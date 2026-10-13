package api

import (
	"context"
	"testing"
)

func TestPayrollConfirmPostsAccrualVoucher(t *testing.T) {
	c, s := setup(t)
	batch := c.ok("POST", "/api/v1/payrolls", map[string]any{
		"period": "2099-04",
		"items":  []any{map[string]any{"employee_name": "计提员工", "base_salary": "100", "bonus": "20", "allowance": "0", "deduction": "0"}},
	}).(map[string]any)
	confirmed := c.ok("POST", "/api/v1/payrolls/"+batch["id"].(string)+"/confirm", nil).(map[string]any)
	if confirmed["status"] != "confirmed" {
		t.Fatalf("unexpected status: %#v", confirmed)
	}
	rows, err := s.Store.Rows(context.Background(), "SELECT account_code,direction,amount FROM journal_entries WHERE source_type='payroll' AND source_id=? ORDER BY account_code", batch["id"])
	if err != nil || len(rows) != 2 {
		t.Fatalf("payroll voucher entries: %#v %v", rows, err)
	}
}
