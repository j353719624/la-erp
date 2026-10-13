package api

import "testing"

func TestLinkedTrackedProductConsumesGenericLockInsteadOfBatches(t *testing.T) {
	c, s := setup(t)
	p := c.ok("POST", "/api/v1/products", map[string]any{"code": "LINK-TRACK", "name": "Linked tracked", "is_batch": true}).(map[string]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "LINK-C", "name": "Link customer"}).(map[string]any)
	for _, batch := range []string{"", "A", "B"} {
		in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 4, "unit_cost": 11, "batch_no": batch}}}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	}
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": customer["id"], "warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 4, "price": 9}}}).(map[string]any)
	op := "/api/v1/sales-orders/" + order["id"].(string)
	c.ok("POST", op+"/confirm", nil)
	c.ok("POST", op+"/approve", nil)
	for i := 0; i < 2; i++ {
		out := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": wh["id"], "type": "sales", "source_id": order["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 2, "unit_cost": 99}}}).(map[string]any)
		result := c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil).(map[string]any)
		if result["total_amount"] != "22" {
			t.Fatal(result)
		}
	}
	result := c.ok("GET", op, nil).(map[string]any)
	if result["status"] != "closed" {
		t.Fatal(result)
	}
	rows := c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)
	for _, raw := range rows {
		b := raw.(map[string]any)
		if b["batch_no"] == "A" || b["batch_no"] == "B" {
			if b["qty_available"] != "4" {
				t.Fatal(b)
			}
		} else if b["qty_available"] != "0" || b["qty_locked"] != "0" {
			t.Fatal(b)
		}
	}
	var n int
	s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_type='sales' AND batch_no IS NOT NULL AND batch_no<>''").Scan(&n)
	if n != 0 {
		t.Fatal("unexpected split", n)
	}
	ret := c.ok("POST", "/api/v1/sales-returns", map[string]any{"customer_id": customer["id"], "warehouse_id": wh["id"], "sales_order_id": order["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 1, "price": 9, "batch_no": "A"}}}).(map[string]any)
	retPath := "/api/v1/sales-returns/" + ret["id"].(string)
	c.ok("POST", retPath+"/confirm", nil)
	c.ok("POST", retPath+"/approve", nil)
	var genericQty, batchQty int
	s.Store.DB.QueryRow("SELECT qty_available FROM inventory_balances WHERE product_id=? AND (batch_no IS NULL OR batch_no='')", p["id"]).Scan(&genericQty)
	s.Store.DB.QueryRow("SELECT qty_available FROM inventory_balances WHERE product_id=? AND batch_no='A'", p["id"]).Scan(&batchQty)
	if genericQty != 1 || batchQty != 4 {
		t.Fatal("original return balance mismatch", genericQty, batchQty)
	}
}

func TestTrackedSalesReturnCostAndVoucherRollback(t *testing.T) {
	c, s := setup(t)
	p := c.ok("POST", "/api/v1/products", map[string]any{"code": "RETURN-COST", "name": "Return cost", "is_batch": true}).(map[string]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "Return customer"}).(map[string]any)
	for _, x := range []struct {
		batch string
		qty   int
		cost  string
	}{{"A", 5, "11"}, {"", 1, "9.4"}} {
		in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": wh["id"], "type": "other", "lines": []any{map[string]any{"product_id": p["id"], "batch_no": x.batch, "qty": x.qty, "unit_cost": x.cost}}}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	}
	ret := c.ok("POST", "/api/v1/sales-returns", map[string]any{"customer_id": customer["id"], "warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 1, "price": 9, "batch_no": "A"}}}).(map[string]any)
	rp := "/api/v1/sales-returns/" + ret["id"].(string)
	c.ok("POST", rp+"/confirm", nil)
	_, err := s.Store.DB.Exec("CREATE TRIGGER fail_return BEFORE INSERT ON vouchers WHEN NEW.source_type='sales_return' BEGIN SELECT RAISE(ABORT,'injected'); END")
	if err != nil {
		t.Fatal(err)
	}
	_, response := c.request("POST", rp+"/approve", nil)
	if response["code"] == float64(0) {
		t.Fatal("injected posting succeeded")
	}
	var qty, cost string
	s.Store.DB.QueryRow("SELECT qty_available,avg_cost FROM inventory_balances WHERE product_id=? AND (batch_no IS NULL OR batch_no='')", p["id"]).Scan(&qty, &cost)
	if qty != "1" || cost != "9.4" {
		t.Fatal("partial return", qty, cost)
	}
	if _, err = s.Store.DB.Exec("DROP TRIGGER fail_return"); err != nil {
		t.Fatal(err)
	}
	c.ok("POST", rp+"/approve", nil)
	s.Store.DB.QueryRow("SELECT qty_available,avg_cost FROM inventory_balances WHERE product_id=? AND (batch_no IS NULL OR batch_no='')", p["id"]).Scan(&qty, &cost)
	if qty != "2" || cost != "10.2" {
		t.Fatal(qty, cost)
	}
	s.Store.DB.QueryRow("SELECT unit_cost FROM stock_movements WHERE source_id=?", ret["id"]).Scan(&cost)
	if cost != "11" {
		t.Fatal(cost)
	}
	s.Store.DB.QueryRow("SELECT total_debit FROM vouchers WHERE source_id=?", ret["id"]).Scan(&cost)
	if cost != "20" {
		t.Fatal(cost)
	}
	_, response = c.request("POST", rp+"/approve", nil)
	if response["code"] == float64(0) {
		t.Fatal("duplicate return approved")
	}
}
