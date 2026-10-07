import { http } from '@/utils/request';
import { Customer, Supplier, SalesOrder, PurchaseOrder, SalesReturn, PurchaseReturn } from '@/types/order';
import { PaginationParams, PaginationResult } from '@/types';

export const customerApi = {
  list: async (params?: PaginationParams & { name?: string; phone?: string; status?: string; category_id?: string }) => {
    return http.get<PaginationResult<Customer>>('/v1/customers', params);
  },

  get: async (id: string) => {
    return http.get<Customer>(`/v1/customers/${id}`);
  },

  create: async (data: Partial<Customer>) => {
    return http.post<Customer>('/v1/customers', data);
  },

  update: async (id: string, data: Partial<Customer>) => {
    return http.put<Customer>(`/v1/customers/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/customers/${id}`);
  },
};

export const supplierApi = {
  list: async (params?: PaginationParams & { name?: string; phone?: string; status?: string; category_id?: string }) => {
    return http.get<PaginationResult<Supplier>>('/v1/suppliers', params);
  },

  get: async (id: string) => {
    return http.get<Supplier>(`/v1/suppliers/${id}`);
  },

  create: async (data: Partial<Supplier>) => {
    return http.post<Supplier>('/v1/suppliers', data);
  },

  update: async (id: string, data: Partial<Supplier>) => {
    return http.put<Supplier>(`/v1/suppliers/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/suppliers/${id}`);
  },
};

export const salesOrderApi = {
  list: async (params?: PaginationParams & { status?: string; order_no?: string }) => {
    return http.get<PaginationResult<SalesOrder>>('/v1/sales-orders', params);
  },

  get: async (id: string) => {
    return http.get<SalesOrder>(`/v1/sales-orders/${id}`);
  },

  create: async (data: Partial<SalesOrder>) => {
    return http.post<SalesOrder>('/v1/sales-orders', data);
  },

  update: async (id: string, data: Partial<SalesOrder>) => {
    return http.put<SalesOrder>(`/v1/sales-orders/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/sales-orders/${id}`);
  },

  /** 变更已确认/审批的销售订单（P1-2，记录变更历史，需填变更原因） */
  change: async (id: string, data: Partial<SalesOrder> & { reason: string }) => {
    return http.post<SalesOrder>(`/v1/sales-orders/${id}/change`, data);
  },

  /** 销售订单变更历史 */
  changes: async (id: string) => {
    return http.get<any[]>(`/v1/sales-orders/${id}/changes`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/sales-orders/${id}/confirm`);
  },

  approve: async (id: string) => {
    return http.post(`/v1/sales-orders/${id}/approve`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/sales-orders/${id}/cancel`);
  },

  close: async (id: string) => {
    return http.post(`/v1/sales-orders/${id}/close`);
  },

  /** 客户全流程：标记开始备货（客户门户可见"备货中"） */
  preparing: async (id: string) => {
    return http.post(`/v1/sales-orders/${id}/preparing`);
  },

  /** 客户全流程：填写物流单号（预留未来对接物流查询） */
  tracking: async (id: string, trackingNo: string) => {
    return http.post(`/v1/sales-orders/${id}/tracking`, { tracking_no: trackingNo });
  },
};

export const purchaseOrderApi = {
  list: async (params?: PaginationParams & { status?: string; order_no?: string }) => {
    return http.get<PaginationResult<PurchaseOrder>>('/v1/purchase-orders', params);
  },

  get: async (id: string) => {
    return http.get<PurchaseOrder>(`/v1/purchase-orders/${id}`);
  },

  create: async (data: Partial<PurchaseOrder>) => {
    return http.post<PurchaseOrder>('/v1/purchase-orders', data);
  },

  update: async (id: string, data: Partial<PurchaseOrder>) => {
    return http.put<PurchaseOrder>(`/v1/purchase-orders/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/purchase-orders/${id}`);
  },

  /** 变更已确认/审批的采购订单（P1-2，记录变更历史，需填变更原因） */
  change: async (id: string, data: Partial<PurchaseOrder> & { reason: string }) => {
    return http.post<PurchaseOrder>(`/v1/purchase-orders/${id}/change`, data);
  },

  /** 采购订单变更历史 */
  changes: async (id: string) => {
    return http.get<any[]>(`/v1/purchase-orders/${id}/changes`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/purchase-orders/${id}/confirm`);
  },

  approve: async (id: string) => {
    return http.post(`/v1/purchase-orders/${id}/approve`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/purchase-orders/${id}/cancel`);
  },

  close: async (id: string) => {
    return http.post(`/v1/purchase-orders/${id}/close`);
  },
};

export const salesReturnApi = {
  list: async (params?: PaginationParams & { order_no?: string }) => {
    return http.get<PaginationResult<SalesReturn>>('/v1/sales-returns', params);
  },

  get: async (id: string) => {
    return http.get<SalesReturn>(`/v1/sales-returns/${id}`);
  },

  create: async (data: Partial<SalesReturn>) => {
    return http.post<SalesReturn>('/v1/sales-returns', data);
  },

  update: async (id: string, data: Partial<SalesReturn>) => {
    return http.put<SalesReturn>(`/v1/sales-returns/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/sales-returns/${id}`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/sales-returns/${id}/confirm`);
  },

  approve: async (id: string) => {
    return http.post(`/v1/sales-returns/${id}/approve`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/sales-returns/${id}/cancel`);
  },
};

export const purchaseReturnApi = {
  list: async (params?: PaginationParams & { order_no?: string }) => {
    return http.get<PaginationResult<PurchaseReturn>>('/v1/purchase-returns', params);
  },

  get: async (id: string) => {
    return http.get<PurchaseReturn>(`/v1/purchase-returns/${id}`);
  },

  create: async (data: Partial<PurchaseReturn>) => {
    return http.post<PurchaseReturn>('/v1/purchase-returns', data);
  },

  update: async (id: string, data: Partial<PurchaseReturn>) => {
    return http.put<PurchaseReturn>(`/v1/purchase-returns/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/purchase-returns/${id}`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/purchase-returns/${id}/confirm`);
  },

  approve: async (id: string) => {
    return http.post(`/v1/purchase-returns/${id}/approve`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/purchase-returns/${id}/cancel`);
  },
};

export const requisitionApi = {
  list: async (params?: PaginationParams & { status?: string; department?: string; requisition_no?: string }) => {
    return http.get<PaginationResult<any>>('/v1/purchase-requisitions', params);
  },

  get: async (id: string) => {
    return http.get<any>(`/v1/purchase-requisitions/${id}`);
  },

  create: async (data: Partial<any>) => {
    return http.post<any>('/v1/purchase-requisitions', data);
  },

  update: async (id: string, data: Partial<any>) => {
    return http.put<any>(`/v1/purchase-requisitions/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/purchase-requisitions/${id}`);
  },

  submit: async (id: string) => {
    return http.post(`/v1/purchase-requisitions/${id}/submit`);
  },

  approve: async (id: string) => {
    return http.post(`/v1/purchase-requisitions/${id}/approve`);
  },

  reject: async (id: string) => {
    return http.post(`/v1/purchase-requisitions/${id}/reject`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/purchase-requisitions/${id}/cancel`);
  },

  convert: async (id: string) => {
    return http.post<any>(`/v1/purchase-requisitions/${id}/convert`);
  },
};

export const rfqApi = {
  list: async (params?: PaginationParams & { status?: string; rfq_no?: string }) => {
    return http.get<PaginationResult<any>>('/v1/purchase-rfqs', params);
  },

  get: async (id: string) => {
    return http.get<any>(`/v1/purchase-rfqs/${id}`);
  },

  create: async (data: Partial<any>) => {
    return http.post<any>('/v1/purchase-rfqs', data);
  },

  update: async (id: string, data: Partial<any>) => {
    return http.put<any>(`/v1/purchase-rfqs/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/purchase-rfqs/${id}`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/purchase-rfqs/${id}/confirm`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/purchase-rfqs/${id}/cancel`);
  },

  convert: async (id: string, quoteId?: string) => {
    return http.post<any>(`/v1/purchase-rfqs/${id}/convert`, quoteId ? { quote_id: quoteId } : {});
  },

  // A-1 多供应商比价：供应商报价
  listQuotes: async (id: string) => {
    return http.get<any[]>(`/v1/purchase-rfqs/${id}/quotes`);
  },

  addQuote: async (id: string, data: Partial<any>) => {
    return http.post<any>(`/v1/purchase-rfqs/${id}/quotes`, data);
  },

  selectQuote: async (id: string, quoteId: string) => {
    return http.post<any>(`/v1/purchase-rfqs/${id}/quotes/${quoteId}/select`);
  },

  deleteQuote: async (id: string, quoteId: string) => {
    return http.delete(`/v1/purchase-rfqs/${id}/quotes/${quoteId}`);
  },
};

export const quotationApi = {
  list: async (params?: PaginationParams & { status?: string; quotation_no?: string }) => {
    return http.get<PaginationResult<any>>('/v1/sales-quotations', params);
  },

  get: async (id: string) => {
    return http.get<any>(`/v1/sales-quotations/${id}`);
  },

  create: async (data: Partial<any>) => {
    return http.post<any>('/v1/sales-quotations', data);
  },

  update: async (id: string, data: Partial<any>) => {
    return http.put<any>(`/v1/sales-quotations/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/sales-quotations/${id}`);
  },

  send: async (id: string) => {
    return http.post(`/v1/sales-quotations/${id}/send`);
  },

  accept: async (id: string) => {
    return http.post(`/v1/sales-quotations/${id}/accept`);
  },

  reject: async (id: string) => {
    return http.post(`/v1/sales-quotations/${id}/reject`);
  },

  expire: async (id: string) => {
    return http.post(`/v1/sales-quotations/${id}/expire`);
  },

  convert: async (id: string) => {
    return http.post<any>(`/v1/sales-quotations/${id}/convert`);
  },
};

// ===== 采购合同（P2 单据功能）=====

export interface PurchaseContract {
  id: string;
  contract_no: string;
  supplier_id?: string;
  supplier_name?: string;
  contract_date?: string;
  start_date?: string;
  end_date?: string;
  total_amount: string;
  status: string; // draft / active / completed / cancelled
  remark?: string;
  // P2 合同执行进度
  executed_amount?: string;
  order_count?: number;
  progress_rate?: string;
}

export interface CommissionSettlement {
  id: string;
  settlement_no: string;
  period: string;
  salesperson_id: string;
  salesperson_name?: string;
  amount: string;
  base: string;
  status: string; // unpaid / paid
  paid_at?: string;
  remark?: string;
}

export const contractApi = {
  list: async (params?: PaginationParams & { status?: string; contract_no?: string }) => {
    return http.get<PaginationResult<PurchaseContract>>('/v1/purchase-contracts', params);
  },
  get: async (id: string) => {
    return http.get<PurchaseContract>(`/v1/purchase-contracts/${id}`);
  },
  create: async (data: any) => {
    return http.post<PurchaseContract>('/v1/purchase-contracts', data);
  },
  update: async (id: string, data: any) => {
    return http.put<PurchaseContract>(`/v1/purchase-contracts/${id}`, data);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/purchase-contracts/${id}`);
  },
  activate: async (id: string) => {
    return http.post<PurchaseContract>(`/v1/purchase-contracts/${id}/activate`);
  },
  complete: async (id: string) => {
    return http.post<PurchaseContract>(`/v1/purchase-contracts/${id}/complete`);
  },
  cancel: async (id: string) => {
    return http.post<PurchaseContract>(`/v1/purchase-contracts/${id}/cancel`);
  },
};

// ===== 销售合同（2026-09-11，与采购合同对称）=====

export interface SalesContract {
  id: string;
  contract_no: string;
  customer_id?: string;
  customer_name?: string;
  customer_contract_no?: string; // 客户方合同号 / 客户 PO 号
  contract_date?: string;
  start_date?: string;
  end_date?: string;
  total_amount: string;
  status: string; // draft / active / completed / cancelled
  remark?: string;
  // 执行进度
  ordered_amount?: string; // 已下单金额
  order_count?: number;
  paid_amount?: string; // 已收款金额
  progress_rate?: string; // 下单执行率 %
  receipt_rate?: string;  // 收款率 %
}

export const salesContractApi = {
  list: async (params?: PaginationParams & { status?: string; contract_no?: string; customer_id?: string }) => {
    return http.get<PaginationResult<SalesContract>>('/v1/sales-contracts', params);
  },
  get: async (id: string) => {
    return http.get<SalesContract>(`/v1/sales-contracts/${id}`);
  },
  /** 下拉选项（销售订单表单「关联合同」用；可按客户过滤，已取消合同不返回） */
  options: async (customerId?: string) => {
    return http.get<SalesContract[]>('/v1/sales-contracts/options', customerId ? { customer_id: customerId } : undefined);
  },
  create: async (data: any) => {
    return http.post<SalesContract>('/v1/sales-contracts', data);
  },
  update: async (id: string, data: any) => {
    return http.put(`/v1/sales-contracts/${id}`, data);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/sales-contracts/${id}`);
  },
  activate: async (id: string) => {
    return http.post<SalesContract>(`/v1/sales-contracts/${id}/activate`);
  },
  complete: async (id: string) => {
    return http.post<SalesContract>(`/v1/sales-contracts/${id}/complete`);
  },
  cancel: async (id: string) => {
    return http.post<SalesContract>(`/v1/sales-contracts/${id}/cancel`);
  },
};

// ===== 销售佣金（P2 单据功能）=====

export interface CommissionConfig {
  id: string;
  salesperson_id?: string;
  salesperson_name?: string;
  rate: string;
  status: string;
  remark?: string;
}

export interface CommissionResult {
  salesperson_id: string;
  salesperson_name: string;
  order_count: number;
  sales_amount: string;
  profit_amount: string;
  rate: string;
  commission: string;
  base: string;
}

export const commissionApi = {
  listConfigs: async () => {
    return http.get<CommissionConfig[]>('/v1/sales-commissions/configs');
  },
  upsertConfig: async (data: any) => {
    return http.post<CommissionConfig>('/v1/sales-commissions/configs', data);
  },
  deleteConfig: async (id: string) => {
    return http.delete(`/v1/sales-commissions/configs/${id}`);
  },
  calculate: async (params?: { base?: string; start_date?: string; end_date?: string }) => {
    return http.get<CommissionResult[]>('/v1/sales-commissions/calculate', params);
  },
  // P2 佣金结算单
  listSettlements: async (params?: { period?: string; status?: string; page?: number; page_size?: number }) => {
    return http.get<PaginationResult<CommissionSettlement>>('/v1/sales-commissions/settlements', params);
  },
  generateSettlements: async (data: { period: string; base?: string }) => {
    return http.post<{ created: number }>('/v1/sales-commissions/settlements/generate', data);
  },
  markSettlementPaid: async (id: string) => {
    return http.post<CommissionSettlement>(`/v1/sales-commissions/settlements/${id}/paid`);
  },
  deleteSettlement: async (id: string) => {
    return http.delete(`/v1/sales-commissions/settlements/${id}`);
  },
};

// ── 采购对账（2026-09-19 第六批②）：生成/差异录入/发送/确认/三单匹配 ──────────

export interface ReconLine {
  id: string;
  line_date: string;
  kind: string; // invoice 应付 / payment 付款
  source_no?: string | null;
  amount: string;
  supplier_amount?: string | null;
  remark?: string | null;
}

export interface PurchaseReconciliation {
  id: string;
  code: string;
  supplier_id: string;
  supplier_name: string;
  period_start: string;
  period_end: string;
  status: string; // draft / sent / confirmed / disputed
  begin_balance: string;
  period_in: string;
  period_out: string;
  end_balance: string;
  supplier_end_balance?: string | null;
  diff_amount?: string | null;
  sent_at?: string | null;
  confirmed_at?: string | null;
  dispute_reason?: string | null;
  remark?: string | null;
  created_at?: string;
  edges?: { lines?: ReconLine[] };
}

export const RECON_STATUS_TEXT: Record<string, string> = { draft: '草稿', sent: '已发送', confirmed: '已确认', disputed: '有差异' };
export const RECON_STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-50 text-blue-600',
  confirmed: 'bg-green-50 text-green-600',
  disputed: 'bg-amber-50 text-amber-700',
};
export const RECON_KIND_TEXT: Record<string, string> = { invoice: '应付', payment: '付款' };
export const RECON_KIND_COLOR: Record<string, string> = {
  invoice: 'bg-orange-50 text-orange-600',
  payment: 'bg-sky-50 text-sky-600',
};

export interface ReconListParams extends PaginationParams {
  keyword?: string;
  status?: string;
  supplier_id?: string;
}
export interface TripleMatchRow {
  order_id: string;
  order_no: string;
  supplier_name: string;
  order_date: string;
  order_amount: string;
  stock_in_amount: string;
  invoice_amount: string;
  flags: string[];
  stock_in_nos: string[];
}

export const purchaseReconApi = {
  list: async (params?: ReconListParams) => {
    return http.get<PaginationResult<PurchaseReconciliation>>('/v1/purchase-reconciliations', params);
  },
  get: async (id: string) => {
    return http.get<PurchaseReconciliation>('/v1/purchase-reconciliations/' + id);
  },
  generate: async (data: { supplier_id: string; period_start: string; period_end: string; remark?: string }) => {
    return http.post<PurchaseReconciliation>('/v1/purchase-reconciliations/generate', data);
  },
  updateSupplierAmounts: async (id: string, data: { lines?: { line_id: string; supplier_amount?: number | null; remark?: string }[]; supplier_end_balance?: number | null; remark?: string }) => {
    return http.put<PurchaseReconciliation>('/v1/purchase-reconciliations/' + id + '/supplier-amounts', data);
  },
  send: async (id: string) => {
    return http.post<PurchaseReconciliation>('/v1/purchase-reconciliations/' + id + '/send');
  },
  confirm: async (id: string) => {
    return http.post<PurchaseReconciliation>('/v1/purchase-reconciliations/' + id + '/confirm');
  },
  dispute: async (id: string, data: { supplier_end_balance?: number | null; reason: string }) => {
    return http.post<PurchaseReconciliation>('/v1/purchase-reconciliations/' + id + '/dispute', data);
  },
  reopen: async (id: string) => {
    return http.post<PurchaseReconciliation>('/v1/purchase-reconciliations/' + id + '/reopen');
  },
  remove: async (id: string) => {
    return http.delete('/v1/purchase-reconciliations/' + id);
  },
  tripleMatch: async (params: { start_date: string; end_date: string; supplier_id?: string }) => {
    return http.get<TripleMatchRow[]>('/v1/purchase-reconciliations/triple-match', params);
  },
};
