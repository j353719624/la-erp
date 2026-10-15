package api

import (
	"net/http"
	"testing"
)

// 本文件固化批次 II 的取证结论（2026-10-14 回归回放（参考实例）。
//
// 起因：批次 HH 比对 69 条通用读资源的返回字段集时发现，既有实现列表返回但本实现没有的
// 计算字段共 3 组（work_orders 那组本实现已在 WorkOrderListRecord 里实现，
// 属「按表列比对」的误报，本轮已排除）：
//   ① product_spus.sku_count
//   ② sales_contracts: order_count / ordered_amount / paid_amount / progress_rate / receipt_rate
//   ③ purchase_contracts: order_count / executed_amount / progress_rate
// 前端在合同列表、SPU 列表里直接展示这些字段（ContractList.tsx / SpuList.tsx），
// 属用户可见缺口。
//
// 口径（在既有实现上建受控数据逐个确定）：
//   - 关联订单 = 指向本合同、未软删、且 status != 'cancelled'
//   - 草稿与已确认订单都计入；软删或取消后回落
//   - 比率 = 金额 / 合同金额 × 100，DivRound(2)，尾随零不保留；合同金额为 0 时为 "0"
//   - paid_amount：既有实现无任何订单收款路由，101 张销售订单的 paid_amount 全为 0
//     （批次 BB 结论），故取关联订单 paid_amount 之和
//   - sku_count = 该款下未软删的 SKU 商品数
//
// 证据：运行快照,2,3,5}-20261014.json

// TestBatchIISalesContractProgress 销售合同执行进度：按回归回放的受控序列逐步核对。
func TestBatchIISalesContractProgress(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "II-SC")
	customer := party["customer"].(map[string]any)

	contract := c.ok("POST", "/api/v1/sales-contracts", map[string]any{
		"customer_id": customer["id"], "total_amount": "300",
	}).(map[string]any)

	// 回归回放 II 实测单号前缀为 XSHT（本实现此前写成 SC）
	if no := contract["contract_no"].(string); len(no) < 4 || no[:4] != "XSHT" {
		t.Fatalf("销售合同单号前缀 = %q, want XSHT…", no)
	}

	assert := func(wantCount float64, wantAmount, wantRate string) {
		t.Helper()
		rows := c.ok("GET", "/api/v1/sales-contracts?page=1&page_size=200", nil).(map[string]any)["list"].([]any)
		for _, item := range rows {
			row := item.(map[string]any)
			if row["id"] != contract["id"] {
				continue
			}
			if row["order_count"] != wantCount {
				t.Fatalf("order_count = %v, want %v", row["order_count"], wantCount)
			}
			if row["ordered_amount"] != wantAmount {
				t.Fatalf("ordered_amount = %v, want %v", row["ordered_amount"], wantAmount)
			}
			if row["progress_rate"] != wantRate {
				t.Fatalf("progress_rate = %v, want %v", row["progress_rate"], wantRate)
			}
			// 既有实现 paid_amount / receipt_rate 恒为 0（无订单收款路由）
			if row["paid_amount"] != "0" || row["receipt_rate"] != "0" {
				t.Fatalf("paid_amount/receipt_rate = %v/%v, want 0/0", row["paid_amount"], row["receipt_rate"])
			}
			return
		}
		t.Fatal("合同不在列表里")
	}

	newOrder := func(amount float64) map[string]any {
		return c.ok("POST", "/api/v1/sales-orders", map[string]any{
			"customer_id": customer["id"], "warehouse_id": warehouse["id"],
			"sales_contract_id": contract["id"],
			"lines":             []any{map[string]any{"product_id": product["id"], "qty": 1, "price": amount}},
		}).(map[string]any)
	}

	assert(0, "0", "0") // 初始
	o1 := newOrder(100)
	assert(1, "100", "33.33") // 回放 II-4：100/300
	o2 := newOrder(50)
	assert(2, "150", "50") // 回放 II-6：150/300（尾随零不保留）
	o3 := newOrder(100)
	assert(3, "250", "83.33") // 回放 II-8：250/300

	// 回放 II-9/10：软删一张草稿订单后回落
	c.ok("DELETE", "/api/v1/sales-orders/"+o3["id"].(string), nil)
	assert(2, "150", "50")

	// 回放 II2-13/14：取消一张订单后同样回落（订单仍在，只是状态变 cancelled）
	c.ok("POST", "/api/v1/sales-orders/"+o2["id"].(string)+"/cancel", nil)
	assert(1, "100", "33.33")

	// 详情不含这几个字段（既有实现详情同样没有）
	detail := c.ok("GET", "/api/v1/sales-contracts/"+contract["id"].(string), nil).(map[string]any)
	for _, key := range []string{"order_count", "ordered_amount", "paid_amount", "progress_rate", "receipt_rate"} {
		if _, ok := detail[key]; ok {
			t.Fatalf("销售合同详情不应包含 %s: %v", key, detail[key])
		}
	}
	_ = o1
}

// TestBatchIIPurchaseContractProgress 采购合同执行进度（字段名为 executed_amount）。
func TestBatchIIPurchaseContractProgress(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "II-PC")
	supplier := party["supplier"].(map[string]any)

	contract := c.ok("POST", "/api/v1/purchase-contracts", map[string]any{
		"supplier_id": supplier["id"], "total_amount": "300",
	}).(map[string]any)

	// 回归回放 II 实测单号前缀为 CT（本实现此前写成 PC）
	if no := contract["contract_no"].(string); len(no) < 2 || no[:2] != "CT" {
		t.Fatalf("采购合同单号前缀 = %q, want CT…", no)
	}

	assert := func(wantCount float64, wantAmount, wantRate string) {
		t.Helper()
		rows := c.ok("GET", "/api/v1/purchase-contracts?page=1&page_size=200", nil).(map[string]any)["list"].([]any)
		for _, item := range rows {
			row := item.(map[string]any)
			if row["id"] != contract["id"] {
				continue
			}
			if row["order_count"] != wantCount {
				t.Fatalf("order_count = %v, want %v", row["order_count"], wantCount)
			}
			if row["executed_amount"] != wantAmount {
				t.Fatalf("executed_amount = %v, want %v", row["executed_amount"], wantAmount)
			}
			if row["progress_rate"] != wantRate {
				t.Fatalf("progress_rate = %v, want %v", row["progress_rate"], wantRate)
			}
			return
		}
		t.Fatal("合同不在列表里")
	}

	newOrder := func(amount float64) map[string]any {
		return c.ok("POST", "/api/v1/purchase-orders", map[string]any{
			"supplier_id": supplier["id"], "warehouse_id": warehouse["id"],
			"contract_id": contract["id"],
			"lines":       []any{map[string]any{"product_id": product["id"], "qty": 1, "price": amount}},
		}).(map[string]any)
	}

	assert(0, "0", "0")
	newOrder(100)
	assert(1, "100", "33.33") // 回放 II-14
	newOrder(50)
	assert(2, "150", "50") // 回放 II-16
}

// TestBatchIISpuSkuCount 商品款列表的 sku_count = 该款下未软删的 SKU 商品数。
func TestBatchIISpuSkuCount(t *testing.T) {
	c, _, _, _ := testFixture(t, "II-SPU")
	spu := c.ok("POST", "/api/v1/spus", map[string]any{
		"code": "II-SPU-COUNT", "name": "II 计数款",
		"dims": []any{
			map[string]any{"code": "color", "name": "颜色", "values": []any{"红", "蓝"}},
			map[string]any{"code": "size", "name": "尺码", "values": []any{"S", "L"}},
		},
	}).(map[string]any)

	read := func() float64 {
		t.Helper()
		rows := c.ok("GET", "/api/v1/spus?page=1&page_size=200", nil).(map[string]any)["list"].([]any)
		for _, item := range rows {
			row := item.(map[string]any)
			if row["id"] == spu["id"] {
				return row["sku_count"].(float64)
			}
		}
		t.Fatal("商品款不在列表里")
		return 0
	}

	if got := read(); got != 0 {
		t.Fatalf("新建款 sku_count = %v, want 0", got) // 回放 II-18
	}
	c.ok("POST", "/api/v1/spus/"+spu["id"].(string)+"/skus", map[string]any{"skip_existing": true})
	if got := read(); got != 4 {
		t.Fatalf("生成 2×2 个 SKU 后 sku_count = %v, want 4", got) // 回放 II-20
	}
}

// TestBatchIISimpleDocDeletePayload 6 类轻量单据删除后的 data 形状并不统一，按既有实现逐个固化。
func TestBatchIISimpleDocDeletePayload(t *testing.T) {
	c, product, _, party := testFixture(t, "II-DEL")
	customer := party["customer"].(map[string]any)
	supplier := party["supplier"].(map[string]any)

	// wantDeleted=true 表示既有实现返回 {"deleted":true}；false 表示 data:null
	cases := []struct {
		route   string
		create  map[string]any
		deleted bool
	}{
		{"purchase-requisitions", map[string]any{
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1}},
		}, true},
		{"purchase-rfqs", map[string]any{
			"supplier_id": supplier["id"],
			"lines":       []any{map[string]any{"product_id": product["id"], "qty": 1}},
		}, false},
		{"sales-quotations", map[string]any{
			"customer_id": customer["id"],
			"lines":       []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 10}},
		}, true},
		{"purchase-contracts", map[string]any{"supplier_id": supplier["id"], "total_amount": "10"}, true},
		{"sales-contracts", map[string]any{"customer_id": customer["id"], "total_amount": "10"}, false},
		{"spus", map[string]any{"code": "II-DEL-SPU", "name": "II 删除款"}, false},
	}

	for _, tc := range cases {
		created := c.ok("POST", "/api/v1/"+tc.route, tc.create).(map[string]any)
		status, body := c.request("DELETE", "/api/v1/"+tc.route+"/"+created["id"].(string), nil)
		if status != http.StatusOK || body["code"] != float64(0) {
			t.Fatalf("DELETE /%s = %d %v", tc.route, status, body)
		}
		if tc.deleted {
			data, ok := body["data"].(map[string]any)
			if !ok || data["deleted"] != true {
				t.Fatalf("DELETE /%s data = %v, want {deleted:true}", tc.route, body["data"])
			}
		} else if body["data"] != nil {
			t.Fatalf("DELETE /%s data = %v, want null", tc.route, body["data"])
		}
	}
}
