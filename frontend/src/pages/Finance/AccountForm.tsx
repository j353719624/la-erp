import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { accountApi } from '@/api/finance';
import { Account } from '@/types/finance';

export function AccountForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Account>>({
    code: '',
    name: '',
    category: 'asset',
    sub_category: '',
    parent_id: '',
    is_leaf: true,
    is_enabled: true,
    currency: 'CNY',
  });

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAccounts();
    if (isEdit && id) {
      fetchAccount(id);
    }
  }, [id]);

  const fetchAccounts = async () => {
    try {
      // 全量科目：父级科目需从全部非末级科目中选择
      const response = await accountApi.all();
      if (response.code === 0) {
        setAccounts(response.data?.list || []);
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  };

  const fetchAccount = async (accountId: string) => {
    setLoading(true);
    try {
      const response = await accountApi.get(accountId);
      if (response.code === 0) {
        setFormData(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch account:', err);
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
        const response = await accountApi.update(id, formData);
        if (response.code === 0) {
          navigate('/finance/accounts');
        }
      } else {
        const response = await accountApi.create(formData);
        if (response.code === 0) {
          navigate('/finance/accounts');
        }
      }
    } catch (err) {
      console.error('Failed to save account:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑科目' : '新增科目'}
        subtitle={isEdit ? '修改科目信息' : '创建新的会计科目'}
        onBack={() => { if (confirmLeave()) navigate('/finance/accounts'); }}
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">科目编码 *</label>
                <input
                  type="text"
                  name="code"
                  value={formData.code || ''}
                  onChange={handleInputChange}
                  required
                  className="form-input"
                  placeholder="请输入科目编码"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">科目名称 *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name || ''}
                  onChange={handleInputChange}
                  required
                  className="form-input"
                  placeholder="请输入科目名称"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">科目类别</label>
                <select
                  name="category"
                  value={formData.category || 'asset'}
                  onChange={handleInputChange}
                  className="form-select"
                >
                  <option value="asset">资产</option>
                  <option value="liability">负债</option>
                  <option value="equity">权益</option>
                  <option value="cost">成本</option>
                  <option value="income">收入</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">明细类别</label>
                <input
                  type="text"
                  name="sub_category"
                  value={formData.sub_category || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="请输入明细类别"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">币种</label>
                <input
                  type="text"
                  name="currency"
                  value={formData.currency || 'CNY'}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="如：CNY / USD"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">父级科目</label>
                <SearchSelect
                  value={formData.parent_id}
                  onChange={(v) => setFormData(prev => ({ ...prev, parent_id: v ?? '' }))}
                  placeholder="无（顶级科目）"
                  allowClear
                  options={accounts
                    .filter((a) => !a.is_leaf && a.id !== id)
                    .map((a) => ({ value: a.id, label: `${a.code} - ${a.name}` }))}
                />
              </div>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="is_leaf"
                    checked={formData.is_leaf || false}
                    onChange={handleInputChange}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">末级科目</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="is_enabled"
                    checked={formData.is_enabled || false}
                    onChange={handleInputChange}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">启用</span>
                </label>
              </div>
            </div>

            <div className="form-actions">
              {/* [物理保护] 保存中锁定取消：防请求飞行+导航竞态 */}
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/finance/accounts'); }} disabled={loading} className="btn-secondary">取消</button>
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
