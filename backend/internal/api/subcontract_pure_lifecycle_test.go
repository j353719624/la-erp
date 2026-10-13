package api

import "testing"

func TestPureSubcontractReceiveFinishAndComplete(t *testing.T) {
	c, s := setup(t)
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	product := products[0].(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	supplier := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	order := c.ok("POST", "/api/v1/subcontract-orders", map[string]any{
		"qty": 2, "supplier_id": supplier["id"], "product_id": product["id"],
		"warehouse_id": warehouse["id"], "unit_price": 5, "mode": "pure",
	}).(map[string]any)
	id := order["id"].(string)
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/confirm", map[string]any{})
	got := c.ok("POST", "/api/v1/subcontract-orders/"+id+"/receive", map[string]any{"qty": 2}).(map[string]any)
	if got["status"] != "receiving" || got["received_qty"] != "2" {
		t.Fatalf("unexpected pure receive state: %#v", got)
	}
	got = c.ok("POST", "/api/v1/subcontract-orders/"+id+"/finish-receive", map[string]any{}).(map[string]any)
	if got["status"] != "received" {
		t.Fatalf("unexpected finish state: %#v", got)
	}
	got = c.ok("POST", "/api/v1/subcontract-orders/"+id+"/complete", map[string]any{}).(map[string]any)
	if got["status"] != "completed" {
		t.Fatalf("unexpected complete state: %#v", got)
	}
	for _, table := range []string{"ap_invoices", "vouchers"} {
		var n int
		if err := s.Store.DB.QueryRow("SELECT count(*) FROM "+table+" WHERE source_id=?", id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatal("completion created unobserved posting", table, n)
		}
	}

}

func TestPureSubcontractPartialReceiveRequiresDifferenceReason(t *testing.T) {
	c, _ := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	supplier := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	order := c.ok("POST", "/api/v1/subcontract-orders", map[string]any{"qty": 2, "supplier_id": supplier["id"], "product_id": product["id"], "warehouse_id": warehouse["id"], "unit_price": 5, "mode": "pure"}).(map[string]any)
	id := order["id"].(string)
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/confirm", nil)
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/receive", map[string]any{"qty": 1, "batch": true})
	if _, body := c.request("POST", "/api/v1/subcontract-orders/"+id+"/finish-receive", map[string]any{}); body["code"] == float64(0) {
		t.Fatal("partial receive without difference reason unexpectedly succeeded")
	}
	got := c.ok("POST", "/api/v1/subcontract-orders/"+id+"/finish-receive", map[string]any{"reason": "供应商短交"}).(map[string]any)
	if got["status"] != "received" || got["diff_qty"] != "-1" || got["diff_reason"] != "供应商短交" {
		t.Fatalf("unexpected partial finish state: %#v", got)
	}
}

func TestSubcontractCancelMatchesOriginalReplay(t *testing.T) {
	c, _ := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	supplier := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	order := c.ok("POST", "/api/v1/subcontract-orders", map[string]any{"qty": 1, "supplier_id": supplier["id"], "product_id": product["id"], "warehouse_id": warehouse["id"], "unit_price": 5, "mode": "pure"}).(map[string]any)
	id := order["id"].(string)
	c.ok("POST", "/api/v1/subcontract-orders/"+id+"/cancel", nil)
	if _, body := c.request("POST", "/api/v1/subcontract-orders/"+id+"/cancel", nil); body["code"] != float64(0) {
		t.Fatalf("original replay allows repeated cancellation: %#v", body)
	}
}
