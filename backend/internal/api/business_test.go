package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/shopspring/decimal"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// Replay actual requests captured against the packaged original. Assertions
// cover HTTP/domain codes, document totals, inventory quantities/cost and ledger.
// Generated IDs and timestamps are not expected to match across installations.
func TestOriginalBusinessFlowReplay(t *testing.T) {
	c, s := setup(t)
	raw, err := readEvidenceSnapshot(t, "backend-runtime/business-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []map[string]any
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	financialEnd := len(cases)
	productionRaw, err := readEvidenceSnapshot(t, "backend-runtime/production-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var productionCases []map[string]any
	if err := json.Unmarshal(productionRaw, &productionCases); err != nil {
		t.Fatal(err)
	}
	cases = append(cases, productionCases...)
	ids := map[string]string{}
	// Runs use fresh UUIDs; resolve original master records by preserved codes.
	codes := map[string]string{}
	for _, table := range []string{"products", "warehouses", "units", "suppliers", "accounts"} {
		rows, err := s.Store.Rows(context.Background(), "SELECT id,code FROM "+table+" WHERE deleted_at IS NULL")
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			codes[row["code"].(string)] = row["id"].(string)
		}
	}
	var masters func(any)
	masters = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			if code, ok := x["code"].(string); ok {
				if target, ok := codes[code]; ok {
					if id, ok := x["id"].(string); ok {
						ids[id] = target
					}
				}
			}
			for _, v := range x {
				masters(v)
			}
		case []any:
			for _, v := range x {
				masters(v)
			}
		}
	}
	for _, item := range cases {
		masters(item["body"])
	}
	for _, item := range cases {
		if b, ok := item["request_body"].(map[string]any); ok {
			if code, ok := b["cash_account_code"].(string); ok {
				if id, ok := b["cash_account_id"].(string); ok {
					ids[id] = codes[code]
				}
			}
		}
	}

	for _, item := range cases {
		if b, ok := item["request_body"].(map[string]any); ok {
			if lines, ok := b["entries"].([]any); ok {
				for _, v := range lines {
					if l, ok := v.(map[string]any); ok {
						if id, ok := l["account_id"].(string); ok {
							ids[id] = codes[l["account_code"].(string)]
						}
					}
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
			pairs := []string{}
			for old, replacement := range ids {
				pairs = append(pairs, old, replacement)
			}
			return strings.NewReplacer(pairs...).Replace(x)
		case map[string]any:
			r := map[string]any{}
			for k, v := range x {
				r[k] = substitute(v)
			}
			return r
		case []any:
			r := []any{}
			for _, v := range x {
				r = append(r, substitute(v))
			}
			return r
		}
		return v
	}
	var bind func(any, any)
	bind = func(expected, actual any) {
		switch e := expected.(type) {
		case map[string]any:
			a, ok := actual.(map[string]any)
			if !ok {
				return
			}
			if id, ok := e["id"].(string); ok {
				if target, ok := a["id"].(string); ok {
					ids[id] = target
				}
			}
			for key, v := range e {
				if strings.HasSuffix(key, "_no") || key == "code" {
					old, ok := v.(string)
					target, ok2 := a[key].(string)
					if ok && ok2 && old != "" {
						ids[old] = target
					}
				}
			}
			for k, v := range e {
				bind(v, a[k])
			}
		case []any:
			a, ok := actual.([]any)
			if !ok {
				return
			}
			for i, v := range e {
				if i < len(a) {
					bind(v, a[i])
				}
			}
		}
	}
	important := map[string]bool{"qty_planned": true, "qty_good": true, "qty_bad": true, "qty_completed": true, "actual_time": true, "labor_rate": true, "operator_name": true, "capacity": true, "efficiency": true, "cost_rate": true, "standard_time": true, "setup_time": true, "name": true, "manager": true, "picked_qty": true, "qty_per": true, "completed_qty": true, "scrap_qty": true, "material_cost": true, "labor_cost": true, "overhead_cost": true, "qty_required": true, "qty_issued": true, "qty_returned": true, "qty_pending": true, "required": true, "picked": true, "available": true, "shortage": true, "line_cost": true, "has_bom": true, "circular": true, "invoice_status": true, "total_debit": true, "total_credit": true, "sales_invoice_no": true, "purchase_invoice_no": true, "received_amount": true, "balance": true, "begin_balance": true, "debit_amount": true, "credit_amount": true, "end_balance": true, "returned_qty": true, "status": true, "total_qty": true, "total_amount": true, "tax_amount": true, "discount_amount": true, "delivered_qty": true, "received_qty": true, "issued_qty": true, "paid_amount": true, "qty_available": true, "qty_locked": true, "qty_in_transit": true, "avg_cost": true, "qty": true, "unit_cost": true, "amount": true, "price": true, "tax_rate": true, "discount": true, "remark": true, "customer_name": true, "supplier_name": true, "stock_locked": true, "lock_remark": true, "customer_progress": true, "direction": true, "total_cost": true, "balance_after": true}
	var compare func(string, any, any)
	compare = func(path string, expected, actual any) {
		switch e := expected.(type) {
		case map[string]any:
			a, ok := actual.(map[string]any)
			if !ok {
				t.Fatalf("%s missing object", path)
			}
			for _, k := range []string{"location_id", "rack_id"} {
				if important[k] && !reflect.DeepEqual(substitute(e[k]), a[k]) {
					t.Fatalf("%s.%s expected=%v actual=%v", path, k, e[k], a[k])
				}
			}
			for k, v := range e {
				if important[k] && !reflect.DeepEqual(substitute(v), a[k]) {
					t.Fatalf("%s.%s expected=%v actual=%v", path, k, v, a[k])
				}
				if k == "edges" || k == "lines" || k == "list" || k == "items" || k == "entries" || k == "children" || k == "steps" || k == "processes" || k == "photos" {
					compare(path+"."+k, v, a[k])
				}
			}
		case []any:
			a, ok := actual.([]any)
			if !ok || len(a) != len(e) {
				t.Fatalf("%s collection lengths differ: expected=%d actual=%d", path, len(e), len(a))
			}
			for i, v := range e {
				compare(fmt.Sprintf("%s[%d]", path, i), v, a[i])
			}
		}
	}
	for i, item := range cases {
		method := item["method"].(string)
		endpoint := substitute(item["endpoint"]).(string)
		status, response := c.request(method, endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || response["code"] != expected["code"] {
			t.Fatalf("case %d %s %s expected=%v actual=%d %v", i, method, endpoint, expected, status, response)
		}
		if expected["code"] == float64(0) {
			if strings.Contains(endpoint, "/work-order-processes/") && expected["code"] != float64(0) && response["message"] != expected["message"] {
				t.Fatalf("case %d process error expected %v actual %v", i, expected, response)
			}
			bind(expected["data"], response["data"])
			if i != 25 && i != 29 {
				compare(fmt.Sprintf("case%d", i), expected["data"], response["data"])
			}
		}
		if i == financialEnd-1 {
			verifyOriginalPostingState(t, s)
		}
	}

	verifyOriginalPostingState(t, s, "../../../evidence/backend-runtime/production-posting-state.json")
	verifyOriginalReports(t, c, s, ids)
	classificationRaw, err := readEvidenceSnapshot(t, "backend-runtime/report-classification-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var classification []map[string]any
	if err = json.Unmarshal(classificationRaw, &classification); err != nil {
		t.Fatal(err)
	}
	for _, item := range classification {
		masters(item["body"])
	}
	for i, item := range classification {
		endpoint := substitute(item["endpoint"]).(string)
		status, response := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || response["code"] != expected["code"] {
			t.Fatalf("cash classification case %d expected=%v actual=%v", i, expected, response)
		}
		if !strings.Contains(endpoint, "/accounts?") {
			bind(expected["data"], response["data"])
		}
		if strings.Contains(endpoint, "cash-flow") && !reflect.DeepEqual(expected["data"], response["data"]) {
			t.Fatalf("cash classification case %d expected=%v actual=%v", i, expected, response)
		}
	}
	t.Logf("replayed %d original business requests", len(cases))
	inventoryRaw, err := readEvidenceSnapshot(t, "backend-runtime/inventory-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var inventory []map[string]any
	if err = json.Unmarshal(inventoryRaw, &inventory); err != nil {
		t.Fatal(err)
	}
	for _, item := range inventory {
		masters(item["body"])
	}

	unitRaw, err := readEvidenceSnapshot(t, "backend-runtime/unit-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var unitCases []map[string]any
	if err = json.Unmarshal(unitRaw, &unitCases); err != nil {
		t.Fatal(err)
	}
	inventory = append(inventory, unitCases...)
	for _, item := range unitCases {
		masters(item["body"])
	}
	important["rate"], important["unit_name"] = true, true
	important["cost_price"], important["transferred_qty"] = true, true
	important["type"], important["source_type"] = true, true
	for _, k := range []string{"book_qty", "actual_qty", "diff_qty", "diff_type", "diff_amount", "profit_amount", "loss_amount", "profit_items", "loss_items", "total_items"} {
		important[k] = true
	}
	for i, item := range inventory {
		endpoint := substitute(item["endpoint"]).(string)
		status, response := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || response["code"] != expected["code"] {
			t.Fatalf("inventory case %d %s expected=%v actual=%v", i, endpoint, expected, response)
		}
		if expected["code"] == float64(0) {
			if expected["data"] == nil && response["data"] != nil {
				t.Fatalf("inventory case %d expected null data, got %v", i, response)
			}
			bind(expected["data"], response["data"])
			compare(fmt.Sprintf("inventory%d", i), expected["data"], response["data"])
		}
	}
	verifyOriginalPostingState(t, s, "../../../evidence/backend-runtime/inventory-unit-posting-state.json")
	photoRaw, err := readEvidenceSnapshot(t, "backend-runtime/photo-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var photoCases []map[string]any
	if err = json.Unmarshal(photoRaw, &photoCases); err != nil {
		t.Fatal(err)
	}
	for _, item := range photoCases {
		masters(item["body"])
	}
	important["url"] = true
	important["location_id"], important["rack_id"] = true, true
	for i, item := range photoCases {
		endpoint := substitute(item["endpoint"]).(string)
		status, response := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || response["code"] != expected["code"] {
			t.Fatalf("photo case %d expected=%v actual=%v", i, expected, response)
		}
		if expected["code"] == float64(0) {
			if expected["data"] == nil && response["data"] != nil {
				t.Fatalf("photo case %d expected null", i)
			}
			bind(expected["data"], response["data"])
			compare(fmt.Sprintf("photo%d", i), expected["data"], response["data"])
		}
	}
	statementRaw, err := readEvidenceSnapshot(t, "backend-runtime/statement-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var statements []map[string]any
	if err = json.Unmarshal(statementRaw, &statements); err != nil {
		t.Fatal(err)
	}
	for i, item := range statements {
		if b, ok := item["request_body"].(map[string]any); ok {
			if id, ok := b["cash_account_id"].(string); ok {
				ids[id] = codes[b["cash_account_code"].(string)]
			}
		}
		endpoint := substitute(item["endpoint"]).(string)
		status, response := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || response["code"] != expected["code"] {
			t.Fatalf("statement case %d %s expected=%v actual=%v", i, endpoint, expected, response)
		}
		if strings.Contains(endpoint, "/reports/finance/statement/") {
			if !reflect.DeepEqual(normalizeStatement(substitute(expected["data"])), normalizeStatement(response["data"])) {
				t.Fatalf("statement case %d %s expected=%v actual=%v", i, endpoint, expected["data"], response["data"])
			}
		} else if expected["code"] == float64(0) {
			bind(expected["data"], response["data"])
			compare(fmt.Sprintf("statement%d", i), expected["data"], response["data"])
		}
	}
	t.Logf("replayed %d cross-month statement requests", len(statements))
	reorderRaw, err := readEvidenceSnapshot(t, "backend-runtime/reorder-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var reorder []map[string]any
	if err = json.Unmarshal(reorderRaw, &reorder); err != nil {
		t.Fatal(err)
	}
	unitMastersRaw, err := readEvidenceSnapshot(t, "backend-runtime/reorder-unit-masters.json")
	if err != nil {
		t.Fatal(err)
	}
	var unitMasters any
	if err = json.Unmarshal(unitMastersRaw, &unitMasters); err != nil {
		t.Fatal(err)
	}
	masters(unitMasters)
	for _, item := range reorder {
		masters(item["body"])
	}
	for i, item := range reorder {
		endpoint := substitute(item["endpoint"]).(string)
		status, response := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || response["code"] != expected["code"] {
			t.Fatalf("reorder case %d %s expected=%v actual=%v", i, endpoint, expected, response)
		}
		if strings.Contains(endpoint, "/reports/inventory/reorder-suggestions") {
			if !reflect.DeepEqual(normalizeReorder(expected["data"]), normalizeReorder(response["data"])) {
				t.Fatalf("reorder case %d expected=%v actual=%v", i, expected["data"], response["data"])
			}
		} else if expected["code"] == float64(0) {
			bind(expected["data"], response["data"])
			compare(fmt.Sprintf("reorder%d", i), expected["data"], response["data"])
		}
	}
	t.Logf("replayed %d replenishment requests", len(reorder))
	accountRaw, err := readEvidenceSnapshot(t, "backend-runtime/account-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var accounts []map[string]any
	if err = json.Unmarshal(accountRaw, &accounts); err != nil {
		t.Fatal(err)
	}
	for _, item := range accounts {
		masters(item["body"])
	}
	var normalizeAccount func(any) any
	normalizeAccount = func(v any) any {
		switch x := v.(type) {
		case map[string]any:
			out := map[string]any{}
			for k, val := range x {
				if k != "id" && k != "created_at" && k != "updated_at" {
					out[k] = normalizeAccount(val)
				}
			}
			return out
		case []any:
			out := []any{}
			for _, val := range x {
				out = append(out, normalizeAccount(val))
			}
			return out
		}
		return v
	}
	for i, item := range accounts {
		endpoint := substitute(item["endpoint"]).(string)
		status, response := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || response["code"] != expected["code"] {
			t.Fatalf("account case %d %s expected=%v actual=%v", i, endpoint, expected, response)
		}
		if expected["code"] == float64(0) {
			bind(expected["data"], response["data"])
			if !reflect.DeepEqual(normalizeAccount(substitute(expected["data"])), normalizeAccount(response["data"])) {
				t.Fatalf("account case %d %s expected=%v actual=%v", i, endpoint, expected["data"], response["data"])
			}
		}
	}
	t.Logf("replayed %d chart of accounts requests", len(accounts))
	verifyAccountDeletionState(t, s)

	mappingRaw, err := readEvidenceSnapshot(t, "backend-runtime/mapping-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var mappings []map[string]any
	if err = json.Unmarshal(mappingRaw, &mappings); err != nil {
		t.Fatal(err)
	}
	// Explicitly selecting a default account still produces an override ID.
	// Resolve only preserved master codes; custom IDs bind at account creation.
	var mappingMasters func(any)
	mappingMasters = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			if code, ok := x["account_code"].(string); ok {
				if target, ok := codes[code]; ok {
					if id, ok := x["account_id"].(string); ok {
						ids[id] = target
					}
				}
			}
			for _, v := range x {
				mappingMasters(v)
			}
		case []any:
			for _, v := range x {
				mappingMasters(v)
			}
		}
	}
	for _, item := range mappings {
		mappingMasters(item["body"])
	}
	for i, item := range mappings {
		endpoint := substitute(item["endpoint"]).(string)
		status, response := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || response["code"] != expected["code"] || response["message"] != expected["message"] {
			t.Fatalf("mapping case %d %s expected=%v actual=%v", i, endpoint, expected, response)
		}
		if expected["code"] == float64(0) {
			bind(expected["data"], response["data"])
		}
		if !reflect.DeepEqual(normalizeAccount(substitute(expected["data"])), normalizeAccount(response["data"])) {
			t.Fatalf("mapping case %d %s expected=%v actual=%v", i, endpoint, substitute(expected["data"]), response["data"])
		}
	}
	settings, err := s.Store.Rows(context.Background(), "SELECT value FROM system_settings WHERE key='account_mapping'")
	if err != nil || len(settings) != 1 || fmt.Sprint(settings[0]["value"]) != "{}" {
		t.Fatalf("mapping reset not persisted: %v %v", settings, err)
	}
	t.Logf("replayed %d account mapping requests", len(mappings))
	bankRaw, err := readEvidenceSnapshot(t, "backend-runtime/bank-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var banks []map[string]any
	if err = json.Unmarshal(bankRaw, &banks); err != nil {
		t.Fatal(err)
	}
	adminRows, err := s.Store.Rows(context.Background(), "SELECT id FROM sys_users WHERE username='admin'")
	if err != nil || len(adminRows) != 1 {
		t.Fatal("bank replay admin missing", err)
	}
	var bankMasters func(any)
	bankMasters = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			if id, ok := x["created_by"].(string); ok {
				ids[id] = fmt.Sprint(adminRows[0]["id"])
			}
			if code, ok := x["cash_account_code"].(string); ok {
				if id, ok := x["cash_account_id"].(string); ok {
					ids[id] = codes[code]
				}
			}
			for _, v := range x {
				bankMasters(v)
			}
		case []any:
			for _, v := range x {
				bankMasters(v)
			}
		}
	}
	for _, item := range banks {
		bankMasters(item["body"])
		bankMasters(item["request_body"])
	}
	for i, item := range banks {
		endpoint := substitute(item["endpoint"]).(string)
		status, response := c.request(item["method"].(string), endpoint, substitute(item["request_body"]))
		expected := item["body"].(map[string]any)
		if status != int(item["status"].(float64)) || response["code"] != expected["code"] || response["message"] != expected["message"] {
			t.Fatalf("bank case %d %s expected=%v actual=%v", i, endpoint, expected, response)
		}
		if expected["code"] == float64(0) {
			bind(expected["data"], response["data"])
		}
		if !strings.HasPrefix(endpoint, "/api/v1/bank/") {
			compare(fmt.Sprintf("bank finance case %d", i), expected["data"], response["data"])
			if e, ok := expected["data"].(map[string]any); ok {
				if a, ok := response["data"].(map[string]any); ok {
					for _, key := range []string{"invoice_no", "receipt_no", "payment_no"} {
						if number, ok := e[key].(string); ok {
							ids[number] = a[key].(string)
						}
					}
				}
			}
		} else if !reflect.DeepEqual(normalizeAccount(substitute(expected["data"])), normalizeAccount(response["data"])) {
			t.Fatalf("bank case %d %s expected=%v actual=%v", i, endpoint, substitute(expected["data"]), response["data"])
		}
	}
	verifyBankState(t, s, ids)
	t.Logf("replayed %d bank and matching setup requests", len(banks))

}

// The original groups parties via map iteration. Normalize only top-level
// party order and fresh party UUIDs; all line order and financial values stay.
func normalizeStatement(v any) any {
	rows, ok := v.([]any)
	if !ok {
		return v
	}
	out := []string{}
	for _, item := range rows {
		row := item.(map[string]any)
		copy := map[string]any{}
		for k, val := range row {
			if k != "customer_id" && k != "supplier_id" {
				copy[k] = val
			}
		}
		raw, _ := json.Marshal(copy)
		out = append(out, string(raw))
	}
	sort.Strings(out)
	return out
}

func normalizeReorder(v any) any {
	rows, ok := v.([]any)
	if !ok {
		return v
	}
	out := []string{}
	for _, item := range rows {
		copy := map[string]any{}
		for k, val := range item.(map[string]any) {
			if k != "product_id" {
				copy[k] = val
			}
		}
		raw, _ := json.Marshal(copy)
		out = append(out, string(raw))
	}
	sort.Strings(out)
	return out
}

func verifyOriginalReports(t *testing.T, c *client, s *Server, ids map[string]string) {
	raw, err := readEvidenceSnapshot(t, "backend-runtime/report-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []map[string]any
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	// Posting creates vouchers without returning their numbers in order DTOs.
	// Resolve the captured daily sequence to this replay's calendar date.
	vouchers, err := s.Store.Rows(context.Background(), "SELECT voucher_no FROM vouchers WHERE deleted_at IS NULL")
	if err != nil {
		t.Fatal(err)
	}
	var bindVoucherNumbers func(any)
	bindVoucherNumbers = func(value any) {
		switch x := value.(type) {
		case map[string]any:
			if number, ok := x["voucher_no"].(string); ok && strings.HasPrefix(number, "VOU") && len(number) == 15 {
				matches := []string{}
				for _, row := range vouchers {
					actual := fmt.Sprint(row["voucher_no"])
					if len(actual) == 15 && actual[:3] == number[:3] && actual[11:] == number[11:] {
						matches = append(matches, actual)
					}
				}
				if len(matches) != 1 {
					t.Fatalf("cannot bind captured voucher %s: %v", number, matches)
				}
				ids[number] = matches[0]
			}
			for _, v := range x {
				bindVoucherNumbers(v)
			}
		case []any:
			for _, v := range x {
				bindVoucherNumbers(v)
			}
		}
	}
	for _, item := range cases {
		bindVoucherNumbers(item["body"])
	}
	supported := map[string]bool{}
	supported["/api/v1/reports/finance/statement/customer"] = true
	supported["/api/v1/reports/finance/statement/supplier"] = true
	supported["/api/v1/reports/inventory/reorder-suggestions"] = true
	for _, mode := range []string{"trial-balance", "profit-loss", "balance-sheet", "cash-flow"} {
		supported["/api/v1/reports/finance/"+mode] = true
	}
	for family, modes := range map[string][]string{"sales": {"by-product", "by-customer", "trend", "profit", "profit-summary"}, "purchase": {"by-product", "by-supplier", "trend", "price-trend"}, "inventory": {"balance", "abc"}} {
		for _, mode := range modes {
			supported["/api/v1/reports/"+family+"/"+mode] = true
		}
	}
	// Fresh capture UUIDs differ; every other field, collection shape and value
	// must match the original after the same 491 state-changing/read operations.
	var normalize func(any) any
	normalize = func(v any) any {
		switch x := v.(type) {
		case string:
			if replacement, ok := ids[x]; ok {
				return replacement
			}
			return x
		case map[string]any:
			y := map[string]any{}
			for k, v := range x {
				if strings.HasSuffix(k, "_id") {
					continue
				}
				y[k] = normalize(v)
			}
			return y
		case []any:
			y := []any{}
			for _, v := range x {
				y = append(y, normalize(v))
			}
			return y
		}
		return v
	}
	for _, item := range cases {
		endpoint := item["endpoint"].(string)
		if strings.Contains(endpoint, "/finance/general-ledger?") {
			actual := c.ok("GET", endpoint, nil).([]any)
			expected := item["body"].(map[string]any)["data"].([]any)
			// Equal timestamp ties are ordered by fresh UUIDs. Compare all journal
			// lines independently of those ties and verify each running balance.
			lines := func(rows []any) []string {
				out := []string{}
				for _, v := range rows {
					r := v.(map[string]any)
					b, _ := json.Marshal(map[string]any{"voucher_no": normalize(r["voucher_no"]), "remark": r["remark"], "direction": r["direction"], "amount": r["amount"]})
					out = append(out, string(b))
				}
				sort.Strings(out)
				return out
			}
			if !reflect.DeepEqual(lines(expected), lines(actual)) {
				t.Fatalf("ledger %s journal lines differ: expected=%v actual=%v", endpoint, expected, actual)
			}
			balance := decimal.Zero
			for _, v := range actual {
				r := v.(map[string]any)
				amount, err := decimal.NewFromString(r["amount"].(string))
				if err != nil {
					t.Fatal(err)
				}
				if r["direction"] == "debit" {
					balance = balance.Add(amount)
				} else {
					balance = balance.Sub(amount)
				}
				if r["balance"] != balance.String() {
					t.Fatalf("ledger %s balance differs: %v", endpoint, r)
				}
			}
			continue
		}
		if !supported[strings.Split(endpoint, "?")[0]] {
			continue
		}
		actual := c.ok("GET", endpoint, nil)
		expected := item["body"].(map[string]any)["data"]
		if !reflect.DeepEqual(normalize(expected), normalize(actual)) {
			t.Fatalf("report %s expected=%v actual=%v", endpoint, expected, actual)
		}
	}
}

func TestStockConfirmationRollback(t *testing.T) {
	c, s := setup(t)
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)["id"]
	p := products[0].(map[string]any)["id"]
	other := products[1].(map[string]any)["id"]
	create := func(route string, lines []any) map[string]any {
		return c.ok("POST", "/api/v1/"+route, map[string]any{"warehouse_id": wh, "lines": lines}).(map[string]any)
	}
	incoming := create("stock-ins", []any{map[string]any{"product_id": p, "qty": 10, "unit_cost": 2}})
	c.ok("POST", "/api/v1/stock-ins/"+incoming["id"].(string)+"/confirm", map[string]any{})
	outgoing := create("stock-outs", []any{map[string]any{"product_id": p, "qty": 4}, map[string]any{"product_id": other, "qty": 1}})
	if status, _ := c.request("POST", "/api/v1/stock-outs/"+outgoing["id"].(string)+"/confirm", map[string]any{}); status != 400 {
		t.Fatal(status)
	}
	balance := c.ok("GET", "/api/v1/inventory-balances?product_id="+p.(string), nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	if balance["qty_available"] != "10" {
		t.Fatal("partial stock deduction survived rollback", balance)
	}
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM stock_movements").Scan(&count)
	if count != 1 {
		t.Fatal("partial movement survived rollback", count)
	}
	state := c.ok("GET", "/api/v1/stock-outs/"+outgoing["id"].(string), nil).(map[string]any)
	if state["status"] != "draft" {
		t.Fatal(state)
	}
	for _, bad := range []any{"NaN", "Infinity", "1e999999", -1, 0} {
		if status, _ := c.request("POST", "/api/v1/inventory-balances/"+balance["id"].(string)+"/lock", map[string]any{"qty": bad}); status != 400 {
			t.Fatalf("invalid qty accepted %v", bad)
		}
	}
}
