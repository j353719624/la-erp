package api

import (
	"context"
	"fmt"
	"testing"
)

func TestPaymentPlanCreatePersistsInstallments(t *testing.T) {
	c, s := setup(t)
	data := c.ok("POST", "/api/v1/payment-plans", map[string]any{
		"plan_type": "receivable", "total_amount": "30",
		"items": []any{
			map[string]any{"due_date": "2099-01-15T00:00:00Z", "planned_amount": "10"},
			map[string]any{"due_date": "2099-02-15T00:00:00Z", "planned_amount": "20"},
		},
	}).(map[string]any)
	id := data["id"].(string)
	items, err := s.Store.Rows(context.Background(), "SELECT seq,planned_amount,status FROM payment_plan_items WHERE payment_plan_items=? ORDER BY seq", id)
	if err != nil || len(items) != 2 || fmt.Sprint(items[0]["planned_amount"]) != "10" || fmt.Sprint(items[1]["planned_amount"]) != "20" || items[0]["status"] != "pending" {
		t.Fatalf("installments not persisted: %#v %v", items, err)
	}
}
