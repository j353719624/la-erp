package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// 本文件固化批次 B 取证（2026-10-14）的结论：发票币种/来源、收付款单明细与合计、
// 库存调整类型与成本型数量 —— 五处原版均接受且行为可复现，恢复端原先一律拒绝。
// 证据见 evidence/backend-runtime/audit-batch-b{,-b2}-20261014.json。

func batchBDate() string { return time.Now().UTC().Format(time.RFC3339Nano) }

type batchBEnv struct {
	client    *client
	server    *Server
	customer  map[string]any
	supplier  map[string]any
	cash      map[string]any
	product   map[string]any
	warehouse map[string]any
}

func batchBSetup(t *testing.T) batchBEnv {
	t.Helper()
	c, s := setup(t)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "BB-C", "name": "BB-客户"}).(map[string]any)
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"code": "BB-S", "name": "BB-供应商"}).(map[string]any)
	accounts, err := s.Store.Rows(context.Background(), "SELECT * FROM accounts WHERE code='1001'")
	if err != nil || len(accounts) != 1 {
		t.Fatal(err)
	}
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "BB-P", "name": "BB-商品"}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	return batchBEnv{c, s, customer, supplier, accounts[0], product, warehouse}
}

func (e batchBEnv) receipt(amount int, lines []any) map[string]any {
	body := map[string]any{
		"customer_id": e.customer["id"], "receipt_date": batchBDate(), "amount": amount, "receipt_type": "normal",
		"cash_account_id": e.cash["id"], "cash_account_code": e.cash["code"], "cash_account_name": e.cash["name"],
	}
	if lines != nil {
		body["lines"] = lines
	}
	return e.client.ok("POST", "/api/v1/payment-receipts", body).(map[string]any)
}

// BB1：发票接受非 CNY 币种与非 1 汇率（汇率本身无列，实际折算点在核销）。
func TestSourceInvoiceAcceptsForeignCurrencyAndRate(t *testing.T) {
	e := batchBSetup(t)
	invoice := e.client.ok("POST", "/api/v1/ar-invoices", map[string]any{
		"customer_id": e.customer["id"], "invoice_date": batchBDate(), "total_amount": 100,
		"currency_code": "USD", "exchange_rate": 7.2,
	}).(map[string]any)
	if invoice["total_amount"] != "100" {
		t.Fatalf("invoice amount changed: %#v", invoice)
	}
	payment := e.receipt(10, []any{map[string]any{"ar_invoice_id": invoice["id"], "amount": 10}})
	e.client.ok("POST", "/api/v1/payment-receipts/"+payment["id"].(string)+"/confirm", nil)
	got := e.client.ok("GET", "/api/v1/ar-invoices/"+invoice["id"].(string), nil).(map[string]any)
	// 收款单本身是 CNY，故按 10 元核销，不折算。
	if got["received_amount"] != "10" || got["balance"] != "90" {
		t.Fatalf("CNY receipt applied a rate to a CNY invoice: %#v", got)
	}
}

// BB2：发票的 source_type/source_id/source_no 落库，并可按 source_type 过滤。
func TestSourceInvoicePersistsSourceFields(t *testing.T) {
	e := batchBSetup(t)
	order := e.client.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": e.customer["id"], "warehouse_id": e.warehouse["id"],
		"lines": []any{map[string]any{"product_id": e.product["id"], "qty": 1, "price": 50}},
	}).(map[string]any)
	invoice := e.client.ok("POST", "/api/v1/ar-invoices", map[string]any{
		"customer_id": e.customer["id"], "invoice_date": batchBDate(), "total_amount": 50,
		"source_type": "sales_order", "source_id": order["id"], "source_no": order["order_no"],
	}).(map[string]any)
	if invoice["source_type"] != "sales_order" || invoice["source_id"] != order["id"] || invoice["source_no"] != order["order_no"] {
		t.Fatalf("invoice source fields dropped: %#v", invoice)
	}
	filtered := e.client.ok("GET", "/api/v1/ar-invoices?source_type=sales_order", nil)
	if !strings.Contains(trimJSON(filtered), order["id"].(string)) {
		t.Fatalf("source_type filter did not match the invoice: %v", filtered)
	}
}

// BB3：收付款单允许空明细数组，落库为无明细并可确认。
func TestSourcePaymentAcceptsEmptyLines(t *testing.T) {
	e := batchBSetup(t)
	payment := e.receipt(10, []any{})
	if payment["status"] != "draft" {
		t.Fatalf("empty-lines payment status: %v", payment["status"])
	}
	confirmed := e.client.ok("POST", "/api/v1/payment-receipts/"+payment["id"].(string)+"/confirm", nil).(map[string]any)
	if confirmed["status"] != "confirmed" {
		t.Fatalf("empty-lines payment confirm: %v", confirmed["status"])
	}
}

// BB3b：lines 不是数组仍拒绝。
func TestSourcePaymentRejectsNonArrayLines(t *testing.T) {
	e := batchBSetup(t)
	if _, body := e.client.request("POST", "/api/v1/payment-receipts", map[string]any{
		"customer_id": e.customer["id"], "receipt_date": batchBDate(), "amount": 10, "receipt_type": "normal",
		"cash_account_id": e.cash["id"], "cash_account_code": e.cash["code"], "cash_account_name": e.cash["name"],
		"lines": "not-an-array",
	}); body["code"] == float64(0) {
		t.Fatal("non-array lines accepted")
	}
}

// BB4：明细合计与表头 amount 不一致时按明细核销，表头 amount 原样落库。
func TestSourcePaymentAllocatesByLineAmountNotHeader(t *testing.T) {
	e := batchBSetup(t)
	invoice := e.client.ok("POST", "/api/v1/ar-invoices", map[string]any{
		"customer_id": e.customer["id"], "invoice_date": batchBDate(), "total_amount": 100,
	}).(map[string]any)
	payment := e.receipt(10, []any{map[string]any{"ar_invoice_id": invoice["id"], "amount": 5}})
	if payment["amount"] != "10" {
		t.Fatalf("header amount not kept as sent: %v", payment["amount"])
	}
	e.client.ok("POST", "/api/v1/payment-receipts/"+payment["id"].(string)+"/confirm", nil)
	got := e.client.ok("GET", "/api/v1/ar-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if got["received_amount"] != "5" || got["balance"] != "95" {
		t.Fatalf("allocation used header instead of line amount: %#v", got)
	}
}

// BB5：adjust_type 不校验白名单，"garbage" 落库并可确认。
func TestSourceAdjustmentAcceptsAnyAdjustType(t *testing.T) {
	e := batchBSetup(t)
	adjust := e.client.ok("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": e.warehouse["id"], "adjust_type": "garbage",
		"lines": []any{map[string]any{"product_id": e.product["id"], "qty": 1}},
	}).(map[string]any)
	if adjust["adjust_type"] != "garbage" {
		t.Fatalf("adjust_type not persisted: %v", adjust["adjust_type"])
	}
	confirmed := e.client.ok("POST", "/api/v1/inventory-adjusts/"+adjust["id"].(string)+"/confirm", nil).(map[string]any)
	if confirmed["status"] != "confirmed" {
		t.Fatalf("unknown adjust_type blocked confirmation: %v", confirmed["status"])
	}
}

// BB5b：不传 adjust_type 时落库为空串并可确认。
func TestSourceAdjustmentAcceptsMissingAdjustType(t *testing.T) {
	e := batchBSetup(t)
	adjust := e.client.ok("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": e.warehouse["id"],
		"lines":        []any{map[string]any{"product_id": e.product["id"], "qty": 1}},
	}).(map[string]any)
	if got := adjust["adjust_type"]; got != "" && got != nil {
		t.Fatalf("missing adjust_type should stay empty: %#v", got)
	}
	e.client.ok("POST", "/api/v1/inventory-adjusts/"+adjust["id"].(string)+"/confirm", nil)
}

// BB5c：cost 型传入 qty 时数量被强制归零（total_qty=0），确认后只改加权平均成本。
func TestSourceCostAdjustmentZeroesQuantity(t *testing.T) {
	e := batchBSetup(t)
	seed := e.client.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": e.warehouse["id"], "lines": []any{
		map[string]any{"product_id": e.product["id"], "qty": 10, "unit_cost": 20},
	}}).(map[string]any)
	e.client.ok("POST", "/api/v1/stock-ins/"+seed["id"].(string)+"/confirm", nil)
	var before, after string
	if err := e.server.Store.DB.QueryRow("SELECT qty_available FROM inventory_balances WHERE product_id=? AND warehouse_id=?",
		e.product["id"], e.warehouse["id"]).Scan(&before); err != nil {
		t.Fatal(err)
	}
	adjust := e.client.ok("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": e.warehouse["id"], "adjust_type": "cost",
		"lines": []any{map[string]any{"product_id": e.product["id"], "qty": 3, "unit_cost": 88}},
	}).(map[string]any)
	if adjust["total_qty"] != "0" {
		t.Fatalf("cost adjustment kept a quantity: %v", adjust["total_qty"])
	}
	e.client.ok("POST", "/api/v1/inventory-adjusts/"+adjust["id"].(string)+"/confirm", nil)
	var avg string
	if err := e.server.Store.DB.QueryRow("SELECT qty_available, avg_cost FROM inventory_balances WHERE product_id=? AND warehouse_id=?",
		e.product["id"], e.warehouse["id"]).Scan(&after, &avg); err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("cost adjustment moved stock: %s -> %s", before, after)
	}
	if avg != "88" {
		t.Fatalf("cost adjustment did not update weighted average: %s", avg)
	}
}

func trimJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
