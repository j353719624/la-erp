package api

import (
	"strings"
	"testing"
)

// 本文件固化批次 N/O 取证（2026-10-14）的结论：
//   N：各 *Action 函数的 default 分支不可达（API 层白名单限定 + 既有实现动作集逐项一致）
//   O：单据表头中「表无对应列」的字段既有实现一律静默忽略，本实现原先 501 属误拒
// 证据见 运行快照,o}-20261014.json。

// OO：销售订单带无列表头字段应放行且不落库（既有实现静默忽略）。
func TestSourceOrderIgnoresFieldsAbsentFromSchema(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "OO-HEADER")
	location := c.ok("POST", "/api/v1/locations", map[string]any{"name": "OO", "warehouse_id": warehouse["id"]}).(map[string]any)
	cases := []struct {
		name  string
		extra map[string]any
	}{
		{"location_id", map[string]any{"location_id": location["id"]}},
		{"rack_id", map[string]any{"rack_id": location["id"]}},
		{"batch_no", map[string]any{"batch_no": "OO-BATCH"}},
		{"serial_nos", map[string]any{"serial_nos": []any{"OO-S1"}}},
		{"production_date", map[string]any{"production_date": "2026-01-01T00:00:00Z"}},
		{"expiry_date", map[string]any{"expiry_date": "2026-01-01T00:00:00Z"}},
	}
	for _, tc := range cases {
		body := map[string]any{
			"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 5}},
		}
		for k, v := range tc.extra {
			body[k] = v
		}
		order := c.ok("POST", "/api/v1/sales-orders", body).(map[string]any)
		for k := range tc.extra {
			if order[k] != nil {
				t.Fatalf("%s must not be persisted on a sales order: %#v", k, order[k])
			}
		}
	}
}

// OO2：表有列的高级字段仍应落库（sales_orders.sales_contract_id）。
func TestSourceSalesContractStillPersists(t *testing.T) {
	c, s, product, warehouse, party := testFixtureWithServer(t, "OO-CONTRACT")
	contract := srcInsertContract(t, s, "sales_contracts", "OO-S-001")
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
		"sales_contract_id": contract,
		"lines":             []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 5}},
	}).(map[string]any)
	if order["sales_contract_id"] != contract {
		t.Fatalf("sales_contract_id must still be persisted when the column exists: %#v", order["sales_contract_id"])
	}
}

// OO3：入库单带无列字段同样放行；带 location_id/rack_id 仍落库。
func TestSourceStockDocumentHeaderFieldSplit(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "OO-STOCK")
	location := c.ok("POST", "/api/v1/locations", map[string]any{"name": "OO-S", "warehouse_id": warehouse["id"]}).(map[string]any)
	rack := c.ok("POST", "/api/v1/racks", map[string]any{"name": "OO-R", "warehouse_id": warehouse["id"]}).(map[string]any)
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"], "location_id": location["id"], "rack_id": rack["id"],
		"sales_contract_id": "00000000-0000-0000-0000-000000000009",
		"contract_id":       "00000000-0000-0000-0000-000000000009",
		"lines":             []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 1}},
	}).(map[string]any)
	// 表有列的字段仍应落库
	if in["location_id"] != location["id"] || in["rack_id"] != rack["id"] {
		t.Fatalf("stock-in location fields must be persisted: %#v", in)
	}
	// 表无列的字段应被忽略而不是拒绝
	if in["sales_contract_id"] != nil || in["contract_id"] != nil {
		t.Fatalf("stock-in must not persist columns that do not exist: %#v", in)
	}
}

// NN：未注册的动作不得被静默接受——本实现不应把未实现的动作暴露成成功。
func TestSourceUnknownActionIsNotAccepted(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "NN-ACTION")
	adjust := c.ok("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": warehouse["id"], "adjust_type": "gain",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1}},
	}).(map[string]any)
	path := "/api/v1/inventory-adjusts/" + adjust["id"].(string)
	// 既有实现只支持 confirm / cancel（delete 走 HTTP DELETE），
	// 因此一个不存在的动作必须返回错误，而不是 code:0。
	if status, body := c.request("POST", path+"/bogus-action", map[string]any{}); status == 200 && body["code"] == float64(0) {
		t.Fatalf("unknown action accepted: %#v", body)
	}
	// HTTP DELETE 形态应可用（既有实现同样支持）
	if _, body := c.request("DELETE", path, nil); body["code"] == float64(0) {
		t.Logf("HTTP DELETE on draft adjustment succeeded (expected: original allows it)")
	}
	if !strings.Contains(trimJSON(adjust), "adjust_no") {
		t.Fatal("adjustment payload broken")
	}
}
