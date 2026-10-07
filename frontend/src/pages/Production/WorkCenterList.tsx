import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { productionApi } from '@/api/production';
import { WorkCenter } from '@/types/production';
import { format } from '@/utils/format';
import { confirmAction } from '@/utils/confirm';
import { message } from '@/utils/appMessage';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { Pagination } from '@/components/Pagination';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';

export function WorkCenterList() {
  // [2026-09-18 权限细化·批 2 生产] 新增=work_center_create；编辑=work_center_edit；删除=work_center_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [items, setItems] = useState<WorkCenter[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  // 请求竞态守卫：快速切换搜索/翻页时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => { setPagination(prev => ({ ...prev, page: 1 })); }, [keyword]);
  useEffect(() => { fetchList(); }, [keyword, pagination.page]);

  const fetchList = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await productionApi.workCenterList({
        page: pagination.page,
        page_size: pagination.page_size,
        keyword: keyword || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setItems(res.data?.list || []);
        setPagination(prev => ({ ...prev, total: res.data?.total || 0 }));
      }
    } catch (e) {
      console.error('Failed to fetch work centers:', e);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirmAction({ title: `确定删除工作中心「${name}」？`, danger: true });
    if (!ok) return;
    try {
      const res = await productionApi.deleteWorkCenter(id);
      if (res.code === 0) {
        message.success('已删除');
        fetchList();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '删除失败');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: WorkCenter) => ReactNode;
  }
  const TH_C = 'px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'code', header: '编码', cell: (item) => <span className="font-medium text-gray-900">{item.code}</span> },
    { key: 'name', header: '名称', cell: (item) => <span className="text-gray-900">{item.name}</span> },
    { key: 'capacity', header: '产能/班次', cell: (item) => <span className="text-gray-500 text-sm">{item.capacity}</span> },
    { key: 'efficiency', header: '效率', cell: (item) => <span className="text-gray-500 text-sm">{(item.efficiency || 1) * 100}%</span> },
    { key: 'cost_rate', header: '成本率(元/时)', cell: (item) => <span className="text-gray-500 text-sm">¥{format.currency(item.cost_rate)}</span> },
    { key: 'manager', header: '负责人', cell: (item) => <span className="text-gray-500 text-sm">{item.manager || '-'}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {item.status === 'active' ? '启用' : '停用'}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      cell: (item) => (
        <div className="flex items-center justify-center gap-1">
          {has('work_center_edit') && (
            <button onClick={() => navigate(`/production/work-centers/${item.id}`)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="编辑">
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {has('work_center_delete') && (
            <button onClick={() => handleDelete(item.id!, item.name!)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="删除">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'work-center-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="工作中心"
        subtitle="生产资源主数据（产能 / 效率 / 成本率）"
        extra={
          has('work_center_create') && (
            <button onClick={() => navigate('/production/work-centers/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              <span className="hidden md:inline">新增工作中心</span>
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
              placeholder="搜索编码或名称..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
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
                  <th key={c.key} className={c.headCls || TH_C}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无工作中心" /></td></tr>
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
