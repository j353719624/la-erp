import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, Plus, Trash2, Boxes, AlertCircle } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { comboApi } from '@/api/combo';
import { productApi } from '@/api/product';
import { Product } from '@/types/product';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';

interface LineDraft {
  component_id: string;
  qty: string;
  remark?: string;
}

export function ComboForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const fromProduct = searchParams.get('from') || '';
  const isEdit = !!id;

  // 成品（组合商品）
  const [productId, setProductId] = useState('');
  // 新建成品信息（无 id 且未选择已有成品时使用）
  const [newProductName, setNewProductName] = useState('');
  const [newProductCode, setNewProductCode] = useState('');
  const [newProductSpec, setNewProductSpec] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProducts();
    if (isEdit && id) fetchCombo(id);
    else if (fromProduct) setProductId(fromProduct);
  }, [id, fromProduct]);

  const fetchProducts = async () => {
    try {
      const res = await productApi.list({ page: 1, page_size: 1000, status: 'active' });
      if (res.code === 0) setProducts(res.data?.list || []);
    } catch (err) {
      console.error('Failed to fetch products:', err);
    }
  };

  const fetchCombo = async (comboId: string) => {
    setLoading(true);
    try {
      const res = await comboApi.get(comboId);
      if (res.code === 0 && res.data) {
        setProductId(res.data.product?.id || '');
        setLines((res.data.lines || []).map((l: any) => ({
          component_id: l.component_id,
          qty: String(l.qty ?? 1),
          remark: l.remark || '',
        })));
      }
    } catch (err) {
      console.error('Failed to fetch combo:', err);
    } finally {
      setLoading(false);
    }
  };

  const addLine = () => {
    setLines(prev => [...prev, { component_id: '', qty: '1' }]);
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, key: keyof LineDraft, value: string) => {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));
  };

  const validate = (): string => {
    if (lines.length === 0) return '请至少添加一行配件';
    for (const l of lines) {
      if (!l.component_id) return '请选择配件商品';
      const q = parseFloat(l.qty);
      if (!q || q <= 0) return '配件数量必须大于 0';
    }
    if (!isEdit) {
      if (productId) return '';
      if (!newProductName.trim()) return '请填写成品名称，或从下方选择已有商品作为成品';
    }
    return '';
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      message.warning(err);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const payload = {
        lines: lines.map(l => ({
          component_id: l.component_id,
          qty: parseFloat(l.qty),
          remark: l.remark || '',
        })),
      };

      let targetId = productId;
      if (!targetId) {
        // 新建成品商品（后端允许仅 name 必填；分类/单位可选）
        const created = await productApi.create({
          name: newProductName.trim(),
          code: newProductCode.trim() || undefined,
          spec: newProductSpec.trim() || undefined,
          sale_price: parseFloat(newProductPrice) || 0,
          product_type: 'goods',
        } as any);
        if (created.code !== 0) {
          setError(created.message || '创建成品商品失败');
          return;
        }
        targetId = created.data?.id;
      }
      if (!targetId) {
        setError('成品商品创建失败，请重试');
        return;
      }

      const res = await comboApi.save(targetId, payload.lines);
      if (res.code === 0) {
        message.success(isEdit ? '组装配方已保存' : '组装商品已创建，可返回列表执行组装');
        navigate('/combo-products');
      } else {
        setError(res.message || '保存失败');
      }
    } catch (err: any) {
      console.error('Failed to save combo:', err);
      setError(err?.message || '保存失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const selectedProduct = products.find(p => p.id === productId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑组装商品' : '新建组装商品'}
        subtitle="选成品 + 配件配方：组装 N 个时按配方扣配件库存 → 成品入库"
        onBack={() => navigate('/combo-products')}
        extra={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/combo-products')} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> 返回
            </button>
            <button onClick={handleSave} disabled={loading} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" /> {loading ? '保存中...' : '保存'}
            </button>
          </div>
        }
      />

      {error && <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
        <AlertCircle className="w-5 h-5 text-red-600" />
        <span className="text-red-700 text-sm">{error}</span>
      </div>}

      <div className="card p-6">
        {loading && !isEdit ? (
          <div className="flex items-center justify-center h-40 text-gray-400">加载中...</div>
        ) : (
          <div className="space-y-6">
            {/* 成品信息 */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-gray-500" />
                <h3 className="font-medium text-gray-700">成品（组装后的商品，可销售/盘点）</h3>
              </div>
              <div className="p-4">
                {isEdit ? (
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-medium">
                      {(selectedProduct as any)?.code || ''}
                    </span>
                    <span className="text-sm text-gray-700 font-medium">{selectedProduct?.name || ''}</span>
                    <span className="text-xs text-gray-400">（商品编码与基本信息在「商品管理」中维护）</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">方式一：直接创建新的成品商品</label>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="md:col-span-2">
                          <input
                            type="text"
                            value={newProductName}
                            onChange={(e) => { setNewProductName(e.target.value); setProductId(''); }}
                            placeholder="成品名称 *（如：果篮 / 台式机）"
                            className="form-input w-full"
                          />
                        </div>
                        <div>
                          <input
                            type="text"
                            value={newProductCode}
                            onChange={(e) => setNewProductCode(e.target.value)}
                            placeholder="编码（留空自动生成）"
                            className="form-input w-full"
                           autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                        </div>
                        <div>
                          <input
                            type="text"
                            value={newProductSpec}
                            onChange={(e) => setNewProductSpec(e.target.value)}
                            placeholder="规格（可选）"
                            className="form-input w-full"
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            step="any"
                            value={newProductPrice}
                            onChange={(e) => setNewProductPrice(e.target.value)}
                            placeholder="销售价（可选）"
                            className="form-input w-full"
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">方式二：选择商品列表中的已有商品作为成品</label>
                      <SearchSelect
                        value={productId}
                        onChange={(v) => { setProductId(v ?? ''); if (v) { setNewProductName(''); } }}
                        placeholder="— 选择已有商品 —"
                        allowClear
                        options={products.map(p => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) }))}
                        className="max-w-xl"
                      />
                      {productId && (
                        <p className="text-xs text-gray-400 mt-1">已选择「{selectedProduct?.name}」作为成品，保存后将为其标记组合商品并写入下方配方。</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 配件配方 */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-medium text-gray-700">配件配方（每 1 个成品所需的配件与数量）</h3>
                <button onClick={addLine} className="btn-secondary text-sm flex items-center gap-1">
                  <Plus className="w-4 h-4" /> 添加配件
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">配件商品 *</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">每 1 成品用量 *</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">备注</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lines.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">点击「添加配件」选择配件商品（如 苹果×3、香蕉×2）</td></tr>
                    )}
                    {lines.map((l, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2">
                          <SearchSelect
                            value={l.component_id}
                            onChange={(v) => updateLine(idx, 'component_id', v ?? '')}
                            placeholder="请选择配件商品"
                            allowClear
                            options={products
                              .filter(p => p.id !== productId)
                              .map(p => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) }))}
                            className="min-w-[200px]"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={l.qty}
                            onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                            className="form-input w-28 text-right"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={l.remark || ''}
                            onChange={(e) => updateLine(idx, 'remark', e.target.value)}
                            placeholder="备注（可选）"
                            className="form-input w-full min-w-[120px]"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => removeLine(idx)} className="icon-btn delete sm" title="删除">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {lines.length > 0 && (
                <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
                  示例：组装 10 个果篮 = 每行配件数量 × 10 自动从配件库存扣减，成品库存 +10。
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
