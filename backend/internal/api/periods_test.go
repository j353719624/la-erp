package api

import (
	"context"
	"testing"

	"la-erp/backend/internal/business"
)

func TestOpeningBalancesTransactionalUpdate(t *testing.T) {
	_, s := setup(t)
	periods, err := s.Store.Rows(context.Background(), "SELECT * FROM accounting_periods WHERE status='open' LIMIT 1")
	if err != nil || len(periods) == 0 { t.Skip("fixture has no open accounting period") }
	accounts, err := s.Store.Rows(context.Background(), "SELECT * FROM accounts WHERE code='1001' LIMIT 1")
	if err != nil || len(accounts) == 0 { t.Fatal("cash account fixture missing") }
	period := periods[0]["period"].(string); account := accounts[0]["id"].(string)
	if _, err := s.business().SetOpeningBalances(context.Background(), period, []map[string]any{{"account_id": account, "begin_balance": "123.45"}}); err != nil { t.Fatal(err) }
	rows, err := s.Store.Rows(context.Background(), "SELECT begin_balance,end_balance FROM account_balances WHERE period=? AND account_id=?", business.BalancePeriodText(period), account)
	if err != nil || len(rows) != 1 || rows[0]["begin_balance"] != "123.45" { t.Fatalf("opening balance not persisted: %#v %v", rows, err) }
}

func TestOpeningBalancesRejectClosedPeriod(t *testing.T) {
	_, s := setup(t)
	periods, _ := s.Store.Rows(context.Background(), "SELECT * FROM accounting_periods WHERE status='open' LIMIT 1")
	if len(periods) == 0 { t.Skip("fixture has no open accounting period") }
	period := periods[0]["period"].(string); id := periods[0]["id"].(string)
	if err := s.Store.Update(context.Background(), "accounting_periods", id, map[string]any{"status": "closed"}); err != nil { t.Fatal(err) }
	accounts, _ := s.Store.Rows(context.Background(), "SELECT * FROM accounts LIMIT 1")
	if len(accounts) == 0 { t.Skip("fixture has no account") }
	if _, err := s.business().SetOpeningBalances(context.Background(), period, []map[string]any{{"account_id": accounts[0]["id"], "begin_balance": "1"}}); err == nil { t.Fatal("closed period accepted opening balance") }
}

func TestOpeningBalancesRollsBackBatchOnInvalidEntry(t *testing.T) {
	_, s := setup(t)
	periods, _ := s.Store.Rows(context.Background(), "SELECT * FROM accounting_periods WHERE status='open' LIMIT 1"); if len(periods)==0 { t.Skip("fixture has no open period") }
	accounts, _ := s.Store.Rows(context.Background(), "SELECT * FROM accounts WHERE code='1001' LIMIT 1"); if len(accounts)==0 { t.Skip("fixture has no account") }
	period:=periods[0]["period"].(string); aid:=accounts[0]["id"].(string)
	if _, err:=s.business().SetOpeningBalances(context.Background(), period, []map[string]any{{"account_id":aid,"begin_balance":"9"},{"account_id":"00000000-0000-0000-0000-000000000000","begin_balance":"2"}});err==nil{t.Fatal("invalid batch unexpectedly succeeded")}
	rows,_:=s.Store.Rows(context.Background(),"SELECT * FROM account_balances WHERE period=? AND account_id=?",business.BalancePeriodText(period),aid);if len(rows)!=0{t.Fatalf("partial opening balance remained: %#v",rows)}
}
