package api

import "testing"

func TestExpenseClaimLifecycleStateGuards(t *testing.T) {
	c, s := setup(t)
	data := c.ok("POST", "/api/v1/expense-claims", map[string]any{
		"employee_name": "生命周期员工",
		"claim_date":    "2099-02-01T00:00:00Z",
		"total_amount":  "12",
		"lines":         []any{map[string]any{"expense_type": "travel", "amount": "12"}},
	}).(map[string]any)
	id := data["id"].(string)
	c.ok("POST", "/api/v1/expense-claims/"+id+"/submit", nil)
	c.ok("POST", "/api/v1/expense-claims/"+id+"/approve", nil)
	paid := c.ok("POST", "/api/v1/expense-claims/"+id+"/paid", map[string]any{"method": "bank"}).(map[string]any)
	if paid["status"] != "paid" || paid["payment_status"] != "paid" {
		t.Fatalf("unexpected paid state: %#v", paid)
	}
	var approvalEntries, paymentEntries int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM journal_entries WHERE source_type='expense_claim' AND source_id=?", id).Scan(&approvalEntries); err != nil || approvalEntries != 2 {
		t.Fatalf("approval posting missing: %d %v", approvalEntries, err)
	}
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM journal_entries WHERE source_type='expense_payment' AND source_id=?", id).Scan(&paymentEntries); err != nil || paymentEntries != 2 {
		t.Fatalf("payment posting missing: %d %v", paymentEntries, err)
	}
	status, response := c.request("POST", "/api/v1/expense-claims/"+id+"/cancel", nil)
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("paid claim cancellation response=%d %#v", status, response)
	}
}
