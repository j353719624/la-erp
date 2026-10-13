package api

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func verifyBankState(t *testing.T, s *Server, ids map[string]string) {
	for _, table := range []string{"bank_accounts", "bank_statements"} {
		raw, err := os.ReadFile("../../../evidence/backend-runtime/" + table + "-including-deleted.json")
		if err != nil {
			t.Fatal(err)
		}
		var expected []map[string]any
		if err = json.Unmarshal(raw, &expected); err != nil {
			t.Fatal(err)
		}
		actual, err := s.Store.Rows(context.Background(), "SELECT * FROM "+table)
		if err != nil {
			t.Fatal(err)
		}
		canonical := func(rows []map[string]any, substitute bool) []string {
			out := []string{}
			for _, row := range rows {
				data := map[string]any{"deleted": row["deleted_at"] != nil}
				for key, v := range row {
					if key == "created_at" || key == "updated_at" || key == "deleted_at" {
						continue
					}
					text := fmt.Sprint(v)
					if substitute {
						for a, b := range ids {
							text = strings.ReplaceAll(text, a, b)
						}
					}
					if key == "statement_date" && len(text) >= 19 {
						text = text[:19]
					}
					data[key] = text
				}
				b, _ := json.Marshal(data)
				out = append(out, string(b))
			}
			sort.Strings(out)
			return out
		}
		want, got := canonical(expected, true), canonical(actual, false)
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("%s raw state differs: expected=%v actual=%v", table, want, got)
		}
	}
}
