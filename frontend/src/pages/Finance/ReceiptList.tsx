import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Pencil, Trash2, Check, Ban, Printer } from 'lucide-react';
import { receiptApi } from '@/api/finance';
import { PaymentReceipt, PaymentReceiptLine } from '@/types/finance';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import type { ReactNode } from 'react';
import { DateRangeFilter } from '@/components/DateRangeFilter';
export function ReceiptList() {
  const navigate = useNavigate();
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', start_date: '', end_date: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  // [2026-09-12] 日期区间筛选（U-02）：快捷区间 + 起止日期，条件写 URL
  const [dateRange, setDateRange] = useState({ start_date: urlFilters.start_date, end_date: urlFilters.end_date });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, start_date: dateRange.start_date, end_date: dateRange.end_date, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchReceipts();
  }, [pagination.page, pagination.page_size, debouncedKeyword, dateRange.start_date, dateRange.end_date]);

  const fetchReceipts = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      // 后端收付款列表不支持 keyword/分页（返回全量数组），在客户端过滤 + 切片分页
      // [2026-09-12] 日期区间（U-02）走后端筛选（end_date 含当天整天）
      const params: PaginationParams = {
        page: 1,
        page_size: 10000,
        start_date: dateRange.start_date || undefined,
        end_date: dateRange.end_date || undefined,
      };
      const response = await receiptApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        const list = Array.isArray(response.data) ? response.data : (response.data?.list || []);
        const kw = (debouncedKeyword || '').trim().toLowerCase();
        const filtered = kw
          ? list.filter((r: any) =>
              String(r.receipt_no || '').toLowerCase().includes(kw) ||
              String(r.customer_name || r.edges?.customer?.name || '').toLowerCase().includes(kw))
          : list;
        const total = filtered.length;
        setReceipts(filtered.slice((pagination.page - 1) * pagination.page_size, pagination.page * pagination.page_size));
        setPagination(prev => ({ ...prev, total }));
      }
    } catch (err) {
      console.error('Failed to fetch receipts:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleConfirm = async (item: PaymentReceipt) => {
    if (!(await confirmAction({ title: `确定确认收款单 ${item.receipt_no} 吗？`, content: '确认后按单核销应收余额并生成收款凭证' }))) return;
    try {
      const response = await receiptApi.confirm(item.id);
      if (response.code === 0) {
        message.success(`收款单 ${item.receipt_no} 已确认`);
        fetchReceipts();
      } else {
        message.error(response.message || '确认失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '确认失败，请稍后重试');
    }
  };

  const handleCancel = async (item: PaymentReceipt) => {
    if (!(await confirmAction({ title: `确定取消收款单 ${item.receipt_no} 吗？`, content: '已确认的收款单将回滚应收核销余额', danger: true }))) return;
    try {
      const response = await receiptApi.cancel(item.id);
      if (response.code === 0) {
        message.success(`收款单 ${item.receipt_no} 已取消`);
        fetchReceipts();
      } else {
        message.error(response.message || '取消失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '取消失败，请稍后重试');
    }
  };

  const handleDelete = async (id: string, receiptNo: string) => {
    if (!(await confirmAction({ title: `确定删除收款单 ${receiptNo} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await receiptApi.delete(id);
      if (response.code === 0) {
        message.success(`收款单 ${receiptNo} 已删除`);
        fetchReceipts();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete receipt:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const allocationLines = (item: PaymentReceipt): PaymentReceiptLine[] => item.edges?.lines ?? item.lines ?? [];

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: PaymentReceipt) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  // [2026-09-18 权限细化] 确认/取消=receipt_edit；新增=receipt_create；删除=receipt_delete
  const { has } = usePermission();
  // [2026-09-13 U-05] 批量确认：逐条执行（每条都走核销+凭证校验）+ 失败原因汇总 + 导出选中
  const sel = useRowSelection({ rows: receipts, getKey: (item) => item.id });
  const batch = useBatchAction({
    selection: sel,
    label: (item) => item.receipt_no || item.id,
    onDone: fetchReceipts,
    actions: [
      {
        key: 'confirm',
        label: '批量确认',
        icon: <Check className="w-4 h-4" />,
        eligible: (item) => item.status === 'draft' && has('receipt_edit'),
        confirm: (rows) => ({ title: `确定确认选中的 ${rows.length} 张收款单？`, content: '确认后按单核销应收余额并生成收款凭证；逐条校验，失败的会列出单号与原因' }),
        run: (item) => receiptApi.confirm(item.id),
      },
    ],
    exportSpec: {
      filename: `收款单_选中_${format.today()}.csv`,
      headers: ['单据号', '客户', '收款日期', '金额', '收款方式', '状态'],
      row: (item) => [item.receipt_no, item.customer_name || (item as any).edges?.customer?.name || '', format.date(item.receipt_date), String(item.amount ?? ''), item.receipt_type || '', format.statusText(item.status)],
    },
  });

  const rowCols: RowCol[] = [
    {
      key: '__sel',
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
      headCls: 'px-4 py-3 w-10',
      cellCls: 'px-4 py-4',
      cell: (item) => (
        <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={sel.isSelected(item)} onChange={() => sel.toggle(item)} />
      ),
    },
    { key: 'receipt_no', header: '单据号', cell: (item) => <span className="font-medium text-gray-900">{item.receipt_no}</span> },
    { key: 'customer_name', header: '客户', cell: (item) => <span className="text-gray-900">{item.customer_name || (item as any).edges?.customer?.name || '-'}</span> },
    { key: 'receipt_date', header: '收款日期', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.receipt_date)}</span> },
    { key: 'amount', header: '金额', cell: (item) => <span className="font-medium text-gray-900">{format.amountText(item.amount, item.currency_code)}</span> },
    {
      key: 'allocations',
      header: '核销明细',
      cell: (item) => (
        allocationLines(item).length === 0 ? (
          <span className="text-gray-400 text-sm">—</span>
        ) : (
          <div className="space-y-0.5">
            {allocationLines(item).map((l) => (
              <div key={l.id} className="text-xs text-gray-500 whitespace-nowrap">
                {l.ar_invoice_no || '未指定单'} ¥{format.currency(l.amount)}
              </div>
            ))}
          </div>
        )
      ),
    },
    { key: 'receipt_type', header: '收款方式', cell: (item) => <span className="text-gray-500 text-sm">{item.receipt_type}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(item.status)}`}>{format.statusText(item.status)}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (item) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            ...(item.status === 'draft' && has('receipt_edit')
              ? [{ key: 'confirm', label: '确认', icon: <Check className="w-4 h-4" />, onClick: () => handleConfirm(item) }]
              : []),
            ...(item.status === 'confirmed' && has('receipt_edit')
              ? [{ key: 'cancel', label: '取消', icon: <Ban className="w-4 h-4" />, onClick: () => handleCancel(item) }]
              : []),
            { key: 'view', label: '查看', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/finance/receipts/${item.id}`) },
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/payment_receipt/${item.id}`) },
            ...(item.status === 'draft' && has('receipt_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.receipt_no) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'receipt-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="收款单"
        subtitle="收款单列表"
        extra={
          has('receipt_create') && (
            <button onClick={() => navigate('/finance/receipts/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增收款单</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索客户名称或单据号..."
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="form-input pl-10"
              />
            </div>
            <div className="ml-auto">{viewMenu}</div>
          </div>
          {/* [2026-09-12] 日期区间筛选（U-02）：快捷区间（本月/上月/本年）+ 起止日期，条件写 URL */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPagination(prev => ({ ...prev, page: 1 })); }} />
          </div>
        </div>

        {/* [2026-09-13 U-05] 批量工具条（勾选后出现；失败汇总弹窗必须独立渲染） */}
        {sel.count > 0 && <div className="px-4 pb-3">{batch.bar}</div>}
        {batch.failureModal}

        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : receipts.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无收款单数据" /></td></tr>
              ) : (
                receipts.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && receipts.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        )}
      </div>
    </div>
  );
}