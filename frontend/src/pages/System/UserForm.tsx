import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { usePermission } from '@/hooks/usePermission';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { userApi, roleApi, departmentApi } from '@/api/system';
import { User, Role } from '@/types';

export function UserForm() {
  const navigate = useNavigate();
  // [2026-09-18 权限细化·第4批] 「分配角色」独立码：无码时角色勾选区锁定（防「能改用户」的人顺手提权）
  const { has } = usePermission();
  const canAssign = has('user_role_assign');
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  // 基本信息保存：新建需 user_create、编辑需 user_edit（与「分配角色」互为独立能力）
  const canSaveBasic = isEdit ? has('user_edit') : has('user_create');

  const [formData, setFormData] = useState<Partial<User>>({
    username: '',
    name: '',
    email: '',
    phone: '',
    status: 'active',
  });

  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // [易用性 2026-09-19] 角色选择器：搜索过滤（角色多时快速定位）+ 已选计数
  const [roleSearch, setRoleSearch] = useState('');
  const filteredRoles = roles.filter((r) => {
    const kw = roleSearch.trim().toLowerCase();
    if (!kw) return true;
    return (r.name || '').toLowerCase().includes(kw) || (r.code || '').toLowerCase().includes(kw);
  });

  useEffect(() => {
    fetchRoles();
    fetchDepartments();
    if (isEdit && id) {
      fetchUser(id);
    }
  }, [id]);

  const fetchRoles = async () => {
    try {
      const response = await roleApi.list({ page: 1, page_size: 1000 });
      if (response.code === 0) {
        setRoles(response.data?.list || []);
      }
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await departmentApi.listAll();
      if (response.code === 0) {
        setDepartments(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    }
  };

  const fetchUser = async (userId: string) => {
    setLoading(true);
    try {
      const response = await userApi.get(userId);
      if (response.code === 0) {
        setFormData(response.data);
        if (response.data.roles) {
          setSelectedRoleIds(response.data.roles.map(r => r.id));
        }
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data: any = {
        ...formData,
        role_ids: selectedRoleIds,
        department_id: formData.department_id || null,
        clear_department: isEdit ? !formData.department_id : false,
      };
      if (isEdit && id) {
        if (canSaveBasic) {
          const response = await userApi.update(id, data);
          if (response.code === 0) {
            // 角色走独立端点分配（后端 Create/Update 不接收 role_ids）；
            // [2026-09-18 第4批] 无「分配角色」码时跳过该调用（勾选区已锁定，不改动既有角色）
            if (canAssign) {
              await userApi.assignRoles(id, { role_ids: selectedRoleIds });
            }
            navigate('/system/users');
          }
        } else if (canAssign) {
          await userApi.assignRoles(id, { role_ids: selectedRoleIds });
          navigate('/system/users');
        }
      } else {
        const response = await userApi.create(data);
        if (response.code === 0 && response.data?.id) {
          if (canAssign) {
            await userApi.assignRoles(response.data.id, { role_ids: selectedRoleIds });
          }
          navigate('/system/users');
        }
      }
    } catch (err) {
      console.error('Failed to save user:', err);
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

  const handleRoleChange = (roleId: string) => {
    setSelectedRoleIds(prev =>
      prev.includes(roleId)
        ? prev.filter(id => id !== roleId)
        : [...prev, roleId]
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑用户' : '新增用户'}
        subtitle={isEdit ? '修改用户信息' : '创建新用户'}
        onBack={() => { if (confirmLeave()) navigate('/system/users'); }}
        backDisabled={loading}
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="card p-6 flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ── 基本信息 ── */}
          <section className="card p-6">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">基本信息</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">用户名 *</label>
                <input
                  type="text"
                  name="username"
                  value={formData.username || ''}
                  onChange={handleInputChange}
                  required
                  className="form-input"
                  placeholder="请输入用户名"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">姓名 *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name || ''}
                  onChange={handleInputChange}
                  required
                  className="form-input"
                  placeholder="请输入姓名"
                />
              </div>
              {!isEdit && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">密码 *</label>
                  <input
                    type="password"
                    name="password"
                    value={(formData as any).password || ''}
                    onChange={handleInputChange}
                    required
                    minLength={6}
                    className="form-input"
                    placeholder="请输入密码（至少 6 位）"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">邮箱</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="请输入邮箱"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">手机号</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="请输入手机号"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
                <select
                  name="status"
                  value={formData.status || 'active'}
                  onChange={handleInputChange}
                  className="form-select"
                >
                  <option value="active">启用</option>
                  <option value="inactive">停用</option>
                </select>
              </div>
            </div>
          </section>

          {/* ── 组织与角色 ── */}
          <section className="card p-6">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">组织与角色</h3>
            <div className="mb-6 max-w-md">
              <label className="block text-sm font-medium text-gray-700 mb-2">所属部门</label>
              <SearchSelect
                value={formData.department_id}
                  onChange={(v) => setFormData(prev => ({ ...prev, department_id: v ?? '' }))}
                  placeholder="无部门"
                  allowClear
                  options={departments.map(d => ({ value: d.id, label: d.name }))}
                />
                <p className="text-xs text-gray-400 mt-1">开启部门数据隔离后，用户只能看到本部门的数据</p>
              </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="text-sm font-medium text-gray-700">
                  角色 <span className="text-xs font-normal text-gray-400">（可多选，决定该用户的功能权限与数据范围）</span>
                </label>
                <span className="text-xs text-gray-500 shrink-0">已选 {selectedRoleIds.length} 个</span>
              </div>

              {!canAssign && (
                <div className="flex items-start gap-2 px-3 py-2 mb-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700">
                    当前账号无「用户管理-分配角色」权限：角色勾选已锁定；若仅需调整基本信息，保存不会改动角色。
                  </p>
                </div>
              )}

              {roles.length > 6 && (
                <input
                  type="text"
                  value={roleSearch}
                  onChange={(e) => setRoleSearch(e.target.value)}
                  className="form-input mb-3 max-w-xs"
                  placeholder="请输入角色名或编码筛选"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredRoles.map((role) => {
                  const checked = selectedRoleIds.includes(role.id);
                  return (
                    <label
                      key={role.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                        checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      } ${canAssign ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canAssign}
                        onChange={() => handleRoleChange(role.id)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 shrink-0"
                      />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block text-sm text-gray-800 truncate">{role.name}</span>
                        {role.code && <span className="block text-xs text-gray-400 truncate">{role.code}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              {filteredRoles.length === 0 && (
                <p className="text-xs text-gray-400 mt-2">没有匹配的角色，换个关键词试试</p>
              )}
            </div>
          </section>

            <div className="form-actions">
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/system/users'); }} disabled={loading} className="btn-secondary">取消</button>
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
  );
}
