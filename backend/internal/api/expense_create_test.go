package api

import (
	"context"
	"testing"
)

func TestExpenseClaimCreatePersistsLines(t *testing.T) {
	c, s := setup(t)
	data := c.ok("POST", "/api/v1/expense-claims", map[string]any{"employee_name": "测试员工", "claim_date": "2099-01-01T00:00:00Z", "total_amount": "30", "lines": []any{map[string]any{"expense_type": "travel", "description": "车费", "amount": "30"}}}).(map[string]any)
	rows, err := s.Store.Rows(context.Background(), "SELECT amount,expense_type FROM expense_claim_lines WHERE claim_id=?", data["id"])
	if err != nil || len(rows) != 1 || rows[0]["expense_type"] != "travel" {
		t.Fatalf("expense lines not persisted: %#v %v", rows, err)
	}
}
