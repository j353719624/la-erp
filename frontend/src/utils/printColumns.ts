/**
 * 打印明细列的内置定义（2026-09-16 抽为共享单一来源）
 *
 * 消费方：
 *   - 打印设置页（PrintSettings）：新建模板列定义 + 已有模板合并显示（老库模板缺新列时补齐，保存后持久化）
 *   - 打印页（PrintPage）：模板缺新内置列（如「商品信息」）时兜底补齐，保证老库打印同样可见
 *
 * ⚠️ 新增/调整内置列时三处同步：本文件 + 后端 defaultTemplateFor（internal/service/print/print_template_service.go）
 *    + PrintPage 的行映射（buildDoc/mapLine）。门禁 0.75（check_product_ext.mjs）校验同步。
 */
import type { PrintColumn } from '@/types/print';

export const DEFAULT_COLUMNS: PrintColumn[] = [
  { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
  { key: 'product_code', label: '商品编码', show: true, width: 100, align: 'left' },
  { key: 'product_name', label: '商品名称', show: true, width: 180, align: 'left' },
  { key: 'spec', label: '规格', show: true, width: 90, align: 'left' },
  { key: 'unit_name', label: '单位', show: true, width: 60, align: 'center' },
  { key: 'qty', label: '数量', show: true, width: 70, align: 'right' },
  { key: 'price', label: '单价', show: true, width: 80, align: 'right' },
  { key: 'amount', label: '金额', show: true, width: 90, align: 'right' },
  // [2026-09-16] 商品自定义字段汇总列（如 原产国：中国 · 配料表：小麦粉、水）
  { key: 'product_info', label: '商品信息', show: true, width: 160, align: 'left' },
];

export const PAY_COLUMNS: PrintColumn[] = [
  { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
  { key: 'invoice_no', label: '关联发票号', show: true, width: 160, align: 'left' },
  { key: 'amount', label: '金额', show: true, width: 120, align: 'right' },
];

export const MOVE_COLUMNS: PrintColumn[] = [
  { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
  { key: 'product_code', label: '商品编码', show: true, width: 100, align: 'left' },
  { key: 'product_name', label: '商品名称', show: true, width: 200, align: 'left' },
  { key: 'spec', label: '规格', show: true, width: 90, align: 'left' },
  { key: 'unit_name', label: '单位', show: true, width: 60, align: 'center' },
  { key: 'qty', label: '数量', show: true, width: 80, align: 'right' },
  // [2026-09-16] 商品自定义字段汇总列
  { key: 'product_info', label: '商品信息', show: true, width: 160, align: 'left' },
];

export const RETURN_COLUMNS: PrintColumn[] = [
  { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
  { key: 'product_code', label: '商品编码', show: true, width: 100, align: 'left' },
  { key: 'product_name', label: '商品名称', show: true, width: 180, align: 'left' },
  { key: 'spec', label: '规格', show: true, width: 90, align: 'left' },
  { key: 'unit_name', label: '单位', show: true, width: 60, align: 'center' },
  { key: 'qty', label: '数量', show: true, width: 70, align: 'right' },
  { key: 'price', label: '单价', show: true, width: 80, align: 'right' },
  { key: 'amount', label: '金额', show: true, width: 90, align: 'right' },
  // [2026-09-16] 商品自定义字段汇总列
  { key: 'product_info', label: '商品信息', show: true, width: 160, align: 'left' },
];

export const INVOICE_COLUMNS: PrintColumn[] = [
  { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
  { key: 'product_code', label: '商品编码', show: true, width: 100, align: 'left' },
  { key: 'product_name', label: '商品名称', show: true, width: 170, align: 'left' },
  { key: 'spec', label: '规格', show: true, width: 80, align: 'left' },
  { key: 'unit_name', label: '单位', show: true, width: 60, align: 'center' },
  { key: 'qty', label: '数量', show: true, width: 60, align: 'right' },
  { key: 'price', label: '单价', show: true, width: 70, align: 'right' },
  { key: 'tax_rate', label: '税率(%)', show: true, width: 60, align: 'right' },
  { key: 'tax_amount', label: '税额', show: true, width: 80, align: 'right' },
  { key: 'amount', label: '金额', show: true, width: 90, align: 'right' },
  // [2026-09-16] 商品自定义字段汇总列
  { key: 'product_info', label: '商品信息', show: true, width: 160, align: 'left' },
];

export const CHECK_COLUMNS: PrintColumn[] = [
  { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
  { key: 'product_code', label: '商品编码', show: true, width: 100, align: 'left' },
  { key: 'product_name', label: '商品名称', show: true, width: 170, align: 'left' },
  { key: 'spec', label: '规格', show: true, width: 80, align: 'left' },
  { key: 'unit_name', label: '单位', show: true, width: 60, align: 'center' },
  { key: 'book_qty', label: '账面数量', show: true, width: 80, align: 'right' },
  { key: 'actual_qty', label: '实盘数量', show: true, width: 80, align: 'right' },
  { key: 'diff_qty', label: '差异', show: true, width: 80, align: 'right' },
  // [2026-09-16] 商品自定义字段汇总列
  { key: 'product_info', label: '商品信息', show: true, width: 160, align: 'left' },
];

export const TRANSFER_COLUMNS: PrintColumn[] = [
  { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
  { key: 'product_code', label: '商品编码', show: true, width: 100, align: 'left' },
  { key: 'product_name', label: '商品名称', show: true, width: 160, align: 'left' },
  { key: 'spec', label: '规格', show: true, width: 80, align: 'left' },
  { key: 'unit_name', label: '单位', show: true, width: 60, align: 'center' },
  { key: 'qty', label: '数量', show: true, width: 70, align: 'right' },
  { key: 'from_warehouse', label: '调出仓库', show: true, width: 110, align: 'left' },
  { key: 'to_warehouse', label: '调入仓库', show: true, width: 110, align: 'left' },
  // [2026-09-16] 商品自定义字段汇总列
  { key: 'product_info', label: '商品信息', show: true, width: 160, align: 'left' },
];

export const WORKORDER_COLUMNS: PrintColumn[] = [
  { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
  { key: 'process_name', label: '工序', show: true, width: 150, align: 'left' },
  { key: 'work_center', label: '工作中心', show: true, width: 110, align: 'left' },
  { key: 'standard_time', label: '标准工时', show: true, width: 80, align: 'right' },
  { key: 'status', label: '状态', show: true, width: 80, align: 'center' },
];

export const EXPENSE_COLUMNS: PrintColumn[] = [
  { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
  { key: 'expense_type', label: '费用类型', show: true, width: 110, align: 'left' },
  { key: 'description', label: '费用说明', show: true, width: 320, align: 'left' },
  { key: 'amount', label: '金额', show: true, width: 120, align: 'right' },
];

/** 各单据类型的内置明细列（打印设置新建模板 / 已有模板合并 / 打印页兜底 共用） */
export function builtinPrintColumnsFor(docType: string): PrintColumn[] {
  const isPay = docType === 'payment_receipt' || docType === 'payment_payment';
  const isMove = docType === 'production_picking' || docType === 'production_receipt';
  const isReturn = docType === 'purchase_return' || docType === 'sales_return';
  const isInvoice = docType === 'ar_invoice' || docType === 'ap_invoice';
  const isCheck = docType === 'inventory_check';
  const isTransfer = docType === 'stock_transfer';
  const isWorkOrder = docType === 'work_order';
  const isExpense = docType === 'expense_claim';
  if (isPay) return PAY_COLUMNS;
  if (isMove) return MOVE_COLUMNS;
  if (isReturn) return RETURN_COLUMNS;
  if (isInvoice) return INVOICE_COLUMNS;
  if (isCheck) return CHECK_COLUMNS;
  if (isTransfer) return TRANSFER_COLUMNS;
  if (isWorkOrder) return WORKORDER_COLUMNS;
  if (isExpense) return EXPENSE_COLUMNS;
  return DEFAULT_COLUMNS;
}

/**
 * 已有列清单合并内置列：模板不含新增内置列（如「商品信息」）时补齐（按内置默认 show/宽度/标题）。
 * 打印设置页保存后持久化；打印页用于老模板的即时兜底（保证新列立即可见）。
 */
export function withBuiltinPrintColumns(docType: string, cols: PrintColumn[]): PrintColumn[] {
  const have = new Set(cols.map((c) => c.key));
  const missing = builtinPrintColumnsFor(docType).filter((c) => !have.has(c.key)).map((c) => ({ ...c }));
  return missing.length ? [...cols, ...missing] : cols;
}
