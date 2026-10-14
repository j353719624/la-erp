package api

import "testing"

func TestSubcontractIssueAndReturnUpdatesStockAndTotals(t *testing.T) {
	c, s := setup(t)
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	product := products[0].(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	supplier := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{map[string]any{"product_id": product["id"], "qty": 10, "unit_cost": 3}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", map[string]any{})
	order := c.ok("POST", "/api/v1/subcontract-orders", map[string]any{
		"qty": 2, "supplier_id": supplier["id"], "warehouse_id": warehouse["id"], "mode": "with_material",
		"material_lines": []any{map[string]any{"product_id": product["id"], "qty": 4}},
	}).(map[string]any)
	id := order["id"].(string)
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/confirm", map[string]any{})
	line := c.ok("GET", "/api/v1/subcontract-orders/"+id, nil).(map[string]any)["edges"].(map[string]any)["material_lines"].([]any)[0].(map[string]any)
	got := c.ok("POST", "/api/v1/subcontract-orders/"+id+"/issue", []any{map[string]any{"material_line_id": line["id"], "qty": 2}}).(map[string]any)
	issued := got["material_issued_qty"].(string)
	if issued != "2" || got["material_issued_cost"].(string) != "6" {
		t.Fatalf("unexpected issue totals: %#v", got)
	}
	got = c.ok("POST", "/api/v1/subcontract-orders/"+id+"/return-material", []any{map[string]any{"material_line_id": line["id"], "qty": 1}}).(map[string]any)
	if got["material_returned_qty"].(string) != "1" || got["material_returned_cost"].(string) != "3" {
		t.Fatalf("unexpected return totals: %#v", got)
	}
	var available string
	if err := s.Store.DB.QueryRow("SELECT CAST(qty_available AS TEXT) FROM inventory_balances WHERE product_id=? AND warehouse_id=?", product["id"], warehouse["id"]).Scan(&available); err != nil {
		t.Fatal(err)
	}
	if available != "9" {
		t.Fatalf("unexpected available quantity: %s", available)
	}
}

func TestSubcontractReceiveLogsIncrementAndConsumeIssuedMaterial(t *testing.T) {
	c, s := setup(t)
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	product := products[0].(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	supplier := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{map[string]any{"product_id": product["id"], "qty": 10, "unit_cost": 3}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", map[string]any{})
	order := c.ok("POST", "/api/v1/subcontract-orders", map[string]any{"qty": 2, "supplier_id": supplier["id"], "product_id": product["id"], "warehouse_id": warehouse["id"], "unit_price": 5, "mode": "with_material", "material_lines": []any{map[string]any{"product_id": product["id"], "qty": 4}}}).(map[string]any)
	id := order["id"].(string)
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/confirm", map[string]any{})
	line := c.ok("GET", "/api/v1/subcontract-orders/"+id, nil).(map[string]any)["edges"].(map[string]any)["material_lines"].([]any)[0].(map[string]any)
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/issue", []any{map[string]any{"material_line_id": line["id"], "qty": 4}})
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/receive", map[string]any{"qty": 1, "batch": true})
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/receive", map[string]any{"qty": 1, "batch": true})
	detail := c.ok("GET", "/api/v1/subcontract-orders/"+id, nil).(map[string]any)
	logs := detail["edges"].(map[string]any)["receive_logs"].([]any)
	if len(logs) != 2 || logs[0].(map[string]any)["seq"].(float64) != 1 || logs[1].(map[string]any)["seq"].(float64) != 2 {
		t.Fatalf("unexpected receive log sequence: %#v", logs)
	}
	if detail["material_consumed_qty"].(string) != "4" || detail["material_consumed_cost"].(string) != "12" {
		t.Fatalf("unexpected material consumption: %#v", detail)
	}
	if logs[0].(map[string]any)["material_cost"].(string) != "6" || logs[0].(map[string]any)["processing_fee"].(string) != "5" || logs[0].(map[string]any)["unit_cost"].(string) != "11" {
		t.Fatalf("unexpected subcontract landed cost: %#v", logs[0])
	}
	var count int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM subcontract_receive_logs WHERE subcontract_order_id=?", id).Scan(&count); err != nil || count != 2 {
		t.Fatalf("unexpected receive log rows: %d %v", count, err)
	}
}

func TestSubcontractCancelAfterIssueRejectsWithoutInventoryChange(t *testing.T) {
	c, s := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	supplier := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{map[string]any{"product_id": product["id"], "qty": 5, "unit_cost": 3}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", nil)
	order := c.ok("POST", "/api/v1/subcontract-orders", map[string]any{"qty": 1, "supplier_id": supplier["id"], "warehouse_id": warehouse["id"], "mode": "with_material", "material_lines": []any{map[string]any{"product_id": product["id"], "qty": 2}}}).(map[string]any)
	id := order["id"].(string)
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/confirm", nil)
	line := c.ok("GET", "/api/v1/subcontract-orders/"+id, nil).(map[string]any)["edges"].(map[string]any)["material_lines"].([]any)[0].(map[string]any)
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/issue", []any{map[string]any{"material_line_id": line["id"], "qty": 1}})
	status, body := c.request("POST", "/api/v1/subcontract-orders/"+id+"/cancel", nil)
	// 原版回放（2026-10-13，证据 evidence/backend-runtime/audit-subcontract-with-material-20261013.json）：
	// 带料外协发料后取消返回业务错误 code=10000「外协单已发料，请先退回多余材料后再取消」，
	// 而非未恢复分支的 501。断言对齐原版实际响应，并核对库存未被取消动作改变。
	if status != 200 || body["code"] == float64(0) {
		t.Fatalf("issued subcontract cancellation unexpectedly succeeded: %d %#v", status, body)
	}
	if body["message"] != "外协单已发料，请先退回多余材料后再取消" {
		t.Fatalf("unexpected cancel error message: %#v", body["message"])
	}
	var available string
	if err := s.Store.DB.QueryRow("SELECT CAST(qty_available AS TEXT) FROM inventory_balances WHERE product_id=? AND warehouse_id=?", product["id"], warehouse["id"]).Scan(&available); err != nil {
		t.Fatal(err)
	}
	if available != "4" {
		t.Fatalf("cancel changed issued inventory: %s", available)
	}
}
