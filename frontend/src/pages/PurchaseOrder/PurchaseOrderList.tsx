import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Check, Trash2, Printer, X, Ban, Download, Send, Copy } from 'lucide-react';
import { exportCsv } from '@/utils/exportCsv';
import { purchaseOrderApi } from '@/api/order';
import { approvalRecordApi } from '@/api/workflow';
import { useAuthStore } from '@/store/auth';
import { useAppStore } from '@/store/app';
import { PurchaseOrder } from '@/types/order';
import { format } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PaginationParams } from '@/types';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { FilterPresetMenu } from '@/components/FilterPresetMenu';
import { Field } from '@/types/metadata';
import { loadEntityListLayout, isEntityListLayoutCustomized, entityColLabel } from '@/utils/entityLayout';
import type { LayoutColumn } from '@/utils/entityLayout';
import { pickFieldValue } from '@/utils/dimLabel';
import { useTableView } from '@/hooks/useTableView';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import { RowActions } from '@/components/RowActions';
import type { RowAction } from '@/components/RowActions';
import { entityApi, fieldApi } from '@/api/metadata';

export function PurchaseOrderList() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  // 「个人模式」：无审批链 → 隐藏「提交审批」按钮（后端同时兜底为提交即通过）
  const personalMode = useAppStore((s) => s.personalMode);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL：刷新/点进详情返回/发链接给同事，条件都不丢
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', status: '', start_date: '', end_date: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [status, setStatus] = useState(urlFilters.status);
  // [2026-09-12] 日期区间（U-02 下沉，U-03 配套：可保存「本月未到货」这类组合为预设）
  const [dateRange, setDateRange] = useState({ start_date: urlFilters.start_date, end_date: urlFilters.end_date });
  // [布局] 采购订单实体默认 list 布局（GET /v1/metadata/layouts/* 需 system 权限，403 时静默回退默认列）
  const [layoutCols, setLayoutCols] = useState<LayoutColumn[]>([]);
  const [layoutCustomized, setLayoutCustomized] = useState(false);
  const [metaFields, setMetaFields] = useState<Field[]>([]);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应，防旧数据覆盖新筛选）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  // [易用性 P1] 条件变化 → 写回 URL（用防抖后关键词，与请求口径一致）
  useEffect(() => {
    syncUrl({ keyword: debouncedKeyword, status, start_date: dateRange.start_date, end_date: dateRange.end_date, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKeyword, status, dateRange.start_date, dateRange.end_date, pagination.page, pagination.page_size]);

  // [布局] 挂载时读取采购订单实体默认 list 布局（失败/无权限静默 → 保持页面默认列）
  useEffect(() => {
    loadEntityListLayout('purchase_order').then((data) => {
      setMetaFields(data.fields);
      setLayoutCols(data.listColumns);
      setLayoutCustomized(isEntityListLayoutCustomized(data.listColumns));
    });
  }, []);

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.page_size, debouncedKeyword, status, dateRange.start_date, dateRange.end_date]);

  const fetchOrders = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { status?: string; order_no?: string; start_date?: string; end_date?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        order_no: debouncedKeyword || undefined,
        status: status || undefined,
        start_date: dateRange.start_date || undefined,
        end_date: dateRange.end_date || undefined,
      };
      const response = await purchaseOrderApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setOrders(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch purchase orders:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, orderNo: string) => {
    if (!(await confirmAction({ title: `确定删除订单 ${orderNo} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await purchaseOrderApi.delete(id);
      if (response.code === 0) {
        message.success(`订单 ${orderNo} 已删除`);
        fetchOrders();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete order:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const handleConfirm = async (id: string, orderNo: string) => {
    if (!(await confirmAction({ title: `确定确认订单 ${orderNo} 吗？` }))) return;
    try {
      const response = await purchaseOrderApi.confirm(id);
      if (response.code === 0) {
        message.success(`订单 ${orderNo} 已确认`);
        fetchOrders();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to confirm order:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleApprove = async (id: string, orderNo: string) => {
    if (!(await confirmAction({ title: `确定审核订单 ${orderNo} 吗？` }))) return;
    try {
      const response = await purchaseOrderApi.approve(id);
      if (response.code === 0) {
        message.success(`订单 ${orderNo} 已审核`);
        fetchOrders();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to approve order:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  // 提交审批流（区别于内部审核：走审批流后由审批人在"我的审批"处理）
  const handleSubmitApproval = async (id: string, orderNo: string) => {
    if (!(await confirmAction({ title: `确定提交审批单 ${orderNo} 吗？`, content: '提交后由审批人在「我的审批」中处理' }))) return;
    const uid = user?.id || user?.ID || '';
    const uname = user?.name || user?.username || '';
    try {
      const response = await approvalRecordApi.submit({
        biz_type: 'purchase_order',
        biz_id: id,
        biz_no: orderNo,
        initiator_id: uid,
        initiator_name: uname,
        remark: '采购订单提交审批',
      });
      if (response.code === 0) {
        message.success(`订单 ${orderNo} 已提交审批`);
        fetchOrders();
      } else {
        message.error(response.message || '提交失败');
      }
    } catch (err) {
      console.error('Failed to submit approval:', err);
      message.error(err instanceof Error && err.message ? err.message : '提交失败，请稍后重试');
    }
  };

  const handleCancel = async (id: string, orderNo: string) => {
    if (!(await confirmAction({ title: `确定取消订单 ${orderNo} 吗？`, danger: true }))) return;
    try {
      const response = await purchaseOrderApi.cancel(id);
      if (response.code === 0) {
        message.success(`订单 ${orderNo} 已取消`);
        fetchOrders();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to cancel order:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleClose = async (id: string, orderNo: string) => {
    if (!(await confirmAction({ title: `确定关闭订单 ${orderNo} 吗？`, content: '关闭后订单完成' }))) return;
    try {
      const response = await purchaseOrderApi.close(id);
      if (response.code === 0) {
        message.success(`订单 ${orderNo} 已关闭`);
        fetchOrders();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to close order:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  // [2026-09-13 U-05] 批量操作统一走 useRowSelection + useBatchAction：
  // 逐条执行（每条都走完整状态机/收发货校验）+ 失败原因逐条汇总 + 导出选中。
  // 旧实现（Set 手写勾选 + 只对 draft 可勾 + 仅批量确认 + 串行逐条）已移除。
  const sel = useRowSelection({ rows: orders, getKey: (o) => o.id });
  const batch = useBatchAction({
    selection: sel,
    label: (o) => o.order_no || o.id,
    onDone: fetchOrders,
    actions: [
      {
        key: 'confirm',
        label: '批量确认',
        icon: <Check className="w-4 h-4" />,
        eligible: (o) => o.status === 'draft',
        confirm: (rows) => ({ title: `确定确认选中的 ${rows.length} 个订单？`, content: '确认后可继续审核/收货；逐条校验，失败的会列出单号与原因' }),
        run: (o) => purchaseOrderApi.confirm(o.id),
      },
      {
        key: 'approve',
        label: '批量审核',
        icon: <Check className="w-4 h-4" />,
        eligible: (o) => o.status === 'confirmed',
        confirm: (rows) => ({ title: `确定审核选中的 ${rows.length} 个订单？`, content: '审核通过后不可修改；失败的会列出单号与原因' }),
        run: (o) => purchaseOrderApi.approve(o.id),
      },
      {
        key: 'close',
        label: '批量关闭',
        icon: <Ban className="w-4 h-4" />,
        eligible: (o) => o.status === 'approved',
        confirm: (rows) => ({ title: `确定关闭选中的 ${rows.length} 个订单？`, content: '关闭后订单不再流转；失败的会列出单号与原因' }),
        run: (o) => purchaseOrderApi.close(o.id),
      },
    ],
    exportSpec: {
      filename: `采购订单_选中_${format.today()}.csv`,
      headers: ['订单号', '供应商', '订单日期', '总金额', '税额', '状态'],
      row: (o) => [o.order_no, o.supplier_name || '', format.date(o.order_date), Number(o.total_amount).toFixed(2), Number(o.tax_amount || 0).toFixed(2), format.statusText(o.status)],
    },
  });

  const handleExport = () => {
    exportCsv(`采购订单_${format.today()}.csv`,
      ['订单号', '供应商', '订单日期', '总金额', '税额', '状态'],
      orders.map(o => [o.order_no, o.supplier_name, format.date(o.order_date), Number(o.total_amount).toFixed(2), Number(o.tax_amount || 0).toFixed(2), format.statusText(o.status)]));
  };

  // ── [布局] 采购订单列表按「采购订单」实体默认 list 布局驱动信息列 ──────────────
  const paymentStatusText = (s?: string) =>
    s === 'unpaid' ? '未付款' : s === 'partial' ? '部分付款' : s === 'paid' ? '已付款' : s === 'advanced' ? '预付款' : (s ? s : '-');
  const scalarText = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '-';
    if (typeof v === 'boolean') return v ? '是' : '否';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  // 信息列 → 单元格（金额统一币种格式化；默认回退原始字段/自定义字段）
  const renderInfoCell = (code: string, o: PurchaseOrder): ReactNode => {
    switch (code) {
      case 'order_date':
        return <span className="text-gray-500 text-sm">{format.date(o.order_date)}</span>;
      case 'delivery_date':
        return <span className="text-gray-500 text-sm">{o.delivery_date ? format.date(o.delivery_date) : '-'}</span>;
      case 'expected_date':
        return <span className="text-gray-500 text-sm">{o.expected_date ? format.date(o.expected_date) : '-'}</span>;
      case 'currency':
        return <span className="text-gray-500 text-sm">{o.currency || '-'}</span>;
      case 'tax_amount':
        return o.tax_amount == null ? <span className="text-gray-500 text-sm">-</span> : <span className="text-gray-500 text-sm">{format.amountText(o.tax_amount, o.currency)}</span>;
      case 'discount_amount':
        return o.discount_amount == null ? <span className="text-gray-500 text-sm">-</span> : <span className="text-gray-500 text-sm">{format.amountText(o.discount_amount, o.currency)}</span>;
      case 'paid_amount':
        return o.paid_amount == null ? <span className="text-gray-500 text-sm">-</span> : <span className="text-gray-500 text-sm">{format.amountText(o.paid_amount, o.currency)}</span>;
      case 'payment_status':
        return <span className="text-gray-500 text-sm">{paymentStatusText(o.payment_status)}</span>;
      case 'total_qty':
        return <span className="text-gray-500 text-sm">{format.qty(o.total_qty ?? 0)}</span>;
      case 'warehouse_name':
        return <span className="text-gray-500 text-sm">{o.warehouse_name || '-'}</span>;
      case 'contract_id':
        return <span className="text-gray-500 text-sm">{o.contract_id || '-'}</span>;
      case 'remark':
        return <span className="text-gray-500 text-sm block max-w-[220px] truncate" title={o.remark || ''}>{o.remark || '-'}</span>;
      case 'created_at':
        return <span className="text-gray-500 text-sm">{format.date(o.created_at, 'YYYY-MM-DD HH:mm') || '-'}</span>;
      case 'updated_at':
        return <span className="text-gray-500 text-sm">{format.date(o.created_at, 'YYYY-MM-DD HH:mm') || '-'}</span>;
      default: {
        // 元数据自定义字段（值存 header ext/ext_fields JSON 列）或订单真实字段
        // 统一取值回退：列码与数据键不同名（如 color ↔ TEST001COLOR）也能取到值
        const v = pickFieldValue(o as unknown as Record<string, any>, code);
        if (v !== undefined && v !== null && v !== '') return <span className="text-gray-500 text-sm">{scalarText(v)}</span>;
        return <span className="text-gray-500 text-sm">-</span>;
      }
    }
  };

  // 本页“始终展示”的固定列（勾选/订单号/供应商/总金额/明细数/状态/操作）；布局列引用这些码时跳过
  const FIXED_INFO_SKIP = new Set([
    'order_no', 'supplier_id', 'supplier_name', 'total_amount', 'status',
    'id', 'tenant_id', 'deleted_at', 'ext', 'ext_fields', 'lines', 'edges',
  ]);

  // 布局信息列（有序、去重）：用户有意配置了布局时按其列渲染；否则用页面默认信息列
  const infoCols: LayoutColumn[] = (() => {
    if (layoutCustomized && layoutCols.length > 0) {
      const seen = new Set<string>();
      const out: LayoutColumn[] = [];
      for (const c of layoutCols) {
        if (!c?.field || seen.has(c.field)) continue;
        seen.add(c.field);
        if (FIXED_INFO_SKIP.has(c.field)) continue;
        out.push({ field: c.field, label: c.label, width: c.width });
      }
      return out;
    }
    return [{ field: 'order_date', label: '订单日期' }];
  })();

  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cell: (o: PurchaseOrder) => ReactNode;
    cellCls?: string;
    width?: number;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';

  const selCol: RowCol = {
    key: '__sel',
    headCls: 'px-4 py-3 w-10',
    cellCls: 'px-4 py-4',
    header: (
      <input
        type="checkbox"
        className="w-4 h-4 accent-blue-600"
        checked={sel.state === 'all'}
        ref={(el) => { if (el) el.indeterminate = sel.state === 'some'; }}
        onChange={sel.toggleAll}
        title="全选本页"
      />
    ),
    cell: (o) => (
      <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={sel.isSelected(o)} onChange={() => sel.toggle(o)} />
    ),
  };

  const orderNoCol: RowCol = {
    key: 'order_no',
    header: '订单号',
    cell: (o) => <span className="font-medium text-gray-900">{o.order_no}</span>,
  };

  const supplierCol: RowCol = {
    key: 'supplier',
    header: '供应商',
    cell: (o) => <span className="text-gray-900">{o.supplier_name || o.edges?.supplier?.name || '-'}</span>,
  };

  const totalCol: RowCol = {
    key: 'total_amount',
    header: '总金额',
    cell: (o) => (
      <>
        <span className="font-medium text-gray-900">{format.amountText(o.total_amount, o.currency)}</span>
        {o.tax_amount ? (
          <div className="text-xs font-normal text-gray-400">税额 {format.amountText(o.tax_amount, o.currency)}</div>
        ) : null}
      </>
    ),
  };

  const linesCol: RowCol = {
    key: 'lines',
    header: '明细数',
    cell: (o) => <span className="text-gray-500 text-sm">{o.edges?.lines?.length || o.lines?.length || 0}</span>,
  };

  const statusCol: RowCol = {
    key: 'status',
    header: '状态',
    cell: (o) => (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(o.status)}`}>{format.statusText(o.status)}</span>
    ),
  };

  // [2026-09-14 统一操作列] 行操作从手写迁移到 RowActions 组件：
  // 宽屏平铺全部图标（观感不变）；窄屏/矮屏折叠为「主操作（查看）+ ⋮ 更多」——
  // 操作列由 ~220px（6 按钮平铺）降到 ~88px，与商品/客户等页完全一致。
  // 确认文案仍在各 handleXxx 内部（走 confirmAction），此处不传 confirm 防双层确认。
  const buildOrderActions = (o: PurchaseOrder): RowAction[] => {
    const actions: RowAction[] = [
      { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, primary: true, onClick: () => navigate(`/purchase-orders/${o.id}`) },
      { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/purchase_order/${o.id}`) },
      { key: 'copy', label: '再来一单（复制本单）', icon: <Copy className="w-4 h-4" />, onClick: () => navigate(`/purchase-orders/create?from=${o.id}`) },
    ];
    if (o.status === 'draft') {
      actions.push({ key: 'confirm', label: '确认', icon: <Check className="w-4 h-4" />, onClick: () => void handleConfirm(o.id, o.order_no) });
    }
    if (o.status === 'confirmed') {
      actions.push({ key: 'approve', label: '审核', icon: <Check className="w-4 h-4" />, onClick: () => void handleApprove(o.id, o.order_no) });
      // 「个人模式」：没有审批链，不展示「提交审批」（后端同时兜底为提交即通过）
      if (!personalMode) {
        actions.push({ key: 'submitApproval', label: '提交审批', icon: <Send className="w-4 h-4" />, onClick: () => void handleSubmitApproval(o.id, o.order_no) });
      }
    }
    if (o.status === 'draft' || o.status === 'confirmed') {
      actions.push({ key: 'cancel', label: '取消', icon: <X className="w-4 h-4" />, onClick: () => void handleCancel(o.id, o.order_no) });
    }
    if (o.status === 'approved') {
      actions.push({ key: 'close', label: '关闭', icon: <Ban className="w-4 h-4" />, onClick: () => void handleClose(o.id, o.order_no) });
    }
    if (o.status === 'draft') {
      actions.push({ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => void handleDelete(o.id, o.order_no) });
    }
    return actions;
  };

  const actionsCol: RowCol = {
    key: '__actions',
    headCls: TH_R,
    cellCls: `${TD} text-right`,
    header: '操作',
    cell: (o) => <RowActions actions={buildOrderActions(o)} />,
  };

  const infoColOf = (lc: LayoutColumn): RowCol => ({
    key: lc.field,
    width: lc.width,
    header: entityColLabel(lc.field, lc.label, metaFields),
    cell: (o) => renderInfoCell(lc.field, o),
  });

  // 列顺序：勾选/订单号/供应商 + 布局信息列 + 总金额/明细数/状态/操作（页面默认列）
  const baseRowCols: RowCol[] = [
    selCol,
    orderNoCol,
    supplierCol,
    ...infoCols.map(infoColOf),
    totalCol,
    linesCol,
    statusCol,
    actionsCol,
  ];

  // [2026-09-12] 元数据自定义字段 → 追加为「可选列」（默认隐藏，视图菜单可勾选显示）
  const baseColKeys = new Set(baseRowCols.map((c) => c.key));
  const META_COL_SKIP = new Set(['id', 'tenant_id', 'deleted_at', 'ext', 'ext_fields']);
  const metaExtraCols: RowCol[] = metaFields
    .filter((f) => f.code && !baseColKeys.has(f.code) && !META_COL_SKIP.has(f.code))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.code.localeCompare(b.code))
    .map((f) => ({
      key: f.code,
      header: f.name || entityColLabel(f.code, undefined, metaFields),
      cell: (o) => renderInfoCell(f.code, o),
    }));
  const rowCols: RowCol[] = [...baseRowCols, ...metaExtraCols];
  // 默认可见列 = 页面基础列（附加的自定义字段默认不显示，勾选后写入 URL 可分享）
  const defaultVisible = baseRowCols.map((c) => c.key);

  // [易用性 P2] 我的视图：可见列写入 URL（?cols=）可分享；列定义仍由元数据布局决定
  // [易用性 P2] 视图内新建字段（联动元数据；字段 API 需 system 权限，无权则不显示入口）
  const { permissions } = useAuthStore();
  const canManageFields = permissions.includes('*') || permissions.includes('system');
  const createEntityField = async (input: { name: string; code: string; fieldType: string }) => {
    const entRes = await entityApi.getByCode('purchase_order');
    const entityId = (entRes as { data?: { id?: string } }).data?.id;
    if (!entityId) throw new Error('未找到采购订单实体定义');
    await fieldApi.create({ entity_id: entityId, code: input.code, name: input.name, field_type: input.fieldType });
    // 重新拉布局 + 字段：新字段随即进入「视图 → 显示列」可选列（表单/详情同步可用）
    const data = await loadEntityListLayout('purchase_order');
    setMetaFields(data.fields);
    setLayoutCustomized(isEntityListLayoutCustomized(data.listColumns));
    return { appeared: true };
  };
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'purchase-order-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
    labelOf: (key) => metaFields.find((f) => f.code === key)?.name || '',
    createField: canManageFields ? createEntityField : undefined,
    entityLabel: '采购订单',
    defaultVisible,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="采购订单"
        subtitle="订单列表"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出 CSV</span>
            </button>
            <button onClick={() => navigate('/purchase-orders/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建订单</span>
            </button>
          </div>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索订单号或供应商名称..."
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="form-input pl-10"
              />
            </div>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-select w-32"
            >
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="confirmed">已确认</option>
              <option value="approved">已审核</option>
              <option value="closed">已关闭</option>
              <option value="cancelled">已取消</option>
            </select>
            {/* [2026-09-12] 我的筛选（U-03）：保存/套用常用条件组合；日期条件写 URL 可分享 */}
            <FilterPresetMenu
              pageKey="purchase-orders"
              currentParams={{ keyword: debouncedKeyword, status, start_date: dateRange.start_date, end_date: dateRange.end_date }}
              onApply={(p) => {
                setKeyword(p.keyword ?? '');
                setStatus(p.status ?? '');
                setDateRange({ start_date: p.start_date ?? '', end_date: p.end_date ?? '' });
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
            />
            {sel.count > 0 && <div className="mt-3">{batch.bar}</div>}
            {batch.failureModal}
            <div className="ml-auto">{viewMenu}</div>
          </div>
          {/* [2026-09-12] 日期区间筛选（U-02 下沉；配合「我的筛选」可保存「本月未到货」） */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPagination((prev) => ({ ...prev, page: 1 })); }} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th
                    key={c.key}
                    className={c.headCls || TH_L}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6">
                  {keyword.trim() || status || dateRange.start_date || dateRange.end_date ? (
                    // 筛选无结果 ≠ 真没数据：说清楚当前条件，并给一键清空（避免用户以为系统坏了）
                    <EmptyState
                      title="没有符合当前条件的订单"
                      description={`当前条件：${[
                        keyword.trim() ? `关键词「${keyword.trim()}」` : '',
                        status ? `状态「${format.statusText(status)}」` : '',
                        dateRange.start_date || dateRange.end_date ? `日期 ${dateRange.start_date || '不限'} ~ ${dateRange.end_date || '不限'}` : '',
                      ].filter(Boolean).join(' + ')}`}
                      action={
                        <button type="button" className="btn-secondary" onClick={() => { setKeyword(''); setStatus(''); setDateRange({ start_date: '', end_date: '' }); setPagination(prev => ({ ...prev, page: 1 })); }}>
                          清空筛选
                        </button>
                      }
                    />
                  ) : (
                    <EmptyState title="暂无订单数据" description="点击右上角「新建订单」开始录入" />
                  )}
                </td></tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(order)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && orders.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}
