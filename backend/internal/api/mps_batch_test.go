package api

import (
	"context"
	"reflect"
	"testing"
)

func TestMPSSecondWorkOrderFailureRollsBackWholeBatch(t *testing.T) {
	c, s := setup(t)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "MPS-BATCH-C", "name": "MPS batch customer"}).(map[string]any)
	lines := []any{}
	productIDs := []any{}
	for i, code := range []string{"MPS-BATCH-A", "MPS-BATCH-B"} {
		kind := "finished"
		if i == 1 {
			kind = "raw_material"
		}
		product := c.ok("POST", "/api/v1/products", map[string]any{"code": code, "name": code, "product_type": kind, "min_order_qty": 5, "cost_method": "weighted_avg"}).(map[string]any)
		productIDs = append(productIDs, product["id"])
		lines = append(lines, map[string]any{"product_id": product["id"], "qty": 6, "price": 1})
		stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{map[string]any{"product_id": product["id"], "qty": 10, "unit_cost": 1}}}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", nil)
	}
	sale := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": customer["id"], "warehouse_id": warehouse["id"], "order_date": "2026-10-15T00:00:00+08:00", "lines": lines}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+sale["id"].(string)+"/confirm", nil)
	plan := c.ok("POST", "/api/v1/mps-plans", map[string]any{"period_start": "2026-10-01T00:00:00+08:00", "period_end": "2026-10-31T23:59:59+08:00", "product_ids": productIDs}).(map[string]any)
	ctx := context.Background()
	before, err := s.Store.Rows(ctx, "SELECT * FROM number_counters ORDER BY prefix")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Store.DB.Exec("CREATE TRIGGER fail_second_mps BEFORE INSERT ON work_orders WHEN NEW.product_code='MPS-BATCH-B' BEGIN SELECT RAISE(ABORT,'second work order failed'); END"); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/mps-plans/" + plan["id"].(string)
	status, response := c.request("POST", path+"/generate-work-orders", nil)
	if status != 200 || response["code"] != float64(10000) {
		t.Fatal(status, response)
	}
	orders, err := s.Store.Rows(ctx, "SELECT * FROM work_orders WHERE product_code LIKE 'MPS-BATCH-%'")
	if err != nil || len(orders) != 0 {
		t.Fatal("partial work orders", orders, err)
	}
	after, err := s.Store.Rows(ctx, "SELECT * FROM number_counters ORDER BY prefix")
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("counter was not rolled back", before, after, err)
	}
	detail := c.ok("GET", path, nil).(map[string]any)
	if detail["status"] != "draft" {
		t.Fatal(detail)
	}
	for _, line := range detail["edges"].(map[string]any)["lines"].([]any) {
		if line.(map[string]any)["status"] != "pending" {
			t.Fatal(line)
		}
	}
	if _, err := s.Store.DB.Exec("DROP TRIGGER fail_second_mps"); err != nil {
		t.Fatal(err)
	}
	result := c.ok("POST", path+"/generate-work-orders", nil).(map[string]any)
	if result["created"] != float64(2) {
		t.Fatal(result)
	}
	orders, err = s.Store.Rows(ctx, "SELECT * FROM work_orders WHERE product_code LIKE 'MPS-BATCH-%'")
	if err != nil || len(orders) != 2 {
		t.Fatal(orders, err)
	}
	for _, order := range orders {
		if order["bom_id"] != nil || order["warehouse_id"] != nil || order["qty"] != int64(2) {
			t.Fatal(order)
		}
	}
}
