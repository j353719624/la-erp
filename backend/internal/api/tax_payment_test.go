package api

import (
	"context"
	"testing"
)

func TestTaxPaymentDraftPersistsBalancedEntries(t *testing.T) {
	c, s := setup(t)
	accounts, err := s.Store.Rows(context.Background(), "SELECT code FROM accounts WHERE code IN ('2171','1001') ORDER BY code")
	if err != nil || len(accounts) < 2 {
		t.Skip("fixture lacks tax and bank accounts")
	}
	data := c.ok("POST", "/api/v1/tax-accruals/pay", map[string]any{
		"items":     []any{map[string]any{"account_code": "2171", "amount": "12.50"}},
		"bank_code": "1001", "remark": "test tax payment",
	}).(map[string]any)
	if data["status"] != "draft" || data["total_debit"] != "12.50" || data["total_credit"] != "12.50" {
		t.Fatalf("unexpected voucher: %#v", data)
	}
	entries, err := s.Store.Rows(context.Background(), "SELECT account_code,direction,amount FROM voucher_entries WHERE voucher_entries=? ORDER BY sequence", data["id"])
	if err != nil || len(entries) != 2 {
		t.Fatalf("draft entries missing: %#v %v", entries, err)
	}
}
