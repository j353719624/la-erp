import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Edit, Trash2, CheckCircle2, Play, XCircle, Printer } from 'lucide-react';
import { productionApi } from '@/api/production';
import { ReworkOrder } from '@/types/production';
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
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
const STATUS: Record<string, { text: string; cls: string }> = {
  draft: { text: '草稿', cls: 'bg-gray-100 text-gray-600' },
  confirmed: { text: '已确认', cls: 'bg-blue-50 text-blue-600' },
  completed: { text: '已完成', cls: 'bg-green-50 text-green-600' },
  cancelled: { text: '已取消', cls: 'bg-red-50 text-red-600' },
};

const fmt = (v: string | number | undefined, d = 0) => (v === undefined || v === null || v === '' ? '0' : Number(v).toFixed(d));

export function ReworkOrderList() {
  // [2026-09-18 权限细化·批 2 生产] 新建=rework_order_create；编辑/确认/完成/取消=rework_order_edit；删除=rework_order_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [items, setItems] = useState<ReworkOrder[]>([]);
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
  const [status, setStatus] = useState('');

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => { setPagination(prev => ({ ...prev, page: 1 })); }, [keyword, status]);
  useEffect(() => { fetchList(); }, [pagination.page, debouncedKeyword, status]);

  const fetchList = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { status?: string; keyword?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined,
        status: status || undefined,
      };
      const res = await productionApi.reworkOrderList(params);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setItems(res.data?.list || []);
        setPagination(prev => ({ ...prev, total: res.data?.total || 0 }));
      }
    } catch (e) {
      console.error('Failed to fetch rework orders:', e);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const act = async (fn: () => Promise<any>, okMsg: string, title: string, danger = false) => {
    if (!(await confirmAction({ title, danger }))) return;
    try {
      const res = await fn();
      if (res.code === 0) {
        message.success(okMsg);
        fetchList();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '操作失败');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: ReworkOrder) => ReactNode;
  }
  const TH_L = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_C = 'px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-3';
  const rowCols: RowCol[] = [
    { key: 'code', header: '返工单号', cell: (item) => <span className="font-medium text-gray-900">{item.code}</span> },
    { key: 'work_order_no', header: '关联工单', cellCls: `${TD} text-sm text-gray-600`, cell: (item) => <span>{item.work_order_no || '-'}</span> },
    { key: 'process', header: '工序', cellCls: `${TD} text-sm text-gray-700`, cell: (item) => <span>{item.process_name || item.process_code || '-'}</span> },
    { key: 'qty_rework', header: '返工数量', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-900`, cell: (item) => <span>{fmt(item.qty_rework)}</span> },
    { key: 'qty_good', header: '合格', headCls: TH_R, cellCls: `${TD} text-right text-sm text-green-600`, cell: (item) => <span>{fmt(item.qty_good)}</span> },
    { key: 'qty_bad', header: '不合格', headCls: TH_R, cellCls: `${TD} text-right text-sm text-red-600`, cell: (item) => <span>{fmt(item.qty_bad)}</span> },
    { key: 'reason', header: '原因', cellCls: `${TD} text-sm text-gray-500 max-w-[160px] truncate`, cell: (item) => <span>{item.reason || '-'}</span> },
    {
      key: 'status',
      header: '状态',
      headCls: TH_C,
      cellCls: `${TD} text-center`,
      cell: (item) => {
        const st = STATUS[item.status || 'draft'] || STATUS.draft;
        return <span className={`px-2 py-1 rounded-full text-xs font-medium ${st.cls}`}>{st.text}</span>;
      },
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (item) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）；确认文案仍在 act() 内
        <RowActions
          actions={[
            { key: 'view', label: '详情', icon: <Eye className="w-4 h-4" />, onClick: () => navigate(`/production/rework-orders/${item.id}`) },
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/rework_order/${item.id}`) },
            ...(item.status === 'draft'
              ? [
                  ...(has('rework_order_edit')
                    ? [
                        { key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, onClick: () => navigate(`/production/rework-orders/${item.id}/edit`) },
                        { key: 'confirm', label: '确认', icon: <Play className="w-4 h-4" />, onClick: () => act(() => productionApi.confirmReworkOrder(item.id!), '已确认', `确定确认返工单 ${item.code}？`) },
                      ]
                    : []),
                  ...(has('rework_order_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => act(() => productionApi.deleteReworkOrder(item.id!), '已删除', `确定删除返工单 ${item.code}？`, true) }]
                    : []),
                ]
              : []),
            ...(item.status === 'confirmed'
              ? (has('rework_order_edit')
                  ? [
                      { key: 'complete', label: '完成', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => act(() => productionApi.completeReworkOrder(item.id!), '已完成', `确定完成返工单 ${item.code}？`) },
                      { key: 'cancel', label: '取消', icon: <XCircle className="w-4 h-4" />, danger: true, onClick: () => act(() => productionApi.cancelReworkOrder(item.id!), '已取消', `确定取消返工单 ${item.code}？`, true) },
                    ]
                  : [])
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'rework-order-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="返工单"
        subtitle="不合格品返工执行跟踪（草稿→确认→完成）"
        extra={
          has('rework_order_create') && (
            <button onClick={() => navigate('/production/rework-orders/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建返工单</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索返工单号/工序/原因..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="form-input pl-10"
              />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="form-select w-28">
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="confirmed">已确认</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
            <div className="ml-auto">{viewMenu}</div>
          </div>
        </div>

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
                <tr><td colSpan={visibleColumns.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-8"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无返工单" /></td></tr>
              ) : (
                items.map((item) => (
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

        {!loading && items.length > 0 && (
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
