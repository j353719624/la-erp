package api

import (
	"testing"
)

func TestConfirmedOrderCannotConsumeReservedStockBeforeApproval(t *testing.T) {
	c, _ := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "REC-SHIP-GUARD", "name": "REC-SHIP-GUARD", "product_type": "finished", "cost_method": "weighted_avg"}).(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "REC-SHIP-C", "name": "ship customer"}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{map[string]any{"product_id": product["id"], "qty": 10, "unit_cost": 2}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", nil)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"warehouse_id": warehouse["id"], "customer_id": customer["id"], "lines": []any{map[string]any{"product_id": product["id"], "qty": 6, "price": 10}}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	outgoing := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": warehouse["id"], "source_id": order["id"], "source_no": order["order_no"], "lines": []any{map[string]any{"product_id": product["id"], "qty": 5, "unit_cost": 2}}}).(map[string]any)
	status, body := c.request("POST", "/api/v1/stock-outs/"+outgoing["id"].(string)+"/confirm", nil)
	if status != 400 || body["message"] != "库存不足" {
		t.Fatal(status, body)
	}
	balance := c.ok("GET", "/api/v1/inventory-balances?product_id="+product["id"].(string), nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if balance["qty_available"] != "4" || balance["qty_locked"] != "6" {
		t.Fatal(balance)
	}
	unchanged := c.ok("GET", "/api/v1/sales-orders/"+order["id"].(string), nil).(map[string]any)
	if unchanged["edges"].(map[string]any)["lines"].([]any)[0].(map[string]any)["delivered_qty"] != "0" {
		t.Fatal(unchanged)
	}
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/approve", nil)
	c.ok("POST", "/api/v1/stock-outs/"+outgoing["id"].(string)+"/confirm", nil)
}
