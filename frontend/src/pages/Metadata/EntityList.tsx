import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Search, X } from 'lucide-react';
import { entityApi } from '@/api/metadata';
import { Entity } from '@/types/metadata';
import { PaginationParams } from '@/types';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { entityCategoryLabel } from '@/utils/columnLabels';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { Pagination } from '@/components/Pagination';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

export function EntityList() {
  // [2026-09-18 权限细化] 按钮级门控：新增=metadata_create / 删除=metadata_delete（「管理字段」为纯导航，字段页自身门控）
  const { has } = usePermission();
  const navigate = useNavigate();
  // [U-01 2026-09-14] 搜索/页码/每页条数写入 URL（刷新/返回/分享不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState(urlFilters.keyword);
  const [pagination, setPagination] = useState<PaginationParams>({ page: urlFilters.page, page_size: urlFilters.page_size });
  const [total, setTotal] = useState(0);
  // 请求竞态守卫：搜索/翻页快速触发时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchEntities();
  }, [pagination]);

  // [U-01 2026-09-14] 条件变化 → 写回 URL
  useEffect(() => {
    syncUrl({ keyword: searchTerm, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, pagination.page, pagination.page_size]);

  const fetchEntities = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      // [2026-09-12] 关键词此前未传入请求 → 搜索框看起来无效；现支持编码/名称/数据表名模糊匹配
      const response = await entityApi.list({ ...pagination, keyword: searchTerm.trim() || undefined });
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setEntities(response.data?.list || []);
        setTotal(response.data?.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch entities:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmAction({ title: '确定要删除该实体吗？', content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await entityApi.delete(id);
      if (response.code === 0) {
        message.success('实体已删除');
        fetchEntities();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete entity:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const handleSearch = () => {
    setPagination({ ...pagination, page: 1 });
    fetchEntities();
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    handleSearch();
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Entity) => ReactNode;
  }
  const TH = 'px-4 py-3 text-left text-sm font-semibold text-gray-600';
  const TD = 'px-4 py-3 text-sm';
  const rowCols: RowCol[] = [
    { key: 'code', header: '实体编码', cellCls: `${TD} text-gray-800`, cell: (entity) => <span>{entity.code}</span> },
    { key: 'name', header: '实体名称', cellCls: `${TD} text-gray-800`, cell: (entity) => <span>{entity.name}</span> },
    { key: 'category', header: '分类', cellCls: `${TD} text-gray-600`, cell: (entity) => <span>{entityCategoryLabel(entity.category)}</span> },
    { key: 'table_name', header: '数据表', cellCls: `${TD} text-gray-600`, cell: (entity) => <span>{entity.table_name}</span> },
    {
      key: 'is_system',
      header: '系统内置',
      cell: (entity) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${entity.is_system ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
          {entity.is_system ? '是' : '否'}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: () => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          启用
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      cell: (entity) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/metadata/fields/${entity.id}`)}
            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="管理字段"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          {!entity.is_system && has('metadata_delete') && (
            <button
              onClick={() => handleDelete(entity.id)}
              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="删除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'entity-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="实体管理"
        subtitle="管理系统中的数据实体"
        extra={
          has('metadata_create') && (
            <button
              onClick={() => navigate('/metadata/entities/create')}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增实体</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="搜索实体名称或编码..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchTerm && (
              <button onClick={handleClearSearch} className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>
          <div className="ml-auto">{viewMenu}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-4">
                    <TableSkeleton rows={5} />
                  </td>
                </tr>
              ) : entities.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-8 text-center">
                    <ListEmpty keyword={searchTerm} onClear={handleClearSearch} title="暂无实体数据" />
                  </td>
                </tr>
              ) : (
                entities.map((entity) => (
                  <tr key={entity.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(entity)}
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
          total={total}
          onPageChange={(page) => setPagination(p => ({ ...p, page }))}
          onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          loading={loading}
        />
      </div>
    </div>
  );
}
