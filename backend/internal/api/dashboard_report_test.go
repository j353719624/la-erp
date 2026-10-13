package api

import "testing"

func TestDashboardReportReturnsOperationalContract(t *testing.T) {
	c, _ := setup(t)
	data := c.ok("GET", "/api/v1/reports/dashboard", nil).(map[string]any)
	for _, key := range []string{"total_sales_amount", "total_purchase_amount", "total_stock_value", "ar_balance", "ap_balance", "monthly_revenue", "monthly_profit", "low_stock_items", "pending_approvals", "top_products", "receivable_aging", "sales_trend", "purchase_trend"} {
		if _, ok := data[key]; !ok {
			t.Fatalf("dashboard missing %s: %#v", key, data)
		}
	}
	if _, ok := data["low_stock_items"].([]any); !ok {
		t.Fatalf("low_stock_items is not an array: %#v", data["low_stock_items"])
	}
	if _, ok := data["pending_approvals"].([]any); !ok {
		t.Fatalf("pending_approvals is not an array: %#v", data["pending_approvals"])
	}
}
