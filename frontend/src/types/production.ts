// Reconstructed type declarations; original type-only files were erased by compilation.
// Assignments derived from frontend usage. Do not edit by hand.
import type { Product, Unit, Warehouse } from '@/types/product';

export interface AssemblyOrder {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "assembly_no"?: string;
  "asm_type"?: string;
  "warehouse_id"?: string;
  "product_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "spec"?: string;
  "qty"?: number | string;
  "unit_cost"?: number;
  "total_cost"?: number;
  "asm_date"?: string;
  "status"?: string;
  "remark"?: string;
  "confirmed_at"?: string;
  "confirmed_by"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "department_id"?: string;
  "edges"?: { "lines"?: AssemblyOrderLine[] };
  "lines"?: AssemblyOrderLine[];
}

export interface AssemblyOrderLine {
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

export interface Bom {
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
  "product_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "version"?: string;
  "department_id"?: string;
  "edges"?: { "steps"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "routing_id"?: string; "sequence"?: number; "process_code"?: string; "process_name"?: string; "work_center"?: string; "work_center_id"?: string; "standard_time"?: number; "standard_time_unit"?: string; "setup_time"?: number; "teardown_time"?: number; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "work_orders"?: (WorkOrder)[]; "product"?: Product };
  "bom_code"?: string;
  "component_count"?: number;
  "items"?: BomItem[];
  "[name]"?: string;
}

export interface BomItem {
  "unit_name"?: string;
  "product_id"?: string;
  "unit_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "qty"?: number;
  "scrap_rate"?: number;
  "remark"?: string;
}

export interface BomTreeNode {
  "product_id"?: string;
  "product_code"?: string;
  "product_name"?: string;
  "spec"?: string;
  "unit_id"?: string;
  "unit_name"?: string;
  "qty"?: number;
  "scrap_rate"?: number;
  "total_qty"?: number;
  "unit_cost"?: number;
  "line_cost"?: number;
  "has_bom"?: boolean;
  "bom_id"?: string;
  "circular"?: boolean;
  "depth"?: number;
  "children"?: BomTreeNode[];
}

export interface BomTreeResult {
  "bom_id"?: string;
  "code"?: string;
  "product_id"?: string;
  "product_code"?: string;
  "product_name"?: string;
  "qty_per"?: number;
  "version"?: string;
  "children"?: (BomTreeNode)[];
  "total_cost"?: number;
  "tree"?: BomTreeNode[];
  "root"?: BomTreeNode;
}

export interface CapacityLoadItem {
  "id"?: string;
  "name"?: string;
  "code"?: string;
  "load_hours"?: number;
  "available_hours"?: number;
  "load_rate"?: number;
  "level"?: string;
  "wip_orders"?: number;
  "wip_processes"?: number;
  "processes"?: CapacityLoadProcess[];
}

export interface CapacityLoadProcess {
  "work_order_id"?: string;
  "order_no"?: string;
  "process_id"?: string;
  "process_code"?: string;
  "process_name"?: string;
  "qty_planned"?: number;
  "standard_time"?: number;
  "standard_time_unit"?: string;
  "load_hours"?: string;
  "status"?: string;
  "planned_start_date"?: string;
  "planned_end_date"?: string;
}

export interface CapacityLoadResult {
  "items"?: CapacityLoadItem[];
  "processes"?: CapacityLoadProcess[];
}

export interface MPSPlan {
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
  "period_start"?: string;
  "period_end"?: string;
  "department_id"?: string;
  "edges"?: { "lines"?: MPSPlanLine[] };
  "lines"?: MPSPlanLine[];
}

export interface MPSPlanLine {
  "id"?: string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "plan_id"?: string;
  "product_id": string;
  "product_code"?: string;
  "product_name"?: string;
  "qty_demand"?: number;
  "qty_onhand"?: number;
  "qty_wip"?: number;
  "net_qty"?: number;
  "status"?: string;
  "edges"?: { "plan"?: MPSPlan };
}

export interface MaterialAvailabilityItem {
  "product_id"?: string;
  "product_code"?: string;
  "product_name"?: string;
  "required"?: boolean;
  "picked"?: string;
  "available"?: string;
  "shortage"?: string;
  "status"?: string;
}

export interface ProductionReturn {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "return_no"?: string;
  "work_order_id"?: string;
  "work_order_no"?: string;
  "warehouse_id"?: string;
  "return_date"?: string;
  "status"?: string;
  "reason"?: string;
  "remark"?: string;
  "created_by"?: string;
  "tenant_id"?: string;
  "edges"?: { "work_order"?: WorkOrder; "lines"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "return_id"?: string; "line_no"?: number; "product_id"?: string; "product_name"?: string; "product_code"?: string; "qty"?: string; "unit_cost"?: string; "batch_no"?: string; "reason"?: string; "remark"?: string; "tenant_id"?: string; "edges"?: string })[] };
}

export interface ReworkOrder {
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
  "work_order_id"?: string;
  "work_order_no"?: string;
  "process_id"?: string;
  "process_code"?: string;
  "process_name"?: string;
  "qty_rework"?: number | string;
  "qty_good"?: number | string;
  "qty_bad"?: number | string;
  "reason"?: string;
  "operator_id"?: string;
  "operator_name"?: string;
  "confirmed_at"?: string;
  "completed_at"?: string;
  "department_id"?: string;
}

export interface Routing {
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
  "product_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "version"?: string;
  "department_id"?: string;
  "edges"?: { "steps"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "routing_id"?: string; "sequence"?: number; "process_code"?: string; "process_name"?: string; "work_center"?: string; "work_center_id"?: string; "standard_time"?: number; "standard_time_unit"?: string; "setup_time"?: number; "teardown_time"?: number; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "work_orders"?: (WorkOrder)[]; "product"?: Product };
  "name"?: string;
  "routing_name"?: string;
  "routing_code"?: string;
  "operation_count"?: number;
  "[name]"?: string;
}

export interface SerialNumber {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "product_id"?: string;
  "product_code"?: string;
  "product_name"?: string;
  "serial_no"?: string;
  "warehouse_id"?: string;
  "warehouse_name"?: string;
  "status"?: string;
  "source_type"?: string;
  "source_no"?: string;
  "movement_id"?: string;
  "registered_at"?: string;
  "out_at"?: string;
  "remark"?: string;
  "tenant_id"?: string;
}

export interface SubcontractMaterialLine {
  "id"?: string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "subcontract_order_id"?: string;
  "line_no"?: number;
  "product_id": string;
  "unit_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "spec"?: string;
  "qty"?: number;
  "issued_qty"?: number;
  "consumed_qty"?: number;
  "returned_qty"?: number;
  "unit_cost"?: number;
  "amount"?: number;
  "warehouse_id"?: string;
  "batch_no"?: string;
  "remark"?: string;
  "tenant_id"?: string;
  "edges"?: { "subcontract_order"?: SubcontractOrder; "product"?: Product; "unit"?: Unit; "warehouse"?: Warehouse };
}

export interface SubcontractOrder {
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
  "work_order_id"?: string;
  "work_order_no"?: string;
  "process_id"?: string;
  "process_code"?: string;
  "process_name"?: string;
  "supplier_id"?: string;
  "supplier_name"?: string;
  "warehouse_id"?: string;
  "warehouse_name"?: string;
  "product_id"?: string;
  "product_code"?: string;
  "product_name"?: string;
  "mode"?: string;
  "qty"?: number;
  "unit_price"?: number;
  "amount"?: number;
  "material_issued_qty"?: number;
  "material_issued_cost"?: number;
  "material_consumed_qty"?: number;
  "material_consumed_cost"?: number;
  "material_returned_qty"?: number;
  "material_returned_cost"?: number;
  "received_qty"?: number;
  "diff_qty"?: number;
  "diff_reason"?: string;
  "issue_date"?: string;
  "confirm_date"?: string;
  "receive_date"?: string;
  "complete_date"?: string;
  "department_id"?: string;
  "edges"?: { "material_lines"?: SubcontractMaterialLine[]; "receive_logs"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "subcontract_order_id"?: string; "seq"?: number; "qty"?: string; "diff_qty"?: string; "receive_date"?: string; "warehouse_id"?: string; "warehouse_name"?: string; "batch_no"?: string; "material_cost"?: string; "processing_fee"?: string; "unit_cost"?: string; "diff_reason"?: string; "remark"?: string; "created_by"?: string; "tenant_id"?: string; "edges"?: string })[] };
  "material_lines"?: SubcontractMaterialLine[];
  "lines"?: SubcontractMaterialLine[];
  "materials"?: SubcontractMaterialLine[];
}

export interface WorkCenter {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "code"?: string;
  "name"?: string;
  "capacity"?: number;
  "efficiency"?: number;
  "cost_rate"?: number;
  "manager"?: string;
  "status"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "department_id"?: string;
  "edges"?: { "routing_steps"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "routing_id"?: string; "sequence"?: number; "process_code"?: string; "process_name"?: string; "work_center"?: string; "work_center_id"?: string; "standard_time"?: number; "standard_time_unit"?: string; "setup_time"?: number; "teardown_time"?: number; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "edges"?: string })[]; "work_order_processes"?: (WorkOrderProcess)[] };
  "[field]"?: string;
  "daily_capacity"?: number;
  "daily_hours"?: number;
}

export interface WorkOrder {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "department_id"?: string;
  "order_no"?: string;
  "status"?: string;
  "product_id"?: string;
  "product_name"?: string;
  "product_code"?: string;
  "bom_id"?: string;
  "routing_id"?: string;
  "warehouse_id"?: string;
  "qty"?: number;
  "completed_qty"?: number;
  "scrap_qty"?: number;
  "material_cost"?: number;
  "labor_cost"?: number;
  "overhead_cost"?: number;
  "total_cost"?: number;
  "planned_start_date"?: string;
  "planned_end_date"?: string;
  "actual_start_date"?: string;
  "actual_end_date"?: string;
  "confirmed_at"?: string;
  "approved_at"?: string;
  "approved_by"?: string;
  "priority"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "created_by"?: string;
  "updated_by"?: string;
  "edges"?: { "processes"?: WorkOrderProcess[]; "pickings"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "department_id"?: string; "picking_no"?: string; "work_order_id"?: string; "work_order_no"?: string; "warehouse_id"?: string; "status"?: string; "picking_date"?: string; "confirmed_at"?: string; "total_qty"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "receipts"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "department_id"?: string; "receipt_no"?: string; "work_order_id"?: string; "work_order_no"?: string; "warehouse_id"?: string; "status"?: string; "receipt_date"?: string; "confirmed_at"?: string; "total_qty"?: string; "total_cost"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "edges"?: string })[]; "returns"?: (ProductionReturn)[]; "materials"?: WorkOrderMaterial[]; "product"?: Product; "bom"?: { "id"?: string; "created_at"?: string; "updated_at"?: string; "deleted_at"?: string; "code"?: string; "status"?: string; "remark"?: string; "ext"?: Record<string, unknown>; "tenant_id"?: string; "created_by"?: string; "updated_by"?: string; "product_id"?: string; "product_name"?: string; "product_code"?: string; "qty_per"?: string; "version"?: string; "department_id"?: string; "edges"?: { "items"?: (string)[]; "work_orders"?: (WorkOrder)[]; "product"?: Product } }; "routing"?: Routing; "warehouse"?: Warehouse };
  "work_order_no"?: string;
  "quantity"?: number;
  "received_qty"?: number;
  "can_complete"?: boolean;
  "start_date"?: string;
  "end_date"?: string;
  "product_spec"?: string;
  "[name]"?: string;
  "processes_done"?: number;
  "processes_total"?: number;
  "material_pending"?: number;
  "materials"?: WorkOrderMaterial[];
  "processes"?: WorkOrderProcess[];
}

export interface WorkOrderMaterial {
  "id": string;
  "work_order_id"?: string;
  "product_id"?: string;
  "product_code"?: string;
  "product_name"?: string;
  "unit_id"?: string;
  "unit_name"?: string;
  "qty_required"?: number;
  "qty_issued"?: number;
  "qty_returned"?: number;
  "qty_pending"?: number;
  "remark"?: string;
}

export interface WorkOrderProcess {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "work_order_id"?: string;
  "sequence"?: number;
  "process_code"?: string;
  "process_name"?: string;
  "work_center"?: string;
  "work_center_id"?: string;
  "work_center_name"?: string;
  "status"?: string;
  "operator_id"?: string;
  "operator_name"?: string;
  "qty_planned"?: number;
  "qty_good"?: number;
  "qty_bad"?: number;
  "qty_completed"?: number;
  "standard_time"?: number;
  "standard_time_unit"?: string;
  "labor_rate"?: number;
  "started_at"?: string;
  "completed_at"?: string;
  "actual_time"?: number;
  "actual_time_unit"?: string;
  "remark"?: string;
  "ext"?: Record<string, unknown>;
  "tenant_id"?: string;
  "edges"?: { "work_order"?: WorkOrder; "work_center_ref"?: WorkCenter };
}
