import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { warehouseApi } from '@/api/product';
import { userApi } from '@/api/system';
import { Warehouse } from '@/types/product';
import { User } from '@/types';

export function WarehouseForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Warehouse>>({
    code: '',
    name: '',
    address: '',
    is_default: false,
    manager_id: '',
    remark: '',
    status: 'active',
  });

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchUsers();
    if (isEdit && id) {
      fetchWarehouse(id);
    }
  }, [id]);

  const fetchUsers = async () => {
    try {
      const res = await userApi.list({ page: 1, page_size: 1000 });
      if (res.code === 0) setUsers(res.data?.list || []);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  const fetchWarehouse = async (warehouseId: string) => {
    setLoading(true);
    try {
      const response = await warehouseApi.get(warehouseId);
      if (response.code === 0) {
        setFormData(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch warehouse:', err);
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
        const response = await warehouseApi.update(id, formData);
        if (response.code === 0) {
          navigate('/warehouses');
        }
      } else {
        const response = await warehouseApi.create(formData);
        if (response.code === 0) {
          navigate('/warehouses');
        }
      }
    } catch (err: any) {
      console.error('Failed to save warehouse:', err);
      setError(err.response?.data?.message || err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑仓库' : '新增仓库'}
        subtitle={isEdit ? '修改仓库信息' : '创建新仓库'}
        onBack={() => navigate('/warehouses')}
        backDisabled={loading}
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      <div className="card p-6">
        {loading && isEdit ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">仓库编码</label>
                <input
                  type="text"
                  name="code"
                  value={formData.code || ''}
                  onChange={handleInputChange}
                  placeholder="留空自动生成"
                  className="form-input"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">仓库名称 *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name || ''}
                  onChange={handleInputChange}
                  required
                  className="form-input"
                  placeholder="请输入仓库名称"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">仓库地址</label>
                <textarea
                  name="address"
                  value={formData.address || ''}
                  onChange={handleInputChange}
                  rows={2}
                  className="form-textarea"
                  placeholder="请输入仓库地址"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer pt-2">
                  <input
                    type="checkbox"
                    name="is_default"
                    checked={formData.is_default || false}
                    onChange={handleInputChange}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">设为默认仓库</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">负责人</label>
                <SearchSelect
                  value={formData.manager_id}
                  onChange={(v) => setFormData(prev => ({ ...prev, manager_id: v ?? '' }))}
                  placeholder="请选择负责人"
                  options={users.map((u) => ({ value: u.id, label: u.name || u.username }))}
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
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
                <textarea
                  name="remark"
                  value={formData.remark || ''}
                  onChange={handleInputChange}
                  rows={2}
                  className="form-input"
                  placeholder="请输入备注信息"
                />
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                onClick={() => navigate('/warehouses')}
                className="btn-secondary"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary flex items-center gap-2"
              >
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
