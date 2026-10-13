package api

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestOriginalUnstartedProcessReplay(t *testing.T) {
	c, _ := setup(t)
	raw, err := os.ReadFile("../../../evidence/backend-runtime/work-orders/unstarted-process-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []map[string]any
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	var replace func(any) any
	replace = func(v any) any {
		switch x := v.(type) {
		case string:
			if n, ok := ids[x]; ok {
				return n
			}
			keys := []string{}
			for k := range ids {
				keys = append(keys, k)
			}
			sort.Slice(keys, func(i, j int) bool { return len(keys[i]) > len(keys[j]) })
			pairs := []string{}
			for _, k := range keys {
				pairs = append(pairs, k, ids[k])
			}
			return strings.NewReplacer(pairs...).Replace(x)
		case map[string]any:
			r := map[string]any{}
			for k, v := range x {
				r[k] = replace(v)
			}
			return r
		case []any:
			r := []any{}
			for _, v := range x {
				r = append(r, replace(v))
			}
			return r
		}
		return v
	}
	var bind func(any, any)
	bind = func(a, b any) {
		switch x := a.(type) {
		case map[string]any:
			y, ok := b.(map[string]any)
			if !ok {
				return
			}
			for _, k := range []string{"id", "code", "order_no", "stock_in_no", "stock_out_no", "picking_no", "receipt_no", "return_no"} {
				old, ok := x[k].(string)
				next, ok2 := y[k].(string)
				if ok && ok2 {
					ids[old] = next
				}
			}
			for k, v := range x {
				bind(v, y[k])
			}
		case []any:
			y, ok := b.([]any)
			if !ok {
				return
			}
			for i, v := range x {
				j := i
				if row, ok := v.(map[string]any); ok && row["code"] != nil {
					for n, z := range y {
						if r, ok := z.(map[string]any); ok && r["code"] == row["code"] {
							j = n
							break
						}
					}
				}
				if j < len(y) {
					bind(v, y[j])
				}
			}
		}
	}
	var normalize func(any) any
	normalize = func(v any) any {
		switch x := v.(type) {
		case map[string]any:
			r := map[string]any{}
			for k, v := range x {
				if k == "id" || k == "created_at" || k == "updated_at" || k == "created_by" || k == "confirmed_at" || k == "approved_at" || k == "approved_by" || k == "actual_start_date" || k == "actual_end_date" || k == "started_at" || k == "completed_at" || k == "deleted_at" {
					continue
				}
				r[k] = normalize(v)
			}
			return r
		case []any:
			r := []any{}
			for _, v := range x {
				r = append(r, normalize(v))
			}
			sort.SliceStable(r, func(i, j int) bool {
				a, _ := json.Marshal(r[i])
				b, _ := json.Marshal(r[j])
				return string(a) < string(b)
			})
			return r
		}
		return v
	}
	for i, record := range cases {
		endpoint := replace(record["endpoint"]).(string)
		status, actual := c.request(record["method"].(string), endpoint, replace(record["request_body"]))
		expected := record["body"].(map[string]any)
		if status != int(record["status"].(float64)) || actual["code"] != expected["code"] {
			t.Fatalf("case %d %s expected %v actual %v", i, endpoint, expected, actual)
		}
		bind(expected["data"], actual["data"])
		if expected["code"] != float64(0) || endpoint == "/api/v1/boms" || strings.HasPrefix(endpoint, "/api/v1/work-orders?") || strings.HasPrefix(endpoint, "/api/v1/routings?") || i >= 41 {
			want, got := normalize(replace(expected)), normalize(actual)
			if !reflect.DeepEqual(want, got) {
				a, _ := json.Marshal(want)
				b, _ := json.Marshal(got)
				t.Fatalf("case %d %s expected %s actual %s", i, endpoint, a, b)
			}
		}
	}
}
