package api

import (
	"context"
	"testing"
)

func TestPaymentPlanReceiveUpdatesItemAndPlan(t *testing.T) {
	c, s := setup(t)
	rows, err := s.Store.Rows(context.Background(), "SELECT p.id plan_id,i.id item_id,i.planned_amount FROM payment_plans p JOIN payment_plan_items i ON i.payment_plan_items=p.id WHERE p.status='active' AND i.status='pending' LIMIT 1")
	if err != nil || len(rows) == 0 {
		t.Skip("fixture has no pending payment plan item")
	}
	planID := rows[0]["plan_id"].(string)
	itemID := rows[0]["item_id"].(string)
	data := c.ok("POST", "/api/v1/payment-plans/"+planID+"/receive", map[string]any{"item_id": itemID, "amount": "1"}).(map[string]any)
	if data["id"] != planID || data["status"] != "partial" {
		t.Fatalf("unexpected plan response: %#v", data)
	}
	item, err := s.Store.Rows(context.Background(), "SELECT received_amount,status FROM payment_plan_items WHERE id=?", itemID)
	if err != nil || len(item) != 1 || item[0]["received_amount"] != "1" || item[0]["status"] != "partial" {
		t.Fatalf("item not updated: %#v %v", item, err)
	}
}
