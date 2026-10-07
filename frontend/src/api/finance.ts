import { http } from '@/utils/request';
import {
  Account,
  Voucher,
  ARInvoice,
  APInvoice,
  PaymentReceipt,
  PaymentPayment
} from '@/types/finance';
import { PaginationParams, PaginationResult } from '@/types';

export const accountApi = {
  list: async (params?: PaginationParams) => {
    return http.get<PaginationResult<Account>>('/v1/accounts', params);
  },

  /** 全量科目（下拉/科目树页面用：默认分页只取 10 条会导致科目选项截断） */
  all: async () => {
    return http.get<PaginationResult<Account>>('/v1/accounts', { page: 1, page_size: 1000 });
  },

  tree: async () => {
    return http.get<any>('/v1/accounts/tree');
  },

  balance: async (id: string) => {
    return http.get<any>(`/v1/accounts/${id}/balance`);
  },

  get: async (id: string) => {
    return http.get<Account>(`/v1/accounts/${id}`);
  },

  create: async (data: Partial<Account>) => {
    return http.post<Account>('/v1/accounts', data);
  },

  update: async (id: string, data: Partial<Account>) => {
    return http.put<Account>(`/v1/accounts/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/accounts/${id}`);
  },
};

export const voucherApi = {
  list: async (params?: PaginationParams & { voucher_no?: string; type?: string; status?: string; start_date?: string; end_date?: string }) => {
    return http.get<PaginationResult<Voucher>>('/v1/vouchers', params);
  },

  get: async (id: string) => {
    return http.get<Voucher>(`/v1/vouchers/${id}`);
  },

  create: async (data: Partial<Voucher>) => {
    return http.post<Voucher>('/v1/vouchers', data);
  },

  update: async (id: string, data: Partial<Voucher>) => {
    return http.put<Voucher>(`/v1/vouchers/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/vouchers/${id}`);
  },

  approve: async (id: string, approverId: string) => {
    return http.post(`/v1/vouchers/${id}/approve?approver_id=${approverId}`);
  },

  post: async (id: string) => {
    return http.post(`/v1/vouchers/${id}/post`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/vouchers/${id}/cancel`);
  },
};

export const receivableApi = {
  list: async (params?: PaginationParams & { customer_id?: string; invoice_status?: string }) => {
    return http.get<PaginationResult<ARInvoice>>('/v1/ar-invoices', params);
  },

  get: async (id: string) => {
    return http.get<ARInvoice>(`/v1/ar-invoices/${id}`);
  },

  create: async (data: Partial<ARInvoice>) => {
    return http.post<ARInvoice>('/v1/ar-invoices', data);
  },

  update: async (id: string, data: Partial<ARInvoice>) => {
    return http.put<ARInvoice>(`/v1/ar-invoices/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/ar-invoices/${id}`);
  },

  issue: async (id: string, data: { sales_invoice_no: string; invoice_date?: string; tax_rate?: number; tax_amount?: number; status?: string }) => {
    return http.post<ARInvoice>(`/v1/ar-invoices/${id}/issue`, data);
  },
};

export const payableApi = {
  list: async (params?: PaginationParams & { supplier_id?: string; invoice_status?: string }) => {
    return http.get<PaginationResult<APInvoice>>('/v1/ap-invoices', params);
  },

  get: async (id: string) => {
    return http.get<APInvoice>(`/v1/ap-invoices/${id}`);
  },

  create: async (data: Partial<APInvoice>) => {
    return http.post<APInvoice>('/v1/ap-invoices', data);
  },

  update: async (id: string, data: Partial<APInvoice>) => {
    return http.put<APInvoice>(`/v1/ap-invoices/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/ap-invoices/${id}`);
  },

  issue: async (id: string, data: { purchase_invoice_no: string; invoice_date?: string; tax_rate?: number; tax_amount?: number; status?: string }) => {
    return http.post<APInvoice>(`/v1/ap-invoices/${id}/issue`, data);
  },
};

export const receiptApi = {
  list: async (params?: PaginationParams) => {
    return http.get<PaginationResult<PaymentReceipt>>('/v1/payment-receipts', params);
  },

  get: async (id: string) => {
    return http.get<PaymentReceipt>(`/v1/payment-receipts/${id}`);
  },

  create: async (data: Partial<PaymentReceipt>) => {
    return http.post<PaymentReceipt>('/v1/payment-receipts', data);
  },

  // 注：后端不支持编辑收款单（无 PUT 路由），故不提供 update；草稿需改可删除重建
  delete: async (id: string) => {
    return http.delete(`/v1/payment-receipts/${id}`);
  },

  confirm: async (id: string) => {
    return http.post<PaymentReceipt>(`/v1/payment-receipts/${id}/confirm`);
  },

  cancel: async (id: string) => {
    return http.post<PaymentReceipt>(`/v1/payment-receipts/${id}/cancel`);
  },
};

export const paymentApi = {
  list: async (params?: PaginationParams) => {
    return http.get<PaginationResult<PaymentPayment>>('/v1/payments', params);
  },

  get: async (id: string) => {
    return http.get<PaymentPayment>(`/v1/payments/${id}`);
  },

  create: async (data: Partial<PaymentPayment>) => {
    return http.post<PaymentPayment>('/v1/payments', data);
  },

  // 注：后端不支持编辑付款单（无 PUT 路由），故不提供 update；草稿需改可删除重建
  delete: async (id: string) => {
    return http.delete(`/v1/payments/${id}`);
  },

  confirm: async (id: string) => {
    return http.post<PaymentPayment>(`/v1/payments/${id}/confirm`);
  },

  cancel: async (id: string) => {
    return http.post<PaymentPayment>(`/v1/payments/${id}/cancel`);
  },
};

export const periodApi = {
  list: async (params?: PaginationParams & { period?: string; status?: string }) => {
    return http.get<PaginationResult<any>>('/v1/accounting-periods', params);
  },

  create: async (data: { period: string; start_date?: string; end_date?: string; remark?: string }) => {
    return http.post<any>('/v1/accounting-periods', data);
  },

  close: async (id: string) => {
    return http.post<any>(`/v1/accounting-periods/${id}/close`);
  },

  /** 反结账（B-06① 2026-09-14）：红冲本期结转损益凭证并解锁期间；需按期间倒序回退（更晚期间已结账时后端拒绝） */
  reopen: async (id: string) => {
    return http.post<any>(`/v1/accounting-periods/${id}/reopen`);
  },

  setOpeningBalances: async (data: { period: string; entries: { account_id: string; account_code?: string; begin_balance: number }[] }) => {
    return http.post<any>('/v1/accounting-periods/opening-balances', data);
  },
};

export const agingApi = {
  analysis: async (type: 'ar' | 'ap', asOf?: string) => {
    return http.get<any>('/v1/reports/finance/aging', { type, as_of: asOf });
  },
};

export const expenseApi = {
  list: async (params?: PaginationParams & { status?: string; claim_no?: string }) => {
    return http.get<PaginationResult<any>>('/v1/expense-claims', params);
  },
  get: async (id: string) => { return http.get<any>(`/v1/expense-claims/${id}`); },
  create: async (data: any) => {
    return http.post<any>('/v1/expense-claims', data);
  },
  submit: async (id: string) => { return http.post<any>(`/v1/expense-claims/${id}/submit`); },
  approve: async (id: string) => { return http.post<any>(`/v1/expense-claims/${id}/approve`); },
  paid: async (id: string, method?: string) => { return http.post<any>(`/v1/expense-claims/${id}/paid`, method ? { method } : undefined); },
  reject: async (id: string) => { return http.post<any>(`/v1/expense-claims/${id}/reject`); },
  cancel: async (id: string) => { return http.post<any>(`/v1/expense-claims/${id}/cancel`); },
  remove: async (id: string) => { return http.delete(`/v1/expense-claims/${id}`); },
};

export const fixedAssetApi = {
  list: async (params?: PaginationParams & { status?: string }) => {
    return http.get<PaginationResult<any>>('/v1/fixed-assets', params);
  },
  create: async (data: any) => {
    return http.post<any>('/v1/fixed-assets', data);
  },
  retire: async (id: string) => { return http.post<any>(`/v1/fixed-assets/${id}/retire`); },
  remove: async (id: string) => { return http.delete(`/v1/fixed-assets/${id}`); },
  runDepreciation: async (period: string) => {
    return http.post<any>(`/v1/fixed-assets/run-depreciation?period=${period}`);
  },
  depreciationEntries: async (period?: string) => {
    return http.get<any[]>('/v1/fixed-assets/depreciation-entries', period ? { period } : undefined);
  },
};

export const bankApi = {
  accounts: async () => { return http.get<any[]>('/v1/bank/accounts'); },
  createAccount: async (data: any) => { return http.post<any>('/v1/bank/accounts', data); },
  deleteAccount: async (id: string) => { return http.delete(`/v1/bank/accounts/${id}`); },
  statements: async (params?: PaginationParams & { account_id?: string }) => {
    return http.get<PaginationResult<any>>('/v1/bank/statements', params);
  },
  addStatement: async (data: any) => { return http.post<any>('/v1/bank/statements', data); },
  deleteStatement: async (id: string) => { return http.delete(`/v1/bank/statements/${id}`); },
  reconcile: async (accountId: string) => { return http.post<any>(`/v1/bank/reconcile?account_id=${accountId}`); },
  summary: async (accountId: string) => { return http.get<any>(`/v1/bank/reconcile-summary?account_id=${accountId}`); },
};

export const currencyApi = {
  list: async () => { return http.get<any[]>('/v1/currencies'); },
  create: async (data: any) => { return http.post<any>('/v1/currencies', data); },
  update: async (id: string, data: any) => { return http.put<any>(`/v1/currencies/${id}`, data); },
  remove: async (id: string) => { return http.delete(`/v1/currencies/${id}`); },
};

export const payrollApi = {
  list: async (params?: PaginationParams & { period?: string; status?: string }) => {
    return http.get<PaginationResult<any>>('/v1/payrolls', params);
  },
  create: async (data: any) => { return http.post<any>('/v1/payrolls', data); },
  get: async (id: string) => { return http.get<any>(`/v1/payrolls/${id}`); },
  confirm: async (id: string) => { return http.post<any>(`/v1/payrolls/${id}/confirm`); },
  remove: async (id: string) => { return http.delete(`/v1/payrolls/${id}`); },
};

// ===== 收付款计划（分期，P2 单据功能）=====

export interface PaymentPlanItem {
  id: string;
  seq: number;
  due_date: string;
  planned_amount: string;
  received_amount: string;
  status: string; // pending / partial / paid
  remark?: string;
}

export interface PaymentPlan {
  id: string;
  plan_no: string;
  plan_type: string; // receivable / payable
  party_id?: string;
  party_name?: string;
  source_type?: string;
  source_id?: string;
  source_no?: string;
  total_amount: string;
  received_amount: string;
  status: string; // active / completed / cancelled
  start_date?: string;
  remark?: string;
  ext?: any; // 含 receive_records（每次登记收/付历史：item_id/seq/date/amount/method）
  edges?: { items?: PaymentPlanItem[] };
}

export const paymentPlanApi = {
  list: async (params?: PaginationParams & { plan_type?: string; party_id?: string; status?: string }) => {
    return http.get<PaginationResult<PaymentPlan>>('/v1/payment-plans', params);
  },
  get: async (id: string) => {
    return http.get<PaymentPlan>(`/v1/payment-plans/${id}`);
  },
  create: async (data: any) => {
    return http.post<PaymentPlan>('/v1/payment-plans', data);
  },
  update: async (id: string, data: any) => {
    return http.put<PaymentPlan>(`/v1/payment-plans/${id}`, data);
  },
  receive: async (id: string, itemId: string, amount: string, method?: string) => {
    return http.post<PaymentPlan>(`/v1/payment-plans/${id}/receive`, { item_id: itemId, amount, method });
  },
  cancel: async (id: string) => {
    return http.post<PaymentPlan>(`/v1/payment-plans/${id}/cancel`);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/payment-plans/${id}`);
  },
};

// ── 税金计提（2026-09-11）────────────────────────────────────────────────────
// 附加税 / 印花税 / 企业所得税 / 分红代扣个税 → 生成计提凭证，净利润可到税后口径
/** 默认税率（2026-09-12）：持久化到系统设置（key=tax），计提页「存为默认」保存、下次打开自动带出 */
export interface TaxRateDefaults {
  city_rate: string | number;
  edu_rate: string | number;
  local_edu_rate: string | number;
  stamp_rate: string | number;
  income_tax_rate: string | number;
  dividend_tax_rate: string | number;
}

export interface TaxPreview {
  period: string;
  period_closed: boolean;
  output_vat: string | number; // 本期销项税额
  input_vat: string | number;  // 本期进项税额
  vat_payable: string | number; // 本期应交增值税（销项-进项，本期发生额口径，不受月末结转影响）
  profit_before_tax: string | number; // 本期利润总额（不含所得税费用）
  defaults: TaxRateDefaults;
}

export interface TaxAccrual {
  id: string;
  code: string;
  period: string;
  tax_type: string;
  base_amount: string | number;
  rate: string | number;
  amount: string | number;
  expense_account_code?: string;
  tax_account_code?: string;
  voucher_id?: string;
  voucher_no?: string;
  details?: {
    name?: string;
    account_code?: string;
    rate?: string;
    amount?: string;
    // 分红明细（按股东拆分时）：shareholder_id/type/tax_no/ratio/tax_rate/tax/net
    shareholder_id?: string;
    type?: string;
    tax_no?: string;
    ratio?: string;
    tax_rate?: string;
    tax?: string;
    net?: string;
  }[];
  remark?: string;
  created_at?: string;
}

/** 税务报表：应交税费明细表（按税种） */
export interface TaxSummaryRow {
  account_code: string;
  account_name: string;
  open_balance: string | number;  // 期初（贷方为正 = 应交未交）
  accrued: string | number;       // 本期计提（贷方发生）
  paid: string | number;          // 本期缴纳（借方发生）
  close_balance: string | number; // 期末
}

export interface TaxSummaryResult {
  period: string;
  rows: TaxSummaryRow[];
  total_open: string | number;
  total_accrued: string | number;
  total_paid: string | number;
  total_close: string | number;
}

export interface TaxPayable {
  account_code: string;
  account_name: string;
  balance: string | number; // 贷方余额 = 应交未交
}

/** 增值税结转预览（截至期末未结转的进项/销项税额） */
export interface VatBalance {
  period: string;
  output_net: string | number;  // 销项税额余额（贷方）
  input_net: string | number;   // 进项税额余额（借方）
  vat_payable: string | number; // 应交增值税（销项−进项；正 = 应交 / 负 = 留抵）
  transferred: boolean;         // 已无可结转余额
}

export const taxAccrualApi = {
  preview: async (period: string) => {
    return http.get<TaxPreview>('/v1/tax-accruals/preview', { period });
  },
  /** 读取默认税率（系统设置；未配置回退常量默认） */
  rateDefaults: async () => {
    return http.get<TaxRateDefaults>('/v1/tax-accruals/rate-defaults');
  },
  /** 保存默认税率（计提页「存为默认」；0~1，如 7% 传 0.07） */
  saveRateDefaults: async (data: TaxRateDefaults) => {
    return http.put<TaxRateDefaults>('/v1/tax-accruals/rate-defaults', data);
  },
  /** 增值税结转预览（截至期末未结转的进项/销项税额） */
  vatBalance: async (period: string) => {
    return http.get<VatBalance>('/v1/tax-accruals/vat-balance', { period });
  },
  /** 应交税费余额（应交未交），用于「税费缴纳」区块 */
  payables: async (asOf?: string) => {
    return http.get<TaxPayable[]>('/v1/tax-accruals/payables', asOf ? { as_of: asOf } : undefined);
  },
  /** 税费缴纳：借 应交税费 / 贷 银行存款，生成凭证（默认草稿） */
  pay: async (data: {
    items: { account_code: string; amount: number }[];
    pay_date?: string;
    bank_code?: string;
    remark?: string;
    post_voucher?: boolean;
  }) => {
    return http.post('/v1/tax-accruals/pay', data);
  },
  list: async (params?: { page?: number; page_size?: number; period?: string; tax_type?: string }) => {
    return http.get<PaginationResult<TaxAccrual>>('/v1/tax-accruals', params);
  },
  /** 应交税费明细表（各税种期初/计提/缴纳/期末） */
  summary: async (period: string) => {
    return http.get<TaxSummaryResult>('/v1/tax-accruals/summary', { period });
  },
  create: async (data: {
    period: string;
    tax_type: string;
    base_amount?: number;
    rate?: number;
    amount?: number;
    city_rate?: number;
    edu_rate?: number;
    local_edu_rate?: number;
    dividend_amount?: number;
    dividend_tax_rate?: number;
    /** 分红股东明细：缺 amount 时后端按持股比例分摊剩余额 */
    dividends?: { shareholder_id: string; amount?: number }[];
    post_voucher?: boolean;
    remark?: string;
  }) => {
    return http.post<TaxAccrual>('/v1/tax-accruals', data);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/tax-accruals/${id}`);
  },
};

// ── 股东档案（2026-09-11）────────────────────────────────────────────────────
// 分红按股东逐个计算的基础数据：自然人股东分红代扣 20% 个税，法人股东免税（居民企业间股息红利）
export interface Shareholder {
  id: string;
  name: string;
  holder_type: string; // natural 自然人 / corporate 法人
  tax_no?: string;     // 身份证号 / 统一社会信用代码
  share_ratio: string | number; // 百分数（40 表示 40%）
  capital?: string | number;    // 出资额
  phone?: string;
  bank_name?: string;
  bank_account?: string;
  is_active: boolean;
  remark?: string;
}

export const HOLDER_TYPE_TEXT: Record<string, string> = {
  natural: '自然人',
  corporate: '法人',
};

export const shareholderApi = {
  list: async (params?: { page?: number; page_size?: number; keyword?: string }) => {
    return http.get<PaginationResult<Shareholder>>('/v1/shareholders', params);
  },
  create: async (data: Partial<Shareholder>) => {
    return http.post<Shareholder>('/v1/shareholders', data);
  },
  update: async (id: string, data: Partial<Shareholder>) => {
    return http.put(`/v1/shareholders/${id}`, data);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/shareholders/${id}`);
  },
};

export const TAX_TYPE_TEXT: Record<string, string> = {
  surcharge: '附加税',
  stamp: '印花税',
  income_tax: '企业所得税',
  dividend: '分红代扣个税',
  vat_transfer: '增值税结转',
};

// ── 凭证模板管理（2026-09-12，B-01b）────────────────────────────────────────
// 自动过账分录模板：客户可调整科目/方向/金额表达式；改坏可一键恢复官方默认（B-01a 的配套出口）。
// 金额表达式变量：line.amount（含税金额）/ line.tax_amount（税额）/ line.cost（成本），支持 + - 运算。
export interface VoucherTemplateEntry {
  account_code: string;
  account_name?: string;
  direction: 'debit' | 'credit';
  amount_expr: string;
}

export interface VoucherTemplate {
  id: string;
  code: string;
  name: string;
  source_type: string;
  is_active: boolean;
  entries?: VoucherTemplateEntry[];
  remark?: string;
}

export const voucherTemplateApi = {
  list: async () => {
    return http.get<VoucherTemplate[]>('/v1/voucher-templates');
  },
  update: async (id: string, data: { name?: string; is_active?: boolean; remark?: string; entries?: VoucherTemplateEntry[] }) => {
    return http.put<VoucherTemplate>(`/v1/voucher-templates/${id}`, data);
  },
  /** 恢复官方默认（仅系统内置 VT-* 模板；客户改坏后的安全出口） */
  reset: async (id: string) => {
    return http.post<VoucherTemplate>(`/v1/voucher-templates/${id}/reset`);
  },
};

// 科目映射（B-04 2026-09-13）：把费用/工资/折旧/税金/进销项/现金银行等"写死的对方科目"开放为可配置
export interface AccountMappingDef {
  key: string;
  label: string;
  usage: string;
  default_code: string;
  default_name: string;
}

export interface AccountMappingItem {
  account_id?: string;
  account_code: string;
  account_name: string;
  is_default: boolean;
  missing: boolean;
}

export interface AccountMappingView {
  defs: AccountMappingDef[];
  items: Record<string, AccountMappingItem>;
}

export const accountMappingApi = {
  get: async () => {
    return http.get<AccountMappingView>('/v1/account-mappings');
  },
  /** items: 映射项 key → 科目 ID；空字符串 = 恢复默认科目 */
  save: async (items: Record<string, string>) => {
    return http.put<AccountMappingView>('/v1/account-mappings', { items });
  },
};

