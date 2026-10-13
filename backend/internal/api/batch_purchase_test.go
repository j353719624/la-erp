package api

import "testing"

func TestTrackedFEFOExpiryPriorityAndInsufficientRollback(t *testing.T) {
	c, s := setup(t)
	p := c.ok("POST", "/api/v1/products", map[string]any{"code": "TRACK-FEFO", "name": "有效期分配", "is_batch": true}).(map[string]any)
	w := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	c.ok("PUT", "/api/v1/settings", map[string]any{"settings": map[string]any{"inventory": map[string]any{"batch_strategy": "fefo"}}})
	settings := c.ok("GET", "/api/v1/settings", nil).(map[string]any)
	if settings["inventory"].(map[string]any)["batch_strategy"] != "fefo" {
		t.Fatal(settings)
	}
	if status, _ := c.request("PUT", "/api/v1/settings", map[string]any{"settings": map[string]any{"inventory": map[string]any{"batch_strategy": "invalid"}}}); status != 400 {
		t.Fatal(status)
	}
	for _, x := range []struct {
		batch, prod, expiry string
		cost                int
	}{{"C", "2026-09-01T00:00:00Z", "2027-02-01T00:00:00Z", 11}, {"B", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", 23}} {
		in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": w["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 5, "unit_cost": x.cost, "batch_no": x.batch, "production_date": x.prod, "expiry_date": x.expiry}}}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	}
	makeOut := func(qty int) map[string]any {
		return c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": w["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": qty, "unit_cost": 9}}}).(map[string]any)
	}
	tooMuch := makeOut(11)
	if status, _ := c.request("POST", "/api/v1/stock-outs/"+tooMuch["id"].(string)+"/confirm", nil); status != 400 {
		t.Fatal(status)
	}
	rows := c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)
	for _, raw := range rows {
		if raw.(map[string]any)["qty_available"] != "5" {
			t.Fatal("shortage mutated stock", rows)
		}
	}
	out := makeOut(2)
	got := c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil).(map[string]any)
	if got["total_amount"] != "18" {
		t.Fatal(got)
	}
	rows = c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)
	for _, raw := range rows {
		r := raw.(map[string]any)
		if r["batch_no"] == "B" && r["qty_available"] != "3" {
			t.Fatal(r)
		}
		if r["batch_no"] == "C" && r["qty_available"] != "5" {
			t.Fatal(r)
		}
	}
	var count int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_id=? AND batch_no='B' AND unit_cost=9 AND total_cost=18", out["id"]).Scan(&count); err != nil || count != 1 {
		t.Fatal("FEFO movement mismatch", count, err)
	}
}

func TestTrackedFIFOAutomaticAllocation(t *testing.T) {
	c, s := setup(t)
	p := c.ok("POST", "/api/v1/products", map[string]any{"code": "TRACKED-FIFO", "name": "批次FIFO", "is_batch": true}).(map[string]any)
	w := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	for _, x := range []struct {
		batch string
		cost  int
	}{{"A", 11}, {"B", 23}} {
		in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": w["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 5, "unit_cost": x.cost, "batch_no": x.batch}}}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	}
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": w["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 7, "unit_cost": 9}}}).(map[string]any)
	path := "/api/v1/stock-outs/" + out["id"].(string) + "/confirm"
	if _, err := s.Store.DB.Exec("CREATE TRIGGER fail_batch_move BEFORE INSERT ON stock_movements WHEN NEW.direction=-1 BEGIN SELECT RAISE(ABORT,'batch rollback'); END"); err != nil {
		t.Fatal(err)
	}
	if status, _ := c.request("POST", path, nil); status == 200 {
		t.Fatal("failed movement accepted")
	}
	rows := c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)
	for _, raw := range rows {
		if raw.(map[string]any)["qty_available"] != "5" {
			t.Fatal("rollback failed", rows)
		}
	}
	if _, err := s.Store.DB.Exec("DROP TRIGGER fail_batch_move"); err != nil {
		t.Fatal(err)
	}
	got := c.ok("POST", path, nil).(map[string]any)
	if got["total_amount"] != "63" {
		t.Fatal(got)
	}
	if _, body := c.request("POST", path, nil); body["code"] == float64(0) {
		t.Fatal("duplicate accepted")
	}
	rows = c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)
	for _, raw := range rows {
		r := raw.(map[string]any)
		if r["batch_no"] == "A" && r["qty_available"] != "0" {
			t.Fatal(r)
		}
		if r["batch_no"] == "B" && r["qty_available"] != "3" {
			t.Fatal(r)
		}
	}
}

func TestBatchSpecificCostMatchesOriginalTwoCostReplay(t *testing.T) {
	c, _ := setup(t)
	p := c.ok("POST", "/api/v1/products", map[string]any{"code": "REC-TWO-COST", "name": "两批成本回放"}).(map[string]any)
	w := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	for _, x := range []struct {
		batch string
		cost  int
	}{{"REC-A", 11}, {"REC-B", 23}} {
		in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": w["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 5, "unit_cost": x.cost, "batch_no": x.batch}}}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	}
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": w["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 2, "unit_cost": 2000, "batch_no": "REC-A"}}}).(map[string]any)
	got := c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil).(map[string]any)
	if got["total_amount"] != "22" {
		t.Fatalf("batch-specific outgoing cost differs: %#v", got)
	}
	rows := c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)
	for _, raw := range rows {
		r := raw.(map[string]any)
		if r["batch_no"] == "REC-A" && (r["qty_available"] != "3" || r["avg_cost"] != "11") {
			t.Fatal(r)
		}
		if r["batch_no"] == "REC-B" && (r["qty_available"] != "5" || r["avg_cost"] != "23") {
			t.Fatal(r)
		}
	}
}

func TestInventoryBalancesRemainSeparatedByBatch(t *testing.T) {
	c, _ := setup(t)
	p := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	w := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	for _, item := range []struct {
		batch string
		qty   string
	}{{"B-ISOLATED-1", "2"}, {"B-ISOLATED-2", "3"}} {
		in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"type": "other", "warehouse_id": w["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": item.qty, "unit_cost": "4", "batch_no": item.batch}}}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	}
	rows := c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)
	seen := map[string]string{}
	for _, raw := range rows {
		row := raw.(map[string]any)
		if b, ok := row["batch_no"].(string); ok && (b == "B-ISOLATED-1" || b == "B-ISOLATED-2") {
			seen[b] = row["qty_available"].(string)
		}
	}
	if seen["B-ISOLATED-1"] != "2" || seen["B-ISOLATED-2"] != "3" {
		t.Fatalf("batch balances leaked or merged: %#v", seen)
	}
}

func TestPurchaseReceiptWithBatch(t *testing.T) {
	c, _ := setup(t)
	p := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	w := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	sup := c.ok("GET", "/api/v1/suppliers", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	order := c.ok("POST", "/api/v1/purchase-orders", map[string]any{"supplier_id": sup["id"], "warehouse_id": w["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": "2", "price": "4"}}}).(map[string]any)
	path := "/api/v1/purchase-orders/" + order["id"].(string)
	c.ok("POST", path+"/confirm", nil)
	c.ok("POST", path+"/approve", nil)
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"type": "purchase", "warehouse_id": w["id"], "source_id": order["id"], "source_no": order["order_no"], "lines": []any{map[string]any{"product_id": p["id"], "qty": "2", "unit_cost": "4", "batch_no": "B-PUR-01"}}}).(map[string]any)
	got := c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil).(map[string]any)
	if got["status"] != "completed" && got["status"] != "confirmed" {
		t.Fatalf("status %#v", got)
	}
}

func TestBatchDateTimezoneTieAndExpiredOutgoing(t *testing.T) {
	c, s := setup(t)
	p := c.ok("POST", "/api/v1/products", map[string]any{"code": "DATE-BOUNDARY", "name": "Dates", "is_batch": true}).(map[string]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	for _, x := range []struct{ batch, date, expiry string }{{"EMPTY", "", ""}, {"EXPIRED", "2026-01-01T00:00:00+08:00", "2026-02-01T00:00:00+08:00"}, {"TZ-A", "2026-09-01T00:00:00+08:00", "2027-01-01T00:00:00+08:00"}, {"TZ-B", "2026-08-31T16:00:00Z", "2026-12-31T16:00:00Z"}} {
		line := map[string]any{"product_id": p["id"], "qty": 2, "unit_cost": 11, "batch_no": x.batch}
		if x.date != "" {
			line["production_date"] = x.date
			line["expiry_date"] = x.expiry
		}
		in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": wh["id"], "lines": []any{line}}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	}
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 5, "unit_cost": 7}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
	for _, x := range []struct {
		batch string
		qty   int
	}{{"EXPIRED", 2}, {"TZ-A", 2}, {"TZ-B", 1}} {
		var qty int
		if err := s.Store.DB.QueryRow("SELECT qty FROM stock_movements WHERE source_id=? AND batch_no=?", out["id"], x.batch).Scan(&qty); err != nil || qty != x.qty {
			t.Fatal(x, qty, err)
		}
	}
	var available int
	s.Store.DB.QueryRow("SELECT qty_available FROM inventory_balances WHERE product_id=? AND batch_no='EMPTY'", p["id"]).Scan(&available)
	if available != 2 {
		t.Fatal(available)
	}
}
