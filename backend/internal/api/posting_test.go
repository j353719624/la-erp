package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/shopspring/decimal"
	"os"
	"reflect"
	"testing"
)

// This compares actual SQL state after the complete original sequence, so an
// HTTP success with missing vouchers, journal legs or balance updates fails.
func verifyOriginalPostingState(t *testing.T, s *Server, fixture ...string) {
	file := "../../../运行快照"
	if len(fixture) > 0 {
		file = fixture[0]
	}
	t.Helper()
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var expected struct {
		Journals []map[string]any  `json:"journal_entries"`
		Balances []map[string]any  `json:"account_balances"`
		Codes    map[string]string `json:"account_codes"`
		Vouchers []map[string]any  `json:"vouchers"`
		Entries  []map[string]any  `json:"voucher_entries"`
		Links    []map[string]any  `json:"voucher_journal_entries"`
	}
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	for table, count := range map[string]int{"journal_entries": len(expected.Journals), "vouchers": len(expected.Vouchers), "voucher_entries": len(expected.Entries), "voucher_journal_entries": len(expected.Links), "account_balances": len(expected.Balances)} {
		var actual int
		if err := s.Store.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&actual); err != nil {
			t.Fatal(err)
		}
		if actual != count {
			t.Fatalf("%s original=%d src=%d", table, count, actual)
		}
	}
	aggregate := func(rows []map[string]any, fields []string, numeric string) map[string]string {
		totals := map[string]decimal.Decimal{}
		for _, r := range rows {
			key := ""
			for _, k := range fields {
				key += fmt.Sprint(r[k]) + "|"
			}
			n, err := decimal.NewFromString(fmt.Sprint(r[numeric]))
			if err != nil {
				t.Fatal(err)
			}
			totals[key] = totals[key].Add(n)
		}
		out := map[string]string{}
		for k, n := range totals {
			out[k] = n.String()
		}
		return out
	}
	for _, spec := range []struct {
		Table   string
		Rows    []map[string]any
		Fields  []string
		Numeric string
	}{{"journal_entries", expected.Journals, []string{"source_type", "account_code", "direction"}, "amount"}, {"vouchers", expected.Vouchers, []string{"source_type", "status"}, "total_debit"}, {"voucher_entries", expected.Entries, []string{"account_code", "direction"}, "amount"}} {
		actual, err := s.Store.Rows(context.Background(), "SELECT * FROM "+spec.Table)
		if err != nil {
			t.Fatal(err)
		}
		want, got := aggregate(spec.Rows, spec.Fields, spec.Numeric), aggregate(actual, spec.Fields, spec.Numeric)
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("%s SQL postings differ: original=%v src=%v", spec.Table, want, got)
		}
	}
	actual, err := s.Store.Rows(context.Background(), "SELECT b.*,a.code FROM account_balances b JOIN accounts a ON a.id=b.account_id")
	if err != nil {
		t.Fatal(err)
	}
	balances := map[string]map[string]any{}
	for _, r := range actual {
		balances[r["code"].(string)] = r
	}
	for _, want := range expected.Balances {
		code := expected.Codes[want["account_id"].(string)]
		got := balances[code]
		for _, k := range []string{"begin_balance", "debit_amount", "credit_amount", "end_balance"} {
			a, err := decimal.NewFromString(fmt.Sprint(want[k]))
			if err != nil {
				t.Fatal(err)
			}
			b, err := decimal.NewFromString(fmt.Sprint(got[k]))
			if err != nil {
				t.Fatal(err)
			}
			if !a.Equal(b) {
				t.Fatalf("account %s %s original=%s src=%s", code, k, a, b)
			}
		}
	}
}
