import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Play, CheckCircle, XCircle, Trash2, Printer } from 'lucide-react';
import { stockTransferApi } from '@/api/inventory';
import { StockTransfer } from '@/types/inventory';
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
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';
export function StockTransferPage() {
  const navigate = useNavigate();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
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
    fetchTransfers();
  }, [pagination.page, pagination.page_size, debouncedKeyword]);

  const fetchTransfers = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        page_size: pagination.page_size,
        // 后端 stock-transfers List 读 transfer_no（不读 keyword）——此前搜索失效
        transfer_no: debouncedKeyword || undefined,
      };
      const response = await stockTransferApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setTransfers(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch stock transfers:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDispatch = async (id: string) => {
    if (!(await confirmAction({ title: '确定发运此调拨单吗？' }))) return;
    try {
      const response = await stockTransferApi.dispatch(id);
      if (response.code === 0) {
        message.success('调拨单已发运');
        fetchTransfers();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to dispatch transfer:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleComplete = async (id: string) => {
    if (!(await confirmAction({ title: '确定完成此调拨单吗？', content: '确认后库存将正式入库' }))) return;
    try {
      const response = await stockTransferApi.complete(id);
      if (response.code === 0) {
        message.success('调拨单已完成');
        fetchTransfers();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to complete transfer:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleCancel = async (id: string) => {
    if (!(await confirmAction({ title: '确定取消此调拨单吗？', danger: true }))) return;
    try {
      const response = await stockTransferApi.cancel(id);
      if (response.code === 0) {
        message.success('调拨单已取消');
        fetchTransfers();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to cancel transfer:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleDelete = async (id: string, transferNo: string) => {
    if (!(await confirmAction({ title: `确定删除调拨单 ${transferNo} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await stockTransferApi.delete(id);
      if (response.code === 0) {
        message.success(`调拨单 ${transferNo} 已删除`);
        fetchTransfers();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete transfer:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: StockTransfer) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  // [2026-09-18 权限细化] 发运/收货/取消=stock_transfer_edit；新增=stock_transfer_create；删除=stock_transfer_delete
  const { has } = usePermission();
  // [2026-09-13 U-05] 批量操作：勾选列（锁定首列）+ 批量发运/确认收货 + 导出选中
  const sel = useRowSelection({ rows: transfers, getKey: (d) => d.id! });
  const batch = useBatchAction({
    selection: sel,
    label: (d) => d.transfer_no || d.id!,
    onDone: fetchTransfers,
    actions: [
      {
        key: 'dispatch',
        label: '批量发运',
        icon: <Play className="w-4 h-4" />,
        eligible: (d) => d.status === 'draft' && has('stock_transfer_edit'),
        confirm: (rows) => ({ title: `确定发运选中的 ${rows.length} 张调拨单？`, content: '发运将扣减调出仓库存（逐条校验可用量，不足的会列出单号与原因）', danger: true }),
        run: (d) => stockTransferApi.dispatch(d.id!),
      },
      {
        key: 'receive',
        label: '批量确认收货',
        icon: <CheckCircle className="w-4 h-4" />,
        eligible: (d) => d.status === 'in_transit' && has('stock_transfer_edit'),
        confirm: (rows) => ({ title: `确定确认收货选中的 ${rows.length} 张调拨单？`, content: '收货将增加调入仓库存并生成凭证' }),
        run: (d) => stockTransferApi.complete(d.id!),
      },
    ],
    exportSpec: {
      filename: `库存调拨_选中_${format.today()}.csv`,
      headers: ['调拨单号', '调出仓库', '调入仓库', '调拨日期', '状态'],
      row: (d) => [d.transfer_no, d.from_warehouse_name || d.edges?.fromWarehouse?.name || '', d.to_warehouse_name || d.edges?.toWarehouse?.name || '', format.date(d.transfer_date), format.statusText(d.status)],
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
      cell: (item) => (
        <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={sel.isSelected(item)} onChange={() => sel.toggle(item)} />
      ),
    },
    { key: 'transfer_no', header: '调拨单号', cell: (item) => <span className="font-medium text-gray-900">{item.transfer_no}</span> },
    { key: 'from_warehouse', header: '调出仓库', cell: (item) => <span className="text-gray-900">{item.from_warehouse_name || item.edges?.fromWarehouse?.name || '-'}</span> },
    { key: 'to_warehouse', header: '调入仓库', cell: (item) => <span className="text-gray-900">{item.to_warehouse_name || item.edges?.toWarehouse?.name || '-'}</span> },
    { key: 'transfer_date', header: '调拨日期', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.transfer_date)}</span> },
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
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => navigate(`/inventory/transfer/${item.id}`) },
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/stock_transfer/${item.id}`) },
            ...(item.status === 'draft'
              ? [
                  ...(has('stock_transfer_edit')
                    ? [{ key: 'dispatch', label: '发运', icon: <Play className="w-4 h-4" />, onClick: () => handleDispatch(item.id) }]
                    : []),
                  ...(has('stock_transfer_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.transfer_no) }]
                    : []),
                ]
              : []),
            ...(item.status === 'in_transit' && has('stock_transfer_edit')
              ? [{ key: 'receive', label: '确认收货', icon: <CheckCircle className="w-4 h-4" />, onClick: () => handleComplete(item.id) }]
              : []),
            ...(item.status === 'draft' || item.status === 'in_transit'
              ? [...(has('stock_transfer_edit')
                  ? [{ key: 'cancel', label: '取消', icon: <XCircle className="w-4 h-4" />, danger: true, onClick: () => handleCancel(item.id) }]
                  : [])]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'stock-transfer-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存调拨"
        subtitle="库存调拨单列表"
        extra={
          has('stock_transfer_create') && (
            <button
              onClick={() => navigate('/inventory/transfer/create')}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建调拨单</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索调拨单号或仓库名称..."
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
              ) : transfers.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无库存调拨数据" /></td></tr>
              ) : (
                transfers.map((item) => (
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

        {!loading && transfers.length > 0 && (
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