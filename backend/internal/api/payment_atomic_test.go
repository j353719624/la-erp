package api

import (
	"context"
	"la-erp-recovered/backend/internal/business"
	"sync"
	"testing"
	"time"
)

func paymentFixture(t *testing.T) (*client, *Server, map[string]any, func(int) map[string]any) {
	t.Helper()
	c, s := setup(t)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "核销事务验证"}).(map[string]any)
	accounts, err := s.Store.Rows(context.Background(), "SELECT * FROM accounts WHERE code='1001'")
	if err != nil || len(accounts) != 1 {
		t.Fatal(err)
	}
	cash := accounts[0]
	date := time.Now().UTC().Format(time.RFC3339Nano)
	invoice := c.ok("POST", "/api/v1/ar-invoices", map[string]any{"customer_id": customer["id"], "invoice_date": date, "total_amount": 100}).(map[string]any)
	create := func(amount int) map[string]any {
		return c.ok("POST", "/api/v1/payment-receipts", map[string]any{"customer_id": customer["id"], "receipt_date": date, "amount": amount, "receipt_type": "normal", "currency_code": "CNY", "cash_account_id": cash["id"], "cash_account_code": cash["code"], "cash_account_name": cash["name"], "lines": []any{map[string]any{"ar_invoice_id": invoice["id"], "amount": amount}}}).(map[string]any)
	}
	return c, s, invoice, create
}
func TestConcurrentPaymentDoesNotOverAllocate(t *testing.T) {
	c, s, invoice, create := paymentFixture(t)
	a, b := create(60), create(60)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, h := range []map[string]any{a, b} {
		wg.Add(1)
		go func(h map[string]any) {
			defer wg.Done()
			_, err := s.business().PaymentTransition(context.Background(), business.Finances["payment-receipts"], h["id"].(string), false)
			results <- err
		}(h)
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("confirmed %d payments", success)
	}
	got := c.ok("GET", "/api/v1/ar-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if got["received_amount"] != "60" || got["balance"] != "40" {
		t.Fatal(got)
	}
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM journal_entries WHERE source_type='payment_receipt'").Scan(&count)
	if count != 2 {
		t.Fatal(count)
	}
}

func TestInvoiceRejectsUnsupportedCurrencyInsteadOfDroppingIt(t *testing.T) {
	c, _ := setup(t)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "币种边界客户"}).(map[string]any)
	status, body := c.request("POST", "/api/v1/ar-invoices", map[string]any{"customer_id": customer["id"], "invoice_date": time.Now().UTC().Format(time.RFC3339Nano), "total_amount": 10, "currency_code": "USD", "exchange_rate": 7.2})
	if status == 200 || body["code"] == float64(0) {
		t.Fatalf("unsupported currency was silently accepted: %d %#v", status, body)
	}
}

func TestPaymentPreservesForeignCurrencyAndRate(t *testing.T) {
	c, _, invoice, _ := paymentFixture(t)
	accounts := c.ok("GET", "/api/v1/accounts?code=1001", nil).(map[string]any)["list"].([]any)
	status, body := c.request("POST", "/api/v1/payment-receipts", map[string]any{"customer_id": invoice["customer_id"], "receipt_date": time.Now().UTC().Format(time.RFC3339Nano), "amount": 10, "receipt_type": "normal", "currency_code": "USD", "exchange_rate": 7.2, "cash_account_id": accounts[0].(map[string]any)["id"], "cash_account_code": accounts[0].(map[string]any)["code"], "lines": []any{map[string]any{"ar_invoice_id": invoice["id"], "amount": 10}}})
	if status != 200 || body["code"] != float64(0) {
		t.Fatalf("foreign currency payment was not preserved: %d %#v", status, body)
	}
	payment := body["data"].(map[string]any)
	c.ok("POST", "/api/v1/payment-receipts/"+payment["id"].(string)+"/confirm", nil)
	updated := c.ok("GET", "/api/v1/ar-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if updated["received_amount"] != "72" || updated["balance"] != "28" {
		t.Fatalf("foreign amount was not converted at confirmation: %#v", updated)
	}
}

func TestForeignReceiptCancelRestoresBaseCurrencyBalance(t *testing.T) {
	c, s, invoice, _ := paymentFixture(t)
	accounts := c.ok("GET", "/api/v1/accounts?code=1001", nil).(map[string]any)["list"].([]any)
	payment := c.ok("POST", "/api/v1/payment-receipts", map[string]any{"customer_id": invoice["customer_id"], "receipt_date": time.Now().UTC().Format(time.RFC3339Nano), "amount": 10, "receipt_type": "银行转账", "currency_code": "EUR", "exchange_rate": 7.872, "cash_account_id": accounts[0].(map[string]any)["id"], "cash_account_code": accounts[0].(map[string]any)["code"], "lines": []any{map[string]any{"ar_invoice_id": invoice["id"], "amount": 10}}}).(map[string]any)
	c.ok("POST", "/api/v1/payment-receipts/"+payment["id"].(string)+"/confirm", nil)
	c.ok("POST", "/api/v1/payment-receipts/"+payment["id"].(string)+"/cancel", nil)
	got := c.ok("GET", "/api/v1/ar-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if got["received_amount"] != "0" || got["balance"] != "100" {
		t.Fatalf("foreign cancel did not restore balance: %#v", got)
	}
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM journal_entries WHERE source_type IN ('payment_receipt','payment_receipt_cancel')").Scan(&count)
	if count != 4 {
		t.Fatalf("expected confirm and cancel journal rows, got %d", count)
	}
}

func TestForeignPaymentCancelRestoresBaseCurrencyBalance(t *testing.T) {
	c, s := setup(t)
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"name": "外币付款测试供应商"}).(map[string]any)
	accounts := c.ok("GET", "/api/v1/accounts?code=1001", nil).(map[string]any)["list"].([]any)
	date := time.Now().UTC().Format(time.RFC3339Nano)
	invoice := c.ok("POST", "/api/v1/ap-invoices", map[string]any{"supplier_id": supplier["id"], "invoice_date": date, "total_amount": 100}).(map[string]any)
	currency := c.ok("POST", "/api/v1/currencies", map[string]any{"code": "RFX", "name": "Rate snapshot", "exchange_rate": 9}).(map[string]any)
	payment := c.ok("POST", "/api/v1/payments", map[string]any{"supplier_id": supplier["id"], "payment_date": date, "amount": 10, "payment_type": "银行转账", "currency_code": "RFX", "exchange_rate": 7.872, "cash_account_id": accounts[0].(map[string]any)["id"], "cash_account_code": accounts[0].(map[string]any)["code"], "lines": []any{map[string]any{"ap_invoice_id": invoice["id"], "amount": 10}}}).(map[string]any)
	c.ok("POST", "/api/v1/payments/"+payment["id"].(string)+"/confirm", nil)
	c.ok("PUT", "/api/v1/currencies/"+currency["id"].(string), map[string]any{"exchange_rate": 12})
	updated := c.ok("GET", "/api/v1/ap-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if updated["paid_amount"] != "78.72" || updated["balance"] != "21.28" {
		t.Fatalf("foreign payment did not convert: %#v", updated)
	}
	c.ok("POST", "/api/v1/payments/"+payment["id"].(string)+"/cancel", nil)
	updated = c.ok("GET", "/api/v1/ap-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if updated["paid_amount"] != "0" || updated["balance"] != "100" {
		t.Fatalf("foreign payment cancel did not restore: %#v", updated)
	}
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM journal_entries WHERE source_type IN ('payment_payment','payment_payment_cancel')").Scan(&count)
	if count != 4 {
		t.Fatalf("expected payment confirm and cancel journal rows, got %d", count)
	}
}

func TestPaymentRejectsUnsupportedExchangeRateInsteadOfDroppingIt(t *testing.T) {
	c, _, invoice, _ := paymentFixture(t)
	accounts := c.ok("GET", "/api/v1/accounts?code=1001", nil).(map[string]any)["list"].([]any)
	status, body := c.request("POST", "/api/v1/payment-receipts", map[string]any{"customer_id": invoice["customer_id"], "receipt_date": time.Now().UTC().Format(time.RFC3339Nano), "amount": 10, "receipt_type": "normal", "currency_code": "CNY", "exchange_rate": 7.2, "cash_account_id": accounts[0].(map[string]any)["id"], "cash_account_code": accounts[0].(map[string]any)["code"], "lines": []any{map[string]any{"ar_invoice_id": invoice["id"], "amount": 10}}})
	if status == 200 || body["code"] == float64(0) {
		t.Fatalf("unsupported exchange rate unexpectedly succeeded: %d %#v", status, body)
	}
}

func TestFailedFinancialPostingRollsBackAllocation(t *testing.T) {
	c, s, invoice, create := paymentFixture(t)
	pay := create(40)
	if _, err := s.Store.DB.Exec("UPDATE accounts SET code='missing-1122' WHERE code='1122'"); err != nil {
		t.Fatal(err)
	}
	_, err := s.business().PaymentTransition(context.Background(), business.Finances["payment-receipts"], pay["id"].(string), false)
	if err == nil {
		t.Fatal("missing posting account accepted")
	}
	got := c.ok("GET", "/api/v1/ar-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if got["received_amount"] != "0" || got["balance"] != "100" {
		t.Fatal("allocation survived rollback", got)
	}
	state := c.ok("GET", "/api/v1/payment-receipts/"+pay["id"].(string), nil).(map[string]any)
	if state["status"] != "draft" {
		t.Fatal(state)
	}
	for _, table := range []string{"journal_entries", "vouchers"} {
		var count int
		s.Store.DB.QueryRow("SELECT count(*) FROM " + table + " WHERE source_type='payment_receipt'").Scan(&count)
		if count != 0 {
			t.Fatal("partial posting survived", table, count)
		}
	}
}

func TestPaymentCancellationReversesAllocationAndPosting(t *testing.T) {
	c, _, invoice, create := paymentFixture(t)
	pay := create(40)
	c.ok("POST", "/api/v1/payment-receipts/"+pay["id"].(string)+"/confirm", nil)
	got := c.ok("GET", "/api/v1/ar-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if got["received_amount"] != "40" || got["balance"] != "60" {
		t.Fatal("confirmation did not allocate invoice", got)
	}
	c.ok("POST", "/api/v1/payment-receipts/"+pay["id"].(string)+"/cancel", nil)
	got = c.ok("GET", "/api/v1/ar-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if got["received_amount"] != "0" || got["balance"] != "100" || got["status"] != "unpaid" {
		t.Fatal("cancellation did not reverse allocation", got)
	}
}

func TestPaymentDetailReturnsAllocationEdges(t *testing.T) {
	c, _, invoice, create := paymentFixture(t)
	pay := create(25)
	detail := c.ok("GET", "/api/v1/payment-receipts/"+pay["id"].(string), nil).(map[string]any)
	edges := detail["edges"].(map[string]any)
	lines := edges["lines"].([]any)
	if len(lines) != 1 || lines[0].(map[string]any)["ar_invoice_id"] != invoice["id"] {
		t.Fatalf("missing payment allocation edges: %#v", detail)
	}
}

func TestPaymentReceiptAllocatesMultipleInvoices(t *testing.T) {
	c, s := setup(t)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "多发票核销验证"}).(map[string]any)
	accounts, err := s.Store.Rows(context.Background(), "SELECT * FROM accounts WHERE code='1001'")
	if err != nil || len(accounts) != 1 {
		t.Fatal(err)
	}
	date := time.Now().UTC().Format(time.RFC3339Nano)
	a := c.ok("POST", "/api/v1/ar-invoices", map[string]any{"customer_id": customer["id"], "invoice_date": date, "total_amount": 70}).(map[string]any)
	b := c.ok("POST", "/api/v1/ar-invoices", map[string]any{"customer_id": customer["id"], "invoice_date": date, "total_amount": 30}).(map[string]any)
	pay := c.ok("POST", "/api/v1/payment-receipts", map[string]any{"customer_id": customer["id"], "receipt_date": date, "amount": 100, "receipt_type": "normal", "currency_code": "CNY", "cash_account_id": accounts[0]["id"], "cash_account_code": accounts[0]["code"], "lines": []any{map[string]any{"ar_invoice_id": a["id"], "amount": 70}, map[string]any{"ar_invoice_id": b["id"], "amount": 30}}}).(map[string]any)
	c.ok("POST", "/api/v1/payment-receipts/"+pay["id"].(string)+"/confirm", nil)
	for _, id := range []string{a["id"].(string), b["id"].(string)} {
		got := c.ok("GET", "/api/v1/ar-invoices/"+id, nil).(map[string]any)
		if got["status"] != "paid" || got["balance"] != "0" {
			t.Fatalf("invoice not fully allocated: %#v", got)
		}
	}
}

func TestPaymentReceiptRejectsDuplicateInvoiceOverAllocation(t *testing.T) {
	c, s, invoice, _ := paymentFixture(t)
	accounts, _ := s.Store.Rows(context.Background(), "SELECT * FROM accounts WHERE code='1001'")
	date := time.Now().UTC().Format(time.RFC3339Nano)
	pay := c.ok("POST", "/api/v1/payment-receipts", map[string]any{"customer_id": invoice["customer_id"], "receipt_date": date, "amount": 120, "receipt_type": "normal", "currency_code": "CNY", "cash_account_id": accounts[0]["id"], "cash_account_code": accounts[0]["code"], "lines": []any{map[string]any{"ar_invoice_id": invoice["id"], "amount": 60}, map[string]any{"ar_invoice_id": invoice["id"], "amount": 60}}}).(map[string]any)
	_, body := c.request("POST", "/api/v1/payment-receipts/"+pay["id"].(string)+"/confirm", nil)
	if body["code"] == nil || body["code"].(float64) == 0 {
		t.Fatalf("over-allocation accepted: %#v", body)
	}
}

func TestOriginalMissingCashCodeChangesBalanceWithoutVoucher(t *testing.T) {
	c, s := setup(t)
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"name": "Missing code supplier"}).(map[string]any)
	accounts := c.ok("GET", "/api/v1/accounts?code=1001", nil).(map[string]any)["list"].([]any)
	date := time.Now().UTC().Format(time.RFC3339Nano)
	invoice := c.ok("POST", "/api/v1/ap-invoices", map[string]any{"supplier_id": supplier["id"], "invoice_date": date, "total_amount": 100}).(map[string]any)
	p := c.ok("POST", "/api/v1/payments", map[string]any{"supplier_id": supplier["id"], "payment_date": date, "amount": 10, "payment_type": "银行转账", "currency_code": "EUR", "exchange_rate": 7.872, "cash_account_id": accounts[0].(map[string]any)["id"], "lines": []any{map[string]any{"ap_invoice_id": invoice["id"], "amount": 10}}}).(map[string]any)
	pp := "/api/v1/payments/" + p["id"].(string)
	c.ok("POST", pp+"/confirm", nil)
	partial := c.ok("GET", "/api/v1/ap-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if partial["balance"] != "21.28" {
		t.Fatal(partial)
	}
	c.ok("POST", pp+"/cancel", nil)
	var n int
	s.Store.DB.QueryRow("SELECT count(*) FROM vouchers WHERE source_id=?", p["id"]).Scan(&n)
	if n != 0 {
		t.Fatal("original missing code produced vouchers", n)
	}
	final := c.ok("GET", "/api/v1/ap-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if final["balance"] != "100" {
		t.Fatal(final)
	}
}
