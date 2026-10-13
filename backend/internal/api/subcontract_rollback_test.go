package api

import "testing"

func TestSubcontractMaterialReplacementRollsBackHeaderAndLines(t *testing.T) {
	c, s := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	supplier := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	order := c.ok("POST", "/api/v1/subcontract-orders", map[string]any{
		"qty": 2, "supplier_id": supplier["id"], "mode": "with_material", "remark": "original",
		"material_lines": []any{map[string]any{"product_id": product["id"], "qty": 4}},
	}).(map[string]any)
	id := order["id"].(string)
	original := order["edges"].(map[string]any)["material_lines"].([]any)[0].(map[string]any)
	if _, err := s.Store.DB.Exec(`CREATE TRIGGER fail_subcontract_replacement BEFORE INSERT ON subcontract_order_material_lines WHEN NEW.qty=5 BEGIN SELECT RAISE(ABORT,'replacement failure'); END`); err != nil {
		t.Fatal(err)
	}
	_, failure := c.request("PUT", "/api/v1/subcontract-orders/"+id, map[string]any{
		"remark": "changed", "qty": 3, "material_lines": []any{map[string]any{"product_id": product["id"], "qty": 5}},
	})
	if failure["code"] == float64(0) {
		t.Fatal("replacement failure reported success")
	}
	current := c.ok("GET", "/api/v1/subcontract-orders/"+id, nil).(map[string]any)
	line := current["edges"].(map[string]any)["material_lines"].([]any)[0].(map[string]any)
	if current["remark"] != "original" || current["qty"] != "2" || line["id"] != original["id"] || line["qty"] != "4" {
		t.Fatal("failed replacement left partial changes", current)
	}
	if _, err := s.Store.DB.Exec("DROP TRIGGER fail_subcontract_replacement"); err != nil {
		t.Fatal(err)
	}
	c.ok("PUT", "/api/v1/subcontract-orders/"+id, map[string]any{"material_lines": []any{map[string]any{"product_id": product["id"], "qty": 5}}})
	var deleted string
	if err := s.Store.DB.QueryRow("SELECT deleted_at FROM subcontract_order_material_lines WHERE id=?", original["id"]).Scan(&deleted); err != nil || deleted == "" {
		t.Fatal("replacement did not soft delete previous line", deleted, err)
	}
	if _, err := s.Store.DB.Exec(`CREATE TRIGGER fail_subcontract_delete BEFORE UPDATE ON subcontract_orders WHEN NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'delete failure'); END`); err != nil {
		t.Fatal(err)
	}
	_, failure = c.request("DELETE", "/api/v1/subcontract-orders/"+id, nil)
	if failure["code"] == float64(0) {
		t.Fatal("failed header deletion reported success")
	}
	current = c.ok("GET", "/api/v1/subcontract-orders/"+id, nil).(map[string]any)
	if len(current["edges"].(map[string]any)["material_lines"].([]any)) != 1 {
		t.Fatal("failed header deletion removed material lines")
	}
	if _, err := s.Store.DB.Exec("DROP TRIGGER fail_subcontract_delete"); err != nil {
		t.Fatal(err)
	}
	c.ok("DELETE", "/api/v1/subcontract-orders/"+id, nil)
	var active int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM subcontract_order_material_lines WHERE subcontract_order_id=? AND deleted_at IS NULL", id).Scan(&active); err != nil || active != 0 {
		t.Fatal("successful deletion left active materials", active, err)
	}
}
