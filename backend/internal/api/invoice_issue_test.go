package api

import (
	"testing"
	"time"
)

func TestInvoiceIssueStoresTaxAndInvoiceNumber(t *testing.T) {
	c, _ := setup(t)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "开票验证客户"}).(map[string]any)
	invoice := c.ok("POST", "/api/v1/ar-invoices", map[string]any{"customer_id": customer["id"], "invoice_date": time.Now().UTC().Format(time.RFC3339Nano), "total_amount": 100}).(map[string]any)
	id := invoice["id"].(string)
	got := c.ok("POST", "/api/v1/ar-invoices/"+id+"/issue", map[string]any{"sales_invoice_no": "INV-AR-001", "tax_rate": 13, "tax_amount": 13}).(map[string]any)
	if got["invoice_status"] != "invoiced" || got["sales_invoice_no"] != "INV-AR-001" || got["tax_rate"] != "13" || got["tax_amount"] != "13" {
		t.Fatalf("unexpected issued invoice: %#v", got)
	}
}

func TestPayableInvoiceIssueStoresPurchaseNumber(t *testing.T) {
	c, _ := setup(t)
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"name": "开票验证供应商"}).(map[string]any)
	invoice := c.ok("POST", "/api/v1/ap-invoices", map[string]any{"supplier_id": supplier["id"], "invoice_date": time.Now().UTC().Format(time.RFC3339Nano), "total_amount": 50}).(map[string]any)
	got := c.ok("POST", "/api/v1/ap-invoices/"+invoice["id"].(string)+"/issue", map[string]any{"purchase_invoice_no": "INV-AP-001", "tax_rate": 6, "tax_amount": 3}).(map[string]any)
	if got["invoice_status"] != "invoiced" || got["purchase_invoice_no"] != "INV-AP-001" || got["tax_rate"] != "6" || got["tax_amount"] != "3" {
		t.Fatalf("unexpected payable invoice: %#v", got)
	}
}
