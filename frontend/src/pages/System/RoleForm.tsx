import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { usePermission } from '@/hooks/usePermission';
import { ArrowLeft, Save, AlertCircle, ShieldAlert, Search } from 'lucide-react';
import { Checkbox, Tooltip } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { PermissionMenuPreview } from '@/components/PermissionMenuPreview';
import { menuItems } from '@/components/Layout/Sidebar';
import { menuPreviewStats, visibleMenusForPreview } from '@/utils/menuPreview';
import { useAppStore } from '@/store/app';
import { roleApi, permissionApi } from '@/api/system';
import { Role, Permission } from '@/types';

export function RoleForm() {
  const navigate = useNavigate();
  // [2026-09-18 权限细化·第4批] 「分配权限」独立码：无码时权限勾选区锁定（防「能改角色」的人顺手提权）
  const { has } = usePermission();
  const canAssign = has('role_permission_assign');
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  /** 复制角色来源（/system/roles/create?from=<id>）：预填名称（副本）/数据范围/权限（2026-09-12） */
  const fromId = searchParams.get('from');
  const isEdit = !!id;
  // 基本信息保存：新建需 role_create、编辑需 role_edit（与「分配权限」互为独立能力）
  const canSaveBasic = isEdit ? has('role_edit') : has('role_create');

  const [formData, setFormData] = useState<Partial<Role>>({
    name: '',
    code: '',
    data_scope: 'all',
  });

  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);
  // [2026-09-18 权限细化] 权限搜索：拆分后 160+ 项，按名称/编码过滤（只影响展示与模块勾选范围）
  const [permKeyword, setPermKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPermissions();
    if (isEdit && id) {
      fetchRole(id);
    } else if (fromId) {
      // [2026-09-12] 复制角色：从现有角色预填（不带头 id，保存时创建新角色）
      copyRole(fromId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fromId]);

  /** 复制角色预填：名称（副本）+ 编码后缀（可改）+ 数据范围 + 全部权限勾选 */
  const copyRole = async (roleId: string) => {
    setLoading(true);
    try {
      const response = await roleApi.get(roleId);
      if (response.code === 0 && response.data) {
        const data = response.data as any;
        setFormData({
          name: `${data.name}（副本）`,
          code: data.code ? `${data.code}_copy` : '',
          data_scope: data.data_scope || 'all',
        });
        if (data.edges?.permissions) {
          setSelectedPermissionIds(data.edges.permissions.map((p: any) => p.id));
        }
      }
    } catch (err) {
      console.error('Failed to copy role:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPermissions = async () => {
    try {
      // 全量权限：权限按模块分组几十项，分页 list 只取 10 条会丢大部分权限导致无法勾选
      const response = await permissionApi.list({ page: 1, page_size: 1000 });
      if (response.code === 0) {
        setPermissions(response.data?.list || []);
      }
    } catch (err) {
      console.error('Failed to fetch permissions:', err);
    }
  };

  const fetchRole = async (roleId: string) => {
    setLoading(true);
    try {
      const response = await roleApi.get(roleId);
      if (response.code === 0 && response.data) {
        const data = response.data;
        setFormData({
          id: data.id,
          name: data.name,
          code: data.code,
          data_scope: (data as any).data_scope || 'all',
        });
        if (data.edges?.permissions) {
          setSelectedPermissionIds(data.edges.permissions.map((p: any) => p.id));
        }
      }
    } catch (err) {
      console.error('Failed to fetch role:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = {
        ...formData,
        permission_ids: selectedPermissionIds,
      };
      if (isEdit && id) {
        if (canSaveBasic) {
          const response = await roleApi.update(id, data);
          if (response.code === 0) {
            // 权限走独立端点分配（后端 Create/Update 不接收 permission_ids）；
            // [2026-09-18 第4批] 无「分配权限」码时跳过该调用（勾选区已锁定，不改动既有权限）
            if (canAssign) {
              await roleApi.assignPermissions(id, { permission_ids: selectedPermissionIds });
            }
            navigate('/system/roles');
          }
        } else if (canAssign) {
          await roleApi.assignPermissions(id, { permission_ids: selectedPermissionIds });
          navigate('/system/roles');
        }
      } else {
        const response = await roleApi.create(data);
        if (response.code === 0 && response.data?.id) {
          if (canAssign) {
            await roleApi.assignPermissions(response.data.id, { permission_ids: selectedPermissionIds });
          }
          navigate('/system/roles');
        }
      }
    } catch (err) {
      console.error('Failed to save role:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handlePermissionChange = (permId: string) => {
    setSelectedPermissionIds(prev =>
      prev.includes(permId)
        ? prev.filter(id => id !== permId)
        : [...prev, permId]
    );
  };

  const permKeywordNorm = permKeyword.trim().toLowerCase();
  const filteredPermissions = permKeywordNorm
    ? permissions.filter(
        (p) => p.name.toLowerCase().includes(permKeywordNorm) || p.code.toLowerCase().includes(permKeywordNorm),
      )
    : permissions;
  const groupedPermissions = filteredPermissions.reduce((acc, perm) => {
    if (!acc[perm.module]) {
      acc[perm.module] = [];
    }
    acc[perm.module].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);

  // [2026-09-12] 权限批量勾选：全选/清空/反选/模块级全选（此前 80+ 项只能逐个点）
  const selectAllPermissions = () => setSelectedPermissionIds(permissions.map((p) => p.id));
  const clearPermissions = () => setSelectedPermissionIds([]);
  const invertPermissions = () =>
    setSelectedPermissionIds(permissions.filter((p) => !selectedPermissionIds.includes(p.id)).map((p) => p.id));
  const setModulePermissions = (module: string, checked: boolean) => {
    const ids = (groupedPermissions[module] || []).map((p) => p.id);
    setSelectedPermissionIds((prev) =>
      checked ? Array.from(new Set([...prev, ...ids])) : prev.filter((x) => !ids.includes(x)),
    );
  };

  // [2026-09-17 角色可视化] 已选权限 → 权限码集合（菜单预览按码计算，与登录后侧边栏同一口径）
  const selectedPermissionCodes = useMemo(
    () => permissions.filter((p) => selectedPermissionIds.includes(p.id)).map((p) => p.code),
    [permissions, selectedPermissionIds],
  );
  // 「个人模式」：预览需与运行期侧栏一致（隐藏审批入口）
  const personalMode = useAppStore((s) => s.personalMode);
  const previewStats = useMemo(
    () => menuPreviewStats(visibleMenusForPreview(menuItems, selectedPermissionCodes, personalMode)),
    [selectedPermissionCodes, personalMode],
  );
  // 「自定义报表」= 可执行任意只读 SQL（涉全库数据），属高危能力——勾选后给出醒目提示
  const hasCustomReport = selectedPermissionCodes.includes('custom_report');

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑角色' : fromId ? '复制角色' : '新增角色'}
        subtitle={isEdit ? '修改角色信息' : fromId ? '从现有角色复制（名称/编码可改，权限已带出）' : '创建新角色'}
        onBack={() => { if (confirmLeave()) navigate('/system/roles'); }}
        backDisabled={loading}
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      <div className="card p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* [2026-09-17 可视化] 两栏：左＝权限勾选（看得懂），右＝菜单预览（看得见结果） */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
              {/* ── 左列：角色信息 + 权限配置 ── */}
              <div className="space-y-6 min-w-0">
                {/* [2026-09 宽屏主栅格规范] 主录入区保留 lg:grid-cols-3（≥1280px 由 index.css 统一升为 4 列） */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">角色名称 *</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name || ''}
                      onChange={handleInputChange}
                      required
                      className="form-input"
                      placeholder="请输入角色名称"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">角色编码 *</label>
                    <input
                      type="text"
                      name="code"
                      value={formData.code || ''}
                      onChange={handleInputChange}
                      required
                      className="form-input"
                      placeholder="请输入角色编码"
                     autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">数据范围</label>
                    <select
                      name="data_scope"
                      value={formData.data_scope || 'all'}
                      onChange={handleInputChange}
                      className="form-input"
                    >
                      <option value="all">全部数据</option>
                      <option value="dept">本部门数据</option>
                      <option value="self">仅本人创建的数据</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">全部=看全公司；本部门=需开启部门隔离后生效；仅本人=只能看自己创建的商品/客户/供应商</p>
                  </div>
                </div>

                {/* ── 左列：权限配置（模块卡片 + 三态全选 + 权限码/高危标记） ── */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <label className="block text-sm font-medium text-gray-700">
                      权限配置
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        已选 {selectedPermissionIds.length}/{permissions.length}
                        {permKeywordNorm ? ` · 匹配 ${filteredPermissions.length} 项` : ` · 可见 ${previewStats.menus} 个菜单`}
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* [2026-09-18 权限细化] 166+ 项的搜索（按名称/编码）；模块卡片随搜索结果收敛 */}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                          type="text"
                          value={permKeyword}
                          onChange={(e) => setPermKeyword(e.target.value)}
                          placeholder="搜索权限（名称或编码）..."
                          className="form-input !py-1.5 pl-8 pr-7 text-xs w-52"
                         autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                        {permKeyword && (
                          <button
                            type="button"
                            onClick={() => setPermKeyword('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                            title="清空搜索"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {/* [2026-09-12] 全选/清空/反选：一次配置几十项权限（此前只能逐项勾选）；无分配权限码则隐藏 */}
                      {canAssign && (
                        <div className="flex items-center gap-2 text-xs">
                          <button type="button" onClick={selectAllPermissions} className="text-blue-600 hover:underline">全选</button>
                          <span className="text-gray-300">|</span>
                          <button type="button" onClick={clearPermissions} className="text-blue-600 hover:underline">清空</button>
                          <span className="text-gray-300">|</span>
                          <button type="button" onClick={invertPermissions} className="text-blue-600 hover:underline">反选</button>
                        </div>
                      )}
                    </div>
                  </div>
                  {!canAssign && (
                    <div className="mb-3 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-700">
                        当前账号无「角色管理-分配权限」权限：权限勾选已锁定；若仅需调整名称/数据范围，保存不会改动权限。
                      </p>
                    </div>
                  )}
                  <div className="space-y-4">
                    {filteredPermissions.length === 0 && (
                      <div className="py-8 text-center text-sm text-gray-400">没有匹配「{permKeyword.trim()}」的权限项，试试其它关键词</div>
                    )}
                    {Object.entries(groupedPermissions).map(([module, perms]) => {
                      const moduleIds = perms.map((p) => p.id);
                      const selectedCount = moduleIds.filter((pid) => selectedPermissionIds.includes(pid)).length;
                      const allChecked = moduleIds.length > 0 && selectedCount === moduleIds.length;
                      return (
                        <div key={module} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                              {/* 三态全选：部分勾选显示半选，一眼看出该模块是否配齐 */}
                              <Checkbox
                                checked={allChecked}
                                indeterminate={selectedCount > 0 && !allChecked}
                                disabled={!canAssign}
                                onChange={(e) => setModulePermissions(module, e.target.checked)}
                              />
                              <span className="font-medium text-gray-700">{module}</span>
                              <span className={`text-xs ${allChecked ? 'text-green-600' : selectedCount > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                                {selectedCount}/{moduleIds.length}
                              </span>
                              {module === '系统管理' && (
                                <span className="text-xs text-amber-600">含系统配置能力，请谨慎授予</span>
                              )}
                            </label>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                            {perms.map((perm) => (
                              <label key={perm.id} className="flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-gray-50">
                                <Checkbox
                                  checked={selectedPermissionIds.includes(perm.id)}
                                  disabled={!canAssign}
                                  onChange={() => handlePermissionChange(perm.id)}
                                />
                                <span className="text-sm text-gray-700 whitespace-nowrap">{perm.name}</span>
                                <span className="text-[11px] text-gray-400 font-mono truncate">{perm.code}</span>
                                {perm.code === 'custom_report' && (
                                  <Tooltip title="可执行任意只读查询（含全部业务数据），仅建议管理员角色勾选">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500 flex-shrink-0">高危</span>
                                  </Tooltip>
                                )}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ── 右列：「所见即所得」——菜单预览 / 风险提示 ── */}
              <div className="space-y-4 lg:sticky lg:top-4">
                <div className="border border-gray-200 rounded-lg p-4">
                  <PermissionMenuPreview permissions={selectedPermissionCodes} />
                </div>

                {hasCustomReport && (
                  <div className="flex items-start gap-2 px-3 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-700">
                      已勾选「自定义报表」：该权限可执行任意只读查询、看到全库数据，请仅授予管理员角色。
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/system/roles'); }} disabled={loading} className="btn-secondary">取消</button>
              {(canSaveBasic || canAssign) && (
                <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                  <Save className="w-5 h-5" />
                  {loading ? '保存中...' : '保存'}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
