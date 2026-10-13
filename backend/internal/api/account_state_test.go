package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/shopspring/decimal"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// Check the SQL rows, not just 404/success responses: deleted accounts must
// retain their UUID references, and existing financial rows must survive.
func verifyAccountDeletionState(t *testing.T, s *Server) {
	raw, err := os.ReadFile("../../../evidence/backend-runtime/account-deletion-posting-state.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected map[string]any
	if err = json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	codes := map[string]string{}
	for id, code := range expected["account_codes"].(map[string]any) {
		codes[id] = code.(string)
	}
	actualAccounts, err := s.Store.Rows(context.Background(), "SELECT * FROM accounts")
	if err != nil {
		t.Fatal(err)
	}
	actualCodes := map[string]string{}
	for _, r := range actualAccounts {
		actualCodes[fmt.Sprint(r["id"])] = strings.Split(fmt.Sprint(r["code"]), "~del~")[0]
	}
	accounts := func(rows []map[string]any, codeMap map[string]string) []string {
		out := []string{}
		for _, r := range rows {
			id := fmt.Sprint(r["id"])
			code := fmt.Sprint(r["code"])
			suffix := strings.Count(code, "~del~")
			if suffix > 0 {
				if code != codeMap[id]+strings.Repeat("~del~"+id[:8], suffix) {
					t.Fatalf("deleted code suffix differs: %s", code)
				}
			}
			row := map[string]any{"code": codeMap[id], "deletion_count": suffix, "deleted": r["deleted_at"] != nil, "parent_code": codeMap[fmt.Sprint(r["parent_id"])]}
			for _, k := range []string{"name", "category", "sub_category", "currency", "remark", "is_leaf", "is_enabled"} {
				v := r[k]
				if v == nil {
					v = ""
				}
				if k == "is_leaf" || k == "is_enabled" {
					v = fmt.Sprint(v) == "1" || fmt.Sprint(v) == "true"
				}
				row[k] = v
			}
			b, _ := json.Marshal(row)
			out = append(out, string(b))
		}
		sort.Strings(out)
		return out
	}
	expectedAccounts := []map[string]any{}
	for _, r := range expected["accounts"].([]any) {
		expectedAccounts = append(expectedAccounts, r.(map[string]any))
	}
	if !reflect.DeepEqual(accounts(expectedAccounts, codes), accounts(actualAccounts, actualCodes)) {
		t.Fatal("account rows, deletion metadata or parent references differ")
	}
	for _, table := range []string{"journal_entries", "vouchers", "voucher_entries", "voucher_journal_entries", "account_balances"} {
		rows, err := s.Store.Rows(context.Background(), "SELECT * FROM "+table)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != len(expected[table].([]any)) {
			t.Fatalf("%s original=%d source=%d", table, len(expected[table].([]any)), len(rows))
		}
		if table == "voucher_journal_entries" {
			continue
		}
		aggregate := func(rows []map[string]any, codeMap map[string]string) map[string]string {
			amounts := map[string]decimal.Decimal{}
			for _, r := range rows {
				key := ""
				fields := []string{"source_type", "account_code", "direction"}
				numeric := []string{"amount"}
				if table == "vouchers" {
					fields = []string{"source_type", "status"}
					numeric = []string{"total_debit", "total_credit"}
				}
				if table == "voucher_entries" {
					fields = []string{"account_code", "direction"}
				}
				if table == "account_balances" {
					key = codeMap[fmt.Sprint(r["account_id"])] + "|" + fmt.Sprint(r["period"])[:10] + "|"
					fields = nil
					numeric = []string{"begin_balance", "debit_amount", "credit_amount", "end_balance"}
				}
				for _, k := range fields {
					key += fmt.Sprint(r[k]) + "|"
				}
				for _, k := range numeric {
					n, err := decimal.NewFromString(fmt.Sprint(r[k]))
					if err != nil {
						t.Fatal(err)
					}
					amounts[key+k] = amounts[key+k].Add(n)
				}
			}
			out := map[string]string{}
			for k, n := range amounts {
				out[k] = n.String()
			}
			return out
		}
		want := []map[string]any{}
		for _, r := range expected[table].([]any) {
			want = append(want, r.(map[string]any))
		}
		wanted, got := aggregate(want, codes), aggregate(rows, actualCodes)
		if !reflect.DeepEqual(wanted, got) {
			diff := map[string]any{}
			for k, v := range wanted {
				if got[k] != v {
					diff[k] = []string{v, got[k]}
				}
			}
			for k, v := range got {
				if _, ok := wanted[k]; !ok {
					diff[k] = []string{"missing", v}
				}
			}
			t.Fatalf("financial state after account deletion differs in %s: %v", table, diff)
		}
	}
}
