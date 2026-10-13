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

func TestOriginalCurrencyReplay(t *testing.T) {
	c, s := setup(t)
	raw, err := os.ReadFile("../../../evidence/backend-runtime/currency-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []map[string]any
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	var substitute func(any) any
	substitute = func(v any) any {
		switch x := v.(type) {
		case string:
			for a, b := range ids {
				x = strings.ReplaceAll(x, a, b)
			}
			return x
		case map[string]any:
			out := map[string]any{}
			for k, v := range x {
				out[k] = substitute(v)
			}
			return out
		case []any:
			out := []any{}
			for _, v := range x {
				out = append(out, substitute(v))
			}
			return out
		}
		return v
	}
	var normalize func(any) any
	normalize = func(v any) any {
		switch x := v.(type) {
		case map[string]any:
			out := map[string]any{}
			for k, v := range x {
				if k != "id" && k != "created_at" && k != "updated_at" {
					out[k] = normalize(v)
				}
			}
			return out
		case []any:
			out := []any{}
			for _, v := range x {
				out = append(out, normalize(v))
			}
			return out
		}
		return v
	}
	for i, item := range cases {
		endpoint := substitute(item["endpoint"]).(string)
		status, actual := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || actual["code"] != expected["code"] || actual["message"] != expected["message"] {
			t.Fatalf("currency case %d expected=%v actual=%v", i, expected, actual)
		}
		if item["method"] == "POST" && expected["code"] == float64(0) {
			ids[expected["data"].(map[string]any)["id"].(string)] = actual["data"].(map[string]any)["id"].(string)
		}
		if !reflect.DeepEqual(normalize(substitute(expected["data"])), normalize(actual["data"])) {
			t.Fatalf("currency case %d expected=%v actual=%v", i, expected["data"], actual["data"])
		}
	}
	raw, err = os.ReadFile("../../../evidence/backend-runtime/currencies-including-deleted.json")
	if err != nil {
		t.Fatal(err)
	}
	var expectedRows []map[string]any
	if err = json.Unmarshal(raw, &expectedRows); err != nil {
		t.Fatal(err)
	}
	actualRows, err := s.Store.Rows(context.Background(), "SELECT * FROM currencies")
	if err != nil {
		t.Fatal(err)
	}
	state := func(rows []map[string]any) []string {
		out := []string{}
		for _, r := range rows {
			code := fmt.Sprint(r["code"])
			id := fmt.Sprint(r["id"])
			deleted := r["deleted_at"] != nil
			if deleted && !strings.HasSuffix(code, "~del~"+id[:8]) {
				t.Fatalf("currency deletion code invalid: %s", code)
			}
			row := map[string]any{"code": strings.Split(code, "~del~")[0], "deleted": deleted, "is_base": fmt.Sprint(r["is_base"]) == "1" || fmt.Sprint(r["is_base"]) == "true"}
			for _, key := range []string{"name", "symbol", "remark", "exchange_rate", "tenant_id"} {
				if r[key] == nil {
					row[key] = ""
				} else {
					row[key] = fmt.Sprint(r[key])
				}
			}
			b, _ := json.Marshal(row)
			out = append(out, string(b))
		}
		sort.Strings(out)
		return out
	}
	if !reflect.DeepEqual(state(expectedRows), state(actualRows)) {
		t.Fatalf("currency SQL state differs: expected=%v actual=%v", state(expectedRows), state(actualRows))
	}
	t.Logf("replayed %d original currency requests and %d raw SQL records", len(cases), len(actualRows))
}
