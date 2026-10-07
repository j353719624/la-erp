import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Check, Ban, Trash2 } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { productionApi } from '@/api/production';
import { ProductionReturn } from '@/types/production';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
const STATUS_TEXT: Record<string, string> = { draft: '草稿', confirmed: '已确认', cancelled: '已取消' };
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-yellow-50 text-yellow-700',
  confirmed: 'bg-green-50 text-green-600',
  cancelled: 'bg-gray-100 text-gray-500',
};
const REASON_TEXT: Record<string, string> = { excess: '多余退回', bad: '不良退回', other: '其他' };

export function ProductionReturnList() {
  // [2026-09-18 权限细化·批 2 生产] 新增=production_return_create；确认/取消=production_return_edit；删除=production_return_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [list, setList] = useState<ProductionReturn[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [status, setStatus] = useState('');
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams = { page: pagination.page, page_size: pagination.page_size };
      const res = await productionApi.returnList({ ...params, return_no: debouncedKeyword || undefined, status: status || undefined } as any);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, debouncedKeyword, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleConfirm = async (r: ProductionReturn) => {
    if (!(await confirmAction({ title: `确定确认退料单 ${r.return_no} 吗？`, content: '确认后将生成入库流水' }))) return;
    const res = await productionApi.confirmReturn(r.id);
    if (res.code === 0) { message.success('已确认，物料已退回仓库'); fetchList(); }
    else message.error(res.message || '确认失败');
  };

  const handleCancel = async (r: ProductionReturn) => {
    if (!(await confirmAction({ title: `确定取消退料单 ${r.return_no} 吗？`, danger: true }))) return;
    const res = await productionApi.cancelReturn(r.id);
    if (res.code === 0) { message.success('已取消'); fetchList(); }
    else message.error(res.message || '取消失败');
  };

  const handleDelete = async (r: ProductionReturn) => {
    if (!(await confirmAction({ title: `确定删除退料单 ${r.return_no} 吗？`, danger: true }))) return;
    const res = await productionApi.deleteReturn(r.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); }
    else message.error(res.message || '删除失败');
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: ProductionReturn) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'return_no', header: '退料单号', cell: (r) => <span className="font-medium text-gray-900">{r.return_no}</span> },
    { key: 'work_order_no', header: '工单', cell: (r) => <span className="text-gray-600 text-sm">{r.work_order_no || '-'}</span> },
    { key: 'return_date', header: '退料日期', cell: (r) => <span className="text-gray-500 text-sm">{format.date(r.return_date)}</span> },
    { key: 'reason', header: '原因', cell: (r) => <span className="text-gray-500 text-sm">{REASON_TEXT[r.reason] || r.reason}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (r) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[r.status] || 'bg-gray-100 text-gray-600'}`}>
          {STATUS_TEXT[r.status] || r.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (r) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => navigate(`/production-returns/${r.id}`) },
            ...(r.status === 'draft'
              ? [
                  ...(has('production_return_edit')
                    ? [
                        { key: 'confirm', label: '确认', icon: <Check className="w-4 h-4" />, onClick: () => handleConfirm(r) },
                        { key: 'cancel', label: '取消', icon: <Ban className="w-4 h-4" />, onClick: () => handleCancel(r) },
                      ]
                    : []),
                  ...(has('production_return_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(r) }]
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
    pageKey: 'production-return-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="生产退料"
        subtitle="领料后多余/不良物料退回仓库"
        extra={
          has('production_return_create') && (
            <button onClick={() => navigate('/production-returns/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增退料</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索退料单号..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已确认</option>
            <option value="cancelled">已取消</option>
          </select>
          <div className="ml-auto flex items-center">{viewMenu}</div>
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
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无退料单" description="领料后多余/不良物料可发起退料" /></td></tr>
              ) : (
                list.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && list.length > 0 && (
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
