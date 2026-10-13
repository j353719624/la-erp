package api

import "testing"

func TestOriginalFIFOCostMethodUsesWeightedAverage(t *testing.T) {
	c, _ := setup(t)
	p := c.ok("POST", "/api/v1/products", map[string]any{"code": "FIFO-ORIGINAL", "name": "Original fifo", "cost_method": "fifo"}).(map[string]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	for _, cost := range []int{11, 23} {
		h := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": wh["id"], "type": "other", "lines": []any{map[string]any{"product_id": p["id"], "qty": 2, "unit_cost": cost}}}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+h["id"].(string)+"/confirm", map[string]any{})
	}
	h := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": wh["id"], "type": "sales", "lines": []any{map[string]any{"product_id": p["id"], "qty": 3, "unit_cost": 99}}}).(map[string]any)
	result := c.ok("POST", "/api/v1/stock-outs/"+h["id"].(string)+"/confirm", map[string]any{}).(map[string]any)
	if result["total_amount"] != "51" {
		t.Fatal(result)
	}
	b := c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if b["qty_available"] != "1" || b["avg_cost"] != "17" {
		t.Fatal(b)
	}
}
