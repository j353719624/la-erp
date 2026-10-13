package api

import "testing"

func TestDraftWorkOrderDeletionRollsBackSnapshots(t *testing.T) {
	c, s := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "WO-DELETE-FIN", "name": "WO-DELETE-FIN", "product_type": "finished", "cost_method": "weighted_avg"}).(map[string]any)
	raw := c.ok("POST", "/api/v1/products", map[string]any{"code": "WO-DELETE-RAW", "name": "WO-DELETE-RAW", "product_type": "raw_material", "cost_method": "weighted_avg"}).(map[string]any)
	bom := c.ok("POST", "/api/v1/boms", map[string]any{"product_id": product["id"], "items": []any{map[string]any{"product_id": raw["id"], "qty": 2}}}).(map[string]any)
	routing := c.ok("POST", "/api/v1/routings", map[string]any{"product_id": product["id"], "steps": []any{map[string]any{"process_code": "DELETE", "process_name": "DELETE"}}}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	order := c.ok("POST", "/api/v1/work-orders", map[string]any{"product_id": product["id"], "qty": 2, "bom_id": bom["id"], "routing_id": routing["id"], "warehouse_id": warehouse["id"]}).(map[string]any)
	id := order["id"].(string)
	count := func(table, predicate string) int {
		var n int
		field := "work_order_id"
		if table == "work_orders" {
			field = "id"
		}
		if err := s.Store.DB.QueryRow("SELECT count(*) FROM "+table+" WHERE "+field+"=? AND "+predicate, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if _, err := s.Store.DB.Exec("CREATE TRIGGER fail_work_order_delete BEFORE UPDATE OF deleted_at ON work_order_processes BEGIN SELECT RAISE(ABORT,'process snapshot deletion failed'); END"); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/work-orders/" + id
	status, response := c.request("DELETE", path, nil)
	if status != 200 || response["code"] != float64(10000) {
		t.Fatal(status, response)
	}
	for _, table := range []string{"work_orders", "work_order_materials", "work_order_processes"} {
		if count(table, "deleted_at IS NULL") != 1 {
			t.Fatal("partial delete", table)
		}
	}
	if _, err := s.Store.DB.Exec("DROP TRIGGER fail_work_order_delete"); err != nil {
		t.Fatal(err)
	}
	c.ok("DELETE", path, nil)
	for _, table := range []string{"work_orders", "work_order_materials", "work_order_processes"} {
		if count(table, "deleted_at IS NOT NULL") != 1 {
			t.Fatal("snapshot not deleted", table)
		}
	}
	var matching int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM work_order_materials m JOIN work_orders h ON m.work_order_id=h.id JOIN work_order_processes p ON p.work_order_id=h.id WHERE h.id=? AND m.deleted_at=h.deleted_at AND p.deleted_at=h.deleted_at", id).Scan(&matching); err != nil || matching != 1 {
		t.Fatal("deletion timestamps", matching, err)
	}
	status, response = c.request("GET", path, nil)
	if status != 404 || response["message"] != "工单不存在" {
		t.Fatal(status, response)
	}
	status, response = c.request("DELETE", path, nil)
	if status != 200 || response["code"] != float64(10000) || response["message"] != "工单不存在" {
		t.Fatal(status, response)
	}
}
