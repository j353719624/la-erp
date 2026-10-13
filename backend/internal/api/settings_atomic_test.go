package api

import (
	"sync"
	"testing"
)

func TestCompanySettingsAtomicAndPreservesConfiguration(t *testing.T) {
	c, s := setup(t)
	c.ok("PUT", "/api/v1/settings", map[string]any{"settings": map[string]any{"company": map[string]any{"name": "before", "phone": "123"}, "inventory": map[string]any{"batch_strategy": "fifo"}, "personal_mode": map[string]any{"enabled": false}}})
	_, err := s.Store.DB.Exec("CREATE TRIGGER fail_setting BEFORE UPDATE ON system_settings WHEN NEW.key='inventory' BEGIN SELECT RAISE(ABORT,'injected'); END")
	if err != nil {
		t.Fatal(err)
	}
	status, _ := c.request("PUT", "/api/v1/settings", map[string]any{"settings": map[string]any{"company": map[string]any{"name": "after"}, "inventory": map[string]any{"batch_strategy": "fefo"}}})
	if status == 200 {
		t.Fatal("failed save succeeded")
	}
	result := c.ok("GET", "/api/v1/settings", nil).(map[string]any)
	if result["company"].(map[string]any)["name"] != "before" {
		t.Fatal(result)
	}
	if _, err = s.Store.DB.Exec("DROP TRIGGER fail_setting"); err != nil {
		t.Fatal(err)
	}
	c.ok("PUT", "/api/v1/settings", map[string]any{"settings": map[string]any{"company": map[string]any{"name": "after"}, "inventory": map[string]any{"batch_strategy": "fefo"}}})
	result = c.ok("GET", "/api/v1/settings", nil).(map[string]any)
	company := result["company"].(map[string]any)
	if company["name"] != "after" || company["phone"] != "123" {
		t.Fatal(result)
	}
	status, _ = c.request("PUT", "/api/v1/settings", map[string]any{"settings": map[string]any{"company": map[string]any{"unknown": true}}})
	if status != 400 {
		t.Fatal(status)
	}
	c.ok("PUT", "/api/v1/data-isolation", map[string]any{"mode": "sales"})
	if c.ok("GET", "/api/v1/data-isolation", nil).(map[string]any)["mode"] != "sales" {
		t.Fatal("isolation readback")
	}
}
func TestPersonalModeAllowsUnstockedSalesConfirmation(t *testing.T) {
	c, _ := setup(t)
	p := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "PERSONAL-CUSTOMER", "name": "Personal customer"}).(map[string]any)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": customer["id"], "warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 100, "price": 3}}}).(map[string]any)
	path := "/api/v1/sales-orders/" + order["id"].(string) + "/confirm"
	_, body := c.request("POST", path, map[string]any{})
	if body["code"] == float64(0) {
		t.Fatal("standard mode accepted shortage")
	}
	flow := c.ok("POST", "/api/v1/approval-flows", map[string]any{"code": "PERSONAL-ACTIVE", "name": "Personal approval", "biz_type": "sales_order"}).(map[string]any)
	c.ok("POST", "/api/v1/approval-flows/"+flow["id"].(string)+"/activate", nil)
	c.ok("PUT", "/api/v1/settings", map[string]any{"settings": map[string]any{"personal_mode": map[string]any{"enabled": true}}})
	c.ok("POST", path, map[string]any{})
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/approve", nil)
	b := c.ok("GET", "/api/v1/inventory-balances?product_id="+p["id"].(string), nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if b["qty_available"] != "-100" || b["qty_locked"] != "100" {
		t.Fatal(b)
	}
}

func TestConcurrentSettingsSaveKeepsOneCompleteSnapshot(t *testing.T) {
	c, _ := setup(t)
	var wg sync.WaitGroup
	outcomes := make(chan bool, 2)
	for _, x := range []struct{ name, strategy string }{{"FIFO writer", "fifo"}, {"FEFO writer", "fefo"}} {
		wg.Add(1)
		go func(name, strategy string) {
			defer wg.Done()
			status, body := c.request("PUT", "/api/v1/settings", map[string]any{"settings": map[string]any{"company": map[string]any{"name": name}, "inventory": map[string]any{"batch_strategy": strategy}, "personal_mode": map[string]any{"enabled": false}}})
			outcomes <- status == 200 && body["code"] == float64(0)
		}(x.name, x.strategy)
	}
	wg.Wait()
	close(outcomes)
	for success := range outcomes {
		if !success {
			t.Fatal("concurrent settings save failed")
		}
	}
	result := c.ok("GET", "/api/v1/settings", nil).(map[string]any)
	name := result["company"].(map[string]any)["name"]
	strategy := result["inventory"].(map[string]any)["batch_strategy"]
	if !(name == "FIFO writer" && strategy == "fifo") && !(name == "FEFO writer" && strategy == "fefo") {
		t.Fatal("mixed settings snapshot", result)
	}
}
