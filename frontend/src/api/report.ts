import { format } from '@/utils/format';
import { http } from '@/utils/request';
import { PaginationParams, PaginationResult } from '@/types';

export interface DashboardData {
  total_sales_amount: number;
  total_purchase_amount: number;
  total_stock_value: number;
  open_sales_orders: number;
  open_purchase_orders: number;
  low_stock_count: number;
  today_sales_amount: number;
  today_purchase_amount: number;
  // v2 老板经营指标
  ar_balance: number;
  ap_balance: number;
  monthly_revenue: number;
  monthly_cost: number;
  monthly_expense: number;
  monthly_profit: number;
  low_stock_items?: { product_code: string; product_name: string; warehouse_name: string; qty_available: number; safety_stock: number; shortage_qty: number }[];
  pending_approvals?: { id: string; biz_type: string; biz_no: string; initiator_name: string; current_step: number; created_at: string }[];
  top_products?: { product_code: string; product_name: string; total_qty: number; total_amount: number }[];
  receivable_aging?: { label: string; amount: number }[];
  // C-1 待办工作台
  draft_sales_orders?: number;
  draft_purchase_orders?: number;
  overdue_receivable?: number;
  overdue_payable?: number;
  sales_trend: { date: string; amount: number }[];
  purchase_trend: { date: string; amount: number }[];
}

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  category: string;
  begin_balance: number;
  debit_amount: number;
  credit_amount: number;
  end_balance: number;
  end_direction: string;
}

export interface GeneralLedgerRow {
  entry_date: string;
  voucher_no: string;
  remark: string;
  direction: string;
  amount: number;
  balance: number;
}

export interface CashFlowResult {
  items: { category: string; label: string; inflow: number; outflow: number; net: number }[];
  net_increase: number;
}

export interface SalesByProductResult {
  product_id: string;
  product_code: string;
  product_name: string;
  total_qty: number;
  total_amount: number;
  order_count: number;
}

export interface SalesByCustomerResult {
  customer_id: string;
  customer_name: string;
  total_amount: number;
  order_count: number;
  avg_amount: number;
}

export interface PurchaseByProductResult {
  product_id: string;
  product_code: string;
  product_name: string;
  total_qty: number;
  total_amount: number;
  order_count: number;
}

export interface PurchaseBySupplierResult {
  supplier_id: string;
  supplier_name: string;
  total_amount: number;
  order_count: number;
  avg_amount: number;
}

export interface ProfitLossResult {
  revenue: number;
  cost: number;
  gross_profit: number;
  net_profit: number;
  profit_rate: number;
}

export interface BalanceSheetResult {
  assets: number;
  liabilities: number;
  equity: number;
  /** 未结转损益（收入−成本费用净额），已计入 equity；做期末损益结转后为 0 */
  unclosed_profit?: number;
}

export interface ReportParams {
  start_date?: string;
  end_date?: string;
  product_id?: string;
  customer_id?: string;
  supplier_id?: string;
  warehouse_id?: string;
}

// ---- 进销存分析报表类型（P2 增值）----
export interface ProfitAnalysisResult {
  product_id: string;
  product_code: string;
  product_name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin_rate: number;
}

export interface StockAgeBucket {
  name: string;
  qty: number;
  amount: number;
}

export interface StockAgeResult {
  product_id: string;
  product_code: string;
  product_name: string;
  total_qty: number;
  total_amount: number;
  max_age_days: number;
  buckets: StockAgeBucket[];
}

export interface StockABCResult {
  product_id: string;
  product_code: string;
  product_name: string;
  qty: number;
  amount: number;
  cum_percent: number;
  class: string;
}

export interface PurchasePriceTrendPoint {
  period: string;
  avg_price: number;
  min_price: number;
  max_price: number;
  total_qty: number;
  order_count: number;
}

export interface PurchasePriceTrendResult {
  product_id: string;
  product_code: string;
  product_name: string;
  points: PurchasePriceTrendPoint[];
}

// ---- 销售预测（P2 增值）----

export interface ForecastPoint {
  month: string;
  actual: number;
  forecast: number;
  is_forecast: boolean;
}

export interface SalesForecastResult {
  product_id: string;
  product_code: string;
  product_name: string;
  method: string;
  method_name: string;
  periods: number;
  lookback: number;
  total_forecast: number;
  avg_monthly: number;
  points: ForecastPoint[];
}

export const reportApi = {
  dashboard: async () => {
    return http.get<DashboardData>('/v1/reports/dashboard');
  },

  salesByProduct: async (params?: ReportParams) => {
    return http.get<SalesByProductResult[]>('/v1/reports/sales/by-product', params);
  },

  salesByCustomer: async (params?: ReportParams) => {
    return http.get<SalesByCustomerResult[]>('/v1/reports/sales/by-customer', params);
  },

  salesTrend: async (params?: ReportParams & { period?: string }) => {
    return http.get<{ date: string; amount: number }[]>('/v1/reports/sales/trend', params);
  },

  purchaseByProduct: async (params?: ReportParams) => {
    return http.get<PurchaseByProductResult[]>('/v1/reports/purchase/by-product', params);
  },

  purchaseBySupplier: async (params?: ReportParams) => {
    return http.get<PurchaseBySupplierResult[]>('/v1/reports/purchase/by-supplier', params);
  },

  purchaseTrend: async (params?: ReportParams & { period?: string }) => {
    return http.get<{ date: string; amount: number }[]>('/v1/reports/purchase/trend', params);
  },

  inventoryBalance: async (params?: ReportParams) => {
    return http.get<{ product_id: string; product_code: string; product_name: string; warehouse_id: string; warehouse_name: string; batch_no: string; qty_available: number; qty_locked: number; total_value: number; avg_cost: number }[]>('/v1/reports/inventory/balance', params);
  },

  inventoryTurnover: async (params?: ReportParams) => {
    return http.get<{ product_id: string; product_code: string; product_name: string; warehouse_name: string; out_qty: number; avg_stock: number; turnover: number; turnover_days: number; last_out_at: string | null }[]>('/v1/reports/inventory/turnover', params);
  },

  dormantStock: async (params?: { days?: number }) => {
    return http.get<{ product_id: string; product_code: string; product_name: string; warehouse_name: string; qty_available: number; avg_cost: number; total_value: number; last_movement_at: string | null; dormant_days: number }[]>('/v1/reports/inventory/dormant', params);
  },

  expiryAlert: async (params?: { days?: number }) => {
    return http.get<{ product_id: string; product_code: string; product_name: string; warehouse_name: string; batch_no: string; qty_available: number; expiry_date: string | null; days_left: number; status: string }[]>('/v1/reports/inventory/expiry-alert', params);
  },

  reorderSuggestions: async () => {
    return http.get<{ product_id: string; product_code: string; product_name: string; safety_stock: number; available: number; on_order: number; committed: number; suggested_qty: number }[]>('/v1/reports/inventory/reorder-suggestions');
  },

  // B-1 订单履行率/逾期报表
  overdueOrderLines: async (params?: { days?: number }) => {
    return http.get<{ order_id: string; order_no: string; order_type: string; party_name: string; product_id: string; product_code: string; product_name: string; spec: string; qty: number; delivered_qty: number; remaining_qty: number; price: number; order_date: string | null; expected_date: string | null; overdue_days: number; status: string }[]>('/v1/reports/trade/fulfillment', params);
  },

  customerFulfillment: async () => {
    return http.get<{ customer_id: string; customer_name: string; order_count: number; total_qty: number; delivered_qty: number; fulfillment_rate: number; overdue_order_count: number; overdue_amount: number }[]>('/v1/reports/trade/fulfillment-summary');
  },

  profitLoss: async (params?: ReportParams) => {
    return http.get<ProfitLossResult>('/v1/reports/finance/profit-loss', params);
  },

  balanceSheet: async (params?: ReportParams) => {
    return http.get<BalanceSheetResult>('/v1/reports/finance/balance-sheet', params);
  },

  trialBalance: async (params?: ReportParams) => {
    return http.get<{ rows: TrialBalanceRow[]; total_debit: number; total_credit: number }>('/v1/reports/finance/trial-balance', params);
  },

  generalLedger: async (params?: ReportParams & { account_code?: string }) => {
    return http.get<GeneralLedgerRow[]>('/v1/reports/finance/general-ledger', params);
  },

  cashFlow: async (params?: ReportParams) => {
    return http.get<CashFlowResult>('/v1/reports/finance/cash-flow', params);
  },

  // ---- 进销存分析（P2 增值）----

  /** 毛利分析（按商品）：收入-成本=毛利 */
  profitByProduct: async (params?: ReportParams) => {
    return http.get<ProfitAnalysisResult[]>('/v1/reports/sales/profit', params);
  },

  /** 毛利汇总 */
  profitSummary: async (params?: ReportParams) => {
    return http.get<{ total_revenue: number; total_cost: number; total_profit: number; margin_rate: number; product_count: number }>('/v1/reports/sales/profit-summary', params);
  },

  /** 销售预测（历史销量外推未来 N 期） */
  salesForecast: async (params?: { product_id?: string; periods?: number; method?: string; lookback?: number }) => {
    return http.get<SalesForecastResult[]>('/v1/reports/sales/forecast', params);
  },

  /** 库龄分布（按商品分桶） */
  stockAge: async () => {
    return http.get<StockAgeResult[]>('/v1/reports/inventory/age');
  },

  /** 库存 ABC 分类 */
  stockABC: async () => {
    return http.get<StockABCResult[]>('/v1/reports/inventory/abc');
  },

  /** 采购价格趋势（按商品+月） */
  purchasePriceTrend: async (params?: ReportParams & { product_id?: string }) => {
    return http.get<PurchasePriceTrendResult[]>('/v1/reports/purchase/price-trend', params);
  },

  // ---- 对账函（P2 单据功能）----

  /** 客户对账单 */
  customerStatement: async (params?: { customer_id?: string; start_date?: string; end_date?: string }) => {
    return http.get<CustomerStatementResult[]>('/v1/reports/finance/statement/customer', params);
  },

  /** 供应商对账单 */
  supplierStatement: async (params?: { supplier_id?: string; start_date?: string; end_date?: string }) => {
    return http.get<SupplierStatementResult[]>('/v1/reports/finance/statement/supplier', params);
  },
};

export interface StatementLine {
  date: string;
  no: string;
  source_no: string;
  type: string; // invoice 应收/应付 / receipt 收款 / payment 付款
  amount: number;
  balance: number;
}

export interface CustomerStatementResult {
  customer_id: string;
  customer_name: string;
  begin_balance: number;
  end_balance: number;
  period_in: number;
  period_out: number;
  lines: StatementLine[];
}

export interface SupplierStatementResult {
  supplier_id: string;
  supplier_name: string;
  begin_balance: number;
  end_balance: number;
  period_in: number;
  period_out: number;
  lines: StatementLine[];
}

export interface ExportReportParams extends ReportParams {
  account_code?: string;
  aging_type?: string;
}

// 报表导出 CSV（触发浏览器下载）
export const exportReport = async (type: string, params?: ExportReportParams) => {
  const blob = await http.download('/v1/reports/export', { ...params, type });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}_${format.today()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

export interface CustomReportDefinition {
  id: string;
  report_code: string;
  report_name: string;
  category?: string;
  query_sql: string;
  columns?: { name?: string; label?: string; type?: string }[];
  status?: string;
  remark?: string;
  created_at?: string;
}

export interface CustomReportRunResult {
  columns: string[];
  labels: string[];
  rows: (string | number | null)[][];
  total: number;
}

// 自定义报表（SQL 配置化）
export const customReportApi = {
  list: async (params?: PaginationParams & { keyword?: string; category?: string; status?: string }) => {
    return http.get<PaginationResult<CustomReportDefinition>>('/v1/custom-reports', params);
  },
  get: async (id: string) => {
    return http.get<CustomReportDefinition>(`/v1/custom-reports/${id}`);
  },
  create: async (data: Partial<CustomReportDefinition>) => {
    return http.post<CustomReportDefinition>('/v1/custom-reports', data);
  },
  update: async (id: string, data: Partial<CustomReportDefinition>) => {
    return http.put<CustomReportDefinition>(`/v1/custom-reports/${id}`, data);
  },
  delete: async (id: string) => {
    return http.delete(`/v1/custom-reports/${id}`);
  },
  run: async (id: string) => {
    return http.post<CustomReportRunResult>(`/v1/custom-reports/${id}/run`);
  },
  runSQL: async (query_sql: string, columns?: { name?: string; label?: string }[]) => {
    return http.post<CustomReportRunResult>('/v1/custom-reports/run-sql', { query_sql, columns });
  },
  // 导出走统一 http.download（自动携带 token / blob 拦截器），不再由页面手写 XHR
  download: async (id: string): Promise<Blob> => {
    return http.download(`/v1/custom-reports/${id}/export`);
  },
};
