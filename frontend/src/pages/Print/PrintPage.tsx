import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { http } from '@/utils/request';
import { salesOrderApi, purchaseOrderApi, salesReturnApi, purchaseReturnApi, quotationApi, contractApi, salesContractApi } from '@/api/order';
import { stockInApi, stockOutApi, inventoryCheckApi, stockTransferApi } from '@/api/inventory';
import { receiptApi, paymentApi, receivableApi, payableApi, expenseApi } from '@/api/finance';
import { productionApi } from '@/api/production';
import { productApi } from '@/api/product';
import { printTemplateApi } from '@/api/print';
import { PrintColumn, PrintTemplate } from '@/types/print';
import { format } from '@/utils/format';
import { rmbUpper } from '@/utils/cnMoney';
import { loadProductFieldLabels, productExtSummary, type ProductFieldLabel } from '@/utils/productExt';
import { withBuiltinPrintColumns } from '@/utils/printColumns';

// 通用打印数据：头部信息按 key 取值，明细行按列 key 取值，列/信息项由模板控制显示
interface PrintData {
  title: string;
  header: Record<string, string>;
  lines: Record<string, any>[];
  totals: { label: string; value: string }[];
  remark: string;
  /** 人民币大写合计金额（仅本币单；外币单在 totals 前缀币种代码） */
  amountForWords?: number;
}

const TYPE_TITLES: Record<string, string> = {
  sales_order: '销售订单',
  purchase_order: '采购订单',
  stock_in: '入库单',
  stock_out: '出库单',
  purchase_return: '采购退货单',
  sales_return: '销售退货单',
  work_order: '生产工单',
  production_picking: '生产领料单',
  production_receipt: '生产入库单',
  rework_order: '返工单',
  subcontract_order: '外协加工单',
  ar_invoice: '应收发票',
  ap_invoice: '应付发票',
  inventory_check: '库存盘点单',
  stock_transfer: '库存调拨单',
  payment_receipt: '收款单',
  payment_payment: '付款单',
  sales_quotation: '销售报价单',
  expense_claim: '费用报销单',
  purchase_contract: '采购合同',
  sales_contract: '销售合同',
  product_label: '商品标签',
};

const fmt = (v: any) => (v === null || v === undefined || v === '' ? '' : String(v));
// 金额/成本/税额：统一两位小数（打印窄列不带千分位；'4400'→'4400.00'，86.666666→'86.67'）
const fmtMoney = (v: any) => (v === null || v === undefined || v === '' ? '' : (Number(v) || 0).toFixed(2));

// 打印头部“往来单位”语义随单据类型修正（避免“往来单位：A仓→B仓/产品名”这类纸质单据）
const PARTY_LABEL: Record<string, string> = {
  stock_in: '仓库',
  stock_out: '仓库',
  stock_transfer: '调拨仓库',
  inventory_check: '盘点仓库',
  production_picking: '领料仓库',
  production_receipt: '入库仓库',
  work_order: '生产产品',
};

// 财务/订单单据必显的附加头部要素（独立于模板 header_fields，保证客户拿到的回单要素齐全）
const EXTRA_HEADER_FIELDS: Record<string, { key: string; label: string }[]> = {
  payment_receipt: [
    { key: 'pay_type', label: '收款方式' },
    { key: 'currency', label: '币种' },
    { key: 'cash_account', label: '收款账户' },
  ],
  payment_payment: [
    { key: 'pay_type', label: '付款方式' },
    { key: 'currency', label: '币种' },
    { key: 'cash_account', label: '付款账户' },
  ],
  sales_order: [{ key: 'currency', label: '币种' }],
  purchase_order: [{ key: 'currency', label: '币种' }],
  ar_invoice: [{ key: 'currency', label: '币种' }],
  ap_invoice: [{ key: 'currency', label: '币种' }],
  sales_quotation: [{ key: 'valid_until', label: '有效期至' }],
  expense_claim: [
    { key: 'department', label: '部门' },
    { key: 'pay_type', label: '付款方式' },
  ],
  purchase_contract: [
    { key: 'end_date', label: '合同有效期至' },
    { key: 'executed', label: '已执行金额' },
  ],
  sales_contract: [
    { key: 'customer_contract_no', label: '客户合同号' },
    { key: 'end_date', label: '合同有效期至' },
    { key: 'executed', label: '已下单金额' },
  ],
};

// 金额类单据（合计需要币种前缀；人民币单另标注大写金额）
const MONEY_DOC_TYPES = new Set([
  'sales_order', 'purchase_order', 'sales_return', 'purchase_return',
  'ar_invoice', 'ap_invoice', 'payment_receipt', 'payment_payment',
  'sales_quotation', 'expense_claim', 'purchase_contract', 'sales_contract',
]);

// 报价行含税金额（行额 = 数量×单价×(1-折扣%)×(1+税率%)，四舍五入到分，避免浮点尾差）
function lineGrossAmount(l: any): number {
  return Math.round((Number(l.qty) || 0) * (Number(l.price) || 0) * (1 - (Number(l.discount) || 0) / 100) * (1 + (Number(l.tax_rate) || 0) / 100) * 100) / 100;
}
function quoteGross(d: any): number {
  const list = d.lines || d.edges?.lines || [];
  return list.reduce((s: number, l: any) => s + lineGrossAmount(l), 0);
}

// 单据主金额（大写合计取“实际金额”口径：订单/发票=金额+税额，退货/报价/收付款=单额）
function docMainAmount(type: string, d: any): number {
  const total = Number(d.total_amount) || 0;
  const tax = Number(d.tax_amount) || 0;
  switch (type) {
    case 'sales_order':
    case 'purchase_order':
    case 'ar_invoice':
    case 'ap_invoice':
      return total + tax;
    case 'payment_receipt':
    case 'payment_payment':
      return Number(d.amount) || 0;
    case 'sales_quotation':
      return quoteGross(d);
    default:
      return total;
  }
}

// 单据数据 → 通用打印数据（字段映射；显示与否由打印模板决定）
// [2026-09-16] labels：商品字段中文名（「商品信息」列 = 该行商品自定义字段汇总；由调用方预加载）
function buildDoc(type: string, d: any, labels?: ProductFieldLabel[] | null): PrintData {
  const header: Record<string, string> = {};
  let lines: Record<string, any>[] = [];
  let totals: { label: string; value: string }[] = [];
  let remark = '';

  const mapLine = (l: any) => ({
    product_code: l.product_code || l.edges?.product?.code || '',
    product_name: l.product_name || l.edges?.product?.name || '',
    spec: l.spec || l.edges?.product?.spec || '',
    // 单位兜底链：行快照 → 行单位边 → 商品主单位（历史单无行级 unit_id 时用商品单位，避免空白）
    unit_name: l.unit_name || l.edges?.unit?.name || l.edges?.product?.edges?.unit?.name || '',
    qty: fmt(l.quantity ?? l.qty),
    price: fmtMoney(l.price ?? l.unit_cost ?? l.cost_price),
    amount: fmtMoney(l.amount),
    invoice_no: l.ar_invoice_no || l.ap_invoice_no || '',
    tax_rate: fmt(l.tax_rate),
    tax_amount: fmtMoney(l.tax_amount),
    book_qty: fmt(l.book_qty),
    actual_qty: fmt(l.actual_qty),
    diff_qty: fmt(l.diff_qty),
    process_name: l.process_name || '',
    work_center: l.work_center_name || l.work_center || '',
    standard_time: fmt(l.standard_time),
    status: fmt(l.status),
    // [2026-09-16] 商品信息列：该行商品自定义字段汇总（如「原产国：中国 · 配料表：…」）
    product_info: productExtSummary(l, labels || null),
  });

  if (type === 'sales_quotation') {
    header.doc_no = d.quotation_no || '';
    header.doc_date = (d.quotation_date || '').slice(0, 10);
    header.party = d.customer_name || d.edges?.customer?.name || '';
    header.status = d.status || '';
    header.valid_until = (d.valid_until || '').slice(0, 10);
    const qty = d.lines || d.edges?.lines || [];
    lines = qty.map((l: any) => ({
      product_code: l.product_code || l.edges?.product?.code || '',
      product_name: l.product_name || l.edges?.product?.name || '',
      spec: l.spec || l.edges?.product?.spec || '',
      // 单位兜底链：行快照 → 行单位边 → 商品主单位（历史单无行级 unit_id 时用商品单位，避免空白）
      unit_name: l.unit_name || l.edges?.unit?.name || l.edges?.product?.edges?.unit?.name || '',
      qty: fmt(l.qty),
      price: fmtMoney(l.price),
      amount: fmtMoney(lineGrossAmount(l)),
      // [2026-09-16] 商品信息列（与 mapLine 同口径）
      product_info: productExtSummary(l, labels || null),
    }));
    totals = [{ label: '报价合计(含税)', value: format.currency(quoteGross(d)) }];
    remark = d.remark || '';
  } else if (type === 'expense_claim') {
    header.doc_no = d.claim_no || '';
    header.doc_date = (d.claim_date || '').slice(0, 10);
    header.party = d.employee_name || '';
    header.status = d.status || '';
    header.department = d.department || '';
    const extPay = d.ext && d.ext.payment_type;
    if (extPay) header.pay_type = String(extPay);
    const expNames: Record<string, string> = { travel: '差旅费', entertainment: '业务招待费', office: '办公费', other: '其他费用' };
    lines = (d.lines || d.edges?.lines || []).map((l: any) => ({
      expense_type: expNames[l.expense_type] || l.expense_type || '',
      description: l.description || '',
      amount: fmtMoney(l.amount),
    }));
    totals = [{ label: '报销金额', value: format.currency(Number(d.total_amount) || 0) }];
    remark = d.remark || '';
  } else if (type === 'purchase_contract') {
    header.doc_no = d.contract_no || '';
    header.doc_date = (d.contract_date || '').slice(0, 10);
    header.party = d.supplier_name || d.edges?.supplier?.name || '';
    header.status = d.status || '';
    header.end_date = (d.end_date || '').slice(0, 10);
    header.executed = d.executed_amount ? `¥${format.currency(Number(d.executed_amount) || 0)}` : '';
    lines = [];
    totals = [{ label: '合同金额', value: format.currency(Number(d.total_amount) || 0) }];
    remark = d.remark || '';
  } else if (type === 'sales_contract') {
    // 销售合同（2026-09-11）：与采购合同对称的正文型单据
    header.doc_no = d.contract_no || '';
    header.doc_date = (d.contract_date || '').slice(0, 10);
    header.party = d.customer_name || d.edges?.customer?.name || '';
    header.status = d.status || '';
    header.customer_contract_no = d.customer_contract_no || '';
    header.end_date = (d.end_date || '').slice(0, 10);
    header.executed = d.ordered_amount ? `¥${format.currency(Number(d.ordered_amount) || 0)}` : '';
    lines = [];
    totals = [{ label: '合同金额', value: format.currency(Number(d.total_amount) || 0) }];
    remark = d.remark || '';
  } else if (type === 'sales_order' || type === 'purchase_order') {
    header.doc_no = d.order_no || '';
    header.doc_date = (d.order_date || '').slice(0, 10);
    header.party = d.customer_name || d.edges?.customer?.name || d.supplier_name || d.edges?.supplier?.name || '';
    header.status = d.status || '';
    header.currency = d.currency || d.currency_code || '';
    lines = (d.lines || d.edges?.lines || []).map(mapLine);
    totals = [
      { label: '金额', value: format.currency(Number(d.total_amount) || 0) },
      { label: '税额', value: format.currency(Number(d.tax_amount) || 0) },
    ];
    remark = d.remark || '';
  } else if (type === 'stock_in' || type === 'stock_out') {
    const isIn = type === 'stock_in';
    header.doc_no = isIn ? d.stock_in_no || '' : d.stock_out_no || '';
    header.doc_date = ((isIn ? d.stock_in_date : d.stock_out_date) || '').slice(0, 10);
    header.party = d.warehouse_name || d.edges?.warehouse?.name || '';
    header.status = d.status || '';
    lines = (d.lines || d.edges?.lines || []).map(mapLine);
    totals = [
      { label: '数量', value: fmt(d.total_qty) },
      { label: '金额', value: format.currency(Number(d.total_amount) || 0) },
    ];
    remark = d.remark || '';
  } else if (type === 'purchase_return' || type === 'sales_return') {
    const isPur = type === 'purchase_return';
    header.doc_no = d.return_no || d.order_no || '';
    header.doc_date = ((d.return_date || d.order_date) || '').slice(0, 10);
    header.party = isPur ? (d.supplier_name || d.edges?.supplier?.name || '') : (d.customer_name || d.edges?.customer?.name || '');
    header.status = d.status || '';
    header.currency = d.currency || d.currency_code || '';
    lines = (d.lines || d.edges?.lines || []).map(mapLine);
    totals = [{ label: '退货金额', value: format.currency(Number(d.total_amount) || 0) }];
    remark = d.remark || d.return_reason || d.reason || '';
  } else if (type === 'production_picking' || type === 'production_receipt') {
    const isPick = type === 'production_picking';
    header.doc_no = isPick ? (d.picking_no || '') : (d.receipt_no || '');
    header.doc_date = (d.created_at || '').slice(0, 10);
    header.party = d.warehouse_name || d.edges?.warehouse?.name || '';
    header.status = d.status || '';
    const rawLines = (d.lines && d.lines.length) ? d.lines : (d.edges?.lines || []);
    if (rawLines.length) {
      lines = rawLines.map(mapLine);
    } else {
      lines = [{ product_code: d.product_code || '', product_name: d.product_name || '', spec: d.product_spec || '', qty: fmt(d.total_qty ?? d.quantity ?? d.qty) }];
    }
    totals = [{ label: '数量', value: fmt(d.total_qty ?? d.quantity ?? d.qty) }];
    remark = d.work_order_no ? `关联工单：${d.work_order_no}` : '';
  } else if (type === 'work_order') {
    header.doc_no = d.work_order_no || d.order_no || '';
    header.doc_date = ((d.planned_start_date || d.start_date) || '').slice(0, 10);
    header.party = d.product_name || d.edges?.product?.name || '';
    header.status = d.status || '';
    lines = (d.edges?.processes || d.processes || []).map(mapLine);
    totals = [
      { label: '计划数量', value: fmt(d.quantity ?? d.qty) },
      { label: '物料成本', value: format.currency(Number(d.material_cost) || 0) },
    ];
    remark = d.remark || '';
  } else if (type === 'rework_order') {
    // 返工单：单表无明细行，返工信息在表头字段（工序/返工数/合格/不合格/原因）
    header.doc_no = d.code || '';
    header.doc_date = (d.created_at || '').slice(0, 10);
    header.party = d.work_order_no || '';
    header.status = d.status || '';
    lines = [{
      product_name: d.process_name || '返工工序',
      process_name: d.process_name || '',
      qty: fmt(d.qty_rework),
      status: fmt(d.status),
      work_center: d.operator_name || '',
    }];
    totals = [
      { label: '返工数量', value: fmt(d.qty_rework) },
      { label: '合格数', value: fmt(d.qty_good) },
      { label: '不合格数', value: fmt(d.qty_bad) },
    ];
    remark = d.reason || '';
  } else if (type === 'subcontract_order') {
    // 外协加工单：单产品 + 数量/单价/金额 + 发料/收货数
    header.doc_no = d.code || '';
    header.doc_date = (d.issue_date || d.created_at || '').slice(0, 10);
    header.party = d.supplier_name || '';
    header.status = d.status || '';
    lines = [{
      product_code: d.product_code || '',
      product_name: d.product_name || '',
      spec: d.product_spec || '',
      qty: fmt(d.qty),
      price: fmtMoney(d.unit_price),
      amount: fmtMoney(d.amount),
      process_name: d.process_name || '',
      actual_qty: fmt(d.received_qty),
      diff_qty: fmt(d.diff_qty),
    }];
    totals = [
      { label: '加工数量', value: fmt(d.qty) },
      { label: '已发料', value: fmt(d.material_issued_qty) },
      { label: '已收货', value: fmt(d.received_qty) },
      { label: '金额', value: fmtMoney(d.amount) },
    ];
    remark = d.remark || '';
  } else if (type === 'ar_invoice' || type === 'ap_invoice') {
    const isAr = type === 'ar_invoice';
    header.doc_no = d.invoice_no || '';
    header.doc_date = (d.invoice_date || '').slice(0, 10);
    header.party = isAr ? (d.customer_name || d.edges?.customer?.name || '') : (d.supplier_name || d.edges?.supplier?.name || '');
    header.status = d.status || d.invoice_status || '';
    header.currency = d.currency || d.currency_code || '';
    lines = (d.lines || d.edges?.lines || []).map(mapLine);
    const tax = Number(d.tax_amount) || 0;
    const total = Number(d.total_amount) || 0;
    totals = [
      { label: '金额', value: format.currency(total) },
      { label: '税额', value: format.currency(tax) },
      { label: '价税合计', value: format.currency(total + tax) },
    ];
  } else if (type === 'inventory_check') {
    header.doc_no = d.check_no || '';
    header.doc_date = (d.check_date || '').slice(0, 10);
    header.party = d.warehouse_name || d.edges?.warehouse?.name || '';
    header.status = d.status || '';
    lines = (d.lines || d.edges?.lines || []).map(mapLine);
    remark = d.remark || '';
  } else if (type === 'stock_transfer') {
    header.doc_no = d.transfer_no || '';
    header.doc_date = (d.transfer_date || '').slice(0, 10);
    header.party = `${d.from_warehouse_name || d.edges?.fromWarehouse?.name || ''} → ${d.to_warehouse_name || d.edges?.toWarehouse?.name || ''}`;
    header.status = d.status || '';
    lines = (d.lines || d.edges?.lines || []).map((l: any) => ({
      ...mapLine(l),
      from_warehouse: d.from_warehouse_name || d.edges?.fromWarehouse?.name || '',
      to_warehouse: d.to_warehouse_name || d.edges?.toWarehouse?.name || '',
    }));
  } else {
    // payment_receipt / payment_payment / product_label（标签数据由加载侧构造）
    const isR = type === 'payment_receipt';
    header.doc_no = isR ? d.receipt_no || '' : d.payment_no || '';
    header.doc_date = ((isR ? d.receipt_date : d.payment_date) || '').slice(0, 10);
    header.party = d.customer_name || d.edges?.customer?.name || d.supplier_name || d.edges?.supplier?.name || '';
    header.status = d.status || '';
    // 收款方式/付款方式、币种、收付款账户：财务回单必显要素（后端 Get 已把历史 code 归一化为中文）
    header.pay_type = (isR ? d.receipt_type : d.payment_type) || '';
    header.currency = d.currency_code || '';
    header.cash_account = d.cash_account_name || '';
    lines = (d.lines || d.edges?.lines || []).map(mapLine);
    totals = [{ label: '金额', value: format.currency(Number(d.amount) || 0) }];
    remark = d.remark || '';
  }

  // 金额类单据统一收尾：外币单合计前补币种代码；人民币单记录大写合计
  let amountForWords: number | undefined;
  if (MONEY_DOC_TYPES.has(type)) {
    // 本币(CNY)不必在头部标注“币种”，仅外币显示（避免回单出现冗余“币种：CNY”）
    if (header.currency === 'CNY') header.currency = '';
    const cur = header.currency || '';
    if (cur && cur !== 'CNY') {
      totals = totals.map(t => ({ ...t, value: `${cur} ${t.value}` }));
    } else {
      const main = docMainAmount(type, d);
      if (main > 0) amountForWords = Math.round(main * 100) / 100;
    }
  }
  return { title: TYPE_TITLES[type] || type, header, lines, totals, remark, amountForWords };
}

// 模板缺省时的兜底配置（与历史打印一致）
const FALLBACK_TEMPLATE: PrintTemplate = {
  id: '', doc_type: '', name: '', is_default: true, is_system: true,
  paper_size: 'A4', paper_width: 210, paper_height: 297, font_size: 14,
  title_size: 24, header_size: 14, row_height: 34, margin: 14,
  print_mode: 'normal', show_border: true,
  label_per_row: 2, show_barcode: false, label_field: 'product_name', label_sub_field: 'spec',
  show_logo: true, show_company: true, show_status: true, show_totals: true,
  show_remark: true, show_signatures: true, footer_text: '',
  header_fields: [
    { key: 'doc_no', label: '单据编号', show: true },
    { key: 'doc_date', label: '单据日期', show: true },
    { key: 'party', label: '往来单位', show: true },
    { key: 'status', label: '状态', show: true },
  ],
  columns: [
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
  ],
};

// 费用报销兜底模板（无系统模板时也能打印报销明细）
const FALLBACK_EXPENSE: PrintTemplate = {
  ...FALLBACK_TEMPLATE,
  columns: [
    { key: 'idx', label: '#', show: true, width: 40, align: 'center' },
    { key: 'expense_type', label: '费用类型', show: true, width: 110, align: 'left' },
    { key: 'description', label: '费用说明', show: true, width: 320, align: 'left' },
    { key: 'amount', label: '金额', show: true, width: 120, align: 'right' },
  ],
};

function fallbackTemplate(type: string): PrintTemplate {
  return type === 'expense_claim' ? FALLBACK_EXPENSE : FALLBACK_TEMPLATE;
}

function paperSpec(t: PrintTemplate) {
  const map: Record<string, { w: number; h: number }> = {
    A4: { w: 210, h: 297 },
    A5: { w: 148, h: 210 },
    Letter: { w: 215.9, h: 279.4 },
  };
  const spec = map[t.paper_size] || { w: t.paper_width || 210, h: t.paper_height || 297 };
  return { width: spec.w, height: spec.h, margin: t.margin || 14 };
}

const alignClass = (a: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

// 标签条码（CODE128）
function Barcode({ value, width = 2, height = 40 }: { value: string; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && value) {
      try {
        JsBarcode(ref.current, value, {
          format: 'CODE128', width, height, displayValue: true, fontSize: 12, margin: 0,
        });
      } catch { /* 无效条码忽略 */ }
    }
  }, [value, width, height]);
  if (!value) return null;
  return <canvas ref={ref} className="max-w-full" />;
}

export function PrintPage() {
  const { type = '', id = '' } = useParams<{ type: string; id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState<any>(null);
  const [doc, setDoc] = useState<PrintData | null>(null);
  const [tpl, setTpl] = useState<PrintTemplate | null>(null);
  const [error, setError] = useState('');
  const supported = !!TYPE_TITLES[type];

  useEffect(() => {
    // 仅认证可读的公司信息接口：无 system 权限的打印用户也能取到打印抬头公司名
    http.get('/v1/settings/company')
      .then((res: any) => { if (res.code === 0 && res.data?.company) setCompany(res.data.company); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!supported) return;
    if (type !== 'product_label' && !id) return;
    (async () => {
      try {
        let data: any = null;
        switch (type) {
          case 'purchase_contract': data = (await contractApi.get(id)).data; break;
          case 'sales_contract': data = (await salesContractApi.get(id)).data; break;
          case 'sales_quotation': data = (await quotationApi.get(id)).data; break;
          case 'expense_claim': data = (await expenseApi.get(id)).data; break;
          case 'sales_order': data = (await salesOrderApi.get(id)).data; break;
          case 'purchase_order': data = (await purchaseOrderApi.get(id)).data; break;
          case 'stock_in': data = (await stockInApi.get(id)).data; break;
          case 'stock_out': data = (await stockOutApi.get(id)).data; break;
          case 'payment_receipt': data = (await receiptApi.get(id)).data; break;
          case 'payment_payment': data = (await paymentApi.get(id)).data; break;
          case 'purchase_return': data = (await purchaseReturnApi.get(id)).data; break;
          case 'sales_return': data = (await salesReturnApi.get(id)).data; break;
          case 'work_order': data = (await productionApi.getWorkOrder(id)).data; break;
          case 'rework_order': data = (await http.get<any>(`/v1/rework-orders/${id}`)).data; break;
          case 'subcontract_order': data = (await http.get<any>(`/v1/subcontract-orders/${id}`)).data; break;
          case 'production_picking': data = (await http.get<any>(`/v1/production-pickings/${id}`)).data; break;
          case 'production_receipt': data = (await http.get<any>(`/v1/production-receipts/${id}`)).data; break;
          case 'ar_invoice': data = (await receivableApi.get(id)).data; break;
          case 'ap_invoice': data = (await payableApi.get(id)).data; break;
          case 'inventory_check': data = (await inventoryCheckApi.get(id)).data; break;
          case 'stock_transfer': data = (await stockTransferApi.get(id)).data; break;
          case 'product_label': {
            // 商品标签：从 query ids 加载商品并映射为标签行（名称/编码/规格/价格/条码）
            const ids = (searchParams.get('ids') || '').split(',').filter(Boolean);
            const prods: any[] = [];
            for (const pid of ids.slice(0, 200)) {
              try {
                const pr = await productApi.get(pid);
                if (pr.code === 0 && pr.data) {
                  const p = pr.data as any;
                  prods.push({
                    product_name: p.name || p.product_name || '',
                    product_code: p.code || p.product_code || '',
                    spec: p.spec || p.specification || '',
                    price: p.sale_price != null ? fmtMoney(p.sale_price) : fmtMoney(p.price),
                    barcode: p.barcode || p.code || '',
                  });
                }
              } catch { /* 单个失败忽略 */ }
            }
            data = { lines: prods };
            break;
          }
          default: break;
        }
        if (!data) { setError('单据不存在或加载失败'); return; }
        // 统一打印接口：按单据类型加载打印模板（各板块打印设置互不影响）
        let template: PrintTemplate | null = null;
        try {
          const tr = await printTemplateApi.byType(type);
          if (tr.code === 0 && tr.data) template = tr.data;
        } catch { /* 模板加载失败时使用兜底配置 */ }
        // [2026-09-16] 商品字段中文名（模块缓存；先于 buildDoc 加载，保证自动打印时「商品信息」列已就绪）
        const labels = await loadProductFieldLabels();
        setTpl(template);
        setDoc(buildDoc(type, data, labels));
        // 数据就绪后自动唤起打印
        setTimeout(() => window.print(), 450);
      } catch (e: any) {
        setError(e?.message || '加载单据失败');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);

  if (!supported) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">不支持的打印类型</div>;
  }

  // 生效配置：模板优先，无则兜底
  // [2026-09-16] 老模板缺新内置列（如「商品信息」）时兜底补齐，保证打印立即可见（不依赖用户先去打印设置保存）
  const active = tpl || fallbackTemplate(type);
  const cols = withBuiltinPrintColumns(type, active.columns || []).filter(c => c.show);
  // 列宽百分比：列宽总和任意，均按比例铺满打印区（杜绝列宽合计超 A4 被裁）
  const colWidthTotal = cols.reduce((s, c) => s + (Number(c.width) || 0), 0) || 1;
  const colWidthPct = (c: PrintColumn) => `${(((Number(c.width) || 0) / colWidthTotal) * 100).toFixed(2)}%`;
  const headerFields = (active.header_fields || []).filter(h => h.show);
  const paper = paperSpec(active);
  const isLabel = active.print_mode === 'label';
  const isOverprint = active.print_mode === 'overprint';
  const borderCls = active.show_border ? 'border border-gray-300' : '';
  const rowHeight = active.row_height || 34;
  const titleSize = active.title_size || 24;
  const headerSize = active.header_size || 14;

  return (
    <div className="print-root min-h-screen bg-gray-100">
      <style>{`
        /* 2026-09-12：@page 边距归零——浏览器会把自带页眉/页脚（日期、网页标题、URL、页码）
           渲染在页边距区，边距归零后彻底消除（用户在打印对话框也无法再开出“页眉与页脚”）；
           原页边距改由 .print-sheet 的容器内边距承载（套打模式除外，需精确对位）。 */
        @page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          .print-sheet {
            box-shadow: none !important; margin: 0 !important; border: none !important;
            /* 打印时贴合 @page 打印区域宽度，表格 w-full + table-layout:fixed 自动等比缩小到打印宽度（修复列宽总和超 A4 溢出/超距） */
            width: 100% !important; max-width: 100% !important; min-height: 0 !important;
            padding: ${isOverprint ? 0 : `${paper.margin}mm`} !important;
          }
          html, body { width: 100% !important; margin: 0 !important; }
          body { background: #fff !important; }
          /* 多页单据：表头跨页重复、明细行/签名区不被截断 */
          table thead { display: table-header-group; }
          table tbody tr { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-secondary flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden md:inline">返回</span>
        </button>
        <button onClick={() => window.print()} className="btn-primary flex items-center gap-2">
          <Printer className="w-4 h-4" />
          打印
        </button>
        {doc && <span className="text-sm text-gray-500">已自动唤起打印，也可点击上方按钮</span>}
      </div>

      {error ? (
        <div className="max-w-3xl mx-auto bg-white shadow p-8 text-red-600">{error}</div>
      ) : !doc ? (
        <div className="max-w-3xl mx-auto bg-white shadow p-8 text-gray-400">加载中...</div>
      ) : (
        <div className={`print-sheet max-w-3xl mx-auto ${isOverprint ? '' : 'bg-white shadow-lg'} p-8 min-h-[900px]`} style={{ fontSize: `${active.font_size || 14}px` }}>
          {isLabel ? (
            /* ===== 标签模式：商品/生产标签网格 ===== */
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${active.label_per_row || 2}, 1fr)` }}>
              {(doc.lines.length ? doc.lines : [{}]).map((l, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center justify-center text-center px-3 py-4 break-inside-avoid"
                  style={{
                    minHeight: 110,
                    border: active.show_border ? '1.5px solid #111827' : 'none',
                    borderRadius: 6,
                  }}
                >
                  <div className="font-bold text-gray-900 leading-snug" style={{ fontSize: 17 }}>
                    {l[active.label_field || 'product_name'] ?? ''}
                  </div>
                  <div className="text-gray-700 mt-1" style={{ fontSize: 13 }}>
                    {l[active.label_sub_field || 'spec'] ?? ''}
                  </div>
                  {active.show_barcode && (l.product_code || l.barcode) && (
                    <div className="mt-2">
                      <Barcode value={String(l.product_code || l.barcode)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
          {/* 公司抬头 */}
          {active.show_company && (
            <div className="flex items-start justify-between border-b-2 border-gray-800 pb-4">
              <div className="flex items-center gap-3">
                {active.show_logo && company?.logo && (
                  <img src={company.logo} alt="logo" className="w-12 h-12 object-contain" />
                )}
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{company?.name || '企业名称'}</h1>
                  <p className="text-xs text-gray-500">
                    {company?.tax_no ? `税号：${company.tax_no}` : ''}
                    {company?.phone ? `  电话：${company.phone}` : ''}
                  </p>
                  <p className="text-xs text-gray-500">{company?.address || ''}</p>
                </div>
              </div>
              <h2 className="font-bold tracking-widest text-gray-900" style={{ fontSize: titleSize }}>{doc.title}</h2>
            </div>
          )}

          {/* 单据信息（按模板配置显示项） */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 py-4 text-sm text-gray-800">
            {headerFields
              .filter(hf => (doc.header[hf.key] ?? '') !== '') // 单据无值的字段不上纸（避免“币种：-”）
              .map(hf => (
              <div key={hf.key}>
                {(hf.key === 'party' && PARTY_LABEL[type]) ? PARTY_LABEL[type] : hf.label}：<span className="font-semibold">
                  {hf.key === 'status' && doc.header[hf.key]
                    ? format.statusText(doc.header[hf.key])
                    : (doc.header[hf.key] || '-')}
                </span>
              </div>
            ))}
            {/* 财务/订单必显附加要素（模板未配也会自动出现；无值不显示） */}
            {(EXTRA_HEADER_FIELDS[type] || [])
              .filter(hf => doc.header[hf.key])
              .map(hf => (
                <div key={`x-${hf.key}`}>
                  {hf.label}：<span className="font-semibold">{doc.header[hf.key]}</span>
                </div>
              ))}
          </div>

          {/* 明细表（列由模板配置：显隐/宽度/对齐/标签；行高/表头字号可配）。无列不渲染（采购合同等正文型单据） */}
          {cols.length > 0 && (
          <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr className="bg-gray-100">
                {cols.map(c => (
                  <th key={c.key} style={{ width: colWidthPct(c), fontSize: headerSize }} className={`${borderCls} px-2 py-1.5 ${alignClass(c.align)}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.lines.length === 0 ? (
                <tr><td colSpan={cols.length || 1} className={`${borderCls} px-2 py-2 text-center text-gray-400`}>无明细</td></tr>
              ) : doc.lines.map((l, i) => (
                <tr key={i} style={{ height: rowHeight }}>
                  {cols.map(c => (
                    <td key={c.key} className={`${borderCls} px-2 py-1.5 ${alignClass(c.align)}`}>
                      {c.key === 'idx' ? i + 1 : c.key === 'status' ? (l[c.key] ? format.statusText(String(l[c.key])) : '') : (l[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          )}

          {/* 合计 */}
          {active.show_totals && (
            <div className="flex justify-end gap-6 pt-4 text-sm text-gray-800">
              {doc.totals.map(t => (
                <div key={t.label}>
                  <span className="text-gray-500">{t.label}：</span>
                  <span className="font-semibold">{t.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* 合计金额（大写）：人民币正式单据必标 */}
          {active.show_totals && typeof doc.amountForWords === 'number' && (
            <div className="flex justify-end pt-2 text-sm text-gray-800">
              <span className="text-gray-500">合计金额（大写）：</span>
              <span className="font-semibold">{rmbUpper(doc.amountForWords)}</span>
            </div>
          )}

          {/* 备注 */}
          {active.show_remark && doc.remark && (
            <div className="pt-4 text-sm text-gray-800">
              <span className="text-gray-500">备注：</span>{doc.remark}
            </div>
          )}

          {/* 签名区 */}
          {active.show_signatures && (
            <div className="grid grid-cols-3 gap-8 pt-16 text-sm text-gray-700">
              <div>制单人：</div>
              <div>审核人：</div>
              <div>签收人：</div>
            </div>
          )}

          {/* 页脚文字：仅当模板/设置里填写了内容才打印（默认留空 = 不显示，不再输出系统默认页脚） */}
          {active.footer_text ? (
            <div className="pt-10 text-center text-xs text-gray-400">{active.footer_text}</div>
          ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
