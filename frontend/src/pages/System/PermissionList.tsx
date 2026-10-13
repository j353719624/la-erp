import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, Info } from 'lucide-react';
import { permissionApi } from '@/api/system';
import { Permission } from '@/types';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { usePermission } from '@/hooks/usePermission';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
export function PermissionList() {
  // [2026-09-18 权限细化] 按钮级门控：新增=permission_create / 编辑=permission_edit / 删除=permission_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [permissions, setPermissions] = useState<Permission[]>([]);
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

  useEffect(() => {
    fetchPermissions();
  }, [keyword, pagination.page]);

  const fetchPermissions = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const response = await permissionApi.list({
        page: pagination.page,
        page_size: pagination.page_size,
        // [2026-09-19] 后端已支持 keyword（名称/编码）——修复“搜索框写名称或编码、实际只按名称匹配”
        keyword: keyword || undefined,
      } as any);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        const list = response.data?.list || [];
        const total = response.data?.total || 0;
        setPermissions(list);
        setPagination(prev => ({ ...prev, total }));
      }
    } catch (err) {
      console.error('Failed to fetch permissions:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmAction({ title: `确定删除权限 ${name} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await permissionApi.delete(id);
      if (response.code === 0) {
        message.success(`权限 ${name} 已删除`);
        fetchPermissions();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete permission:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const groupedPermissions = permissions.reduce((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {} as Record<string, Permission[]>);

  return (
    <div className="space-y-6">
      <PageHeader
        title="权限码管理"
        subtitle="系统功能「权限码」字典（角色表单里勾选的就是这些码）"
        extra={
          has('permission_create') && (
            <button onClick={() => navigate('/system/permissions/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增权限码</span>
            </button>
          )
        }
      />

      {/* 说明（2026-09-19）：与「角色管理」的分工常被混淆——一行讲清 + 直达入口 */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <Info className="w-4 h-4 text-blue-500 shrink-0" />
        <span className="text-sm text-gray-600">
          此页维护「权限码」字典本身（系统每个功能开关的登记 / 改名 / 排序）；<b>日常给角色配权限请到「角色管理」勾选</b>，给用户发角色请到「用户管理」。
        </span>
        {has('role') && (
          <button type="button" onClick={() => navigate('/system/roles')} className="btn-secondary ml-auto shrink-0">
            去角色管理配权限
          </button>
        )}
      </div>

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索权限名称或编码..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="form-input pl-10"
            />
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-4"><TableSkeleton rows={4} /></div>
        ) : Object.keys(groupedPermissions).length === 0 ? (
          <ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无权限数据" />
        ) : (
          <div className="divide-y divide-gray-100">
            {Object.entries(groupedPermissions).map(([module, items]) => (
              <div key={module}>
                <div className="px-6 py-4 bg-gray-50 font-medium text-gray-700">
                  {module}
                </div>
                <div className="px-6 py-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-lg hover:border-blue-200">
                        <div>
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <p className="text-sm text-gray-500">{item.code}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {has('permission_edit') && (
                            <button onClick={() => navigate(`/system/permissions/${item.id}`)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                              <Edit className="w-4 h-4" />
                            </button>
                          )}
                          {has('permission_delete') && (
                            <button onClick={() => handleDelete(item.id, item.name)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && permissions.length > 0 && (
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