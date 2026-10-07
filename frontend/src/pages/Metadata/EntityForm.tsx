import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { entityApi } from '@/api/metadata';
import { Entity } from '@/types/metadata';
import { entityCategoryLabel } from '@/utils/columnLabels';

// 分类统一存英文模块码（与系统内置实体一致，如 base/purchase/sale），显示中文
const CATEGORIES = [
  { value: 'base', label: '基础数据' },
  { value: 'purchase', label: '采购' },
  { value: 'sale', label: '销售' },
  { value: 'production', label: '生产' },
  { value: 'finance', label: '财务' },
  { value: 'inventory', label: '库存' },
  { value: 'system', label: '系统' },
  { value: 'business', label: '业务单据' },
];

export function EntityForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Entity> & { table_name: string }>({
    code: '',
    name: '',
    table_name: '',
    category: 'base',
    is_system: false,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isEdit && id) {
      fetchEntity(id);
    }
  }, [id]);

  const fetchEntity = async (entityId: string) => {
    setLoading(true);
    try {
      const response = await entityApi.get(entityId);
      if (response.code === 0) {
        setFormData(response.data);
      }
    } catch (err: any) {
      setError(err.message || '获取实体失败');
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
        const response = await entityApi.update(id, {
          name: formData.name,
          table_name: formData.table_name,
          category: formData.category,
        });
        if (response.code === 0) {
          navigate('/metadata/entities');
        } else {
          setError(response.message || '保存失败');
        }
      } else {
        const response = await entityApi.create({
          code: formData.code,
          name: formData.name,
          table_name: formData.table_name,
          category: formData.category,
          is_system: false,
        });
        if (response.code === 0) {
          navigate('/metadata/entities');
        } else {
          setError(response.message || '保存失败');
        }
      }
    } catch (err: any) {
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑实体' : '新增实体'}
        subtitle={isEdit ? '修改实体信息' : '创建新的数据实体（自动建表）'}
        onBack={() => navigate('/metadata/entities')}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">实体编码 *</label>
                <input
                  type="text"
                  name="code"
                  value={formData.code || ''}
                  onChange={handleInputChange}
                  disabled={isEdit}
                  required
                  className="form-input"
                  placeholder="小写字母/数字/下划线，如：customer_visit"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                <p className="text-xs text-gray-400 mt-1">唯一，创建后不可修改</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">实体名称 *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name || ''}
                  onChange={handleInputChange}
                  required
                  className="form-input"
                  placeholder="如：客户回访记录"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">数据表名 *</label>
                <input
                  type="text"
                  name="table_name"
                  value={formData.table_name || ''}
                  onChange={handleInputChange}
                  disabled={isEdit}
                  required
                  className="form-input"
                  placeholder="如：customer_visit（自动建表，唯一）"
                />
                <p className="text-xs text-gray-400 mt-1">系统自动创建对应物理表，创建后不可修改</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">分类</label>
                <select
                  name="category"
                  value={formData.category || 'base'}
                  onChange={handleInputChange}
                  className="form-select"
                >
                  {(() => {
                    const cats = [...CATEGORIES];
                    // 兼容历史中文分类值（编辑旧数据时无匹配选项 → 补一项兜底）
                    if (formData.category && !cats.some(c => c.value === formData.category)) {
                      cats.push({ value: formData.category, label: entityCategoryLabel(formData.category) });
                    }
                    return cats.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ));
                  })()}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => navigate('/metadata/entities')} className="btn-secondary">
                取消
              </button>
              <button type="submit" className="btn-primary flex items-center gap-2">
                <Save className="w-5 h-5" />
                保存
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
