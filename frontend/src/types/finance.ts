// Reconstructed type declarations; original type-only files were erased by compilation.
// Assignments derived from frontend usage. Do not edit by hand.
import type { Customer, PurchaseOrder, PurchaseReturn } from '@/types/order';

export interface APInvoice {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "invoice_no"?: string;
  "supplier_id"?: string;
  "supplier_name"?: string;
  "invoice_date"?: string;
  "total_amount"?: number;
  "paid_amount"?: number;
  "balance"?: number;
  "source_type"?: string;
  "source_id"?: string;
  "source_no"?: string;
  "status"?: string;
  "due_date"?: string;
  "purchase_invoice_no"?: string;
  "invoice_status"?: string;
  "tax_rate"?: number;
  "tax_amount"?: number;
  "invoiced_at"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "department_id"?: string;
  "edges"?: { "supplier"?: { "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "code"?: string; "status"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "category_id"?: string; "name"?: string; "contact"?: string; "phone"?: string; "email"?: string; "address"?: string; "tax_no"?: string; "bank_account"?: string; "payment_term"?: number; "rating"?: string; "department_id"?: string; "edges"?: { "category"?: string; "purchase_orders"?: (PurchaseOrder)[]; "purchase_returns"?: (PurchaseReturn)[]; "ap_invoices"?: (APInvoice)[]; "payment_payments"?: (PaymentPayment)[] } }; "payment_lines"?: (PaymentPaymentLine)[] };
}

export interface ARInvoice {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "invoice_no"?: string;
  "customer_id"?: string;
  "customer_name"?: string;
  "invoice_date"?: string;
  "total_amount"?: number;
  "received_amount"?: number;
  "balance"?: number;
  "source_type"?: string;
  "source_id"?: string;
  "source_no"?: string;
  "status"?: string;
  "due_date"?: string;
  "sales_invoice_no"?: string;
  "invoice_status"?: string;
  "tax_rate"?: number;
  "tax_amount"?: number;
  "invoiced_at"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "department_id"?: string;
  "edges"?: { "customer"?: Customer; "receipt_lines"?: (PaymentReceiptLine)[] };
}

export interface Account {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "code"?: string;
  "name"?: string;
  "category"?: string;
  "sub_category"?: string;
  "is_leaf"?: boolean;
  "parent_id"?: string;
  "currency"?: string;
  "is_enabled"?: boolean;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "edges"?: { "parent"?: Account; "children"?: (Account)[]; "entries"?: ({ "id"?: string; "deleted_at"?: string; "sequence"?: number; "account_code"?: string; "account_name"?: string; "direction"?: string; "amount"?: string; "remark"?: string; "customer_id"?: string; "supplier_id"?: string; "product_id"?: string; "ext"?: Record<string, unknown>; "edges"?: string })[]; "templates"?: ({ "id"?: string; "code"?: string; "name"?: string; "source_type"?: string; "is_active"?: boolean; "entries"?: (Record<string, unknown>)[]; "remark"?: string; "tenant_id"?: string })[]; "balances"?: ({ "id"?: string; "account_id"?: string; "period"?: string; "begin_balance"?: string; "debit_amount"?: string; "credit_amount"?: string; "end_balance"?: string; "tenant_id"?: string; "edges"?: string })[]; "journal_entries"?: ({ "id"?: string; "entry_date"?: string; "account_code"?: string; "account_name"?: string; "direction"?: string; "amount"?: string; "voucher_no"?: string; "source_id"?: string; "source_type"?: string; "remark"?: string; "created_at"?: string; "tenant_id"?: string; "edges"?: string })[] };
  "[name]"?: string;
}

export interface PaymentPayment {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "payment_no"?: string;
  "supplier_id"?: string;
  "supplier_name"?: string;
  "payment_date"?: string;
  "amount"?: number;
  "payment_type"?: string;
  "currency_code"?: string;
  "exchange_rate"?: number | string;
  "cash_account_id"?: string;
  "cash_account_code"?: string;
  "cash_account_name"?: string;
  "status"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "edges"?: { "supplier"?: { "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "code"?: string; "status"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "category_id"?: string; "name"?: string; "contact"?: string; "phone"?: string; "email"?: string; "address"?: string; "tax_no"?: string; "bank_account"?: string; "payment_term"?: number; "rating"?: string; "department_id"?: string; "edges"?: { "category"?: string; "purchase_orders"?: (PurchaseOrder)[]; "purchase_returns"?: (PurchaseReturn)[]; "ap_invoices"?: (APInvoice)[]; "payment_payments"?: (PaymentPayment)[] } }; "lines"?: PaymentPaymentLine[] };
  "lines"?: PaymentPaymentLine[];
}

export interface PaymentPaymentLine {
  "id"?: string;
  "line_no"?: number;
  "ap_invoice_id"?: string;
  "ap_invoice_no"?: string;
  "amount"?: number;
  "remark"?: string;
  "edges"?: { "payment"?: PaymentPayment; "ap_invoice"?: APInvoice };
}

export interface PaymentReceipt {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "receipt_no"?: string;
  "customer_id"?: string;
  "customer_name"?: string;
  "receipt_date"?: string;
  "amount"?: number;
  "receipt_type"?: string;
  "currency_code"?: string;
  "exchange_rate"?: number | string;
  "cash_account_id"?: string;
  "cash_account_code"?: string;
  "cash_account_name"?: string;
  "status"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "edges"?: { "customer"?: Customer; "lines"?: PaymentReceiptLine[] };
  "lines"?: PaymentReceiptLine[];
}

export interface PaymentReceiptLine {
  "id"?: string;
  "line_no"?: number;
  "ar_invoice_id"?: string;
  "ar_invoice_no"?: string;
  "amount"?: number;
  "remark"?: string;
  "edges"?: { "receipt"?: PaymentReceipt; "ar_invoice"?: ARInvoice };
}

export interface Voucher {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "voucher_no"?: string;
  "type"?: string;
  "voucher_date"?: string;
  "status"?: string;
  "remark"?: string;
  "operator_id"?: string;
  "operator_name"?: string;
  "approved_by"?: string;
  "approved_at"?: string;
  "source_id"?: string;
  "source_type"?: string;
  "source_no"?: string;
  "total_debit"?: number;
  "total_credit"?: number;
  "currency_code"?: string;
  "exchange_rate"?: number | string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "edges"?: { "entries"?: VoucherEntry[]; "journal_entries"?: ({ "id"?: string; "entry_date"?: string; "account_code"?: string; "account_name"?: string; "direction"?: string; "amount"?: string; "voucher_no"?: string; "source_id"?: string; "source_type"?: string; "remark"?: string; "created_at"?: string; "tenant_id"?: string; "edges"?: string })[] };
  "entries"?: VoucherEntry[];
  "lines"?: VoucherEntry[];
}

export interface VoucherEntry {
  "sequence"?: number;
  "account_id"?: string;
  "account_code"?: string;
  "account_name"?: string;
  "direction"?: string;
  "amount"?: number;
  "remark"?: string;
  "customer_id"?: string;
  "supplier_id"?: string;
  "product_id"?: string;
  "id": string;
}
