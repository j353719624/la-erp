// Reconstructed type declarations; original type-only files were erased by compilation.
// Assignments derived from frontend usage. Do not edit by hand.
import type { InventoryBalance, InventoryCheck, InventoryCheckLine, LoanOrder, Location, StockIn, StockMovement, StockOut, StockTransfer, StockTransferLine } from '@/types/inventory';
import type { PurchaseReturnLine, SalesOrderLine, SalesReturnLine } from '@/types/order';
import type { Routing, SubcontractMaterialLine, WorkOrder } from '@/types/production';

export interface Category {
  "id": string;
  "code"?: string;
  "name"?: string;
  "parent_id"?: string;
  "entity_code"?: string;
  "status"?: string;
  "children"?: (CategoryTreeNode)[];
  "[name]"?: string;
}

export interface CategoryTreeNode {
  "id": string;
  "code"?: string;
  "name"?: string;
  "parent_id"?: string;
  "entity_code"?: string;
  "status"?: string;
  "children"?: CategoryTreeNode[];
}

export interface ComboActionResult {
  "source_no"?: string;
  "qty"?: number;
  "unit_cost"?: number;
  "total_cost"?: number;
  "stock"?: ComboStock;
}

export interface ComboDetail {
  "product"?: Product;
  "is_combo"?: boolean;
  "lines"?: ComboLine[];
  "unit_cost"?: number;
  "total_cost"?: number;
  "stock"?: ComboStock;
}

export interface ComboLine {
  "component_id"?: string;
  "qty"?: number;
  "remark"?: string;
  "edges"?: { product?: Product; unit?: Unit };
}

export interface ComboListItem {
  "item_count"?: number;
  "unit_cost"?: number;
  "can_assemble"?: string;
  "stock"?: string;
  "name"?: string;
  "id"?: string;
  "spec"?: string;
  "edges"?: { product?: Product; category?: Category };
  "product"?: Product;
}

export interface ComboStock {

}

export interface PriceList {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "name"?: string;
  "list_type"?: string;
  "entity_id"?: string;
  "entity_name"?: string;
  "currency"?: string;
  "effective_date"?: string;
  "expiry_date"?: string;
  "status"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "edges"?: { "lines"?: PriceListLine[] };
  "lines"?: PriceListLine[];
  "[key]"?: string;
}

export interface PriceListLine {
  "product_id": string;
  "product_name"?: string;
  "product_code"?: string;
  "price"?: number;
  "min_qty"?: number;
  "remark"?: string;
}

export interface Product {
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
  "category_id"?: string;
  "unit_id"?: string;
  "spu_id"?: string;
  "name"?: string;
  "spec"?: string;
  "barcode"?: string;
  "product_type"?: string;
  "is_batch"?: boolean;
  "is_serial"?: boolean;
  "shelf_life_days"?: number;
  "safety_stock"?: number;
  "min_order_qty"?: number;
  "cost_method"?: string;
  "sale_price"?: number;
  "purchase_price"?: number;
  "image_url"?: string;
  "images"?: string[];
  "description"?: string;
  "ext_fields"?: Record<string, unknown>;
  "is_combo"?: boolean;
  "department_id"?: string;
  "edges"?: { "category"?: Category; "unit"?: Unit; "spu"?: Spu; "unit_conversions"?: UnitConversion[]; "purchase_order_lines"?: (SalesOrderLine)[]; "sales_order_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "order_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "delivered_qty"?: string; "returned_qty"?: string; "price"?: string; "discount"?: string; "tax_rate"?: string; "amount"?: string; "tax_amount"?: string; "remark"?: string; "is_gift"?: boolean; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "purchase_return_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "order_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "delivered_qty"?: string; "returned_qty"?: string; "price"?: string; "discount"?: string; "tax_rate"?: string; "amount"?: string; "tax_amount"?: string; "remark"?: string; "is_gift"?: boolean; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "sales_return_lines"?: (SalesReturnLine)[]; "stock_movements"?: (StockMovement)[]; "inventory_balances"?: (InventoryBalance)[]; "stock_transfer_lines"?: (StockTransferLine)[]; "inventory_check_lines"?: (InventoryCheckLine)[]; "boms"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "code"?: string; "status"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "product_id"?: string; "product_name"?: string; "product_code"?: string; "qty_per"?: string; "version"?: string; "department_id"?: string; "edges"?: string })[]; "bom_items"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "bom_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "scrap_rate"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "routings"?: (Routing)[]; "work_orders"?: (WorkOrder)[]; "production_picking_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "picking_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "picked_qty"?: string; "unit_cost"?: string; "batch_no"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "production_receipt_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "receipt_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "unit_cost"?: string; "total_cost"?: string; "batch_no"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "stock_in_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "stock_in_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "received_qty"?: string; "unit_cost"?: string; "amount"?: string; "batch_no"?: string; "serial_nos"?: (string)[]; "production_date"?: string; "expiry_date"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "loan_order_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "loan_order_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "returned_qty"?: string; "unit_cost"?: string; "amount"?: string; "batch_no"?: string; "serial_nos"?: (string)[]; "remark"?: string; "tenant_id"?: string; "edges"?: string })[]; "consignment_order_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "order_id"?: string; "line_no"?: number; "product_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "sold_qty"?: string; "returned_qty"?: string; "unit_cost"?: string; "amount"?: string; "batch_no"?: string; "serial_nos"?: (string)[]; "remark"?: string; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "stock_out_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "stock_out_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "issued_qty"?: string; "unit_cost"?: string; "amount"?: string; "batch_no"?: string; "serial_nos"?: (string)[]; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "material_requirement_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "mrp_id"?: string; "product_id"?: string; "product_code"?: string; "product_name"?: string; "requirement_type"?: string; "gross_demand"?: string; "available_qty"?: string; "on_order_qty"?: string; "wip_qty"?: string; "safety_stock"?: string; "net_requirement"?: string; "suggested_qty"?: string; "status"?: string; "source_no"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "purchase_suggestion_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "suggestion_id"?: string; "product_id"?: string; "product_code"?: string; "product_name"?: string; "suggested_qty"?: string; "planned_date"?: string; "status"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "purchase_requisition_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "requisition_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "suggested_price"?: string; "suggested_supplier_id"?: string; "suggested_supplier_name"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "sales_quotation_lines"?: (PurchaseReturnLine)[]; "work_order_materials"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "work_order_id"?: string; "product_id"?: string; "product_code"?: string; "product_name"?: string; "unit_id"?: string; "qty_required"?: string; "qty_issued"?: string; "qty_returned"?: string; "warehouse_id"?: string; "remark"?: string; "tenant_id"?: string; "edges"?: string })[]; "subcontract_order_material_lines"?: (SubcontractMaterialLine)[]; "stock_adjust_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "adjust_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "unit_cost"?: string; "batch_no"?: string; "remark"?: string; "tenant_id"?: string; "edges"?: string })[]; "assembly_order_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "assembly_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "unit_cost"?: string; "batch_no"?: string; "remark"?: string; "tenant_id"?: string; "edges"?: string })[]; "production_return_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "return_id"?: string; "line_no"?: number; "product_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "unit_cost"?: string; "batch_no"?: string; "reason"?: string; "remark"?: string; "tenant_id"?: string; "edges"?: string })[]; "purchase_rfq_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "rfq_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "quoted_price"?: string; "remark"?: string; "tenant_id"?: string; "edges"?: string })[] };
  "category_name"?: string;
  "stock_qty"?: number;
  "unit_name"?: string;
  "stock_by_warehouse"?: { warehouse_id?: string; warehouse_name?: string; qty_available?: number; qty_locked?: number; qty_in_transit?: number }[];
  "[name]"?: string;
  "category"?: Category;
  "unit"?: Unit;
  "spu"?: Spu;
  "unit_conversions"?: UnitConversion[];
}

export interface Spu {
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
  "name"?: string;
  "category_id"?: string;
  "unit_id"?: string;
  "description"?: string;
  "images"?: (string)[];
  "dims"?: SpuDim[];
  "edges"?: { "products"?: Product[] };
  "sku_count"?: number;
  "products"?: Product[];
}

export interface SpuDim {
  "code": string;
  "name"?: string;
  "values": string[];
}

export interface SpuGenerateResult {
  "created"?: number;
  "skipped"?: number;
  "codes"?: (string)[];
  "products"?: Product[];
}

export interface Unit {
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
  "name"?: string;
  "is_base"?: boolean;
  "edges"?: { "products"?: (Product)[]; "unit_conversions"?: (UnitConversion)[]; "loan_order_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "loan_order_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "returned_qty"?: string; "unit_cost"?: string; "amount"?: string; "batch_no"?: string; "serial_nos"?: (string)[]; "remark"?: string; "tenant_id"?: string; "edges"?: string })[]; "purchase_order_lines"?: (SalesOrderLine)[]; "sales_order_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "order_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "delivered_qty"?: string; "returned_qty"?: string; "price"?: string; "discount"?: string; "tax_rate"?: string; "amount"?: string; "tax_amount"?: string; "remark"?: string; "is_gift"?: boolean; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "purchase_return_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "order_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "spec"?: string; "qty"?: string; "delivered_qty"?: string; "returned_qty"?: string; "price"?: string; "discount"?: string; "tax_rate"?: string; "amount"?: string; "tax_amount"?: string; "remark"?: string; "is_gift"?: boolean; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "sales_return_lines"?: (SalesReturnLine)[]; "bom_items"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "bom_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "scrap_rate"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "production_picking_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "picking_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "picked_qty"?: string; "unit_cost"?: string; "batch_no"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "production_receipt_lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "receipt_id"?: string; "line_no"?: number; "product_id"?: string; "unit_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "unit_cost"?: string; "total_cost"?: string; "batch_no"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "work_order_materials"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "work_order_id"?: string; "product_id"?: string; "product_code"?: string; "product_name"?: string; "unit_id"?: string; "qty_required"?: string; "qty_issued"?: string; "qty_returned"?: string; "warehouse_id"?: string; "remark"?: string; "tenant_id"?: string; "edges"?: string })[]; "subcontract_order_material_lines"?: (SubcontractMaterialLine)[] };
  "[name]"?: string;
}

export interface UnitConversion {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "product_id"?: string;
  "unit_id"?: string;
  "unit_name"?: string;
  "rate"?: number;
  "remark"?: string;
  "tenant_id"?: string;
  "edges"?: { "product"?: Product; "unit"?: Unit };
}

export interface Warehouse {
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
  "name"?: string;
  "address"?: string;
  "manager_id"?: string;
  "is_default"?: boolean;
  "edges"?: { "locations"?: (Location)[]; "stock_movements"?: (StockMovement)[]; "inventory_balances"?: (InventoryBalance)[]; "stock_transfers_from"?: (StockTransfer)[]; "stock_transfers_to"?: (StockTransfer)[]; "inventory_checks"?: (InventoryCheck)[]; "work_orders"?: (WorkOrder)[]; "production_pickings"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "department_id"?: string; "picking_no"?: string; "work_order_id"?: string; "work_order_no"?: string; "warehouse_id"?: string; "status"?: string; "picking_date"?: string; "confirmed_at"?: string; "total_qty"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "production_receipts"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "department_id"?: string; "receipt_no"?: string; "work_order_id"?: string; "work_order_no"?: string; "warehouse_id"?: string; "status"?: string; "receipt_date"?: string; "confirmed_at"?: string; "total_qty"?: string; "total_cost"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "stock_ins"?: (StockIn)[]; "stock_outs"?: (StockOut)[]; "loan_orders"?: (LoanOrder)[]; "consignment_orders"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "department_id"?: string; "consignment_no"?: string; "party_id"?: string; "party_name"?: string; "warehouse_id"?: string; "location_id"?: string; "rack_id"?: string; "status"?: string; "consignment_date"?: string; "expected_return_date"?: string; "total_qty"?: string; "sold_qty"?: string; "returned_qty"?: string; "total_amount"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "subcontract_order_material_lines"?: (SubcontractMaterialLine)[] };
  "[name]"?: string;
}
