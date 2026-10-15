package api

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestOriginalMPSReplay(t *testing.T) {
	c, s := setup(t)
	raw, err := readEvidenceSnapshot(t, "backend-runtime/mps/mps-plan-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []map[string]any
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	c.ok("POST", "/api/v1/customers", map[string]any{"code": "REC-MRP-CUSTOMER", "name": "恢复MRP客户"})
	units := c.ok("GET", "/api/v1/units", nil).(map[string]any)["list"].([]any)
	var rawUnit any
	for _, unit := range units {
		u := unit.(map[string]any)
		if u["code"] == "U-L" {
			rawUnit = u["id"]
		}
	}
	part := c.ok("POST", "/api/v1/products", map[string]any{"code": "REC-MRP-RAW2", "name": "REC-MRP-RAW2", "product_type": "raw_material", "cost_method": "weighted_avg", "purchase_price": 9, "unit_id": rawUnit}).(map[string]any)
	ids := map[string]string{}
	products := cases[0]["body"].(map[string]any)["data"].(map[string]any)["list"].([]any)
	for _, v := range products {
		p := v.(map[string]any)
		if p["code"] == "REC-MRP-RAW2" {
			ids[p["id"].(string)] = part["id"].(string)
		}
	}
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
			for _, k := range []string{"id", "code", "order_no", "stock_in_no", "stock_out_no"} {
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
				if k == "id" || k == "created_at" || k == "updated_at" || k == "created_by" || k == "confirmed_at" || k == "approved_at" || k == "approved_by" || k == "actual_start_date" {
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
	for i, record := range cases[2:] {
		endpoint := replace(record["endpoint"]).(string)
		status, actual := c.request(record["method"].(string), endpoint, replace(record["request_body"]))
		expected := record["body"].(map[string]any)
		if status != int(record["status"].(float64)) || actual["code"] != expected["code"] {
			t.Fatalf("case %d %s expected %v actual %v", i+2, endpoint, expected, actual)
		}
		bind(expected["data"], actual["data"])
		if strings.Contains(endpoint, "/mps-plans") || strings.HasPrefix(endpoint, "/api/v1/work-orders?") {
			want, got := normalize(replace(expected)), normalize(actual)
			if !reflect.DeepEqual(want, got) {
				a, _ := json.Marshal(want)
				b, _ := json.Marshal(got)
				t.Fatalf("case %d %s expected %s actual %s", i+2, endpoint, a, b)
			}
		}
	}
	originalPlans := []map[string]any{}
	for _, record := range cases {
		if record["endpoint"] == "/api/v1/mps-plans" {
			body := record["body"].(map[string]any)
			if body["code"] == float64(0) {
				originalPlans = append(originalPlans, body["data"].(map[string]any))
			}
		}
	}
	var positiveID string
	for _, p := range originalPlans {
		edges, _ := p["edges"].(map[string]any)
		lines, _ := edges["lines"].([]any)
		if len(lines) > 0 && lines[0].(map[string]any)["net_qty"] == "2" {
			candidate := ids[p["id"].(string)]
			row, err := s.Store.Get(context.Background(), "mps_plans", candidate)
			if err == nil && row["status"] == "draft" {
				positiveID = candidate
				break
			}
		}
	}
	if positiveID == "" {
		t.Fatal("positive draft plan missing")
	}
	before, err := s.Store.Rows(context.Background(), "SELECT * FROM work_orders")
	if err != nil {
		t.Fatal(err)
	}
	counters, err := s.Store.Rows(context.Background(), "SELECT prefix,seq FROM number_counters ORDER BY prefix")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Store.DB.Exec("CREATE TRIGGER fail_mps BEFORE INSERT ON work_orders BEGIN SELECT RAISE(ABORT,'injected MPS failure'); END"); err != nil {
		t.Fatal(err)
	}
	status, body := c.request("POST", "/api/v1/mps-plans/"+positiveID+"/generate-work-orders", nil)
	if status != 200 || body["code"] != float64(10000) {
		t.Fatal(status, body)
	}
	after, err := s.Store.Rows(context.Background(), "SELECT * FROM work_orders")
	if err != nil {
		t.Fatal(err)
	}
	nextCounters, err := s.Store.Rows(context.Background(), "SELECT prefix,seq FROM number_counters ORDER BY prefix")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(counters, nextCounters) {
		t.Fatal("MPS failure partially committed work orders or counters")
	}
	plan := c.ok("GET", "/api/v1/mps-plans/"+positiveID, nil).(map[string]any)
	if plan["status"] != "draft" || plan["edges"].(map[string]any)["lines"].([]any)[0].(map[string]any)["status"] != "pending" {
		t.Fatal(plan)
	}
	var retained int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM mps_plan_lines l JOIN mps_plans h ON h.id=l.plan_id WHERE h.deleted_at IS NOT NULL AND l.deleted_at IS NULL").Scan(&retained); err != nil {
		t.Fatal(err)
	}
	if retained != 1 {
		t.Fatal("deleted plan should retain its original line", retained)
	}
	generated, err := s.Store.Rows(context.Background(), "SELECT * FROM work_orders WHERE remark='MPS计划生成'")
	if err != nil {
		t.Fatal(err)
	}
	quantities := []string{}
	for _, row := range generated {
		quantities = append(quantities, fmt.Sprint(row["qty"]))
		if row["bom_id"] != nil || row["warehouse_id"] != nil {
			t.Fatal(row)
		}
	}
	sort.Strings(quantities)
	if !reflect.DeepEqual(quantities, []string{"10", "2", "4"}) {
		t.Fatal(generated)
	}
}
