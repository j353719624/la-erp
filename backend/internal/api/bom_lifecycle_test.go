package api

import (
	"testing"
)

func TestBOMDeleteFailureRollsBackHeader(t *testing.T) {
	c, s := setup(t)
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	parent, part := products[0].(map[string]any), products[1].(map[string]any)
	bom := c.ok("POST", "/api/v1/boms", map[string]any{"product_id": parent["id"], "items": []any{map[string]any{"product_id": part["id"], "qty": 1}}}).(map[string]any)
	id := bom["id"].(string)
	if _, err := s.Store.DB.Exec("CREATE TRIGGER fail_bom_item_delete BEFORE UPDATE OF deleted_at ON bom_items BEGIN SELECT RAISE(ABORT,'injected item deletion failure'); END"); err != nil {
		t.Fatal(err)
	}
	status, body := c.request("DELETE", "/api/v1/boms/"+id, nil)
	if status != 200 || body["code"] != float64(10000) {
		t.Fatal(status, body)
	}
	for _, query := range []string{"SELECT count(*) FROM bo_ms WHERE id=? AND deleted_at IS NULL", "SELECT count(*) FROM bom_items WHERE bom_id=? AND deleted_at IS NULL"} {
		var n int
		if err := s.Store.DB.QueryRow(query, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatal("delete partially committed", query, n)
		}
	}
	if _, err := s.Store.DB.Exec("DROP TRIGGER fail_bom_item_delete"); err != nil {
		t.Fatal(err)
	}
	c.ok("DELETE", "/api/v1/boms/"+id, nil)
	for _, query := range []string{"SELECT count(*) FROM bo_ms WHERE id=? AND deleted_at IS NOT NULL", "SELECT count(*) FROM bom_items WHERE bom_id=? AND deleted_at IS NOT NULL"} {
		var n int
		if err := s.Store.DB.QueryRow(query, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatal("deleted rows differ", query, n)
		}
	}
	status, body = c.request("POST", "/api/v1/boms/"+id+"/deactivate", map[string]any{})
	if status != 200 || body["code"] != float64(10000) || body["message"] != "BOM不存在" {
		t.Fatal(status, body)
	}
	var state string
	if err := s.Store.DB.QueryRow("SELECT status FROM bo_ms WHERE id=?", id).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "inactive" {
		t.Fatal(state)
	}
}
