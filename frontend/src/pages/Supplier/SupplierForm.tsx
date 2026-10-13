import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { supplierApi } from '@/api/order';
import { categoryApi } from '@/api/product';
import { Supplier } from '@/types/order';
import { CategoryTreeNode } from '@/types/product';
import { buildCategoryOptions } from '@/utils/categoryTree';
import { EntityExtFieldsSection } from '@/components/EntityExtFieldsSection';

export function SupplierForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Supplier>>({
    code: '',
    name: '',
    contact: '',
    phone: '',
    email: '',
    address: '',
    category_id: '',
    status: 'active',
    tax_no: '',
    bank_account: '',
    payment_term: 30,
    rating: '',
    remark: '',
    ext: {},
  });

  const [categories, setCategories] = useState<CategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) {
      fetchSupplier(id);
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      // 全量分类树（分页 list 只取前 10 条会漏项），选项带层级缩进，父级/子级一目了然
      const res = await categoryApi.tree('supplier');
      if (res.code === 0) setCategories(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchSupplier = async (supplierId: string) => {
    setLoading(true);
    try {
      const response = await supplierApi.get(supplierId);
      if (response.code === 0) setFormData(response.data);
    } catch (err) {
      console.error('Failed to fetch supplier:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // 数字字段类型转换（后端要求 int，前端输入为字符串/数字，统一转 Number）
      const ptStr = String(formData.payment_term ?? '');
      const data: any = {
        ...formData,
        payment_term: ptStr === '' ? undefined : Number(ptStr),
      };
      if (isEdit && id) {
        const response = await supplierApi.update(id, data);
        if (response.code === 0) navigate('/suppliers');
      } else {
        const response = await supplierApi.create(data);
        if (response.code === 0) navigate('/suppliers');
      }
    } catch (err) {
      console.error('Failed to save supplier:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑供应商' : '新增供应商'}
        subtitle={isEdit ? '修改供应商信息' : '创建新供应商'}
        onBack={() => { if (confirmLeave()) navigate('/suppliers'); }}
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
          <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div><label className="block text-sm font-medium text-gray-700 mb-2">供应商编码</label><input type="text" name="code" value={formData.code || ''} onChange={handleInputChange} disabled={isEdit} placeholder={isEdit ? '' : '留空自动生成'} className="form-input"  autoCapitalize="none" autoCorrect="off" spellCheck={false}/></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">供应商名称 *</label><input type="text" name="name" value={formData.name || ''} onChange={handleInputChange} required className="form-input" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">联系人</label><input type="text" name="contact" value={formData.contact || ''} onChange={handleInputChange} className="form-input" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">联系电话</label><input type="text" name="phone" value={formData.phone || ''} onChange={handleInputChange} className="form-input" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">邮箱</label><input type="email" name="email" value={formData.email || ''} onChange={handleInputChange} className="form-input"  autoCapitalize="none" autoCorrect="off" spellCheck={false}/></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">供应商分类</label>
                <SearchSelect
                  value={formData.category_id}
                  onChange={(v) => setFormData(prev => ({ ...prev, category_id: v ?? '' }))}
                  placeholder="请选择分类"
                  allowClear
                  options={buildCategoryOptions(categories)}
                />
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
                <select name="status" value={formData.status || 'active'} onChange={handleInputChange} className="form-select">
                  <option value="active">启用</option>
                  <option value="inactive">停用</option>
                </select>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">税号</label><input type="text" name="tax_no" value={formData.tax_no || ''} onChange={handleInputChange} className="form-input"  autoCapitalize="none" autoCorrect="off" spellCheck={false}/></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">银行账号</label><input type="text" name="bank_account" value={formData.bank_account || ''} onChange={handleInputChange} className="form-input"  autoCapitalize="none" autoCorrect="off" spellCheck={false}/></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">账期（天）</label><input type="number" min={0} name="payment_term" value={formData.payment_term ?? ''} onChange={handleInputChange} className="form-input" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">供应商评级</label>
                <select name="rating" value={formData.rating || ''} onChange={handleInputChange} className="form-select">
                  <option value="">请选择</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                </select>
              </div>
            </div>
            {/* [2026-09-16] 地址 + 备注左右并排（原来各占整行，把自定义字段挤出首屏） */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">地址</label>
                <textarea name="address" value={formData.address || ''} onChange={handleInputChange} rows={2} className="form-input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
                <textarea name="remark" value={formData.remark || ''} onChange={handleInputChange} rows={2} className="form-input" />
              </div>
            </div>
            {/* 自定义字段：行业模板/自建扩展字段，按实体 form 布局分组（值存 ext） */}
            <EntityExtFieldsSection
              entityCode="supplier"
              value={formData.ext}
              onChange={(code, v) => setFormData(prev => ({ ...prev, ext: { ...(prev.ext || {}), [code]: v } }))}
              disabled={loading}
            />
            <div className="form-actions">
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/suppliers'); }} disabled={loading} className="btn-secondary">取消</button>
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
