package api

import (
	"context"
	"la-erp-recovered/backend/internal/business"
	"testing"
)

func TestConcurrentReceiptsCannotOverReceive(t *testing.T) {
	c, s := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	supplier := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	order := c.ok("POST", "/api/v1/purchase-orders", map[string]any{"supplier_id": supplier, "warehouse_id": wh, "lines": []any{map[string]any{"product_id": product["id"], "qty": 3, "price": 15}}}).(map[string]any)
	path := "/api/v1/purchase-orders/" + order["id"].(string)
	c.ok("POST", path+"/confirm", map[string]any{})
	c.ok("POST", path+"/approve", map[string]any{})
	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		doc := c.ok("POST", "/api/v1/stock-ins", map[string]any{"type": "purchase", "warehouse_id": wh, "source_id": order["id"], "source_no": order["order_no"], "lines": []any{map[string]any{"product_id": product["id"], "qty": 2, "unit_cost": 15, "serial_nos": []any{}}}}).(map[string]any)
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
		t.Fatalf("successful receipts=%d", successes)
	}
	order = c.ok("GET", path, nil).(map[string]any)
	if order["edges"].(map[string]any)["lines"].([]any)[0].(map[string]any)["delivered_qty"] != "2" {
		t.Fatal("source quantity was over-received", order)
	}
	balance := c.ok("GET", "/api/v1/inventory-balances", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if balance["qty_available"] != "2" {
		t.Fatal("rejected receipt changed inventory", balance)
	}
	movements := c.ok("GET", "/api/v1/stock-movements", nil).(map[string]any)
	if movements["total"] != float64(1) {
		t.Fatal("rejected receipt left ledger entry", movements)
	}
}

func TestSourceMismatchAndRepeatedApprovalAreRejected(t *testing.T) {
	c, _ := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	supplier := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	order := c.ok("POST", "/api/v1/purchase-orders", map[string]any{"supplier_id": supplier, "warehouse_id": wh, "lines": []any{map[string]any{"product_id": product, "qty": 3, "price": 15}}}).(map[string]any)
	path := "/api/v1/purchase-orders/" + order["id"].(string)
	c.ok("POST", path+"/confirm", map[string]any{})
	c.ok("POST", path+"/approve", map[string]any{})
	_, res := c.request("POST", path+"/approve", map[string]any{})
	if res["code"] != float64(10000) {
		t.Fatal("approval repeated", res)
	}
	if status, _ := c.request("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": wh, "source_id": order["id"], "source_no": "WRONG", "lines": []any{map[string]any{"product_id": product, "qty": 1, "unit_cost": 15}}}); status != 400 {
		t.Fatal("mismatched source number accepted", status)
	}
}
