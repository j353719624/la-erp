package api

import (
	"context"
	"testing"
)

func TestAssemblyOrderLifecycleGuards(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id,name,code FROM products WHERE deleted_at IS NULL LIMIT 1")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id,name FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	order := c.ok("POST", "/api/v1/assemblies", map[string]any{"assembly_no": "ASM-2099-01", "warehouse_id": warehouses[0]["id"], "product_id": products[0]["id"], "product_name": products[0]["name"], "product_code": products[0]["code"], "qty": "1", "unit_cost": "10", "total_cost": "10"}).(map[string]any)
	id := order["id"].(string)
	confirmed := c.ok("POST", "/api/v1/assemblies/"+id+"/confirm", map[string]any{}).(map[string]any)
	if confirmed["status"] != "confirmed" {
		t.Fatalf("unexpected confirm state: %#v", confirmed)
	}
	status, response := c.request("POST", "/api/v1/assemblies/"+id+"/confirm", map[string]any{})
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("repeat confirm response=%d %#v", status, response)
	}
}
