package api

import (
	"context"
	"testing"
)

func TestConcurrentStocktakeCompletionPostsDifferenceOnce(t *testing.T) {
	c, s := setup(t)
	p := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"type": "other", "warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 5, "unit_cost": 7}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", nil)
	check := c.ok("POST", "/api/v1/inventory-checks", map[string]any{"warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": p["id"], "actual_qty": 8}}}).(map[string]any)
	path := "/api/v1/inventory-checks/" + check["id"].(string)
	c.ok("POST", path+"/start", nil)
	c.ok("PUT", path, map[string]any{"warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": p["id"], "actual_qty": 8}}})
	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := s.business().CheckAction(context.Background(), check["id"].(string), "complete", stock["created_by"].(string))
			done <- err
		}()
	}
	success := 0
	for i := 0; i < 2; i++ {
		if <-done == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("completion successes=%d", success)
	}
	result := c.ok("GET", path, nil).(map[string]any)
	if result["profit_amount"] != "21" || result["profit_items"] != float64(1) {
		t.Fatal(result)
	}
	balance := c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if balance["qty_available"] != "8" {
		t.Fatal(balance)
	}
	var count int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_type='check'").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal(count)
	}
}

func TestStocktakeSecondLineUnderflowRollsBackWholeCompletion(t *testing.T) {
	c, s := setup(t)
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	p, q := products[0].(map[string]any), products[1].(map[string]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	seed := func(lines []any) {
		stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"type": "other", "warehouse_id": wh["id"], "lines": lines}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", nil)
	}
	seed([]any{map[string]any{"product_id": p["id"], "qty": 5, "unit_cost": 7}, map[string]any{"product_id": q["id"], "qty": 3, "unit_cost": 7}})
	lines := []any{map[string]any{"product_id": p["id"], "actual_qty": 8}, map[string]any{"product_id": q["id"], "actual_qty": 0}}
	check := c.ok("POST", "/api/v1/inventory-checks", map[string]any{"warehouse_id": wh["id"], "lines": lines}).(map[string]any)
	path := "/api/v1/inventory-checks/" + check["id"].(string)
	c.ok("POST", path+"/start", nil)
	c.ok("PUT", path, map[string]any{"warehouse_id": wh["id"], "lines": lines})
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": q["id"], "qty": 2}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
	status, response := c.request("POST", path+"/complete", nil)
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("second-line underflow accepted: %d %v", status, response)
	}
	pBalance := c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if pBalance["qty_available"] != "5" {
		t.Fatal(pBalance)
	}
	result := c.ok("GET", path, nil).(map[string]any)
	if result["status"] != "checking" || result["profit_amount"] != "0" {
		t.Fatal(result)
	}
	var count int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_type='check'").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal(count)
	}
}
