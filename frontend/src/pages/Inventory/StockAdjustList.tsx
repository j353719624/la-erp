import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, Trash2, CheckCircle2, X } from 'lucide-react';
import { stockAdjustApi } from '@/api/inventory';
import { StockAdjust } from '@/types/inventory';
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
import type { ReactNode } from 'react';
const ADJUST_TYPE_TEXT: Record<string, string> = {
  profit: '盘盈',
  loss: '盘亏',
  write_off: '报损',
  cost: '成本调整',
};

const STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  cancelled: '已取消',
};

export function StockAdjustList() {
  const navigate = useNavigate();
  // [2026-09-18 权限细化] 新增=stock_adjust_create；编辑/确认/取消=stock_adjust_edit；删除=stock_adjust_delete
  const { has } = usePermission();
  const [adjusts, setAdjusts] = useState<StockAdjust[]>([]);
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
  const [detail, setDetail] = useState<StockAdjust | null>(null);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchAdjusts();
  }, [pagination.page, pagination.page_size, debouncedKeyword]);

  const fetchAdjusts = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { adjust_no?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        adjust_no: debouncedKeyword || undefined,
      };
      const response = await stockAdjustApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setAdjusts(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch stock adjusts:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, no: string) => {
    if (!(await confirmAction({ title: `确定删除调整单 ${no} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await stockAdjustApi.delete(id);
      if (response.code === 0) {
        message.success(`调整单 ${no} 已删除`);
        fetchAdjusts();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete stock adjust:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const handleConfirm = async (id: string, no: string) => {
    if (!(await confirmAction({ title: `确定确认调整单 ${no} 吗？`, content: '确认后将按行生成库存调整流水，不可撤销', danger: true }))) return;
    try {
      const response = await stockAdjustApi.confirm(id);
      if (response.code === 0) {
        message.success(`调整单 ${no} 已确认，库存已调整`);
        fetchAdjusts();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to confirm stock adjust:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleCancel = async (id: string, no: string) => {
    if (!(await confirmAction({ title: `确定取消调整单 ${no} 吗？`, danger: true }))) return;
    try {
      const response = await stockAdjustApi.cancel(id);
      if (response.code === 0) {
        message.success(`调整单 ${no} 已取消`);
        fetchAdjusts();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to cancel stock adjust:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const openDetail = async (id: string) => {
    try {
      const response = await stockAdjustApi.get(id);
      if (response.code === 0) {
        setDetail(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch stock adjust detail:', err);
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: StockAdjust) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'adjust_no', header: '调整单号', cell: (a) => <span className="text-sm font-medium text-gray-900">{a.adjust_no}</span> },
    { key: 'adjust_type', header: '类型', cell: (a) => <span className="text-sm text-gray-600">{ADJUST_TYPE_TEXT[a.adjust_type] || a.adjust_type}</span> },
    { key: 'adjust_date', header: '调整日期', cell: (a) => <span className="text-sm text-gray-600">{format.date(a.adjust_date)}</span> },
    { key: 'total_qty', header: '数量', headCls: TH_R, cellCls: `${TD} text-right`, cell: (a) => <span className="text-sm text-gray-600">{a.total_qty}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (a) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${
          a.status === 'confirmed' ? 'bg-green-100 text-green-600'
          : a.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
          : 'bg-blue-100 text-blue-600'}`}>
          {STATUS_TEXT[a.status] || a.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (a) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => openDetail(a.id) },
            ...(a.status === 'draft'
              ? [
                  ...(has('stock_adjust_edit')
                    ? [
                        { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/inventory/adjust/${a.id}`) },
                        { key: 'confirm', label: '确认', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => handleConfirm(a.id, a.adjust_no) },
                        { key: 'cancel', label: '取消', icon: <X className="w-4 h-4" />, onClick: () => handleCancel(a.id, a.adjust_no) },
                      ]
                    : []),
                  ...(has('stock_adjust_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(a.id, a.adjust_no) }]
                    : []),
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'stock-adjust-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存调整"
        subtitle="盘盈/盘亏/报损/成本调整单"
        extra={
          has('stock_adjust_create') && (
            <button
              onClick={() => navigate('/inventory/adjust/create')}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建调整单</span>
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
              placeholder="搜索调整单号..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
          </div>
          <div className="ml-auto">{viewMenu}</div>
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
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : adjusts.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无调整单数据" /></td></tr>
              ) : (
                adjusts.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(a)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={pagination.page}
          pageSize={pagination.page_size}
          total={pagination.total}
          onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
          loading={loading}
          onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
        />
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">调整单 {detail.adjust_no}</h3>
              <button onClick={() => setDetail(null)} className="icon-btn" title="关闭">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div><span className="text-gray-500">类型：</span>{ADJUST_TYPE_TEXT[detail.adjust_type] || detail.adjust_type}</div>
                <div><span className="text-gray-500">日期：</span>{format.date(detail.adjust_date)}</div>
                <div><span className="text-gray-500">状态：</span>{STATUS_TEXT[detail.status] || detail.status}</div>
                <div><span className="text-gray-500">数量：</span>{detail.adjust_type === 'cost' ? '—（成本调整无数量变动）' : detail.total_qty}</div>
                {detail.remark && <div className="col-span-2"><span className="text-gray-500">备注：</span>{detail.remark}</div>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">商品</th>
                      {detail.adjust_type !== 'cost' && <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">数量</th>}
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                        {detail.adjust_type === 'cost' ? '调整后成本价' : '成本价'}
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">批次</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(detail.lines || detail.edges?.lines || []).map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2 text-sm text-gray-700">{line.product_name}</td>
                        {detail.adjust_type !== 'cost' && <td className="px-4 py-2 text-sm text-right text-gray-700">{line.qty}</td>}
                        <td className="px-4 py-2 text-sm text-right text-gray-700">¥{format.currency(line.unit_cost)}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{line.batch_no || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
