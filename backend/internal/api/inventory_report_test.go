package api

import "testing"

func TestInventoryTurnoverReportReturnsContractFields(t *testing.T) {
	c, _ := setup(t)
	p := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	w := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": w["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 4, "unit_cost": 2}}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	rows := c.ok("GET", "/api/v1/reports/inventory/turnover", nil).([]any)
	if len(rows) != 1 {
		t.Fatalf("unexpected turnover rows: %#v", rows)
	}
	row := rows[0].(map[string]any)
	for _, field := range []string{"product_id", "warehouse_name", "out_qty", "avg_stock", "turnover", "turnover_days"} {
		if _, ok := row[field]; !ok {
			t.Fatalf("missing turnover field %s: %#v", field, row)
		}
	}
}

func TestInventoryDormantReportReturnsContractFields(t *testing.T) {
	c, _ := setup(t)
	rows := c.ok("GET", "/api/v1/reports/inventory/dormant?days=0", nil).([]any)
	if len(rows) != 0 {
		for _, raw := range rows {
			row := raw.(map[string]any)
			for _, field := range []string{"product_id", "qty_available", "avg_cost", "total_value", "last_movement_at", "dormant_days"} {
				if _, ok := row[field]; !ok {
					t.Fatalf("missing dormant field %s: %#v", field, row)
				}
			}
		}
	}
}

func TestInventoryExpiryAlertReportIsAvailable(t *testing.T) {
	c, _ := setup(t)
	rows := c.ok("GET", "/api/v1/reports/inventory/expiry-alert?days=30", nil).([]any)
	for _, raw := range rows {
		row := raw.(map[string]any)
		for _, field := range []string{"product_id", "batch_no", "qty_available", "expiry_date", "days_left", "status"} {
			if _, ok := row[field]; !ok {
				t.Fatalf("missing expiry field %s: %#v", field, row)
			}
		}
	}
}

func TestTradeFulfillmentReportIsAvailable(t *testing.T) {
	c, _ := setup(t)
	rows := c.ok("GET", "/api/v1/reports/trade/fulfillment", nil).([]any)
	if rows == nil {
		t.Fatal("fulfillment report returned null")
	}
}

func TestTradeFulfillmentSummaryIsAvailable(t *testing.T) {
	c, _ := setup(t)
	rows := c.ok("GET", "/api/v1/reports/trade/fulfillment-summary", nil).([]any)
	if rows == nil {
		t.Fatal("fulfillment summary returned null")
	}
}
