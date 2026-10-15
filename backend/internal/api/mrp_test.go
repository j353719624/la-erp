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

// This replays isolated requests against the packaged executable, including
// real inventory reservation, on-order supply and work-order component demand.
func TestOriginalMRPReplay(t *testing.T)                 { replayMRP(t, 0) }
func TestOriginalSuggestionReplay(t *testing.T)          { replayMRP(t, 1) }
func TestOriginalMRPQuantityReplay(t *testing.T)         { replayMRP(t, 2) }
func TestOriginalSuggestionMultilineReplay(t *testing.T) { replayMRP(t, 3) }
func TestOriginalMRPNestedReplay(t *testing.T)           { replayMRP(t, 4) }
func TestOriginalMRPGenerationReplay(t *testing.T)       { replayMRP(t, 5) }
func replayMRP(t *testing.T, phase int) {
	suggestions := phase >= 1
	c, s := setup(t)
	read := func(name string, target any) {
		raw, err := readEvidenceSnapshot(t, "backend-runtime/mrp/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(raw, target); err != nil {
			t.Fatal(err)
		}
	}
	var cases []map[string]any
	read("mrp-flow-contracts.json", &cases)
	mrpEnd := len(cases)
	var state map[string][]map[string]any
	if suggestions {
		var extension []map[string]any
		read("suggestion-flow-contracts.json", &extension)
		cases = append(cases, extension...)
		if phase >= 2 {
			var extension []map[string]any
			read("mrp-quantity-contracts.json", &extension)
			cases = append(cases, extension...)
			if phase >= 3 {
				var extension []map[string]any
				read("suggestion-multiline-contracts.json", &extension)
				cases = append(cases, extension...)
				if phase >= 4 {
					var nested []map[string]any
					read("mrp-nested-contracts.json", &nested)
					cases = append(cases, nested...)
					if phase == 5 {
						var generation []map[string]any
						read("mrp-generation-contracts.json", &generation)
						cases = append(cases, generation...)
						read("generation-state.json", &state)
					} else {
						read("nested-state.json", &state)
					}
				} else {
					read("multiline-state.json", &state)
				}
			} else {
				read("quantity-state.json", &state)
			}
		} else {
			read("suggestion-state.json", &state)
		}
	} else {
		read("state.json", &state)
	}
	ids := map[string]string{}
	lineNumbers := map[string]any{}
	for _, table := range []string{"units", "warehouses", "suppliers", "products"} {
		rows, err := s.Store.Rows(context.Background(), "SELECT id,code FROM "+table+" WHERE deleted_at IS NULL")
		if err != nil {
			t.Fatal(err)
		}
		for _, old := range state[table] {
			for _, row := range rows {
				if old["code"] == row["code"] {
					ids[fmt.Sprint(old["id"])] = fmt.Sprint(row["id"])
				}
			}
		}
	}
	var substitute func(any) any
	substitute = func(v any) any {
		switch x := v.(type) {
		case string:
			if replacement, ok := ids[x]; ok {
				return replacement
			}
			keys := []string{}
			for old := range ids {
				keys = append(keys, old)
			}
			sort.Slice(keys, func(i, j int) bool { return len(keys[i]) > len(keys[j]) })
			pairs := []string{}
			for _, old := range keys {
				pairs = append(pairs, old, ids[old])
			}
			return strings.NewReplacer(pairs...).Replace(x)
		case map[string]any:
			out := map[string]any{}
			for k, v := range x {
				if k == "line_no" {
					if number, ok := lineNumbers[fmt.Sprint(x["id"])]; ok {
						v = number
					}
				}
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
	var bind func(any, any)
	bind = func(a, b any) {
		switch x := a.(type) {
		case map[string]any:
			y, ok := b.(map[string]any)
			if !ok {
				return
			}
			for _, key := range []string{"id", "code", "mrp_no", "suggestion_no", "order_no", "stock_in_no"} {
				old, ok := x[key].(string)
				replacement, ok2 := y[key].(string)
				if ok && ok2 {
					ids[old] = replacement
				}
			}
			if x["order_id"] != nil && x["price"] != nil && y["line_no"] != nil {
				lineNumbers[fmt.Sprint(x["id"])] = y["line_no"]
			}
			for k, v := range x {
				bind(v, y[k])
			}
		case []any:
			y, ok := b.([]any)
			if !ok || len(x) != len(y) {
				return
			}
			for i, v := range x {
				j := i
				if row, ok := v.(map[string]any); ok && row["code"] != nil {
					for n, actual := range y {
						if r, ok := actual.(map[string]any); ok && r["code"] == row["code"] {
							j = n
							break
						}
					}
				}
				if row, ok := v.(map[string]any); ok && row["product_code"] != nil {
					unique := 0
					for _, item := range x {
						if r, ok := item.(map[string]any); ok && r["product_code"] == row["product_code"] {
							unique++
						}
					}
					if row["order_no"] == nil || unique == 1 {
						for n, actual := range y {
							if r, ok := actual.(map[string]any); ok && r["product_code"] == row["product_code"] {
								j = n
								break
							}
						}
					}
				}
				bind(v, y[j])
			}
		}
	}
	var normalize func(any) any
	normalize = func(v any) any {
		switch x := v.(type) {
		case map[string]any:
			out := map[string]any{}
			for k, v := range x {
				switch k {
				case "id", "created_at", "updated_at", "plan_date", "created_by", "confirmed_by", "approved_by", "confirmed_at", "approved_at", "actual_start_date", "actual_end_date":
					continue
				}
				out[k] = normalize(v)
			}
			return out
		case []any:
			out := []any{}
			for _, v := range x {
				out = append(out, normalize(v))
			}
			if len(out) > 0 {
				if row, ok := out[0].(map[string]any); ok && (row["requirement_type"] != nil || row["suggestion_id"] != nil || row["order_id"] != nil || (row["order_no"] != nil && row["qty"] != nil)) {
					sort.Slice(out, func(i, j int) bool {
						return fmt.Sprint(out[i].(map[string]any)["product_code"]) < fmt.Sprint(out[j].(map[string]any)["product_code"])
					})
				}
			}
			return out
		}
		return v
	}
	for i, item := range cases {
		endpoint := substitute(item["endpoint"]).(string)
		status, actual := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || actual["code"] != expected["code"] {
			t.Fatalf("MRP case %d %s expected=%v actual=%v", i, endpoint, expected, actual)
		}
		bind(expected["data"], actual["data"])
		if endpoint == "/api/v1/boms" || strings.HasPrefix(endpoint, "/api/v1/work-orders?") || strings.Contains(endpoint, "/mrp/") || strings.Contains(endpoint, "/purchase-suggestions") || strings.HasSuffix(endpoint, "/tree") || (i >= mrpEnd && strings.Contains(endpoint, "/purchase-orders?")) {
			want, got := normalize(substitute(expected)), normalize(actual)
			if strings.Contains(endpoint, "/purchase-orders?") {
				// This module compares newly converted orders; the earlier manual
				// purchase is setup and has independent legacy DTO coverage.
				for _, response := range []any{want, got} {
					data := response.(map[string]any)["data"].(map[string]any)
					items := []any{}
					for _, item := range data["list"].([]any) {
						if strings.HasPrefix(fmt.Sprint(item.(map[string]any)["remark"]), "由采购建议单 ") {
							items = append(items, item)
						}
					}
					data["list"] = items
				}
			}
			if !reflect.DeepEqual(want, got) {
				a, _ := json.Marshal(want)
				b, _ := json.Marshal(got)
				t.Fatalf("MRP case %d %s expected=%s actual=%s", i, endpoint, a, b)
			}
		}
	}
	if phase == 5 {
		plans, err := s.Store.Rows(context.Background(), "SELECT id FROM material_requirements WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
		if err != nil || len(plans) != 1 {
			t.Fatalf("batch rollback setup %v %v", plans, err)
		}
		count := func(table string) int {
			var n int
			if err := s.Store.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil {
				t.Fatal(err)
			}
			return n
		}
		beforeWork, beforeMaterials := count("work_orders"), count("work_order_materials")
		beforeCounters, err := s.Store.Rows(context.Background(), "SELECT prefix,seq FROM number_counters ORDER BY prefix")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.Store.DB.Exec("CREATE TRIGGER reject_generated_assembly BEFORE INSERT ON work_orders WHEN NEW.product_code='REC-NEST-SEMI' BEGIN SELECT RAISE(ABORT,'injected batch failure'); END"); err != nil {
			t.Fatal(err)
		}
		status, response := c.request("POST", "/api/v1/mrp/requirements/"+fmt.Sprint(plans[0]["id"])+"/generate-work-orders", nil)
		if status != 200 || response["code"] != float64(10000) {
			t.Fatalf("batch rollback response %d %v", status, response)
		}
		if count("work_orders") != beforeWork || count("work_order_materials") != beforeMaterials {
			t.Fatal("partial generated work orders survived failed batch")
		}
		afterCounters, err := s.Store.Rows(context.Background(), "SELECT prefix,seq FROM number_counters ORDER BY prefix")
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(beforeCounters, afterCounters) {
			t.Fatal("failed generation advanced work-order counters")
		}
	}
	if suggestions {
		pending, err := s.Store.Rows(context.Background(), "SELECT h.id FROM purchase_suggestions h JOIN purchase_suggestion_lines l ON l.suggestion_id=h.id WHERE h.status='draft' AND h.deleted_at IS NULL AND l.status='pending' LIMIT 1")
		if err != nil || len(pending) != 1 {
			t.Fatalf("pending setup: %v %v", pending, err)
		}
		count := func() int {
			var n int
			if err := s.Store.DB.QueryRow("SELECT count(*) FROM purchase_orders").Scan(&n); err != nil {
				t.Fatal(err)
			}
			return n
		}
		before := count()
		counters, err := s.Store.Rows(context.Background(), "SELECT prefix,seq FROM number_counters ORDER BY prefix")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.Store.DB.Exec("CREATE TRIGGER reject_suggestion_order BEFORE UPDATE OF status ON purchase_suggestion_lines BEGIN SELECT RAISE(ABORT,'injected suggestion update failure'); END"); err != nil {
			t.Fatal(err)
		}
		status, response := c.request("POST", "/api/v1/purchase-suggestions/"+fmt.Sprint(pending[0]["id"])+"/convert", nil)
		if status != 200 || response["code"] != float64(10000) {
			t.Fatalf("rollback response %d %v", status, response)
		}
		if count() != before {
			t.Fatal("conversion failure left a purchase order")
		}
		after, err := s.Store.Rows(context.Background(), "SELECT prefix,seq FROM number_counters ORDER BY prefix")
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(counters, after) {
			t.Fatal("failed conversion advanced a number counter")
		}
		header, err := s.Store.Get(context.Background(), "purchase_suggestions", fmt.Sprint(pending[0]["id"]))
		if err != nil || header["status"] != "draft" {
			t.Fatalf("failed conversion changed suggestion: %v %v", header, err)
		}
	}

	// MRP also creates suggestions without returning their IDs. Bind those
	// persisted headers by their generated number before checking foreign keys.
	headers, err := s.Store.Rows(context.Background(), "SELECT id,suggestion_no FROM purchase_suggestions")
	if err != nil {
		t.Fatal(err)
	}
	for _, old := range state["purchase_suggestions"] {
		targetNumber := substitute(old["suggestion_no"])
		if mrp, ok := substitute(old["mrp_no"]).(string); ok && strings.HasPrefix(mrp, "MRP") {
			targetNumber = "PS" + mrp[3:]
		}
		for _, row := range headers {
			if targetNumber == row["suggestion_no"] {
				ids[fmt.Sprint(old["id"])] = fmt.Sprint(row["id"])
				ids[fmt.Sprint(old["suggestion_no"])] = fmt.Sprint(row["suggestion_no"])
			}
		}
	}

	// Retained suggestions (including deleted plans), component quantities and
	// soft-deleted plan lines must agree with the original database snapshot.
	if suggestions {
		invalid, err := s.Store.Rows(context.Background(), "SELECT l.order_id FROM purchase_order_lines l JOIN purchase_orders h ON h.id=l.order_id WHERE h.remark LIKE '由采购建议单 %' GROUP BY l.order_id HAVING min(l.line_no)<>1 OR max(l.line_no)<>count(*) OR count(DISTINCT l.line_no)<>count(*)")
		if err != nil || len(invalid) != 0 {
			t.Fatalf("invalid generated order line numbering: %v %v", invalid, err)
		}
	}
	tables := []string{"material_requirements", "material_requirement_lines", "purchase_suggestions", "purchase_suggestion_lines"}
	if suggestions {
		tables = append(tables, "purchase_orders", "purchase_order_lines")
		if phase == 5 {
			tables = append(tables, "work_orders", "work_order_materials")
		}
	}
	for _, table := range tables {
		query := "SELECT * FROM " + table + " WHERE deleted_at IS NULL"
		if table == "purchase_orders" {
			query += " AND remark LIKE '由采购建议单 %'"
		}
		if table == "purchase_order_lines" {
			query += " AND order_id IN (SELECT id FROM purchase_orders WHERE remark LIKE '由采购建议单 %')"
		}
		rows, err := s.Store.Rows(context.Background(), query)
		if err != nil {
			t.Fatal(err)
		}
		canonical := func(rows []map[string]any, replace bool) []string {
			out := []string{}
			for _, row := range rows {
				v := any(s.Store.Public(table, row))
				if replace {
					v = substitute(v)
				}
				raw, _ := json.Marshal(normalize(v))
				out = append(out, string(raw))
			}
			sort.Strings(out)
			return out
		}
		want, got := canonical(state[table], true), canonical(rows, false)
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("MRP SQL %s differs: expected=%v actual=%v", table, want, got)
		}
	}
}
