import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, Copy, Eye } from 'lucide-react';
import { Drawer } from 'antd';
import { roleApi } from '@/api/system';
import { Role } from '@/types';
import { format } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { usePermission } from '@/hooks/usePermission';
// [2026-09-17 角色可视化] 菜单预览（所见即所得：该角色登录后左侧导航会看到什么）
import { PermissionMenuPreview } from '@/components/PermissionMenuPreview';
import { menuItems } from '@/components/Layout/Sidebar';
import { menuPreviewStats, visibleMenusForPreview } from '@/utils/menuPreview';
import { useAppStore } from '@/store/app';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { RowActions } from '@/components/RowActions';
import type { ReactNode } from 'react';
// 数据范围中文文案（预览抽屉展示）
const DATA_SCOPE_TEXT: Record<string, string> = { all: '全部数据', dept: '本部门数据', self: '仅本人数据' };

export function RoleList() {
  // [2026-09-18 权限细化] 按钮级门控：新增·复制=role_create / 编辑=role_edit / 删除=role_delete（「预览菜单」只读不门控）
  const { has } = usePermission();
  const navigate = useNavigate();
  const [roles, setRoles] = useState<Role[]>([]);
  // [2026-09-17 角色可视化] 预览菜单抽屉：展开的即为该角色登录后可见的左侧导航
  const [previewRole, setPreviewRole] = useState<Role | null>(null);
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
    fetchRoles();
  }, [keyword, pagination.page, pagination.page_size]);

  const fetchRoles = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const response = await roleApi.list({
        page: pagination.page,
        page_size: pagination.page_size,
        // 后端支持 name 检索；此前仅对当前页做客户端过滤，角色>10 时搜索漏命中
        name: keyword || undefined,
      } as any);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        const data = (response.data?.list || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          code: item.code,
          data_scope: item.data_scope,
          permissions: item.edges?.permissions || [],
        }));
        setRoles(data);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmAction({ title: `确定删除角色 ${name} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await roleApi.delete(id);
      if (response.code === 0) {
        message.success(`角色 ${name} 已删除`);
        fetchRoles();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete role:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Role) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  // 「個人模式」：菜单数需与运行期侧栏一致（隐藏审批入口）
  const personalMode = useAppStore((s) => s.personalMode);
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'name', header: '角色名称', cellCls: `${TD} font-medium text-gray-900`, cell: (item) => <span>{item.name}</span> },
    { key: 'code', header: '角色编码', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => <span>{item.code}</span> },
    {
      key: 'permission_count',
      header: '权限数量',
      cellCls: `${TD} text-gray-500 text-sm`,
      // [2026-09-17 角色可视化] 不只数量，直接给出「可见几个菜单」——不用点进去就知道这个角色能看什么
      cell: (item) => {
        const codes = (item.permissions || []).map((p) => p.code);
        const menus = codes.length ? menuPreviewStats(visibleMenusForPreview(menuItems, codes, personalMode)).menus : 0;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span>{item.permissions?.length || 0} 项</span>
            <span className="text-gray-300">·</span>
            <span className={menus > 0 ? 'text-blue-600' : 'text-gray-400'}>{menus} 个菜单</span>
          </span>
        );
      },
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      // [2026-09-14 统一操作列] 手写按钮迁移 RowActions：窄屏折叠「主操作 + ⋮」，操作列 ~88px
      cell: (item) => (
        <RowActions
          actions={[
            // [2026-09-18 权限细化] 编辑=role_edit；复制=创建路径(role_create)；删除=role_delete；预览菜单只读不门控
            ...(has('role_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, primary: true, onClick: () => navigate(`/system/roles/${item.id}`) }]
              : []),
            { key: 'preview', label: '预览菜单（该角色可见的导航）', icon: <Eye className="w-4 h-4" />, onClick: () => setPreviewRole(item) },
            ...(has('role_create')
              ? [{ key: 'copy', label: '复制角色（带出全部权限）', icon: <Copy className="w-4 h-4" />, onClick: () => navigate(`/system/roles/create?from=${item.id}`) }]
              : []),
            ...(has('role_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.name) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'role-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="角色管理"
        subtitle="系统角色列表"
        extra={
          has('role_create') && (
            <button onClick={() => navigate('/system/roles/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增角色</span>
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
              placeholder="搜索角色名称或编码..."
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
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : roles.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无角色数据" /></td></tr>
              ) : (
                roles.map((item) => (
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

        {!loading && roles.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
            loading={loading}
          />
        )}
      </div>

      {/* [2026-09-17 角色可视化]「预览菜单」抽屉：所见即所得地查看该角色登录后可见的左侧导航 */}
      <Drawer
        title={previewRole ? `菜单预览：${previewRole.name}` : '菜单预览'}
        open={!!previewRole}
        onClose={() => setPreviewRole(null)}
        size={420}
        destroyOnHidden
      >
        {previewRole && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              数据范围：{DATA_SCOPE_TEXT[previewRole.data_scope || 'all'] || '全部数据'}。
              以下为按该角色权限计算出的左侧导航（与登录后一致）。
            </p>
            <PermissionMenuPreview permissions={(previewRole.permissions || []).map((p) => p.code)} />
          </div>
        )}
      </Drawer>
    </div>
  );
}