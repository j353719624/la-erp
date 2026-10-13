import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, CheckCircle, Trash2, Printer, X, Download } from 'lucide-react';
import { salesReturnApi } from '@/api/order';
import { SalesReturn } from '@/types/order';
import { format } from '@/utils/format';
import { exportCsv } from '@/utils/exportCsv';
import { PaginationParams } from '@/types';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { usePermission } from '@/hooks/usePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import type { ReactNode } from 'react';
export function SalesReturnList() {
  // [2026-09-18 权限细化·第3批] 退货单独立四件套
  const { has } = usePermission();
  const navigate = useNavigate();
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchReturns();
  }, [pagination.page, pagination.page_size, debouncedKeyword]);

  const fetchReturns = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { order_no?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        order_no: debouncedKeyword || undefined,
      };
      const response = await salesReturnApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setReturns(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch sales returns:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleConfirm = async (id: string) => {
    if (!(await confirmAction({ title: '确认要确认此退货单吗？', content: '确认后将无法修改' }))) return;
    try {
      const response = await salesReturnApi.confirm(id);
      if (response.code === 0) {
        message.success('退货单已确认');
        fetchReturns();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to confirm sales return:', err);
      message.error(err instanceof Error && err.message ? err.message : '确认失败');
    }
  };

  const handleApprove = async (id: string) => {
    if (!(await confirmAction({ title: '确定审核此退货单吗？' }))) return;
    try {
      const response = await salesReturnApi.approve(id);
      if (response.code === 0) {
        message.success('退货单已审核');
        fetchReturns();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to approve sales return:', err);
      message.error(err instanceof Error && err.message ? err.message : '审核失败');
    }
  };

  const handleCancel = async (id: string) => {
    if (!(await confirmAction({ title: '确定取消此退货单吗？', danger: true }))) return;
    try {
      const response = await salesReturnApi.cancel(id);
      if (response.code === 0) {
        message.success('退货单已取消');
        fetchReturns();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to cancel sales return:', err);
      message.error(err instanceof Error && err.message ? err.message : '取消失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmAction({ title: '确认要删除此退货单吗？', content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await salesReturnApi.delete(id);
      if (response.code === 0) {
        message.success('退货单已删除');
        fetchReturns();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete sales return:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: SalesReturn) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  // [2026-09-13 U-05] 批量操作：勾选列（锁定首列）+ 批量确认/审核 + 导出选中
  const sel = useRowSelection({ rows: returns, getKey: (d: any) => d.id });
  const batch = useBatchAction({
    selection: sel,
    label: (d: any) => d.order_no || d.id,
    onDone: fetchReturns,
    actions: [
      {
        key: 'confirm',
        label: '批量确认',
        icon: <CheckCircle className="w-4 h-4" />,
        eligible: (d: any) => d.status === 'draft' && has('sales_return_edit'),
        confirm: (rows) => ({ title: `确定确认选中的 ${rows.length} 张退货单？`, content: '确认后将无法修改；逐条校验，失败的会在结果中列出单号与原因' }),
        run: (d: any) => salesReturnApi.confirm(d.id),
      },
      {
        key: 'approve',
        label: '批量审核',
        icon: <CheckCircle className="w-4 h-4" />,
        eligible: (d: any) => d.status === 'confirmed' && has('sales_return_edit'),
        confirm: (rows) => ({ title: `确定审核选中的 ${rows.length} 张退货单？`, content: '审核通过后不可修改；失败的会在结果中列出单号与原因' }),
        run: (d: any) => salesReturnApi.approve(d.id),
      },
    ],
    exportSpec: {
      filename: `销售退货_选中_${format.today()}.csv`,
      headers: ['退货单号', '关联销售单', '客户', '退货日期', '退货原因', '金额', '状态'],
      row: (d: any) => [d.order_no, d.sales_order_no || '', d.customer_name || '', format.date(d.order_date), d.return_reason || '', Number(d.total_amount ?? 0).toFixed(2), format.statusText(d.status)],
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
        />
      ),
      headCls: 'px-4 py-3 w-10',
      cellCls: 'px-4 py-4',
      cell: (item: any) => (
        <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={sel.isSelected(item)} onChange={() => sel.toggle(item)} />
      ),
    },
    { key: 'order_no', header: '退货单号', cell: (item: any) => <span className="font-medium text-gray-900">{item.order_no}</span> },
    { key: 'sales_order_no', header: '原订单号', cell: (item: any) => <span className="text-gray-500 text-sm">{item.sales_order_no}</span> },
    { key: 'customer_name', header: '客户', cell: (item: any) => <span className="text-gray-900">{item.customer_name || item.edges?.customer?.name || '-'}</span> },
    { key: 'order_date', header: '退货日期', cell: (item: any) => <span className="text-gray-500 text-sm">{format.date(item.order_date)}</span> },
    { key: 'return_reason', header: '退货原因', cellCls: `${TD} max-w-xs truncate`, cell: (item: any) => <span className="text-gray-500 text-sm">{item.return_reason}</span> },
    { key: 'total_amount', header: '金额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (item: any) => <span className="font-medium text-gray-900">{format.amountText(item.total_amount, item.currency)}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (item: any) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(item.status)}`}>{format.statusText(item.status)}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (item: any) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => navigate(`/sales-returns/${item.id}`) },
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/sales_return/${item.id}`) },
            ...(item.status === 'draft' && has('sales_return_edit')
              ? [
                  { key: 'confirm', label: '确认', icon: <CheckCircle className="w-4 h-4" />, onClick: () => handleConfirm(item.id) },
                  { key: 'cancel', label: '取消', icon: <X className="w-4 h-4" />, onClick: () => handleCancel(item.id) },
                ]
              : []),
            ...(item.status === 'draft' && has('sales_return_delete')
              ? [
                  { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id) },
                ]
              : []),
            ...(item.status === 'confirmed' && has('sales_return_edit')
              ? [
                  { key: 'approve', label: '审核', icon: <CheckCircle className="w-4 h-4" />, onClick: () => handleApprove(item.id) },
                  { key: 'cancel', label: '取消', icon: <X className="w-4 h-4" />, danger: true, onClick: () => handleCancel(item.id) },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'sales-return-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="销售退货"
        subtitle="销售退货单列表"
        extra={
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCsv(`销售退货_${format.today()}.csv`,
                ['退货单号', '关联销售单', '客户', '退货日期', '退货原因', '金额', '状态'],
                returns.map((item: any) => [item.order_no, item.sales_order_no || '', item.customer_name, format.date(item.order_date), item.return_reason, Number(item.total_amount).toFixed(2), format.statusText(item.status)]))}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出 CSV</span>
            </button>
            {has('sales_return_create') && (
              <button
                onClick={() => navigate('/sales-returns/create')}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新建退货单</span>
              </button>
            )}
          </div>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索客户名称或退货单号..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
          </div>
          <div className="ml-auto">{viewMenu}</div>
        </div>

        {batch.failureModal}
        {sel.count > 0 && <div className="px-4 pb-3">{batch.bar}</div>}

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
              ) : returns.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无销售退货数据" /></td></tr>
              ) : (
                returns.map((item: any) => (
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
      </div>
    </div>
  );
}