package api

import (
	"testing"
	"time"
)

func TestAgingReportReturnsBucketsAndDetails(t *testing.T) {
	c, _ := setup(t)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "账龄客户"}).(map[string]any)
	c.ok("POST", "/api/v1/ar-invoices", map[string]any{"customer_id": customer["id"], "invoice_date": time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano), "due_date": time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano), "total_amount": "80"})
	data := c.ok("GET", "/api/v1/reports/finance/aging?type=ar&as_of=2026-10-11", nil).(map[string]any)
	if data["type"] != "ar" || data["total"] != "80" {
		t.Fatalf("unexpected aging: %#v", data)
	}
	if len(data["details"].([]any)) != 1 || len(data["buckets"].([]any)) != 5 {
		t.Fatalf("missing aging rows: %#v", data)
	}
}
