package api

import (
	"context"
	"la-erp-recovered/backend/internal/business"
	"testing"
)

func TestConcurrentConfirmationCannotDoublePost(t *testing.T) {
	c, s := setup(t)
	p := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	doc := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": wh, "lines": []any{map[string]any{"product_id": p, "qty": 10, "unit_cost": 3}}}).(map[string]any)
	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := s.business().Transition(context.Background(), business.Documents["stock-ins"], doc["id"].(string), doc["created_by"].(string), false)
			done <- err
		}()
	}
	successes := 0
	for i := 0; i < 2; i++ {
		if <-done == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("successful confirmations=%d", successes)
	}
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements").Scan(&count)
	if count != 1 {
		t.Fatalf("posted movements=%d", count)
	}
	balance := c.ok("GET", "/api/v1/inventory-balances", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if balance["qty_available"] != "10" {
		t.Fatal("stock was posted twice", balance)
	}
}

func TestDraftEditFailurePreservesOldDetails(t *testing.T) {
	c, _ := setup(t)
	p := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	doc := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": wh, "lines": []any{map[string]any{"product_id": p, "qty": 2, "unit_cost": 3}}}).(map[string]any)
	path := "/api/v1/stock-ins/" + doc["id"].(string)
	status, _ := c.request("PUT", path, map[string]any{"warehouse_id": wh, "remark": "不能提交", "lines": []any{map[string]any{"product_id": p, "qty": 5, "unit_cost": 3}, map[string]any{"product_id": "missing", "qty": 1, "unit_cost": 2}}})
	if status != 400 {
		t.Fatal(status)
	}
	unchanged := c.ok("GET", path, nil).(map[string]any)
	if unchanged["total_qty"] != "2" || unchanged["total_amount"] != "6" || unchanged["remark"] != nil {
		t.Fatal("failed edit changed header", unchanged)
	}
	line := unchanged["edges"].(map[string]any)["lines"].([]any)[0].(map[string]any)
	if line["id"] != doc["edges"].(map[string]any)["lines"].([]any)[0].(map[string]any)["id"] {
		t.Fatal("failed edit replaced original detail")
	}
	c.ok("DELETE", path, nil)
	if status, _ := c.request("GET", path, nil); status != 404 {
		t.Fatal(status)
	}
	inventory := c.ok("GET", "/api/v1/inventory-balances", nil).(map[string]any)
	if inventory["total"] != float64(0) {
		t.Fatal("draft deletion changed inventory", inventory)
	}
}
