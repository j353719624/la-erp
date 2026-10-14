package api

import (
	"testing"
)

// 本文件固化批次 I 取证（2026-10-14）的结论：银行对账对「同额候选」与「非 CNY」
// 不整批报错，外协单状态守卫。证据见
// evidence/backend-runtime/audit-batch-i{,-i2}-20261014.json。

type batchIEnv struct {
	client    *client
	server    *Server
	supplier  map[string]any
	cash      map[string]any
	account   map[string]any
	timestamp string
}

func batchISetup(t *testing.T, code string) batchIEnv {
	t.Helper()
	c, s := setup(t)
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"code": code + "-S", "name": code + "-供应商"}).(map[string]any)
	accounts, err := s.Store.Rows(t.Context(), "SELECT * FROM accounts WHERE code='1001'")
	if err != nil || len(accounts) != 1 {
		t.Fatal(err)
	}
	account := c.ok("POST", "/api/v1/bank/accounts", map[string]any{
		"name": code + " 银行", "account_no": "6222" + itoa(len(code)*137%100000000),
	}).(map[string]any)
	return batchIEnv{c, s, supplier, accounts[0], account, batchBDate()}
}

// II1：同额多张付款单时对账不整批失败（原版 code:0）。
func TestRecoveredReconcileToleratesDuplicateAmounts(t *testing.T) {
	e := batchISetup(t, "II-DUP")
	date := e.timestamp
	mkPayment := func(invoice map[string]any) map[string]any {
		p := e.client.ok("POST", "/api/v1/payments", map[string]any{
			"supplier_id": e.supplier["id"], "payment_date": date, "amount": 100, "payment_type": "normal",
			"cash_account_id": e.cash["id"], "cash_account_code": e.cash["code"], "cash_account_name": e.cash["name"],
			"lines": []any{map[string]any{"ap_invoice_id": invoice["id"], "amount": 100}},
		}).(map[string]any)
		e.client.ok("POST", "/api/v1/payments/"+p["id"].(string)+"/confirm", nil)
		return p
	}
	for i := 0; i < 2; i++ {
		invoice := e.client.ok("POST", "/api/v1/ap-invoices", map[string]any{
			"supplier_id": e.supplier["id"], "invoice_date": date, "total_amount": 100,
		}).(map[string]any)
		mkPayment(invoice)
	}
	e.client.ok("POST", "/api/v1/bank/statements", map[string]any{
		"account_id": e.account["id"], "statement_date": date, "amount": 100, "direction": "debit",
	})
	// 关键断言：对账不得整批失败。
	e.client.ok("POST", "/api/v1/bank/reconcile?account_id="+e.account["id"].(string), nil)
	e.client.ok("GET", "/api/v1/bank/reconcile-summary?account_id="+e.account["id"].(string), nil)
}

// II2：非 CNY 付款单参与对账也不整批失败。
func TestRecoveredReconcileToleratesForeignCurrency(t *testing.T) {
	e := batchISetup(t, "II-EUR")
	date := e.timestamp
	invoice := e.client.ok("POST", "/api/v1/ap-invoices", map[string]any{
		"supplier_id": e.supplier["id"], "invoice_date": date, "total_amount": 100,
	}).(map[string]any)
	payment := e.client.ok("POST", "/api/v1/payments", map[string]any{
		"supplier_id": e.supplier["id"], "payment_date": date, "amount": 10, "payment_type": "normal",
		"currency_code": "EUR", "exchange_rate": 7.8,
		"cash_account_id": e.cash["id"], "cash_account_code": e.cash["code"], "cash_account_name": e.cash["name"],
		"lines": []any{map[string]any{"ap_invoice_id": invoice["id"], "amount": 10}},
	}).(map[string]any)
	e.client.ok("POST", "/api/v1/payments/"+payment["id"].(string)+"/confirm", nil)
	e.client.ok("POST", "/api/v1/bank/statements", map[string]any{
		"account_id": e.account["id"], "statement_date": date, "amount": 78, "direction": "debit",
	})
	e.client.ok("POST", "/api/v1/bank/reconcile?account_id="+e.account["id"].(string), nil)
}

// II3/II4：银行记录删除守卫与原文案一致。
func TestRecoveredBankDeleteGuards(t *testing.T) {
	c, _ := setup(t)
	account := c.ok("POST", "/api/v1/bank/accounts", map[string]any{
		"name": "II 删除验证", "account_no": "6223111100000001",
	}).(map[string]any)
	// 空账户可删。
	if _, body := c.request("DELETE", "/api/v1/bank/accounts/"+account["id"].(string), nil); body["code"] != float64(0) {
		t.Fatalf("empty bank account not deletable: %#v", body)
	}
	// 有流水时拒绝，文案逐字对齐原版。
	withFlow := c.ok("POST", "/api/v1/bank/accounts", map[string]any{
		"name": "II 有流水", "account_no": "6223111100000002",
	}).(map[string]any)
	c.ok("POST", "/api/v1/bank/statements", map[string]any{
		"account_id": withFlow["id"], "statement_date": batchBDate(), "amount": 10, "direction": "debit",
	})
	_, body := c.request("DELETE", "/api/v1/bank/accounts/"+withFlow["id"].(string), nil)
	if body["code"] == float64(0) || fmtMessage(body) != "该账户存在对账单记录，不能删除" {
		t.Fatalf("bank account with statements: %#v", body)
	}
}

// II5：外协单状态守卫与原文案一致；取消可重复执行。
func TestRecoveredSubcontractStateGuards(t *testing.T) {
	e := batchISetup(t, "II-SUB")
	date := e.timestamp
	product := e.client.ok("POST", "/api/v1/products", map[string]any{"code": "II-SUB-P", "name": "II-SUB"}).(map[string]any)
	// 校验类守卫
	for _, tc := range []struct {
		name string
		body map[string]any
		want string
	}{
		{"bad_mode", map[string]any{"supplier_id": e.supplier["id"], "qty": 2, "mode": "garbage"}, "外协业务模式无效（仅支持 pure/with_material）"},
		{"no_supplier", map[string]any{"qty": 2, "mode": "pure"}, "外协供应商不能为空"},
		{"zero_qty", map[string]any{"supplier_id": e.supplier["id"], "qty": 0, "mode": "pure"}, "外协数量必须大于0"},
	} {
		_, body := e.client.request("POST", "/api/v1/subcontract-orders", tc.body)
		if body["code"] == float64(0) || fmtMessage(body) != tc.want {
			t.Fatalf("%s: %#v", tc.name, body["message"])
		}
	}
	// 取消可重复（原版 code:0）
	order := e.client.ok("POST", "/api/v1/subcontract-orders", map[string]any{
		"supplier_id": e.supplier["id"], "product_id": product["id"], "qty": 2, "mode": "pure", "remark": date,
	}).(map[string]any)
	path := "/api/v1/subcontract-orders/" + order["id"].(string)
	e.client.ok("POST", path+"/cancel", nil)
	e.client.ok("POST", path+"/cancel", nil)
	// 已取消的外协单不允许完成
	if _, body := e.client.request("POST", path+"/complete", nil); body["code"] == float64(0) {
		t.Fatal("cancelled subcontract completed")
	}
}

// II6：负损耗率 BOM 在恢复端保持拒绝（原版缺失该校验，属缺陷不对齐）。
func TestRecoveredMrpRejectsNegativeScrap(t *testing.T) {
	c, product, _, _ := recoveredFixture(t, "II-SCRAP")
	if _, body := c.request("POST", "/api/v1/boms", map[string]any{
		"name": "II 负损耗", "product_id": product["id"],
		"items": []any{map[string]any{"product_id": product["id"], "qty": 4, "scrap_rate": -0.1}},
	}); body["code"] == float64(0) {
		t.Fatalf("negative scrap accepted, recovered side must keep rejecting it: %#v", body)
	}
	// MRP 端点本身可用（GET /mrp/requirements 返回 code:0 即视为健康）。
	if _, body := c.request("GET", "/api/v1/mrp/requirements?page_size=3", nil); body["code"] != float64(0) {
		t.Fatalf("MRP requirements endpoint broken: %#v", body)
	}
}
