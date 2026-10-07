import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
import { NotFound } from '@/pages/NotFound';
import { PortalLogin } from '@/pages/Portal/PortalLogin';
import { PortalShop } from '@/pages/Portal/PortalShop';
import { Dashboard } from '@/pages/Dashboard';
import { ProductList } from '@/pages/Product/ProductList';
import { ProductForm } from '@/pages/Product/ProductForm';
const ComboList = lazy(() => import('@/pages/Product/ComboList').then(m => ({ default: m.ComboList })));
const ComboForm = lazy(() => import('@/pages/Product/ComboForm').then(m => ({ default: m.ComboForm })));
const CategoryList = lazy(() => import('@/pages/Product/CategoryList').then(m => ({ default: m.CategoryList })));
const CategoryForm = lazy(() => import('@/pages/Product/CategoryForm').then(m => ({ default: m.CategoryForm })));
const PriceListList = lazy(() => import('@/pages/Product/PriceListList').then(m => ({ default: m.PriceListList })));
const PriceListForm = lazy(() => import('@/pages/Product/PriceListForm').then(m => ({ default: m.PriceListForm })));
const UnitList = lazy(() => import('@/pages/Product/UnitList').then(m => ({ default: m.UnitList })));
const UnitForm = lazy(() => import('@/pages/Product/UnitForm').then(m => ({ default: m.UnitForm })));
const SpuList = lazy(() => import('@/pages/Product/SpuList').then(m => ({ default: m.SpuList })));
import { useAuthStore } from '@/store/auth';

const CustomerList = lazy(() => import('@/pages/Customer/CustomerList').then(m => ({ default: m.CustomerList })));
const EmployeeList = lazy(() => import('@/pages/Hr/EmployeeList').then(m => ({ default: m.EmployeeList })));
const HrContractList = lazy(() => import('@/pages/Hr/ContractList').then(m => ({ default: m.ContractList })));
const AttendanceList = lazy(() => import('@/pages/Hr/AttendanceList').then(m => ({ default: m.AttendanceList })));
const EmployeeChangeList = lazy(() => import('@/pages/Hr/EmployeeChangeList').then(m => ({ default: m.EmployeeChangeList })));
const RecruitmentList = lazy(() => import('@/pages/Hr/RecruitmentList').then(m => ({ default: m.RecruitmentList })));
const TrainingList = lazy(() => import('@/pages/Hr/TrainingList').then(m => ({ default: m.TrainingList })));
const PerformanceList = lazy(() => import('@/pages/Hr/PerformanceList').then(m => ({ default: m.PerformanceList })));
const PieceworkList = lazy(() => import('@/pages/Hr/PieceworkList').then(m => ({ default: m.PieceworkList })));
const HrReportList = lazy(() => import('@/pages/Hr/HrReportList').then(m => ({ default: m.HrReportList })));
const CustomerForm = lazy(() => import('@/pages/Customer/CustomerForm').then(m => ({ default: m.CustomerForm })));
const SupplierList = lazy(() => import('@/pages/Supplier/SupplierList').then(m => ({ default: m.SupplierList })));
const SupplierForm = lazy(() => import('@/pages/Supplier/SupplierForm').then(m => ({ default: m.SupplierForm })));
const SalesOrderList = lazy(() => import('@/pages/SalesOrder/SalesOrderList').then(m => ({ default: m.SalesOrderList })));
const SalesOrderForm = lazy(() => import('@/pages/SalesOrder/SalesOrderForm').then(m => ({ default: m.SalesOrderForm })));
const SalesQuotationList = lazy(() => import('@/pages/SalesOrder/SalesQuotationList').then(m => ({ default: m.SalesQuotationList })));
const SalesReturnList = lazy(() => import('@/pages/SalesOrder/SalesReturnList').then(m => ({ default: m.SalesReturnList })));
const SalesReturnForm = lazy(() => import('@/pages/SalesOrder/SalesReturnForm').then(m => ({ default: m.SalesReturnForm })));
const PurchaseOrderList = lazy(() => import('@/pages/PurchaseOrder/PurchaseOrderList').then(m => ({ default: m.PurchaseOrderList })));
const PurchaseOrderForm = lazy(() => import('@/pages/PurchaseOrder/PurchaseOrderForm').then(m => ({ default: m.PurchaseOrderForm })));
const ContractList = lazy(() => import('@/pages/Purchase/ContractList').then(m => ({ default: m.ContractList })));
const ContractForm = lazy(() => import('@/pages/Purchase/ContractForm').then(m => ({ default: m.ContractForm })));
const SalesContractList = lazy(() => import('@/pages/SalesOrder/ContractList').then(m => ({ default: m.ContractList })));
const SalesContractForm = lazy(() => import('@/pages/SalesOrder/ContractForm').then(m => ({ default: m.ContractForm })));
const PurchaseRequisitionList = lazy(() => import('@/pages/PurchaseOrder/PurchaseRequisitionList').then(m => ({ default: m.PurchaseRequisitionList })));
const PurchaseRFQList = lazy(() => import('@/pages/PurchaseOrder/PurchaseRFQList').then(m => ({ default: m.PurchaseRFQList })));
const PurchaseRFQForm = lazy(() => import('@/pages/PurchaseOrder/PurchaseRFQForm').then(m => ({ default: m.PurchaseRFQForm })));
const PurchaseReturnList = lazy(() => import('@/pages/PurchaseOrder/PurchaseReturnList').then(m => ({ default: m.PurchaseReturnList })));
const PurchaseReturnForm = lazy(() => import('@/pages/PurchaseOrder/PurchaseReturnForm').then(m => ({ default: m.PurchaseReturnForm })));
const InventoryBalance = lazy(() => import('@/pages/Inventory/InventoryBalance').then(m => ({ default: m.InventoryBalancePage })));
const InventoryMovement = lazy(() => import('@/pages/Inventory/InventoryMovement').then(m => ({ default: m.InventoryMovement })));
const InventoryCheck = lazy(() => import('@/pages/Inventory/InventoryCheck').then(m => ({ default: m.InventoryCheckPage })));
const InventoryCheckForm = lazy(() => import('@/pages/Inventory/InventoryCheckForm').then(m => ({ default: m.InventoryCheckForm })));
const LocationList = lazy(() => import('@/pages/Inventory/LocationList').then(m => ({ default: m.LocationList })));
const RackList = lazy(() => import('@/pages/Inventory/RackList').then(m => ({ default: m.RackList })));
const StockTransfer = lazy(() => import('@/pages/Inventory/StockTransfer').then(m => ({ default: m.StockTransferPage })));
const StockTransferForm = lazy(() => import('@/pages/Inventory/StockTransferForm').then(m => ({ default: m.StockTransferForm })));
const StockAdjustList = lazy(() => import('@/pages/Inventory/StockAdjustList').then(m => ({ default: m.StockAdjustList })));
const StockAdjustForm = lazy(() => import('@/pages/Inventory/StockAdjustForm').then(m => ({ default: m.StockAdjustForm })));
const LoanList = lazy(() => import('@/pages/Inventory/LoanList').then(m => ({ default: m.LoanList })));
const LoanForm = lazy(() => import('@/pages/Inventory/LoanForm').then(m => ({ default: m.LoanForm })));
const ConsignmentList = lazy(() => import('@/pages/Inventory/ConsignmentList').then(m => ({ default: m.ConsignmentList })));
const ConsignmentForm = lazy(() => import('@/pages/Inventory/ConsignmentForm').then(m => ({ default: m.ConsignmentForm })));
const WarehouseList = lazy(() => import('@/pages/Inventory/WarehouseList').then(m => ({ default: m.WarehouseList })));
const WarehouseForm = lazy(() => import('@/pages/Inventory/WarehouseForm').then(m => ({ default: m.WarehouseForm })));
const StockInList = lazy(() => import('@/pages/Stock/StockInList').then(m => ({ default: m.StockInList })));
const StockInForm = lazy(() => import('@/pages/Stock/StockInForm').then(m => ({ default: m.StockInForm })));
const StockOutList = lazy(() => import('@/pages/Stock/StockOutList').then(m => ({ default: m.StockOutList })));
const StockOutForm = lazy(() => import('@/pages/Stock/StockOutForm').then(m => ({ default: m.StockOutForm })));
const ReceivableList = lazy(() => import('@/pages/Finance/ReceivableList').then(m => ({ default: m.ReceivableList })));
const ReceivableForm = lazy(() => import('@/pages/Finance/ReceivableForm').then(m => ({ default: m.ReceivableForm })));
const PayableList = lazy(() => import('@/pages/Finance/PayableList').then(m => ({ default: m.PayableList })));
const PayableForm = lazy(() => import('@/pages/Finance/PayableForm').then(m => ({ default: m.PayableForm })));
const ReceiptList = lazy(() => import('@/pages/Finance/ReceiptList').then(m => ({ default: m.ReceiptList })));
const ReceiptForm = lazy(() => import('@/pages/Finance/ReceiptForm').then(m => ({ default: m.ReceiptForm })));
const PaymentList = lazy(() => import('@/pages/Finance/PaymentList').then(m => ({ default: m.PaymentList })));
const PaymentForm = lazy(() => import('@/pages/Finance/PaymentForm').then(m => ({ default: m.PaymentForm })));
const VoucherList = lazy(() => import('@/pages/Finance/VoucherList').then(m => ({ default: m.VoucherList })));
const VoucherForm = lazy(() => import('@/pages/Finance/VoucherForm').then(m => ({ default: m.VoucherForm })));
const VoucherTemplateList = lazy(() => import('@/pages/Finance/VoucherTemplateList').then(m => ({ default: m.VoucherTemplateList })));
const AccountMappingList = lazy(() => import('@/pages/Finance/AccountMappingList').then(m => ({ default: m.AccountMappingList })));
const AccountList = lazy(() => import('@/pages/Finance/AccountList').then(m => ({ default: m.AccountList })));
const AccountForm = lazy(() => import('@/pages/Finance/AccountForm').then(m => ({ default: m.AccountForm })));
const InvoiceManage = lazy(() => import('@/pages/Finance/InvoiceManage').then(m => ({ default: m.InvoiceManage })));
const AccountingPeriods = lazy(() => import('@/pages/Finance/AccountingPeriods').then(m => ({ default: m.AccountingPeriods })));
const TaxAccrualPage = lazy(() => import('@/pages/Finance/TaxAccrual').then(m => ({ default: m.TaxAccrualPage })));
const ShareholderList = lazy(() => import('@/pages/Finance/ShareholderList').then(m => ({ default: m.ShareholderList })));
const TaxReport = lazy(() => import('@/pages/Finance/TaxReport').then(m => ({ default: m.TaxReport })));
const AgingAnalysis = lazy(() => import('@/pages/Finance/AgingAnalysis').then(m => ({ default: m.AgingAnalysis })));
const Statement = lazy(() => import('@/pages/Finance/Statement').then(m => ({ default: m.Statement })));
const ExpenseClaims = lazy(() => import('@/pages/Finance/ExpenseClaims').then(m => ({ default: m.ExpenseClaims })));
const FixedAssets = lazy(() => import('@/pages/Finance/FixedAssets').then(m => ({ default: m.FixedAssets })));
const BankReconciliation = lazy(() => import('@/pages/Finance/BankReconciliation').then(m => ({ default: m.BankReconciliation })));
const CurrencyList = lazy(() => import('@/pages/Finance/CurrencyList').then(m => ({ default: m.CurrencyList })));
const PayrollList = lazy(() => import('@/pages/Finance/PayrollList').then(m => ({ default: m.PayrollList })));
const PaymentPlanList = lazy(() => import('@/pages/Finance/PaymentPlanList').then(m => ({ default: m.PaymentPlanList })));
const PaymentPlanForm = lazy(() => import('@/pages/Finance/PaymentPlanForm').then(m => ({ default: m.PaymentPlanForm })));
const LeadList = lazy(() => import('@/pages/Sales/LeadList').then(m => ({ default: m.LeadList })));
const CrmList = lazy(() => import('@/pages/Crm/CrmList').then(m => ({ default: m.CrmList })));
const PurchaseReconciliationList = lazy(() => import('@/pages/Purchase/PurchaseReconciliationList').then(m => ({ default: m.PurchaseReconciliationList })));
const SalesReport = lazy(() => import('@/pages/Report/SalesReport').then(m => ({ default: m.SalesReport })));
const SalesForecast = lazy(() => import('@/pages/Report/SalesForecast').then(m => ({ default: m.SalesForecast })));
const SalesCommission = lazy(() => import('@/pages/Report/SalesCommission').then(m => ({ default: m.SalesCommission })));
const PurchaseReport = lazy(() => import('@/pages/Report/PurchaseReport').then(m => ({ default: m.PurchaseReport })));
const InventoryReport = lazy(() => import('@/pages/Report/InventoryReport').then(m => ({ default: m.InventoryReport })));
const TradeReport = lazy(() => import('@/pages/Report/TradeReport').then(m => ({ default: m.TradeReport })));
const FinanceReport = lazy(() => import('@/pages/Report/FinanceReport').then(m => ({ default: m.FinanceReport })));
const CustomReportList = lazy(() => import('@/pages/Report/CustomReportList').then(m => ({ default: m.CustomReportList })));
const UserList = lazy(() => import('@/pages/System/UserList').then(m => ({ default: m.UserList })));
const UserForm = lazy(() => import('@/pages/System/UserForm').then(m => ({ default: m.UserForm })));
const RoleList = lazy(() => import('@/pages/System/RoleList').then(m => ({ default: m.RoleList })));
const RoleForm = lazy(() => import('@/pages/System/RoleForm').then(m => ({ default: m.RoleForm })));
const PermissionList = lazy(() => import('@/pages/System/PermissionList').then(m => ({ default: m.PermissionList })));
const PermissionForm = lazy(() => import('@/pages/System/PermissionForm').then(m => ({ default: m.PermissionForm })));
const NotificationCenter = lazy(() => import('@/pages/System/NotificationCenter').then(m => ({ default: m.NotificationCenter })));
const AuditLogList = lazy(() => import('@/pages/System/AuditLogList').then(m => ({ default: m.AuditLogList })));
const ApprovalFlowList = lazy(() => import('@/pages/System/ApprovalFlowList').then(m => ({ default: m.ApprovalFlowList })));
const ApprovalTasks = lazy(() => import('@/pages/System/ApprovalTasks').then(m => ({ default: m.ApprovalTasks })));
const PortalManage = lazy(() => import('@/pages/Portal/PortalManage').then(m => ({ default: m.PortalManage })));
const CompanySettings = lazy(() => import('@/pages/System/CompanySettings').then(m => ({ default: m.CompanySettings })));
const CompanyManage = lazy(() => import('@/pages/System/CompanyManage').then(m => ({ default: m.CompanyManage })));
const NumberingRules = lazy(() => import('@/pages/System/NumberingRules').then(m => ({ default: m.NumberingRules })));
const BackupList = lazy(() => import('@/pages/System/BackupList').then(m => ({ default: m.BackupList })));
const LicenseActivation = lazy(() => import('@/pages/System/LicenseActivation').then(m => ({ default: m.LicenseActivation })));
const ProfilePage = lazy(() => import('@/pages/System/ProfilePage').then(m => ({ default: m.ProfilePage })));
const DynamicDataList = lazy(() => import('@/pages/Metadata/DynamicDataList').then(m => ({ default: m.DynamicDataList })));
const DictList = lazy(() => import('@/pages/System/DictList').then(m => ({ default: m.DictList })));
const DepartmentList = lazy(() => import('@/pages/System/DepartmentList').then(m => ({ default: m.DepartmentList })));
const WorkOrderList = lazy(() => import('@/pages/Production/WorkOrderList').then(m => ({ default: m.WorkOrderList })));
const WorkReportList = lazy(() => import('@/pages/Production/WorkReportList').then(m => ({ default: m.WorkReportList })));
const AssemblyList = lazy(() => import('@/pages/Production/AssemblyList').then(m => ({ default: m.AssemblyList })));
const AssemblyForm = lazy(() => import('@/pages/Production/AssemblyForm').then(m => ({ default: m.AssemblyForm })));
const WorkOrderForm = lazy(() => import('@/pages/Production/WorkOrderForm').then(m => ({ default: m.WorkOrderForm })));
const WorkOrderBoard = lazy(() => import('@/pages/Production/WorkOrderBoard').then(m => ({ default: m.WorkOrderBoard })));
const ReworkOrderList = lazy(() => import('@/pages/Production/ReworkOrderList').then(m => ({ default: m.ReworkOrderList })));
const ReworkOrderForm = lazy(() => import('@/pages/Production/ReworkOrderForm').then(m => ({ default: m.ReworkOrderForm })));
const SubcontractList = lazy(() => import('@/pages/Production/SubcontractList').then(m => ({ default: m.SubcontractList })));
const EquipmentList = lazy(() => import('@/pages/Production/EquipmentList').then(m => ({ default: m.EquipmentList })));
const ToolingList = lazy(() => import('@/pages/Production/ToolingList').then(m => ({ default: m.ToolingList })));
const ProductionTeamList = lazy(() => import('@/pages/Production/TeamList').then(m => ({ default: m.TeamList })));
const ProductDocumentList = lazy(() => import('@/pages/Production/DocumentList').then(m => ({ default: m.DocumentList })));
const SerialNumberList = lazy(() => import('@/pages/Production/SerialNumberList').then(m => ({ default: m.SerialNumberList })));
const MpsPlan = lazy(() => import('@/pages/Production/MpsPlan').then(m => ({ default: m.MpsPlan })));
const BomList = lazy(() => import('@/pages/Production/BomList').then(m => ({ default: m.BomList })));
const BomForm = lazy(() => import('@/pages/Production/BomForm').then(m => ({ default: m.BomForm })));
const RoutingList = lazy(() => import('@/pages/Production/RoutingList').then(m => ({ default: m.RoutingList })));
const RoutingForm = lazy(() => import('@/pages/Production/RoutingForm').then(m => ({ default: m.RoutingForm })));
const WorkCenterList = lazy(() => import('@/pages/Production/WorkCenterList').then(m => ({ default: m.WorkCenterList })));
const WorkCenterForm = lazy(() => import('@/pages/Production/WorkCenterForm').then(m => ({ default: m.WorkCenterForm })));
const CapacityLoad = lazy(() => import('@/pages/Production/CapacityLoad').then(m => ({ default: m.CapacityLoad })));
const ProductionPickingPage = lazy(() => import('@/pages/Production/ProductionPickingPage').then(m => ({ default: m.ProductionPickingPage })));
const ProductionSettingsPage = lazy(() => import('@/pages/Production/ProductionSettings').then(m => ({ default: m.ProductionSettings })));
const ProductionReceiptPage = lazy(() => import('@/pages/Production/ProductionReceiptPage').then(m => ({ default: m.ProductionReceiptPage })));
const ProductionReturnList = lazy(() => import('@/pages/Production/ProductionReturnList').then(m => ({ default: m.ProductionReturnList })));
const ProductionReturnForm = lazy(() => import('@/pages/Production/ProductionReturnForm').then(m => ({ default: m.ProductionReturnForm })));
const MrpPlan = lazy(() => import('@/pages/Production/MrpPlan').then(m => ({ default: m.MrpPlan })));
const PurchaseSuggestionList = lazy(() => import('@/pages/Production/PurchaseSuggestionList').then(m => ({ default: m.PurchaseSuggestionList })));
const EntityList = lazy(() => import('@/pages/Metadata/EntityList').then(m => ({ default: m.EntityList })));
const EntityForm = lazy(() => import('@/pages/Metadata/EntityForm').then(m => ({ default: m.EntityForm })));
const FieldList = lazy(() => import('@/pages/Metadata/FieldList').then(m => ({ default: m.FieldList })));
const IndustryTemplateList = lazy(() => import('@/pages/Metadata/IndustryTemplateList').then(m => ({ default: m.IndustryTemplateList })));
const IndustryTemplateForm = lazy(() => import('@/pages/Metadata/IndustryTemplateForm').then(m => ({ default: m.IndustryTemplateForm })));
const LayoutList = lazy(() => import('@/pages/Metadata/LayoutList').then(m => ({ default: m.LayoutList })));
const FieldPermissionList = lazy(() => import('@/pages/Metadata/FieldPermissionList').then(m => ({ default: m.FieldPermissionList })));
const PrintPage = lazy(() => import('@/pages/Print/PrintPage').then(m => ({ default: m.PrintPage })));
const PrintSettings = lazy(() => import('@/pages/Print/PrintSettings').then(m => ({ default: m.PrintSettings })));

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * 路径 → 权限码 映射（与 Sidebar 菜单权限一致）。
 * 统一以 `/*` 结尾：base 路径精确匹配或以其为前缀的路径均命中（最长前缀优先）。
 * 路由级守卫用于防止"直接输入 URL 绕过菜单"访问无权限页面。
 */
const ROUTE_PERMISSIONS: { path: string; permission: string }[] = [
  { path: '/dashboard/*', permission: 'dashboard' },
  { path: '/products/*', permission: 'product_list' },
  { path: '/spus/*', permission: 'spu_list' },
  { path: '/combo-products/*', permission: 'product_list' },
  { path: '/price-lists/*', permission: 'product_list' },
  { path: '/category/product/*', permission: 'product_list' },
  { path: '/category/customer/*', permission: 'customer_list' },
  { path: '/category/supplier/*', permission: 'supplier_list' },
  { path: '/units/*', permission: 'product_list' },
  { path: '/customers/*', permission: 'customer_list' },
  { path: '/suppliers/*', permission: 'supplier_list' },
  { path: '/hr/employees/*', permission: 'employee' },
  { path: '/hr/contracts/*', permission: 'labor_contract' },
  { path: '/hr/attendance/*', permission: 'attendance' },
  { path: '/hr/changes/*', permission: 'employee_change' },
  { path: '/hr/recruitment/*', permission: 'recruitment' },
  { path: '/hr/training/*', permission: 'training' },
  { path: '/hr/performance/*', permission: 'perf' },
  { path: '/hr/piecework/*', permission: 'piecework' },
  { path: '/hr/reports/*', permission: 'hr_report' },
  { path: '/sales-orders/*', permission: 'sales_order_list' },
  { path: '/sales-returns/*', permission: 'sales_return' },
  { path: '/sales-quotations/*', permission: 'sales_quotation' },
  // [2026-09-14 三方对齐] 门户管理后端挂 customer_edit（客户门户域）
  { path: '/portal/manage/*', permission: 'customer_edit' },
  { path: '/purchase-orders/*', permission: 'purchase_order_list' },
  { path: '/purchase-contracts/*', permission: 'purchase_contract' },
  { path: '/purchase-reconciliations/*', permission: 'purchase_reconciliation' },
  { path: '/sales-contracts/*', permission: 'sales_contract' },
  { path: '/purchase-returns/*', permission: 'purchase_return' },
  { path: '/purchase-requisitions/*', permission: 'purchase_requisition' },
  { path: '/purchase-rfqs/*', permission: 'purchase_rfq' },
  { path: '/warehouses/*', permission: 'warehouse' },
  { path: '/inventory/locations/*', permission: 'location' },
  { path: '/inventory/racks/*', permission: 'rack' },
  { path: '/inventory/balance/*', permission: 'inventory_view' },
  { path: '/inventory/movement/*', permission: 'inventory_view' },
  { path: '/inventory/check/*', permission: 'inventory_check' },
  { path: '/inventory/transfer/*', permission: 'stock_transfer' },
  { path: '/inventory/adjust/*', permission: 'stock_adjust' },
  { path: '/inventory/loans/*', permission: 'loan_order' },
  { path: '/inventory/consignments/*', permission: 'consignment' },
  { path: '/stock-in/*', permission: 'stock_in' },
  { path: '/stock-out/*', permission: 'stock_out' },
  { path: '/finance/receivables/*', permission: 'receivable' },
  { path: '/finance/payables/*', permission: 'payable' },
  { path: '/finance/invoices/*', permission: 'receivable' },
  { path: '/finance/periods/*', permission: 'accounting_period' },
  { path: '/finance/tax-accruals/*', permission: 'tax_accrual' },
  { path: '/production/equipments/*', permission: 'equipment' },
  { path: '/production/toolings/*', permission: 'tooling' },
  { path: '/production/teams/*', permission: 'team' },
  { path: '/production/documents/*', permission: 'document' },
  { path: '/finance/tax-report/*', permission: 'finance_report' },
  { path: '/finance/shareholders/*', permission: 'shareholder' },
  { path: '/finance/voucher-templates/*', permission: 'voucher_template' },
  { path: '/finance/account-mappings/*', permission: 'account_mapping' },
  { path: '/finance/aging/*', permission: 'finance_report' },
  { path: '/finance/statement/*', permission: 'finance_report' },
  { path: '/finance/expenses/*', permission: 'expense' },
  { path: '/finance/assets/*', permission: 'fixed_asset' },
  { path: '/finance/bank/*', permission: 'bank_reconciliation' },
  { path: '/finance/currencies/*', permission: 'currency' },
  { path: '/finance/payrolls/*', permission: 'payroll' },
  { path: '/finance/payment-plans/*', permission: 'payment_plan' },
  { path: '/sales/leads/*', permission: 'customer' },
  { path: '/crm/*', permission: 'crm' },
  { path: '/finance/receipts/*', permission: 'receipt' },
  { path: '/finance/payments/*', permission: 'payment' },
  { path: '/finance/vouchers/*', permission: 'voucher' },
  { path: '/finance/accounts/*', permission: 'account' },
  { path: '/reports/sales/*', permission: 'sales_report' },
  { path: '/reports/sales-forecast/*', permission: 'sales_report' },
  // [2026-09-18 权限细化·第3批] 佣金结算页=销售佣金域（独立四件套）
  { path: '/reports/sales-commission/*', permission: 'sales_commission' },
  { path: '/reports/purchase/*', permission: 'purchase_report' },
  { path: '/reports/inventory/*', permission: 'inventory_report' },
  { path: '/reports/trade/*', permission: 'sales_report' },
  { path: '/reports/finance/*', permission: 'finance_report' },
  { path: '/reports/custom/*', permission: 'custom_report' },
  { path: '/system/users/*', permission: 'user' },
  { path: '/system/roles/*', permission: 'role' },
  { path: '/system/permissions/*', permission: 'permission' },
  // [2026-09-18 权限细化·第4批] 系统面逐对象查看码（旧码 system 伞已拆分）
  { path: '/system/audit-logs/*', permission: 'audit_log' },
  { path: '/system/approval-flows/*', permission: 'approval_flow' },
  // 我的审批：审批人可为普通用户（非管理员），路由不设权限（与后端 approval-records 仅认证一致）
  { path: '/system/settings/*', permission: 'setting' },
  // 公司管理（多公司部署控制台，2026-09-17）：仅默认公司 super_admin 可操作（页面内再收敛）
  { path: '/system/companies/*', permission: 'system' },
  { path: '/system/numbering/*', permission: 'numbering' },
  { path: '/system/departments/*', permission: 'department' },
  { path: '/system/print-settings/*', permission: 'print_template' },
  { path: '/system/dict/*', permission: 'dict' },
  // [2026-09-14 三方一致性] 补菜单项缺失的守卫：数据备份 / 授权激活（此前直链可绕过）
  { path: '/system/backups/*', permission: 'backup' },
  { path: '/system/license/*', permission: 'license' },
  { path: '/production/work-orders/*', permission: 'work_order' },
  { path: '/production/work-reports/*', permission: 'production_report' },
  { path: '/assemblies/*', permission: 'assembly' },
  { path: '/production/work-order-board/*', permission: 'work_order' },
  { path: '/production/rework-orders/*', permission: 'rework_order' },
  { path: '/production/subcontract/*', permission: 'subcontract' },
  { path: '/production/serial-numbers/*', permission: 'serial_number' },
  { path: '/production/mps/*', permission: 'mps' },
  { path: '/production/bom/*', permission: 'bom' },
  { path: '/production/routing/*', permission: 'routing' },
  { path: '/production/work-centers/*', permission: 'work_center' },
  { path: '/production/capacity-load/*', permission: 'work_center' },
  { path: '/production/pickings/*', permission: 'picking' },
  { path: '/production/receipts/*', permission: 'production_receipt' },
  { path: '/production/settings/*', permission: 'setting' },
  { path: '/production-returns/*', permission: 'production_return' },
  { path: '/mrp/*', permission: 'mrp' },
  { path: '/purchase-suggestions/*', permission: 'mrp' },
  // [2026-09-18 权限细化·第4批] 元数据管理独立码（实体/字段/布局/模板/字段权限/动态数据）
  { path: '/metadata/*', permission: 'metadata' },
  { path: '/metadata-data/*', permission: 'metadata' },
  // 打印页守卫（P1 修复）：此前 /print/* 不在 ROUTE_PERMISSIONS，任意已登录用户可打印/查看任意单据；
  // 映射 dashboard（所有业务角色默认拥有的基础权限），挡住零权限账号且不破坏正常打印。
  { path: '/print/*', permission: 'dashboard' },
];

function getRoutePermission(pathname: string): string | undefined {
  let bestLen = -1;
  let permission: string | undefined;
  for (const { path, permission: perm } of ROUTE_PERMISSIONS) {
    const base = path.replace(/\/\*$/, '');
    const matched = pathname === base || pathname.startsWith(base + '/');
    if (matched && base.length > bestLen) {
      bestLen = base.length;
      permission = perm;
    }
  }
  return permission;
}

function Forbidden({ permission }: { permission: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-[70vh] px-6">
      <div className="text-6xl mb-4">🔒</div>
      <h2 className="text-xl font-semibold mb-2">无权访问</h2>
      <p className="text-gray-500 mb-6 text-center">
        您没有访问该页面的权限
        <span className="ml-2 text-xs bg-gray-100 px-2 py-0.5 rounded">需要权限：{permission}</span>
      </p>
      <button
        onClick={() => navigate('/dashboard')}
        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm transition-colors"
      >
        返回仪表盘
      </button>
    </div>
  );
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, permissions } = useAuthStore();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  // 路由级 RBAC：按当前路径匹配所需权限，无权限显示 403 页（super_admin "*" 全放行）
  const permission = getRoutePermission(location.pathname);
  if (permission && !permissions.includes('*') && !permissions.includes(permission)) {
    return <Forbidden permission={permission} />;
  }
  return children;
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* 客户自助门户（独立布局，客户 token 认证） */}
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal" element={<PortalShop />} />
      
      <Route 
        path="/" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <Dashboard />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/products" 
        element={
          <ProtectedRoute>
            <Layout>
              <ProductList key="products-list" />
            </Layout>
          </ProtectedRoute>
        } 
      />

      {/* [2026-09-16] 下架商品管理：默认只显停用商品，可恢复启用/删除（静态段须在 /products/:id 之前）；
          key 强制区分实例：否则从列表进入时 React 复用组件、status 状态残留为「启用」 */}
      <Route 
        path="/products/archived" 
        element={
          <ProtectedRoute>
            <Layout>
              <ProductList key="products-archived" archived />
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/products/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <ProductForm />
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/products/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <ProductForm />
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/products/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <ProductForm />
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/spus" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SpuList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/combo-products" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ComboList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/combo-products/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ComboForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/combo-products/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ComboForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/category/:domain" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CategoryList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/category/:domain/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CategoryForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/category/:domain/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CategoryForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/units" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <UnitList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/units/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <UnitForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/units/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <UnitForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/price-lists" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PriceListList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/price-lists/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PriceListForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/price-lists/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PriceListForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/customers" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CustomerList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/customers/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CustomerForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/customers/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CustomerForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/suppliers" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SupplierList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/suppliers/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SupplierForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/suppliers/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SupplierForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/hr/employees" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <EmployeeList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/hr/contracts" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <HrContractList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/hr/attendance" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AttendanceList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/hr/changes" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <EmployeeChangeList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/hr/recruitment" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <RecruitmentList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/hr/training" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <TrainingList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/hr/performance" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PerformanceList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/hr/piecework" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PieceworkList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/hr/reports" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <HrReportList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-orders" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesOrderList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-orders/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesOrderForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-orders/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesOrderForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/portal/manage" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PortalManage />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-returns" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesReturnList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-returns/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesReturnForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-returns/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesReturnForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-quotations" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesQuotationList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-orders" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseOrderList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-orders/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseOrderForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-orders/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseOrderForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-contracts" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ContractList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-contracts/new" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ContractForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-reconciliations" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseReconciliationList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/crm" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CrmList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-contracts/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ContractForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-contracts" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesContractList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-contracts/new" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesContractForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales-contracts/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesContractForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-returns" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseReturnList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-returns/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseReturnForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-returns/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseReturnForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-requisitions" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseRequisitionList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-rfqs" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseRFQList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-rfqs/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseRFQForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-rfqs/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseRFQForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/warehouses" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WarehouseList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/warehouses/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WarehouseForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/warehouses/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WarehouseForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/balance" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <InventoryBalance />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/movement" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <InventoryMovement />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/check" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <InventoryCheck />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/check/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <InventoryCheckForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/check/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <InventoryCheckForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/locations" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <LocationList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/racks" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <RackList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/transfer" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockTransfer />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/transfer/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockTransferForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/transfer/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockTransferForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/adjust" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockAdjustList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/adjust/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockAdjustForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/adjust/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockAdjustForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/loans" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <LoanList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/loans/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <LoanForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/loans/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <LoanForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/consignments" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ConsignmentList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/consignments/new" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ConsignmentForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/inventory/consignments/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ConsignmentForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/stock-in" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockInList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/stock-in/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockInForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/stock-in/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockInForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/stock-out" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockOutList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/stock-out/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockOutForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/stock-out/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <StockOutForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/receivables" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReceivableList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/receivables/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReceivableForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/receivables/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReceivableForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payables" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PayableList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payables/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PayableForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payables/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PayableForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/vouchers" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <VoucherList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/vouchers/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <VoucherForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/vouchers/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <VoucherForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/accounts" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AccountList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/accounts/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AccountForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/accounts/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AccountForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/invoices" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <InvoiceManage />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/periods" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AccountingPeriods />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/tax-accruals" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <TaxAccrualPage />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/tax-report" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <TaxReport />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/shareholders" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ShareholderList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/voucher-templates" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <VoucherTemplateList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/account-mappings" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AccountMappingList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/aging" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AgingAnalysis />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/statement" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <Statement />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/expenses" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ExpenseClaims />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/assets" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <FixedAssets />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/bank" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <BankReconciliation />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/currencies" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CurrencyList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payrolls" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PayrollList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payment-plans" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PaymentPlanList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payment-plans/new" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PaymentPlanForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payment-plans/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PaymentPlanForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/sales/leads" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <LeadList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/receipts" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReceiptList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/receipts/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReceiptForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/receipts/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReceiptForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payments" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PaymentList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payments/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PaymentForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/finance/payments/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PaymentForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/reports/sales" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesReport />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/reports/sales-forecast" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesForecast />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/reports/sales-commission" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SalesCommission />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/reports/purchase" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseReport />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/reports/inventory" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <InventoryReport />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/reports/trade" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <TradeReport />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/reports/finance" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <FinanceReport />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/reports/custom" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CustomReportList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/users" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <UserList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/users/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <UserForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/users/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <UserForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/roles" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <RoleList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/roles/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <RoleForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/roles/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <RoleForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/permissions" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PermissionList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/permissions/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PermissionForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/permissions/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PermissionForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/notifications" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <NotificationCenter />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/audit-logs" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AuditLogList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/approval-flows" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ApprovalFlowList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/approval-tasks" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ApprovalTasks />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/departments" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <DepartmentList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/settings" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CompanySettings />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/companies" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CompanyManage />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/numbering" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <NumberingRules />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/print-settings" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PrintSettings />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/backups" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <BackupList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/license" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <LicenseActivation />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/system/dict" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <DictList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/profile" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ProfilePage />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata-data" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <DynamicDataList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/work-orders" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WorkOrderList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/assemblies" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AssemblyList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/work-reports" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WorkReportList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/assemblies/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AssemblyForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/assemblies/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <AssemblyForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/work-order-board" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WorkOrderBoard />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/equipments" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <EquipmentList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/toolings" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ToolingList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/teams" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ProductionTeamList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/documents" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ProductDocumentList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/rework-orders" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReworkOrderList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/subcontract" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SubcontractList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/serial-numbers" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <SerialNumberList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/mps" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <MpsPlan />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/rework-orders/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReworkOrderForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/rework-orders/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReworkOrderForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/rework-orders/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ReworkOrderForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/work-orders/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WorkOrderForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/work-orders/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WorkOrderForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/bom" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <BomList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/bom/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <BomForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/bom/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <BomForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/bom/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <BomForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/routing" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <RoutingList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/routing/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <RoutingForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/routing/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <RoutingForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/routing/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <RoutingForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/work-centers" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WorkCenterList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/work-centers/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WorkCenterForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/work-centers/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <WorkCenterForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/capacity-load" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <CapacityLoad />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production/pickings" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ProductionPickingPage />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/production/receipts" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ProductionReceiptPage />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/production/settings" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ProductionSettingsPage />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production-returns" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ProductionReturnList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production-returns/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ProductionReturnForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/production-returns/:id" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <ProductionReturnForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/mrp" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <MrpPlan />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/purchase-suggestions" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <PurchaseSuggestionList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata/templates" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <IndustryTemplateList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata/templates/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <IndustryTemplateForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata/templates/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <IndustryTemplateForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata/entities" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <EntityList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata/entities/create" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <EntityForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata/entities/:id/edit" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <EntityForm />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/print/:type/:id?" 
        element={
          <ProtectedRoute>
            <Suspense fallback={<Loading />}>
              <PrintPage />
            </Suspense>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata/layouts" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <LayoutList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata/field-permissions" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <FieldPermissionList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/metadata/fields/:entityId" 
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <FieldList />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } 
      />

      {/* 404 兜底（易用性修复：此前静默重定向仪表盘，用户不知道发生了什么） */}
      <Route
        path="*"
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<Loading />}>
                <NotFound />
              </Suspense>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
