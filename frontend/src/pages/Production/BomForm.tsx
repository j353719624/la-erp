import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { productionApi } from '@/api/production';
import { productApi } from '@/api/product';
import { Bom, BomItem } from '@/types/production';
import { Product } from '@/types/product';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';

export function BomForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Bom>>({
    bom_code: '',
    product_id: '',
    version: '1.0',
    status: 'active',
    remark: '',
    items: [],
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProducts();
    if (isEdit && id) {
      fetchBom(id);
    }
  }, [id]);

  const fetchProducts = async () => {
    try {
      const response = await productApi.list({ page: 1, page_size: 1000, status: 'active' });
      if (response.code === 0) {
        setProducts(response.data?.list || []);
      }
    } catch (err) {
      console.error('Failed to fetch products:', err);
    }
  };

  const fetchBom = async (bomId: string) => {
    setLoading(true);
    try {
      const response = await productionApi.getBom(bomId);
      if (response.code === 0 && response.data) {
        const data = response.data as any;
        const itemsFromServer = data.edges?.items || data.items || [];
        setFormData({
          id: data.id,
          bom_code: data.code,
          product_id: data.product_id,
          version: data.version || '1.0',
          status: data.status || 'active',
          remark: data.remark,
          items: itemsFromServer.map((it: any) => ({
            id: it.id,
            product_id: it.product_id,
            product_code: it.product_code || it.edges?.product?.code || '',
            product_name: it.product_name || it.edges?.product?.name || '',
            unit_id: it.unit_id,
            unit_name: it.unit_name || it.edges?.unit?.name || '',
            qty: Number(it.qty) || 0,
            scrap_rate: Number(it.scrap_rate) || 0,
            remark: it.remark || '',
          })),
        });
      }
    } catch (err) {
      console.error('Failed to fetch BOM:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // 关联产品为必填（原原生 select required；改用 antd 后此处显式校验兜底）
    if (!formData.product_id) {
      setError('请选择关联产品');
      return;
    }
    setLoading(true);
    try {
      const product = products.find(p => p.id === formData.product_id);
      const submitData = {
        code: formData.bom_code,
        product_id: formData.product_id || undefined,
        product_name: product?.name || '',
        product_code: product?.code || '',
        version: formData.version || '1.0',
        remark: formData.remark,
        items: (formData.items || [])
          .filter(i => i.product_id)
          .map(i => ({
            product_id: i.product_id,
            unit_id: i.unit_id || undefined,
            product_name: i.product_name || '',
            product_code: i.product_code || '',
            qty: Number(i.qty) || 0,
            scrap_rate: Number(i.scrap_rate) || 0,
            remark: i.remark || '',
          })),
      };
      if (isEdit && id) {
        const response = await productionApi.updateBom(id, submitData);
        if (response.code === 0) {
          navigate('/production/bom');
        }
      } else {
        const response = await productionApi.createBom(submitData);
        if (response.code === 0) {
          navigate('/production/bom');
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleAddItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...(prev.items || []), { product_id: '', qty: 1, scrap_rate: 0, remark: '' } as BomItem],
    }));
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...(formData.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };
    if (field === 'product_id') {
      const product = products.find(p => p.id === value);
      if (product) {
        newItems[index].product_code = product.code;
        newItems[index].product_name = product.name;
        newItems[index].unit_id = product.unit_id;
        newItems[index].unit_name = product.edges?.unit?.name || '';
      }
    }
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑BOM' : '新建BOM'}
        subtitle={isEdit ? '修改BOM信息' : '创建新的物料清单'}
        onBack={() => { if (confirmLeave()) navigate('/production/bom'); }}
        backDisabled={loading}
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      <div className="card p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">BOM编号 *</label>
              <input
                type="text"
                name="bom_code"
                value={formData.bom_code || ''}
                onChange={handleInputChange}
                required
                className="form-input"
                placeholder="请输入BOM编号"
               autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">关联产品 *</label>
              <SearchSelect
                required
                value={formData.product_id}
                onChange={(v) => setFormData(prev => ({ ...prev, product_id: v ?? '' }))}
                placeholder="请选择产品"
                options={products.map((p) => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">版本</label>
              <input
                type="text"
                name="version"
                value={formData.version || ''}
                onChange={handleInputChange}
                className="form-input"
                placeholder="请输入版本号"
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

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-medium text-gray-700">BOM 子项（组成物料）</h3>
              <button type="button" onClick={handleAddItem} className="btn-secondary text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" />
                添加子项
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">物料</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">数量</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">损耗率%</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">备注</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(formData.items || []).map((item, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3">
                        <SearchSelect
                          value={item.product_id}
                          onChange={(v) => handleItemChange(index, 'product_id', v ?? '')}
                          placeholder="请选择物料"
                          options={[
                            // 编辑态保留已删除/不在列表中的物料（原样展示，不可再改选别的值）
                            ...(!products.some((p) => p.id === item.product_id) && item.product_id
                              ? [{ value: item.product_id, label: `${item.product_code} - ${item.product_name || '已删除物料'}` }]
                              : []),
                            ...products.map((p) => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) })),
                          ]}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.qty ?? ''}
                          onChange={(e) => handleItemChange(index, 'qty', e.target.value)}
                          className="form-input text-right w-24"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.scrap_rate ?? ''}
                          onChange={(e) => handleItemChange(index, 'scrap_rate', e.target.value)}
                          className="form-input text-right w-24"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.remark || ''}
                          onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                          className="form-input"
                          placeholder="备注"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => handleRemoveItem(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!formData.items || formData.items.length === 0) && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">点击上方按钮添加组成物料</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
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

          <div className="form-actions">
            <button type="button" onClick={() => { if (confirmLeave()) navigate('/production/bom'); }} disabled={loading} className="btn-secondary">取消</button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              <Save className="w-5 h-5" />
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
