package api

import "testing"

func TestLoanLifecycleMovesInventoryAndReversesOnReturn(t *testing.T) {
	c, _ := setup(t)
	products := c.ok("GET", "/api/v1/products?page_size=1", nil).(map[string]any)
	items, _ := products["items"].([]any); if items == nil { if e, ok := products["edges"].(map[string]any); ok { items, _ = e["items"].([]any) } }; if len(items) == 0 { t.Skip("no seeded product") }
	p := items[0].(map[string]any)
	warehouses := c.ok("GET", "/api/v1/warehouses?page_size=1", nil).(map[string]any)
	ws, _ := warehouses["items"].([]any); if ws == nil { if e, ok := warehouses["edges"].(map[string]any); ok { ws, _ = e["items"].([]any) } }; if len(ws) == 0 { t.Skip("no seeded warehouse") }
	w := ws[0].(map[string]any)
	loan := c.ok("POST", "/api/v1/loan-orders", map[string]any{"warehouse_id": w["id"], "party_name": "测试客户", "lines": []any{map[string]any{"product_id": p["id"], "qty": "1", "unit_cost": "2"}}}).(map[string]any)
	id := loan["id"].(string)
	confirmed := c.ok("POST", "/api/v1/loan-orders/"+id+"/confirm", nil).(map[string]any)
	if confirmed["status"] != "confirmed" { t.Fatalf("confirm status: %#v", confirmed) }
	line := confirmed["lines"].([]any)[0].(map[string]any)
	returned := c.ok("POST", "/api/v1/loan-orders/"+id+"/return", map[string]any{"lines": []any{map[string]any{"id": line["id"], "qty": "1"}}}).(map[string]any)
	if returned["status"] != "returned" { t.Fatalf("return status: %#v", returned) }
	_, body := c.request("POST", "/api/v1/loan-orders/"+id+"/return", map[string]any{"lines": []any{map[string]any{"id": line["id"], "qty": "1"}}})
	if body["code"] == nil || body["code"].(float64) == 0 { t.Fatalf("duplicate return accepted: %#v", body) }
}
