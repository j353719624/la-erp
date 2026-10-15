package api

import (
	"context"
	"fmt"
	"testing"

	"la-erp/backend/internal/business"
)

// 批次 PP（2026-10-15）· 剩余 4 处自动过账点的形态对齐。
//
// 证据文件：
//   运行快照  （收付款单/出入库/退货/税金）
//   运行快照  （调拨拦截、0 金额分录、税金形态）
//   运行快照（凭证与分录形态干净取样）
//
// 已对齐（autopost3 逐字一致，此处不再重复锁定）：
// 收款单确认 / 付款单确认 / 采购入库确认。

// TestStockOrderRejectsManualTransferType 既有实现禁止手工创建调拨类出/入库单。
//
// 既有实现在**写路径**（POST 建单与 PUT 改单）上专门拦截 type=transfer，
// 出库与入库是**两句不同**的文案；但 confirm 不拦
// （已存量的 transfer 单据 confirm 实测 code:0）—— 故这里只锁写路径。
func TestStockOrderRejectsManualTransferType(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	const (
		outText = "调拨发货请使用「库存调拨单」完成，禁止手工创建/确认「调拨出库」类出库单（请删除该单或改用其他类型）"
		inText  = "调拨到货请使用「库存调拨单」完成，禁止手工创建/确认「调拨入库」类入库单（请删除该单或改用其他类型）"
	)
	body := func(dateKey string) map[string]any {
		return map[string]any{
			dateKey:      "2026-05-23T00:00:00+08:00",
			"warehouse_id": warehouses[0]["id"],
			"lines":        []any{map[string]any{"product_id": products[0]["id"], "qty": 1, "unit_cost": 10}},
		}
	}
	cases := []struct {
		name  string
		path  string
		extra map[string]any
		want  string
	}{
		{"出库 POST transfer", "/api/v1/stock-outs", map[string]any{"stock_out_date": body("stock_out_date")["stock_out_date"]}, outText},
		{"入库 POST transfer", "/api/v1/stock-ins", map[string]any{"stock_in_date": body("stock_in_date")["stock_in_date"]}, inText},
	}
	for _, tc := range cases {
		payload := body(map[string]string{
			"/api/v1/stock-outs": "stock_out_date",
			"/api/v1/stock-ins":  "stock_in_date",
		}[tc.path])
		payload["type"] = "transfer"
		if status, got := c.request("POST", tc.path, payload); status != 400 ||
			got["code"] != float64(400) || got["message"] != tc.want {
			t.Errorf("%s = http%d %v, want http400 code=400 %s", tc.name, status, got, tc.want)
		}
	}
	// PUT 改成 transfer 同样被拒（既有实现写路径两侧都拦）
	created := c.ok("POST", "/api/v1/stock-outs", map[string]any{
		"stock_out_date": "2026-05-23T00:00:00+08:00",
		"warehouse_id":   warehouses[0]["id"],
		"type":           "sale",
		"lines":          []any{map[string]any{"product_id": products[0]["id"], "qty": 1, "unit_cost": 10}},
	}).(map[string]any)
	put := map[string]any{
		"stock_out_date": "2026-05-23T00:00:00+08:00",
		"warehouse_id":   warehouses[0]["id"],
		"type":           "transfer",
		"lines":          []any{map[string]any{"product_id": products[0]["id"], "qty": 1, "unit_cost": 10}},
	}
	if status, got := c.request("PUT", "/api/v1/stock-outs/"+created["id"].(string), put); status != 400 ||
		got["code"] != float64(400) || got["message"] != outText {
		t.Errorf("PUT 改 transfer = http%d %v, want http400 code=400 %s", status, got, outText)
	}
	// 非 transfer 的类型不受影响（既有实现对 sales/purchase/garbage 等一律放行）
	free := map[string]any{
		"stock_out_date": "2026-05-23T00:00:00+08:00",
		"warehouse_id":   warehouses[0]["id"],
		"type":           "garbage",
		"lines":          []any{map[string]any{"product_id": products[0]["id"], "qty": 1, "unit_cost": 10}},
	}
	if status, got := c.request("POST", "/api/v1/stock-outs", free); status != 200 || got["code"] != float64(0) {
		t.Errorf("type=garbage = http%d %v, want 200 code=0（既有实现不校验普通类型）", status, got)
	}
}

// TestStockPostingTypeWhitelist 出入库自动过账的 type 是**白名单**而非黑名单。
//
// 受控对照（tools/replay-batch-pp-stocktype.js）：两端各铺同样的货，对 18 个
// type 取值逐个 confirm，只有两个值会过账：
//   出库 → 仅 "sales"    ；入库 → 仅 "purchase"
// 精确匹配且**大小写敏感**（SALES / Sales / sales_out / purchase_in / buy 全不过账）。
//
// ⚠️ 这个用例的存在理由：首版取证用 type="sale"（单数）误得「既有实现出库不过账」，
// 据此删掉过账后，`TestOriginalBusinessFlowReplay` 的 journal_entries 条数
// 从 56 掉到 48 才暴露错误 —— 回归回放快照里 sales_outbound 有 8 条分录。
// 白名单漏一个「s」就会让整条出库业务的账目消失，必须钉死。
func TestStockPostingTypeWhitelist(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	pid, wid := fmt.Sprint(products[0]["id"]), fmt.Sprint(warehouses[0]["id"])
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "PP 出库客户"}).(map[string]any)
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"name": "PP 入库供应商"}).(map[string]any)
	// 铺货（type=other 不过账，不干扰计数）
	stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id":  wid,
		"stock_in_date": "2026-05-01T00:00:00+08:00",
		"type":          "other",
		"lines":         []any{map[string]any{"product_id": pid, "qty": 1000, "unit_cost": 10}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", nil)

	cases := []struct {
		route    string
		dateKey  string
		party    string
		partyID  any
		type_    string // 空串表示不传 type
		wantPost bool
	}{
		// 出库：只有 "sales" 过账
		{"/api/v1/stock-outs", "stock_out_date", "customer_id", customer["id"], "sales", true},
		{"/api/v1/stock-outs", "stock_out_date", "customer_id", customer["id"], "sale", false},
		{"/api/v1/stock-outs", "stock_out_date", "customer_id", customer["id"], "sales_out", false},
		{"/api/v1/stock-outs", "stock_out_date", "customer_id", customer["id"], "SALES", false},
		{"/api/v1/stock-outs", "stock_out_date", "customer_id", customer["id"], "Sales", false},
		{"/api/v1/stock-outs", "stock_out_date", "customer_id", customer["id"], "out", false},
		{"/api/v1/stock-outs", "stock_out_date", "customer_id", customer["id"], "", false},
		{"/api/v1/stock-outs", "stock_out_date", "customer_id", customer["id"], "other", false},
		// 入库：只有 "purchase" 过账
		{"/api/v1/stock-ins", "stock_in_date", "supplier_id", supplier["id"], "purchase", true},
		{"/api/v1/stock-ins", "stock_in_date", "supplier_id", supplier["id"], "purchase_in", false},
		{"/api/v1/stock-ins", "stock_in_date", "supplier_id", supplier["id"], "Purchase", false},
		{"/api/v1/stock-ins", "stock_in_date", "supplier_id", supplier["id"], "buy", false},
		{"/api/v1/stock-ins", "stock_in_date", "supplier_id", supplier["id"], "purchases", false},
		{"/api/v1/stock-ins", "stock_in_date", "supplier_id", supplier["id"], "", false},
		{"/api/v1/stock-ins", "stock_in_date", "supplier_id", supplier["id"], "other", false},
	}
	for _, tc := range cases {
		payload := map[string]any{
			tc.party:       tc.partyID,
			tc.dateKey:     "2026-05-23T00:00:00+08:00",
			"warehouse_id": wid,
			"lines":        []any{map[string]any{"product_id": pid, "qty": 1, "unit_cost": 10}},
		}
		if tc.type_ != "" {
			payload["type"] = tc.type_
		}
		created := c.ok("POST", tc.route, payload).(map[string]any)
		id := created["id"].(string)
		if status, body := c.request("POST", tc.route+"/"+id+"/confirm", nil); status != 200 || body["code"] != float64(0) {
			t.Fatalf("%s type=%q confirm = http%d %v", tc.route, tc.type_, status, body)
		}
		var n int
		if err := s.Store.DB.QueryRow("SELECT count(*) FROM vouchers WHERE source_id=?", id).Scan(&n); err != nil {
			t.Fatalf("查凭证失败: %v", err)
		}
		want := 0
		if tc.wantPost {
			want = 1
		}
		if n != want {
			t.Errorf("%s type=%q 凭证数 = %d, want %d", tc.route, tc.type_, n, want)
		}
	}
}

// TestPostingSkipsZeroAmountEntries 过账时**跳过金额为 0 的分录**，
// 且全部分录都为 0 时**整个凭证不产生**（批次 PP）。
//
// 这条规则的证据是一组受控对照 —— 同一张销售退货单，只改「明细是否带 price」：
//   带 price=200 → 金额 200，两端都是 4 条分录、D=210 C=210
//   不带 price   → 金额被重算为 0，既有实现只落 2 条（成本冲销），本实现原先仍落 4 条
// 即既有实现**确实构造**了收入冲销那两条，只是 0 金额不入账 —— 不是「压根不构造」。
// 采购退货更彻底：两条分录都为 0 时既有实现凭证增量为 0（但 approve 仍 code:0 成功）。
func TestPostingSkipsZeroAmountEntries(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	pid, wid := fmt.Sprint(products[0]["id"]), fmt.Sprint(warehouses[0]["id"])
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "PP 退货客户"}).(map[string]any)
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"name": "PP 退货供应商"}).(map[string]any)
	// 退货会动库存，先铺货（type=other 不过账，避免干扰凭证计数）
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id":  wid,
		"stock_in_date": "2026-05-01T00:00:00+08:00",
		"type":          "other",
		"lines":         []any{map[string]any{"product_id": pid, "qty": 50, "unit_cost": 10}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)

	entryCount := func(sourceID string) (int, bool) {
		rows, err := s.Store.Rows(context.Background(),
			"SELECT e.sequence FROM voucher_entries e JOIN vouchers v ON v.id=e.voucher_entries WHERE v.source_id=? ORDER BY e.sequence", sourceID)
		if err != nil {
			t.Fatalf("查分录失败: %v", err)
		}
		return len(rows), len(rows) > 0
	}
	approve := func(route string, payload map[string]any) string {
		created := c.ok("POST", route, payload).(map[string]any)
		id := created["id"].(string)
		c.ok("POST", route+"/"+id+"/confirm", nil)
		if status, body := c.request("POST", route+"/"+id+"/approve", nil); status != 200 || body["code"] != float64(0) {
			t.Fatalf("%s approve = http%d %v, want 200 code=0", route, status, body)
		}
		return id
	}
	head := func(withPrice bool) map[string]any {
		line := map[string]any{"product_id": pid, "qty": 1, "unit_cost": 10}
		if withPrice {
			line["price"] = 200
		}
		return map[string]any{
			"warehouse_id": wid,
			"order_date":   "2026-05-24T00:00:00+08:00",
			"lines":        []any{line},
		}
	}

	// ① 销售退货金额非 0 → 4 条分录（收入冲销 + 成本冲销）
	full := head(true)
	full["customer_id"] = customer["id"]
	full["total_amount"] = 200
	if n, ok := entryCount(approve("/api/v1/sales-returns", full)); n != 4 || !ok {
		t.Errorf("销售退货（金额 200）分录数 = %d (有凭证=%v), want 4", n, ok)
	}
	// ② 销售退货金额为 0 → 只剩成本冲销的 2 条（0 金额的收入冲销被跳过）
	zero := head(false)
	zero["customer_id"] = customer["id"]
	if n, ok := entryCount(approve("/api/v1/sales-returns", zero)); n != 2 || !ok {
		t.Errorf("销售退货（金额 0）分录数 = %d (有凭证=%v), want 2（0 金额分录不入账）", n, ok)
	}
	// ③ 采购退货两条分录全为 0 → 整个凭证不产生
	pr := head(false)
	pr["supplier_id"] = supplier["id"]
	if n, ok := entryCount(approve("/api/v1/purchase-returns", pr)); ok || n != 0 {
		t.Errorf("采购退货（金额全 0）分录数 = %d (有凭证=%v), want 无凭证", n, ok)
	}
}

// TestTaxPaymentVoucherShape 税金缴纳的凭证形态与其他过账点不同（批次 PP）。
//
// 实测三条差异：
//   ① 凭证 type 是 "payment"，不是通用的 "general"
//   ② 凭证头 remark 被加工成「缴纳税费（<传入 remark>）」
//   ③ 分录 remark 是「缴纳税费」（其余过账点的分录 remark 实测为空）
func TestTaxPaymentVoucherShape(t *testing.T) {
	c, s := setup(t)
	accounts, _ := s.Store.Rows(context.Background(),
		"SELECT id,code FROM accounts WHERE deleted_at IS NULL ORDER BY code LIMIT 2")
	if len(accounts) < 2 {
		t.Skip("missing seed accounts")
	}
	_, err := s.Store.DB.Exec("DELETE FROM vouchers WHERE source_type='tax_payment'")
	if err != nil {
		t.Fatalf("清理历史税金凭证失败: %v", err)
	}
	c.ok("POST", "/api/v1/tax-accruals/pay", map[string]any{
		"items":        []any{map[string]any{"account_code": accounts[0]["code"], "amount": 88}},
		"bank_code":    accounts[1]["code"],
		"pay_date":     "2026-05-26T00:00:00+08:00",
		"post_voucher": true,
		"remark":       "形态验证",
	})
	rows, err := s.Store.Rows(context.Background(),
		"SELECT type,remark,status,total_debit,total_credit FROM vouchers WHERE source_type='tax_payment' ORDER BY created_at DESC")
	if err != nil || len(rows) == 0 {
		t.Fatalf("未找到税金缴纳凭证: %v rows=%d", err, len(rows))
	}
	v := rows[0]
	if fmt.Sprint(v["type"]) != "payment" {
		t.Errorf("凭证 type = %v, want payment（既有实现不是 general）", v["type"])
	}
	if fmt.Sprint(v["remark"]) != "缴纳税费（形态验证）" {
		t.Errorf("凭证 remark = %v, want 缴纳税费（形态验证）", v["remark"])
	}
	if fmt.Sprint(v["status"]) != "posted" {
		t.Errorf("凭证 status = %v, want posted", v["status"])
	}
	if fmt.Sprint(v["total_debit"]) != "88" || fmt.Sprint(v["total_credit"]) != "88" {
		t.Errorf("凭证金额 D=%v C=%v, want 88/88", v["total_debit"], v["total_credit"])
	}
	entries, err := s.Store.Rows(context.Background(),
		"SELECT e.remark FROM voucher_entries e JOIN vouchers v ON v.id=e.voucher_entries WHERE v.source_type='tax_payment' ORDER BY e.sequence")
	if err != nil || len(entries) != 2 {
		t.Fatalf("分录条数 = %d (err=%v), want 2", len(entries), err)
	}
	for i, e := range entries {
		if fmt.Sprint(e["remark"]) != "缴纳税费" {
			t.Errorf("分录%d remark = %v, want 缴纳税费", i+1, e["remark"])
		}
	}
}

// TestTaxPaymentDraftVoucherShape post_voucher=false 时既有实现产出的是**草稿**凭证，
// 但形态与过账分支同源：type=payment、remark 加工、带 source_type=tax_payment。
//
// 本实现原先草稿分支 type=general、remark 原样、且**不打 source_type** ——
// 草稿凭证在列表里无法按来源归属。
func TestTaxPaymentDraftVoucherShape(t *testing.T) {
	c, s := setup(t)
	accounts, _ := s.Store.Rows(context.Background(),
		"SELECT id,code FROM accounts WHERE deleted_at IS NULL ORDER BY code LIMIT 2")
	if len(accounts) < 2 {
		t.Skip("missing seed accounts")
	}
	if _, err := s.Store.DB.Exec("DELETE FROM vouchers WHERE source_type='tax_payment'"); err != nil {
		t.Fatalf("清理历史税金凭证失败: %v", err)
	}
	c.ok("POST", "/api/v1/tax-accruals/pay", map[string]any{
		"items":        []any{map[string]any{"account_code": accounts[0]["code"], "amount": 66}},
		"bank_code":    accounts[1]["code"],
		"pay_date":     "2026-05-27T00:00:00+08:00",
		"post_voucher": false,
		"remark":       "草稿形态",
	})
	rows, err := s.Store.Rows(context.Background(),
		"SELECT type,remark,status,source_type FROM vouchers WHERE source_type='tax_payment'")
	if err != nil || len(rows) != 1 {
		t.Fatalf("草稿凭证条数 = %d (err=%v), want 1", len(rows), err)
	}
	v := rows[0]
	if fmt.Sprint(v["type"]) != "payment" {
		t.Errorf("草稿 type = %v, want payment", v["type"])
	}
	if fmt.Sprint(v["status"]) != "draft" {
		t.Errorf("草稿 status = %v, want draft", v["status"])
	}
	if fmt.Sprint(v["remark"]) != "缴纳税费（草稿形态）" {
		t.Errorf("草稿 remark = %v, want 缴纳税费（草稿形态）", v["remark"])
	}
	entries, err := s.Store.Rows(context.Background(),
		"SELECT e.remark FROM voucher_entries e JOIN vouchers v ON v.id=e.voucher_entries WHERE v.source_type='tax_payment' ORDER BY e.sequence")
	if err != nil || len(entries) != 2 {
		t.Fatalf("草稿分录条数 = %d (err=%v), want 2", len(entries), err)
	}
	for i, e := range entries {
		if fmt.Sprint(e["remark"]) != "缴纳税费" {
			t.Errorf("草稿分录%d remark = %v, want 缴纳税费", i+1, e["remark"])
		}
	}
}

// TestPostingShapeDefaults 其余过账点保持默认形态：type=general、分录无 remark。
//
// 这条是防止把税金缴纳的特例**扩散**到通用过账上 —— 现场取样已证明
// 收款单 / 采购入库 / 销售退货的分录 remark 在既有实现里都是空的。
func TestPostingShapeDefaults(t *testing.T) {
	if got := (business.VoucherShape{}).Type; got != "" {
		t.Errorf("VoucherShape{}.Type = %q, want 空（由 postShaped 回落 general）", got)
	}
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"name": "PP 入库供应商"}).(map[string]any)
	created := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id":  warehouses[0]["id"],
		"supplier_id":   supplier["id"],
		"stock_in_date": "2026-05-22T00:00:00+08:00",
		"type":          "purchase",
		"lines":         []any{map[string]any{"product_id": products[0]["id"], "qty": 2, "unit_cost": 10}},
	}).(map[string]any)
	id := created["id"].(string)
	c.ok("POST", "/api/v1/stock-ins/"+id+"/confirm", nil)
	var vType, remark string
	if err := s.Store.DB.QueryRow("SELECT type,remark FROM vouchers WHERE source_id=?", id).Scan(&vType, &remark); err != nil {
		t.Fatalf("查凭证失败: %v", err)
	}
	if vType != "general" {
		t.Errorf("采购入库凭证 type = %s, want general", vType)
	}
	if remark != "采购入库确认" {
		t.Errorf("采购入库凭证 remark = %s, want 采购入库确认", remark)
	}
	entries, err := s.Store.Rows(context.Background(),
		"SELECT e.remark FROM voucher_entries e JOIN vouchers v ON v.id=e.voucher_entries WHERE v.source_id=? ORDER BY e.sequence", id)
	if err != nil || len(entries) != 2 {
		t.Fatalf("分录条数 = %d (err=%v), want 2", len(entries), err)
	}
	for i, e := range entries {
		if r := fmt.Sprint(e["remark"]); r != "" {
			t.Errorf("分录%d remark = %q, want 空（通用过账的分录不带 remark）", i+1, r)
		}
	}
}
