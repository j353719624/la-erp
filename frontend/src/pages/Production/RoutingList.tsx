import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Edit, Trash2 } from 'lucide-react';
import { productionApi } from '@/api/production';
import { Routing } from '@/types/production';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
export function RoutingList() {
  // [2026-09-18 权限细化·批 2 生产] 新建=routing_create；编辑=routing_edit；删除=routing_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [routings, setRoutings] = useState<Routing[]>([]);
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
    fetchRoutings();
  }, [pagination.page, pagination.page_size, debouncedKeyword]);

  const fetchRoutings = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        page_size: pagination.page_size,
        // 后端 routings List 读 code（不读 keyword）——此前搜索失效
        code: debouncedKeyword || undefined,
      };
      const response = await productionApi.routingList(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        const list = response.data?.list || [];
        const mappedList = list.map((item: any) => ({
          id: item.id,
          routing_code: item.code,
          routing_name: item.name || '',
          product_name: item.product_name,
          operation_count: (item.edges?.steps || []).length,
          status: item.status,
        }));
        setRoutings(mappedList);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch routings:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, code: string) => {
    if (!(await confirmAction({ title: `确定删除工艺路线 ${code} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await productionApi.deleteRouting(id);
      if (response.code === 0) {
        message.success(`工艺路线 ${code} 已删除`);
        fetchRoutings();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete routing:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Routing) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'routing_code', header: '工艺编码', cell: (item) => <span className="font-medium text-gray-900">{item.routing_code}</span> },
    { key: 'routing_name', header: '工艺名称', cell: (item) => <span className="text-gray-900">{item.routing_name}</span> },
    { key: 'product_name', header: '产品名称', cell: (item) => <span className="text-gray-500 text-sm">{item.product_name}</span> },
    { key: 'operation_count', header: '工序数量', cell: (item) => <span className="text-gray-500 text-sm">{item.operation_count}</span> },
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
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => navigate(`/production/routing/${item.id}`)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="查看">
            <Eye className="w-4 h-4" />
          </button>
          {has('routing_edit') && (
            <button onClick={() => navigate(`/production/routing/${item.id}/edit`)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="编辑">
              <Edit className="w-4 h-4" />
            </button>
          )}
          {has('routing_delete') && (
            <button onClick={() => handleDelete(item.id, item.routing_code)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="删除">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'routing-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="生产管理"
        subtitle="工艺路线"
        extra={
          has('routing_create') && (
            <button onClick={() => navigate('/production/routing/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建工艺路线</span>
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
              placeholder="搜索工艺路线编码或名称..."
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
              ) : routings.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无工艺路线数据" /></td></tr>
              ) : (
                routings.map((item) => (
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

        {!loading && routings.length > 0 && (
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