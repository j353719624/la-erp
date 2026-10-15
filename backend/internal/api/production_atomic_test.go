package api

import (
	"context"
	"la-erp/backend/internal/business"
	"sync"
	"testing"
	"time"
)

func productionFixture(t *testing.T, extra bool) (*client, *Server, map[string]any, map[string]any, map[string]any, map[string]any) {
	t.Helper()
	c, s := setup(t)
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	finished, component, other := products[0].(map[string]any), products[1].(map[string]any), products[2].(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	stock := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{map[string]any{"product_id": component["id"], "qty": 20, "unit_cost": 3}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", map[string]any{})
	items := []any{map[string]any{"product_id": component["id"], "unit_id": component["unit_id"], "qty": 3, "scrap_rate": 0}}
	if extra {
		items = append(items, map[string]any{"product_id": other["id"], "unit_id": other["unit_id"], "qty": 1, "scrap_rate": 0})
	}
	bom := c.ok("POST", "/api/v1/boms", map[string]any{"product_id": finished["id"], "items": items}).(map[string]any)
	wo := c.ok("POST", "/api/v1/work-orders", map[string]any{"product_id": finished["id"], "qty": 2, "warehouse_id": warehouse["id"], "bom_id": bom["id"]}).(map[string]any)
	c.ok("POST", "/api/v1/work-orders/"+wo["id"].(string)+"/confirm", map[string]any{})
	c.ok("POST", "/api/v1/work-orders/"+wo["id"].(string)+"/approve", map[string]any{})
	return c, s, wo, warehouse, component, other
}
func TestConcurrentProductionPickingDoesNotOverIssue(t *testing.T) {
	c, s, wo, wh, component, _ := productionFixture(t, false)
	create := func() map[string]any {
		return c.ok("POST", "/api/v1/production-pickings", map[string]any{"work_order_id": wo["id"], "warehouse_id": wh["id"], "picking_date": time.Now().UTC().Format(time.RFC3339Nano), "lines": []any{map[string]any{"product_id": component["id"], "qty": 4, "unit_cost": 3}}}).(map[string]any)
	}
	a, b := create(), create()
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, h := range []map[string]any{a, b} {
		wg.Add(1)
		go func(h map[string]any) {
			defer wg.Done()
			_, err := s.business().ConfirmProductionDocument(context.Background(), business.ProductionDocuments["production-pickings"], h["id"].(string))
			results <- err
		}(h)
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal(success)
	}
	materials := c.ok("GET", "/api/v1/work-orders/"+wo["id"].(string)+"/materials", nil).([]any)[0].(map[string]any)
	if materials["qty_issued"] != "4" || materials["qty_pending"] != "2" {
		t.Fatal(materials)
	}
	order := c.ok("GET", "/api/v1/work-orders/"+wo["id"].(string), nil).(map[string]any)
	if order["material_cost"] != "12" {
		t.Fatal(order)
	}
}
func TestProductionPickingFailureRollsBackAllMaterials(t *testing.T) {
	c, s, wo, wh, component, other := productionFixture(t, true)
	pick := c.ok("POST", "/api/v1/production-pickings", map[string]any{"work_order_id": wo["id"], "warehouse_id": wh["id"], "picking_date": time.Now().UTC().Format(time.RFC3339Nano), "lines": []any{map[string]any{"product_id": component["id"], "qty": 1, "unit_cost": 3}, map[string]any{"product_id": other["id"], "qty": 1, "unit_cost": 3}}}).(map[string]any)
	_, err := s.business().ConfirmProductionDocument(context.Background(), business.ProductionDocuments["production-pickings"], pick["id"].(string))
	if err == nil {
		t.Fatal("missing second material stock accepted")
	}
	balance := c.ok("GET", "/api/v1/inventory-balances?product_id="+component["id"].(string), nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if balance["qty_available"] != "20" {
		t.Fatal(balance)
	}
	for _, m := range c.ok("GET", "/api/v1/work-orders/"+wo["id"].(string)+"/materials", nil).([]any) {
		if m.(map[string]any)["qty_issued"] != "0" {
			t.Fatal(m)
		}
	}
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_type='production_picking'").Scan(&count)
	if count != 0 {
		t.Fatal(count)
	}
}

func TestConcurrentProductionReceiptsDoNotExceedWorkOrder(t *testing.T) {
	c, s, wo, wh, _, _ := productionFixture(t, false)
	create := func() map[string]any {
		return c.ok("POST", "/api/v1/production-receipts", map[string]any{"work_order_id": wo["id"], "warehouse_id": wh["id"], "receipt_date": time.Now().UTC().Format(time.RFC3339Nano), "lines": []any{map[string]any{"product_id": wo["product_id"], "qty": 2, "unit_cost": 11}}}).(map[string]any)
	}
	a, b := create(), create()
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, h := range []map[string]any{a, b} {
		wg.Add(1)
		go func(h map[string]any) {
			defer wg.Done()
			_, err := s.business().ConfirmProductionDocument(context.Background(), business.ProductionDocuments["production-receipts"], h["id"].(string))
			results <- err
		}(h)
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("confirmed %d receipts instead of one", success)
	}
	balance := c.ok("GET", "/api/v1/inventory-balances?product_id="+wo["product_id"].(string), nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if balance["qty_available"] != "2" || balance["avg_cost"] != "11" {
		t.Fatal(balance)
	}
	var movements, confirmed int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_type='production_receipt'").Scan(&movements); err != nil {
		t.Fatal(err)
	}
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM production_receipts WHERE work_order_id=? AND status='confirmed'", wo["id"]).Scan(&confirmed); err != nil {
		t.Fatal(err)
	}
	if movements != 1 || confirmed != 1 {
		t.Fatalf("movement/header mismatch: %d/%d", movements, confirmed)
	}
}

func TestProductionReceiptMultiOutputAtomic(t *testing.T) {
	c, s, wo, wh, _, other := productionFixture(t, true)
	if _, err := s.Store.DB.Exec("UPDATE work_orders SET status='confirmed' WHERE id=?", wo["id"]); err != nil {
		t.Fatal(err)
	}
	receipt := c.ok("POST", "/api/v1/production-receipts", map[string]any{"work_order_id": wo["id"], "warehouse_id": wh["id"], "receipt_date": time.Now().UTC().Format(time.RFC3339Nano), "lines": []any{map[string]any{"product_id": wo["product_id"], "qty": 1, "unit_cost": 11}, map[string]any{"product_id": other["id"], "qty": 1, "unit_cost": 3}}}).(map[string]any)
	id := receipt["id"].(string)
	_, err := s.Store.DB.Exec("CREATE TRIGGER fail_multi BEFORE INSERT ON stock_movements WHEN NEW.product_id='" + other["id"].(string) + "' AND NEW.source_type='production_receipt' BEGIN SELECT RAISE(ABORT,'injected'); END")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.business().ConfirmProductionDocument(context.Background(), business.ProductionDocuments["production-receipts"], id); err == nil {
		t.Fatal("injected failure accepted")
	}
	var n int
	s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_id=?", id).Scan(&n)
	if n != 0 {
		t.Fatal("partial movements", n)
	}
	s.Store.DB.QueryRow("SELECT count(*) FROM inventory_balances WHERE product_id=?", wo["product_id"]).Scan(&n)
	if n != 0 {
		t.Fatal("partial balance", n)
	}
	if _, err = s.Store.DB.Exec("DROP TRIGGER fail_multi"); err != nil {
		t.Fatal(err)
	}
	c.ok("POST", "/api/v1/production-receipts/"+id+"/confirm", map[string]any{})
	s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements WHERE source_id=?", id).Scan(&n)
	if n != 2 {
		t.Fatal(n)
	}
	for _, x := range []struct {
		product any
		cost    string
	}{{wo["product_id"], "11"}, {other["id"], "3"}} {
		var qty, cost string
		if err := s.Store.DB.QueryRow("SELECT qty_available,avg_cost FROM inventory_balances WHERE product_id=? AND warehouse_id=?", x.product, wh["id"]).Scan(&qty, &cost); err != nil {
			t.Fatal(err)
		}
		if qty != "1" || cost != x.cost {
			t.Fatal(qty, cost)
		}
	}
	if _, err = s.business().ConfirmProductionDocument(context.Background(), business.ProductionDocuments["production-receipts"], id); err == nil {
		t.Fatal("repeat accepted")
	}
	_, body := c.request("POST", "/api/v1/work-orders/"+wo["id"].(string)+"/cancel", nil)
	if body["code"] == float64(0) {
		t.Fatal("posted output work order cancelled")
	}

}
