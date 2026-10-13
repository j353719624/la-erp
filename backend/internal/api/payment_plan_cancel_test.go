package api

import "testing"

func TestPaymentPlanCancelRejectsCompletedPlan(t *testing.T) {
	c, _ := setup(t)
	data := c.ok("POST", "/api/v1/payment-plans", map[string]any{"plan_type": "receivable", "total_amount": "1", "items": []any{map[string]any{"due_date": "2099-01-01T00:00:00Z", "planned_amount": "1"}}}).(map[string]any)
	id := data["id"].(string)
	detail := c.ok("GET", "/api/v1/payment-plans/"+id, nil).(map[string]any)
	items := detail["edges"].(map[string]any)["items"].([]any)
	itemID := items[0].(map[string]any)["id"].(string)
	c.ok("POST", "/api/v1/payment-plans/"+id+"/receive", map[string]any{"item_id": itemID, "amount": "1"})
	if status, _ := c.request("POST", "/api/v1/payment-plans/"+id+"/cancel", nil); status != 409 {
		t.Fatalf("completed plan cancel status=%d", status)
	}
}
