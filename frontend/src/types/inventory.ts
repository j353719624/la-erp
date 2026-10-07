// Reconstructed type declarations; original type-only files were erased by compilation.
// Schema evidence: evidence/go-structs.json.gz; assignments refined from frontend usage.
import type { Product, Warehouse } from '@/types/product';

export interface InventoryBalance {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "product_id"?: string;
  "warehouse_id"?: string;
  "location_id"?: string;
  "rack_id"?: string;
  "batch_no"?: string;
  "production_date"?: string;
  "expiry_date"?: string;
  "qty_available"?: number;
  "qty_locked"?: number;
  "qty_in_transit"?: number;
  "avg_cost"?: number;
  "last_in_at"?: string;
  "last_out_at"?: string;
  "tenant_id"?: string;
  "department_id"?: string;
  "edges"?: { "product"?: Product; "warehouse"?: Warehouse };
  "product_code"?: string;
  "product_name"?: string;
  "warehouse_name"?: string;
  "location_name"?: string;
  "rack_name"?: string;
}

export interface InventoryCheck {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "check_no"?: string;
  "warehouse_id"?: string;
  "location_id"?: string;
  "status"?: string;
  "check_date"?: string;
  "completed_at"?: string;
  "total_items"?: number;
  "profit_items"?: number;
  "loss_items"?: number;
  "profit_amount"?: number;
  "loss_amount"?: number;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "edges"?: { "lines"?: InventoryCheckLine[]; "warehouse"?: Warehouse };
  "warehouse_name"?: string;
  "lines"?: InventoryCheckLine[];
}

export interface InventoryCheckLine {
  "id"?: string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "check_id"?: string;
  "line_no"?: number;
  "product_id": string;
  "unit_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "batch_no"?: string;
  "book_qty"?: number;
  "actual_qty"?: number;
  "diff_qty"?: number;
  "diff_type"?: string;
  "unit_cost"?: number;
  "diff_amount"?: number;
  "remark"?: string;
  "tenant_id"?: string;
  "edges"?: { "check"?: InventoryCheck; "product"?: Product };
  "spec"?: string;
  "unit_name"?: string;
  "ext_fields"?: Record<string, unknown>;
}

export interface LoanOrder {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "loan_no"?: string;
  "loan_type"?: string;
  "party_name"?: string;
  "warehouse_id"?: string;
  "location_id"?: string;
  "rack_id"?: string;
  "status"?: string;
  "loan_date"?: string;
  "expected_return_date"?: string;
  "total_qty"?: number;
  "total_amount"?: number;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "edges"?: { "lines"?: LoanOrderLine[]; "warehouse"?: Warehouse };
  "lines"?: LoanOrderLine[];
  "warehouse_name"?: string;
}

export interface LoanOrderLine {

}

export interface Location {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "code"?: string;
  "status"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "warehouse_id"?: string;
  "name"?: string;
  "area"?: number;
  "edges"?: { "warehouse"?: Warehouse; "racks"?: (Rack)[] };
  "pathname"?: string;
  "href"?: string;
  "origin"?: string;
  "key"?: string;
  "reload"?: string;
}

export interface Rack {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "code"?: string;
  "status"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "location_id"?: string;
  "name"?: string;
  "rows"?: number;
  "cols"?: number;
  "capacity"?: number;
  "edges"?: { "location"?: Location };
}

export interface StockAdjust {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "adjust_no"?: string;
  "warehouse_id"?: string;
  "location_id"?: string;
  "rack_id"?: string;
  "adjust_type"?: string;
  "adjust_date"?: string;
  "status"?: string;
  "total_qty"?: number;
  "remark"?: string;
  "confirmed_at"?: string;
  "confirmed_by"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "edges"?: { "lines"?: StockAdjustLine[] };
  "lines"?: StockAdjustLine[];
  "[key]"?: string;
}

export interface StockAdjustLine {
  "id"?: string;
  "product_id": string;
  "product_name"?: string;
  "product_code"?: string;
  "qty"?: number;
  "unit_cost"?: number;
  "spec"?: string;
  "batch_no"?: string;
  "remark"?: string;
  "ext_fields"?: Record<string, unknown>;
}

export interface StockIn {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "stock_in_no"?: string;
  "type"?: string;
  "warehouse_id"?: string;
  "location_id"?: string;
  "rack_id"?: string;
  "status"?: string;
  "stock_in_date"?: string;
  "confirmed_at"?: string;
  "confirmed_by"?: string;
  "total_qty"?: number;
  "total_amount"?: number;
  "source_no"?: string;
  "source_id"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "edges"?: { "lines"?: StockInLine[]; "photos"?: StockInPhoto[]; "warehouse"?: Warehouse };
  "warehouse_name"?: string;
  "lines"?: StockInLine[];
  "source_type"?: string;
  "photos"?: StockInPhoto[];
}

export interface StockInLine {
  "id"?: string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "transfer_id"?: string;
  "line_no"?: number;
  "product_id": string;
  "unit_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "spec"?: string;
  "unit_name"?: string;
  "qty"?: number;
  "cost_price"?: number;
  "amount"?: number;
  "transferred_qty"?: number;
  "batch_no"?: string;
  "remark"?: string;
  "tenant_id"?: string;
  "edges"?: { "transfer"?: StockTransfer; "product"?: Product };
  "quantity"?: number;
  "production_date"?: string;
  "expiry_date"?: string;
  "serial_nos"?: string[];
  "ext_fields"?: Record<string, unknown>;
}

export interface StockInPhoto {

}

export interface StockMovement {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "type"?: string;
  "source_type"?: string;
  "source_id"?: string;
  "source_no"?: string;
  "product_id"?: string;
  "warehouse_id"?: string;
  "location_id"?: string;
  "rack_id"?: string;
  "batch_no"?: string;
  "serial_no"?: string;
  "production_date"?: string;
  "expiry_date"?: string;
  "qty"?: number;
  "direction"?: number;
  "unit_id"?: string;
  "unit_cost"?: number;
  "total_cost"?: number;
  "balance_after"?: string;
  "remark"?: string;
  "operator_id"?: string;
  "tenant_id"?: string;
  "department_id"?: string;
  "edges"?: { "product"?: Product; "warehouse"?: Warehouse };
  "product_code"?: string;
  "product_name"?: string;
  "warehouse_name"?: string;
}

export interface StockOut {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "stock_out_no"?: string;
  "type"?: string;
  "warehouse_id"?: string;
  "location_id"?: string;
  "rack_id"?: string;
  "status"?: string;
  "stock_out_date"?: string;
  "confirmed_at"?: string;
  "confirmed_by"?: string;
  "total_qty"?: number;
  "total_amount"?: number;
  "source_no"?: string;
  "source_id"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "edges"?: { "lines"?: StockOutLine[]; "warehouse"?: Warehouse };
  "warehouse_name"?: string;
  "lines"?: StockOutLine[];
  "source_type"?: string;
}

export interface StockOutLine {
  "id"?: string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "transfer_id"?: string;
  "line_no"?: number;
  "product_id": string;
  "unit_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "spec"?: string;
  "unit_name"?: string;
  "qty"?: number;
  "cost_price"?: number;
  "amount"?: number;
  "transferred_qty"?: number;
  "batch_no"?: string;
  "remark"?: string;
  "tenant_id"?: string;
  "edges"?: { "transfer"?: StockTransfer; "product"?: Product };
  "quantity"?: number;
  "serial_nos"?: string[];
  "ext_fields"?: Record<string, unknown>;
}

export interface StockTransfer {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "transfer_no"?: string;
  "from_warehouse_id"?: string;
  "to_warehouse_id"?: string;
  "from_location_id"?: string;
  "to_location_id"?: string;
  "status"?: string;
  "transfer_date"?: string;
  "completed_at"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "edges"?: { "lines"?: StockTransferLine[]; "fromWarehouse"?: Warehouse; "toWarehouse"?: Warehouse };
  "from_warehouse_name"?: string;
  "to_warehouse_name"?: string;
  "lines"?: StockTransferLine[];
}

export interface StockTransferLine {
  "id"?: string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "transfer_id"?: string;
  "line_no"?: number;
  "product_id": string;
  "unit_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "spec"?: string;
  "unit_name"?: string;
  "qty"?: number;
  "cost_price"?: number;
  "amount"?: number;
  "transferred_qty"?: number;
  "batch_no"?: string;
  "remark"?: string;
  "tenant_id"?: string;
  "edges"?: { "transfer"?: StockTransfer; "product"?: Product };
  "quantity"?: number;
  "ext_fields"?: Record<string, unknown>;
}
