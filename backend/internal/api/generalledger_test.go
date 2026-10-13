package api

import (
	"context"
	"net/url"
	"testing"
)

func TestGeneralLedgerAcceptsDateBounds(t *testing.T) {
	_, s := setup(t)
	accounts, err := s.Store.Rows(context.Background(), "SELECT code FROM accounts WHERE deleted_at IS NULL ORDER BY code LIMIT 1")
	if err != nil || len(accounts) == 0 {
		t.Skip("fixture has no account")
	}
	code, ok := accounts[0]["code"].(string)
	if !ok || code == "" {
		t.Fatal("account code fixture missing")
	}
	rows, err := s.business().GeneralLedger(context.Background(), url.Values{
		"account_code": []string{code},
		"start_date":   []string{"2000-01-01"},
		"end_date":     []string{"2099-12-31"},
	})
	if err != nil {
		t.Fatalf("date-bounded general ledger rejected: %v", err)
	}
	if rows == nil {
		t.Fatal("date-bounded general ledger returned nil")
	}
}
