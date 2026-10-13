package api

import "testing"

func TestOmittedRoutingSequenceRemainsZeroInWorkOrderSnapshot(t *testing.T) {
	c, s := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "ROUTE-SEQ", "name": "ROUTE-SEQ", "product_type": "finished", "cost_method": "weighted_avg"}).(map[string]any)
	routing := c.ok("POST", "/api/v1/routings", map[string]any{"product_id": product["id"], "steps": []any{map[string]any{"process_code": "ZERO", "process_name": "ZERO", "standard_time": 1}}}).(map[string]any)
	step := routing["edges"].(map[string]any)["steps"].([]any)[0].(map[string]any)
	if _, present := step["sequence"]; present {
		t.Fatal("omitted sequence was synthesized", step)
	}
	var sequence int
	if err := s.Store.DB.QueryRow("SELECT sequence FROM routing_steps WHERE id=?", step["id"]).Scan(&sequence); err != nil || sequence != 0 {
		t.Fatal(sequence, err)
	}
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	work := c.ok("POST", "/api/v1/work-orders", map[string]any{"product_id": product["id"], "qty": 1, "routing_id": routing["id"], "warehouse_id": warehouse["id"]}).(map[string]any)
	process := work["edges"].(map[string]any)["processes"].([]any)[0].(map[string]any)
	if _, present := process["sequence"]; present {
		t.Fatal("work-order snapshot changed sequence", process)
	}
}

func TestRoutingHourUnitPersistsIntoWorkOrder(t *testing.T) {
	c, s := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "ROUTE-HOUR", "name": "ROUTE-HOUR", "product_type": "finished", "cost_method": "weighted_avg"}).(map[string]any)
	routing := c.ok("POST", "/api/v1/routings", map[string]any{"product_id": product["id"], "steps": []any{map[string]any{"process_code": "HOUR", "process_name": "HOUR", "standard_time": 2, "standard_time_unit": "hour"}}}).(map[string]any)
	step := routing["edges"].(map[string]any)["steps"].([]any)[0].(map[string]any)
	var unit string
	if err := s.Store.DB.QueryRow("SELECT standard_time_unit FROM routing_steps WHERE id=?", step["id"]).Scan(&unit); err != nil || unit != "hour" {
		t.Fatal(unit, err)
	}
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	work := c.ok("POST", "/api/v1/work-orders", map[string]any{"product_id": product["id"], "qty": 3, "routing_id": routing["id"], "warehouse_id": warehouse["id"]}).(map[string]any)
	process := work["edges"].(map[string]any)["processes"].([]any)[0].(map[string]any)
	if process["standard_time_unit"] != "hour" {
		t.Fatal(process)
	}
}
