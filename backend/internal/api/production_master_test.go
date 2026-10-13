package api

import (
	"testing"
)

func TestRoutingDeletionRollbackAndWorkOrderSnapshot(t *testing.T) {
	c, s := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "ROUTE-DELETE-P", "name": "ROUTE-DELETE-P", "product_type": "finished", "cost_method": "weighted_avg"}).(map[string]any)
	center := c.ok("POST", "/api/v1/work-centers", map[string]any{"code": "ROUTE-DELETE-WC", "name": "ROUTE-DELETE-WC"}).(map[string]any)
	routing := c.ok("POST", "/api/v1/routings", map[string]any{"product_id": product["id"], "steps": []any{map[string]any{"process_code": "DEL", "process_name": "DEL", "work_center_id": center["id"], "work_center": center["name"]}}}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	work := c.ok("POST", "/api/v1/work-orders", map[string]any{"product_id": product["id"], "routing_id": routing["id"], "warehouse_id": warehouse["id"], "qty": 1}).(map[string]any)
	if _, err := s.Store.DB.Exec("CREATE TRIGGER fail_routing_delete BEFORE UPDATE OF deleted_at ON routing_steps BEGIN SELECT RAISE(ABORT,'injected step deletion failure'); END"); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/routings/" + routing["id"].(string)
	status, response := c.request("DELETE", path, nil)
	if status != 200 || response["code"] != float64(10000) {
		t.Fatal(status, response)
	}
	detail := c.ok("GET", path, nil).(map[string]any)
	if len(detail["edges"].(map[string]any)["steps"].([]any)) != 1 {
		t.Fatal(detail)
	}
	if _, err := s.Store.DB.Exec("DROP TRIGGER fail_routing_delete"); err != nil {
		t.Fatal(err)
	}
	c.ok("DELETE", path, nil)
	var deleted, steps, snapshots int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM routings WHERE id=? AND deleted_at IS NOT NULL", routing["id"]).Scan(&deleted); err != nil {
		t.Fatal(err)
	}
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM routing_steps r JOIN routings h ON h.id=r.routing_id WHERE h.id=? AND r.deleted_at=h.deleted_at", routing["id"]).Scan(&steps); err != nil {
		t.Fatal(err)
	}
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM work_order_processes WHERE work_order_id=? AND deleted_at IS NULL", work["id"]).Scan(&snapshots); err != nil {
		t.Fatal(err)
	}
	if deleted != 1 || steps != 1 || snapshots != 1 {
		t.Fatal(deleted, steps, snapshots)
	}
	c.ok("DELETE", "/api/v1/work-centers/"+center["id"].(string), nil)
	status, response = c.request("GET", "/api/v1/work-centers/"+center["id"].(string), nil)
	if status != 200 || response["message"] != "工作中心不存在" {
		t.Fatal(status, response)
	}
}
