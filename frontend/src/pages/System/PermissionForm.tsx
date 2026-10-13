import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { permissionApi } from '@/api/system';
import { Permission } from '@/types';

export function PermissionForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Permission>>({
    name: '',
    code: '',
    module: '',
    type: 'menu',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isEdit && id) {
      fetchPermission(id);
    }
  }, [id]);

  const fetchPermission = async (permId: string) => {
    setLoading(true);
    try {
      const response = await permissionApi.get(permId);
      if (response.code === 0 && response.data) {
        const data = response.data;
        setFormData({
          id: data.id,
          name: data.name,
          code: data.code,
          module: data.module,
          type: data.type || 'menu',
        });
      }
    } catch (err) {
      console.error('Failed to fetch permission:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isEdit && id) {
        const response = await permissionApi.update(id, formData);
        if (response.code === 0) {
          navigate('/system/permissions');
        }
      } else {
        const response = await permissionApi.create(formData);
        if (response.code === 0) {
          navigate('/system/permissions');
        }
      }
    } catch (err) {
      console.error('Failed to save permission:', err);
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

  const modules = [
    '仪表盘',
    '商品管理',
    '客户管理',
    '供应商管理',
    '销售订单',
    '采购订单',
    '库存管理',
    '生产管理',
    '财务管理',
    '报表中心',
    '系统管理',
  ];

  const permissionTypes = [
    { value: 'menu', label: '菜单权限' },
    { value: 'action', label: '操作权限' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑权限码' : '新增权限码'}
        subtitle={isEdit ? '修改权限码信息' : '创建新权限码'}
        onBack={() => { if (confirmLeave()) navigate('/system/permissions'); }}
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">权限名称 *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name || ''}
                  onChange={handleInputChange}
                  required
                  className="form-input"
                  placeholder="请输入权限名称"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">权限编码 *</label>
                <input
                  type="text"
                  name="code"
                  value={formData.code || ''}
                  onChange={handleInputChange}
                  required
                  className="form-input"
                  placeholder="请输入权限编码"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">权限类型 *</label>
                <select
                  name="type"
                  value={formData.type || 'menu'}
                  onChange={handleInputChange}
                  required
                  className="form-select"
                >
                  {permissionTypes.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">所属模块 *</label>
                <select
                  name="module"
                  value={formData.module || ''}
                  onChange={handleInputChange}
                  required
                  className="form-select"
                >
                  <option value="">请选择模块</option>
                  {modules.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/system/permissions'); }} disabled={loading} className="btn-secondary">取消</button>
              <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                <Save className="w-5 h-5" />
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}