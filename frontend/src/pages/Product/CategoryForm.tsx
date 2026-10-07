import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { categoryApi } from '@/api/product';
import { Category, CategoryTreeNode } from '@/types/product';
import { buildCategoryOptions, collectSubtreeIds } from '@/utils/categoryTree';

const DOMAIN_LABEL: Record<string, string> = {
  product: '商品分类',
  customer: '客户分类',
  supplier: '供应商分类',
};

export function CategoryForm() {
  const navigate = useNavigate();
  const { domain = 'product', id } = useParams<{ domain: string; id: string }>();
  const isEdit = !!id;
  const domainLabel = DOMAIN_LABEL[domain] || '基础分类';

  const [formData, setFormData] = useState<Partial<Category>>({
    code: '',
    name: '',
    entity_code: domain,
    parent_id: '',
    status: 'active',
  });

  const [categories, setCategories] = useState<CategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCategories();
    if (isEdit && id) {
      fetchCategory(id);
    }
  }, [id]);

  const fetchCategories = async () => {
    try {
      // 全量分类树：父级下拉需要看到全部层级（分页 list 只取前 10 条会漏掉父级）
      const res = await categoryApi.tree(domain);
      if (res.code === 0) setCategories(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  const fetchCategory = async (categoryId: string) => {
    setLoading(true);
    try {
      const response = await categoryApi.get(categoryId);
      if (response.code === 0) {
        setFormData(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch category:', err);
    } finally {
      setLoading(false);
    }
  };

  // 父级候选：全量树（无分页截断、带层级缩进），排除自身及其后代防止成环；
  // 编辑时若父级已不可见（历史孤儿数据）则追加占位项，保证下拉正确回显、避免误清父级
  const parentOptions = useMemo(() => {
    const excludeIds = id ? collectSubtreeIds(categories, id) : undefined;
    const options = buildCategoryOptions(categories, { excludeIds, showCode: true });
    const pid = formData.parent_id;
    if (pid && !options.some((o) => o.value === pid)) {
      options.unshift({ value: pid, label: '（父级分类不可见）', search: '' });
    }
    return options;
  }, [categories, id, formData.parent_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isEdit && id) {
        const response = await categoryApi.update(id, formData);
        if (response.code === 0) {
          navigate(`/category/${domain}`);
        }
      } else {
        const response = await categoryApi.create(formData);
        if (response.code === 0) {
          navigate(`/category/${domain}`);
        }
      }
    } catch (err) {
      console.error('Failed to save category:', err);
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
        title={isEdit ? `编辑${domainLabel}` : `新增${domainLabel}`}
        subtitle={isEdit ? '修改分类信息' : '创建新分类'}
        onBack={() => navigate(`/category/${domain}`)}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">分类编码</label>
                <input
                  type="text"
                  name="code"
                  value={formData.code || ''}
                  onChange={handleInputChange}
                  disabled={isEdit}
                  placeholder={isEdit ? '' : '留空自动生成'}
                  className="form-input"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">分类名称 *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name || ''}
                  onChange={handleInputChange}
                  required
                  className="form-input"
                  placeholder="请输入分类名称"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">所属实体</label>
                <input
                  type="text"
                  value={domainLabel}
                  disabled
                  className="form-input bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">父级分类</label>
                <SearchSelect
                  value={formData.parent_id}
                  onChange={(v) => setFormData(prev => ({ ...prev, parent_id: v ?? '' }))}
                  placeholder="无（顶级分类）"
                  allowClear
                  options={parentOptions}
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

            <div className="form-actions">
              <button
                type="button"
                onClick={() => navigate(`/category/${domain}`)}
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
