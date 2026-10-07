import { useState, useEffect } from 'react';
import { Modal } from 'antd';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, KeyRound, Upload } from 'lucide-react';
import { userApi, departmentApi, roleApi } from '@/api/system';
import { User } from '@/types';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { ImportModal } from '@/components/ImportModal';
import { SearchSelect } from '@/components/SearchSelect';
import { loadOptions } from '@/utils/loadOptions';
import { PERM_IMPORT_EXPORT, hasPermissionNow, usePermission } from '@/hooks/usePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { RowActions } from '@/components/RowActions';
import type { ReactNode } from 'react';
export function UserList() {
  // [2026-09-18 权限细化] 按钮级门控：新增=user_create / 编辑·重置密码=user_edit / 删除=user_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', department_id: '', role_id: '', status: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  // [易用性 2026-09-19] 部门 / 角色 / 状态筛选（写 URL，刷新/分享不丢条件）
  const [departmentId, setDepartmentId] = useState(urlFilters.department_id || '');
  const [roleId, setRoleId] = useState(urlFilters.role_id || '');
  const [status, setStatus] = useState(urlFilters.status || '');
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [roleOptions, setRoleOptions] = useState<{ value: string; label: string }[]>([]);
  // [2026-09-12] 重置密码结果（临时密码仅显示一次，可复制）
  const [resetResult, setResetResult] = useState<{ username: string; password: string } | null>(null);
  // [S-01b 2026-09-13] 批量导入用户（CSV/Excel）
  const [importOpen, setImportOpen] = useState(false);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, department_id: departmentId, role_id: roleId, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, departmentId, roleId, status, pagination.page, pagination.page_size]);

  // [易用性 2026-09-19] 筛选下拉（失败隔离：缺权限时该项为空，不影响其它）
  useEffect(() => {
    (async () => {
      const [deptRes, roleRes] = await loadOptions([
        departmentApi.listAll(),
        roleApi.list({ page: 1, page_size: 200 }),
      ], '用户管理筛选');
      if (deptRes?.code === 0) {
        setDepartments((deptRes.data || []).map((d: any) => ({ value: d.id, label: d.name })));
      }
      if (roleRes?.code === 0) {
        setRoleOptions((roleRes.data?.list || []).map((r: any) => ({ value: r.id, label: r.name })));
      }
    })();
  }, []);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchUsers();
  }, [pagination.page, pagination.page_size, debouncedKeyword, departmentId, roleId, status]);

  const fetchUsers = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        page_size: pagination.page_size,
        // [2026-09-19] 后端已支持 keyword（用户名/姓名/邮箱/手机号）——修复“搜索框写用户名或邮箱、实际只按姓名匹配”
        keyword: debouncedKeyword || undefined,
        department_id: departmentId || undefined,
        role_id: roleId || undefined,
        status: status || undefined,
      };
      const response = await userApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        const list = response.data?.list || [];
        const mappedList = list.map((item: any) => ({
          id: item.id,
          username: item.username,
          name: item.name,
          email: item.email || '',
          Email: item.email || null,
          phone: item.phone || '',
          Phone: item.phone || null,
          status: item.status,
          Status: item.status,
          role: (item.edges?.roles || []).length > 0 ? item.edges.roles[0] : null,
          roles: item.edges?.roles || [],
          Roles: item.edges?.roles || [],
          created_at: item.created_at,
          CreatedAt: item.created_at,
          ID: item.id,
          Username: item.username,
          Name: item.name,
          department_id: item.department_id || null,
          department_name: item.department_id ? ((response.data as any)?.departments || {})[item.department_id] || '-' : '-',
        }));
        setUsers(mappedList);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, username: string) => {
    if (!(await confirmAction({ title: `确定删除用户 ${username} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await userApi.delete(id);
      if (response.code === 0) {
        message.success(`用户 ${username} 已删除`);
        fetchUsers();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete user:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [2026-09-12] 管理员重置密码：生成一次性临时密码（用户旧会话失效）
  const handleResetPassword = async (u: User) => {
    if (!(await confirmAction({
      title: `确定重置「${u.name || u.username}」的密码？`,
      content: '将生成一次性临时密码，该用户当前登录的会话会全部失效',
      danger: true,
    }))) return;
    try {
      const response = await userApi.resetPassword(u.id);
      if (response.code === 0) {
        setResetResult({ username: u.username, password: (response.data as any)?.temp_password || '' });
      } else {
        message.error(response.message || '重置失败');
      }
    } catch (err) {
      console.error('Failed to reset password:', err);
      message.error(err instanceof Error && err.message ? err.message : '重置失败，请稍后重试');
    }
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: User) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'username', header: '用户名', cellCls: `${TD} font-medium text-gray-900`, cell: (item) => <span>{item.username}</span> },
    { key: 'name', header: '姓名', cellCls: `${TD} text-gray-900`, cell: (item) => <span>{item.name}</span> },
    { key: 'email', header: '邮箱', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => <span>{item.email}</span> },
    { key: 'department_name', header: '部门', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => <span>{(item as any).department_name || '-'}</span> },
    { key: 'role', header: '角色', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => {
      const rs = (item as any).roles as { name?: string }[] | undefined;
      const names = (rs || []).map((r) => r.name || '').filter(Boolean);
      if (names.length === 0) return <span>-</span>;
      const shown = names.slice(0, 2);
      return (
        <span className="inline-flex flex-wrap items-center gap-1" title={names.join('、')}>
          {shown.map((n) => (
            <span key={n} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">{n}</span>
          ))}
          {names.length > shown.length && <span className="text-xs text-gray-400">+{names.length - shown.length}</span>}
        </span>
      );
    } },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(item.status)}`}>{format.statusText(item.status)}</span>
      ),
    },
    { key: 'created_at', header: '创建时间', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => <span>{format.date(item.created_at)}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      // [2026-09-14 统一操作列] 手写按钮迁移 RowActions：窄屏折叠「主操作 + ⋮」，操作列 ~88px
      cell: (item) => (
        <RowActions
          actions={[
            // [2026-09-18 权限细化] 编辑/重置密码=user_edit；删除=user_delete
            ...(has('user_edit')
              ? [
                  { key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, primary: true, onClick: () => navigate(`/system/users/${item.id}`) },
                  { key: 'resetPwd', label: '重置密码（生成临时密码）', icon: <KeyRound className="w-4 h-4" />, onClick: () => handleResetPassword(item) },
                ]
              : []),
            ...(has('user_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.username) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'user-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  // 空态筛选说明（2026-09-19）：筛了部门/角色/状态却 0 条时，不得显示“暂无数据→新增”
  const userFilterNote = [
    departmentId ? `部门「${departments.find((d) => d.value === departmentId)?.label || ''}」` : '',
    roleId ? `角色「${roleOptions.find((r) => r.value === roleId)?.label || ''}」` : '',
    status ? `状态「${status === 'active' ? '启用' : '停用'}」` : '',
  ].filter(Boolean).join(' + ');

  return (
    <div className="space-y-6">
      <PageHeader
        title="用户管理"
        subtitle="系统用户列表"
        extra={
          <div className="flex items-center gap-2">
            {/* [S-01b] 批量导入：需要 import_export 权限（后端路由额外要求 system 权限） */}
            {hasPermissionNow(PERM_IMPORT_EXPORT) && (
              <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-2" title="批量导入用户（CSV/Excel）">
                <Upload className="w-4 h-4" />
                <span className="hidden md:inline">导入</span>
              </button>
            )}
            {has('user_create') && (
              <button onClick={() => navigate('/system/users/create')} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新增用户</span>
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
              placeholder="搜索用户名或邮箱..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
          </div>
          <div className="w-44">
            <SearchSelect
              value={departmentId || null}
              onChange={(v) => { setDepartmentId(v ?? ''); setPagination(prev => ({ ...prev, page: 1 })); }}
              placeholder="全部部门"
              allowClear
              options={departments}
            />
          </div>
          <div className="w-44">
            <SearchSelect
              value={roleId || null}
              onChange={(v) => { setRoleId(v ?? ''); setPagination(prev => ({ ...prev, page: 1 })); }}
              placeholder="全部角色"
              allowClear
              options={roleOptions}
            />
          </div>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
            className="form-select w-28"
            aria-label="状态筛选"
          >
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
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
              ) : users.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} filterNote={userFilterNote} onClear={() => { setKeyword(''); setDepartmentId(''); setRoleId(''); setStatus(''); setPagination(prev => ({ ...prev, page: 1 })); }} title="暂无用户数据" /></td></tr>
              ) : (
                users.map((item) => (
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

        {!loading && users.length > 0 && (
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

      {/* [2026-09-12] 重置密码结果：临时密码仅显示一次（可复制） */}
      <Modal
        title="密码已重置"
        open={!!resetResult}
        onOk={() => setResetResult(null)}
        onCancel={() => setResetResult(null)}
        okText="我已保存"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <p className="text-sm text-gray-600 mb-2">
          用户 <span className="font-medium">{resetResult?.username}</span> 的新临时密码（仅显示一次，请复制后转告本人）：
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-base tracking-wider">{resetResult?.password}</code>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(resetResult?.password || '').then(() => message.success('已复制'));
            }}
          >
            复制
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">该用户此前登录的会话已全部失效，需用新密码重新登录。</p>
      </Modal>

      {/* [S-01b 2026-09-13] 批量导入用户：CSV / Excel(.xlsx)，逐行错误反馈；密码留空则自动生成临时密码 */}
      <ImportModal
        open={importOpen}
        title="批量导入用户"
        importUrl="/v1/import/users"
        templateUrl="/v1/export/users-template?format=csv"
        templateUrlXlsx="/v1/export/users-template?format=xlsx"
        templateHint="用户名、姓名、密码、手机号、邮箱、角色、部门、状态（密码留空=自动生成 12 位临时密码；角色可写多个，用「、」分隔）"
        onClose={() => setImportOpen(false)}
        onSuccess={fetchUsers}
      />
    </div>
  );
}
