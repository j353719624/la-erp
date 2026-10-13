package api

import (
	"context"
	"testing"
)

func TestAccountingPeriodCloseReopenRoutes(t *testing.T) {
	c, s := setup(t)
	rows, err := s.Store.Rows(context.Background(), "SELECT id,period FROM accounting_periods WHERE status='open' ORDER BY period LIMIT 1")
	if err != nil || len(rows) == 0 {
		t.Skip("fixture has no open accounting period")
	}
	id, _ := rows[0]["id"].(string)
	period, _ := rows[0]["period"].(string)
	if status, _ := c.request("POST", "/api/v1/accounting-periods/"+id+"/close", nil); status != 200 {
		t.Fatalf("close status=%d", status)
	}
	if status, _ := c.request("POST", "/api/v1/accounting-periods/"+id+"/close", nil); status != 409 {
		t.Fatalf("duplicate close status=%d", status)
	}
	if status, _ := c.request("POST", "/api/v1/accounting-periods/opening-balances", map[string]any{"period": period, "entries": []any{}}); status != 409 {
		t.Fatalf("closed opening balance status=%d", status)
	}
	if status, _ := c.request("POST", "/api/v1/accounting-periods/"+id+"/reopen", nil); status != 200 {
		t.Fatalf("reopen status=%d", status)
	}
}
