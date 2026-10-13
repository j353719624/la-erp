package api

import (
	"context"
	"testing"
)

func TestConcurrentTransfersPreserveBothWarehouses(t *testing.T) {
	c, s := setup(t)
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	p := products[0].(map[string]any)
	from := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	to := c.ok("POST", "/api/v1/warehouses", map[string]any{"name": "并发目标仓库", "code": "TRANSFER-TEST"}).(map[string]any)
	stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"type": "other", "warehouse_id": from["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 5, "unit_cost": 7}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", nil)
	docs := []map[string]any{}
	for i := 0; i < 2; i++ {
		docs = append(docs, c.ok("POST", "/api/v1/stock-transfers", map[string]any{"from_warehouse_id": from["id"], "to_warehouse_id": to["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 3, "cost_price": 99}}}).(map[string]any))
	}
	done := make(chan error, 2)
	for _, doc := range docs {
		go func(doc map[string]any) {
			_, err := s.business().TransferAction(context.Background(), doc["id"].(string), "dispatch", stock["created_by"].(string))
			done <- err
		}(doc)
	}
	success := 0
	for i := 0; i < 2; i++ {
		if <-done == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("dispatch successes=%d", success)
	}
	balances, err := s.Store.Rows(context.Background(), "SELECT * FROM inventory_balances WHERE product_id=?", p["id"])
	if err != nil {
		t.Fatal(err)
	}
	if len(balances) != 2 {
		t.Fatal(balances)
	}
	for _, b := range balances {
		expected := "2"
		transit := "0"
		if b["warehouse_id"] == to["id"] {
			expected, transit = "0", "3"
		}
		if s.Store.Public("inventory_balances", b)["qty_available"] != expected || s.Store.Public("inventory_balances", b)["qty_in_transit"] != transit {
			t.Fatal(b)
		}
	}
	var movements int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_type='transfer'").Scan(&movements); err != nil {
		t.Fatal(err)
	}
	if movements != 1 {
		t.Fatalf("movement count=%d", movements)
	}
}

func TestTransferFailureRollsBackEarlierLines(t *testing.T) {
	c, s := setup(t)
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	p, q := products[0].(map[string]any), products[1].(map[string]any)
	from := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	to := c.ok("POST", "/api/v1/warehouses", map[string]any{"name": "回滚目标仓库", "code": "ROLLBACK-TEST"}).(map[string]any)
	stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"type": "other", "warehouse_id": from["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 5, "unit_cost": 7}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", nil)
	doc := c.ok("POST", "/api/v1/stock-transfers", map[string]any{"from_warehouse_id": from["id"], "to_warehouse_id": to["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 3}, map[string]any{"product_id": q["id"], "qty": 1}}}).(map[string]any)
	_, err := s.business().TransferAction(context.Background(), doc["id"].(string), "dispatch", stock["created_by"].(string))
	if err == nil {
		t.Fatal("missing stock accepted")
	}
	balances, err := s.Store.Rows(context.Background(), "SELECT * FROM inventory_balances")
	if err != nil {
		t.Fatal(err)
	}
	if len(balances) != 1 || s.Store.Public("inventory_balances", balances[0])["qty_available"] != "5" {
		t.Fatal(balances)
	}
	var movements int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_type='transfer'").Scan(&movements); err != nil {
		t.Fatal(err)
	}
	if movements != 0 {
		t.Fatal(movements)
	}
	result := c.ok("GET", "/api/v1/stock-transfers/"+doc["id"].(string), nil).(map[string]any)
	if result["status"] != "draft" {
		t.Fatal(result)
	}
	for _, v := range result["edges"].(map[string]any)["lines"].([]any) {
		if v.(map[string]any)["transferred_qty"] != "0" {
			t.Fatal(v)
		}
	}
}
