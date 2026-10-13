package api

import (
	"context"
	"testing"
)

func TestOpeningBalancesRoutePersistsEntries(t *testing.T) {
	c, s := setup(t)
	periods, err := s.Store.Rows(context.Background(), "SELECT period FROM accounting_periods WHERE status='open' ORDER BY period LIMIT 1")
	if err != nil || len(periods) == 0 {
		t.Skip("fixture has no open accounting period")
	}
	accounts, err := s.Store.Rows(context.Background(), "SELECT id FROM accounts WHERE code='1001' LIMIT 1")
	if err != nil || len(accounts) == 0 {
		t.Skip("fixture has no cash account")
	}
	period := periods[0]["period"].(string)
	aid := accounts[0]["id"].(string)
	data := c.ok("POST", "/api/v1/accounting-periods/opening-balances", map[string]any{
		"period":  period,
		"entries": []any{map[string]any{"account_id": aid, "begin_balance": "321.09"}},
	}).(map[string]any)
	if data["updated"] != float64(1) {
		t.Fatalf("unexpected update count: %#v", data)
	}
	rows, err := s.Store.Rows(context.Background(), "SELECT begin_balance,end_balance FROM account_balances WHERE period=? AND account_id=?", period, aid)
	if err != nil || len(rows) != 1 || rows[0]["begin_balance"] != "321.09" || rows[0]["end_balance"] != "321.09" {
		t.Fatalf("opening balance not persisted: %#v %v", rows, err)
	}
}
