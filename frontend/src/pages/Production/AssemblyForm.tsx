import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { message } from '@/utils/appMessage';
import { ArrowLeft, Save, Plus, Trash2, ListTree } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { assemblyApi } from '@/api/production';
import { productApi, warehouseApi } from '@/api/product';
import { AssemblyOrder, AssemblyOrderLine } from '@/types/production';
import { Product, Warehouse } from '@/types/product';
import { format } from '@/utils/format';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { loadOptions } from '@/utils/loadOptions';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

export function AssemblyForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  // [2026-09-16] 商品自定义字段中文名（组件行内小字展示用）
  const productLabels = useProductFieldLabels();

  const [formData, setFormData] = useState<Partial<AssemblyOrder>>({
    asm_type: 'assemble',
    warehouse_id: '',
    product_id: '',
    product_code: '',
    product_name: '',
    spec: '',
    qty: 1,
    asm_date: format.today(),
    remark: '',
    lines: [],
  });

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isDraft = !formData.status || formData.status === 'draft';
  const readonly = isEdit && !isDraft;

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) fetchAssembly(id);
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [whRes, productRes] = await loadOptions([
        warehouseApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
      ], '组装单');
      if (whRes?.code === 0) setWarehouses(whRes.data.list);
      if (productRes?.code === 0) setProducts(productRes.data.list);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchAssembly = async (asmId: string) => {
    setLoading(true);
    try {
      const response = await assemblyApi.get(asmId);
      if (response.code === 0 && response.data) {
        const d = response.data;
        const lines = (d.edges?.lines || d.lines || []).map((l: any) => ({
          product_id: l.product_id,
          product_code: l.product_code || '',
          product_name: l.product_name || '',
          spec: l.spec || '',
          qty: Number(l.qty) || 0,
          unit_cost: Number(l.unit_cost) || 0,
          batch_no: l.batch_no || '',
          remark: l.remark || '',
          // [2026-09-16] 商品自定义字段（组件行内小字展示）
          ext_fields: l.edges?.product?.ext_fields,
        }));
        setFormData({
          ...d,
          warehouse_id: d.warehouse_id || '',
          product_id: d.product_id || '',
          product_code: d.product_code || '',
          product_name: d.product_name || '',
          spec: d.spec || '',
          qty: Number(d.qty) || 0,
          asm_date: d.asm_date ? format.date(d.asm_date) : '',
          lines,
        });
      }
    } catch (err) {
      console.error('Failed to fetch assembly:', err);
    } finally {
      setLoading(false);
    }
  };

  const setProduct = (value: string) => {
    const p = products.find(x => x.id === value);
    setFormData(prev => ({
      ...prev,
      product_id: value,
      product_code: p?.code || '',
      product_name: p?.name || '',
      spec: p?.spec || '',
    }));
  };

  const addLine = () => {
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), { product_id: '', product_code: '', product_name: '', spec: '', qty: 1, unit_cost: 0, batch_no: '', remark: '' }],
    }));
  };

  const removeLine = (index: number) => {
    setFormData(prev => ({ ...prev, lines: (prev.lines || []).filter((_, i) => i !== index) }));
  };

  const updateLine = (index: number, key: string, value: any) => {
    setFormData(prev => {
      const lines = [...(prev.lines || [])];
      if (key === 'product_id') {
        const p = products.find(x => x.id === value);
        lines[index] = {
          ...lines[index],
          product_id: value,
          product_code: p?.code || '',
          product_name: p?.name || '',
          spec: p?.spec || '',
          unit_cost: p?.purchase_price ? Number(p.purchase_price) : (lines[index].unit_cost || 0),
          // [2026-09-16] 商品自定义字段（组件行内小字展示）
          ext_fields: p?.ext_fields,
        };
      } else {
        lines[index] = { ...lines[index], [key]: value };
      }
      return { ...prev, lines };
    });
  };

  const validate = (): string => {
    if (!formData.warehouse_id) return '请选择仓库';
    if (!formData.product_id) return '请选择成品';
    if (!formData.qty || Number(formData.qty) <= 0) return '成品数量必须大于0';
    if (!formData.lines || formData.lines.length === 0) return '请添加组件明细';
    for (const line of formData.lines) {
      if (!line.product_id) return '请选择组件商品';
      if (!line.qty || Number(line.qty) <= 0) return '组件数量必须大于0';
    }
    return '';
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { message.warning(err); return; }
    setError('');
    setLoading(true);
    try {
      const payload = {
        asm_type: formData.asm_type,
        warehouse_id: formData.warehouse_id,
        product_id: formData.product_id,
        product_name: formData.product_name,
        product_code: formData.product_code,
        spec: formData.spec,
        qty: Number(formData.qty),
        asm_date: formData.asm_date || undefined,
        remark: formData.remark || '',
        lines: (formData.lines || []).map((line, i) => ({
          line_no: i + 1,
          product_id: line.product_id,
          product_name: line.product_name,
          product_code: line.product_code,
          spec: line.spec,
          qty: Number(line.qty),
          unit_cost: Number(line.unit_cost) || 0,
          batch_no: line.batch_no || '',
          remark: line.remark || '',
        })),
      };
      const response = isEdit ? await assemblyApi.update(id!, payload) : await assemblyApi.create(payload);
      if (response.code === 0) {
        message.success(isEdit ? '组装单已更新' : '组装单已创建');
        navigate('/assemblies');
      } else {
        setError(response.message || '保存失败');
      }
    } catch (err: any) {
      console.error('Failed to save assembly:', err);
      setError(err?.message || '保存失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const totalComponentCost = (formData.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);

  const handleLoadBOM = async () => {
    if (!formData.product_id) {
      message.warning('请先选择成品');
      return;
    }
    const qty = Number(formData.qty) || 1;
    try {
      const response = await assemblyApi.bomComponents(formData.product_id);
      if (response.code === 0) {
        const comps: any[] = response.data || [];
        if (comps.length === 0) {
          message.warning('该成品未配置生效 BOM，无法带出组件');
          return;
        }
        const lines = comps.map((c: any) => ({
          product_id: c.product_id,
          product_code: c.product_code || '',
          product_name: c.product_name || '',
          spec: c.spec || '',
          qty: Number(((Number(c.qty_per_unit) || 0) * qty * (1 + (Number(c.scrap_rate) || 0))).toFixed(4)),
          unit_cost: Number(c.unit_cost) || 0,
          batch_no: '',
          remark: c.scrap_rate ? `损耗率${(Number(c.scrap_rate) * 100).toFixed(0)}%` : '',
          // [2026-09-16] 商品自定义字段（BOM 带出行内小字展示）
          ext_fields: c.ext_fields,
        }));
        setFormData(prev => ({ ...prev, lines }));
        message.success(`已按 BOM 带出 ${lines.length} 个组件，可修改后保存`);
      } else {
        message.error(response.message || '带出失败');
      }
    } catch (err: any) {
      console.error('Failed to load BOM components:', err);
      message.error(err?.message || '带出失败，请稍后重试');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑组装单' : '新建组装单'}
        subtitle="半成品与成品的快速组装、拆解"
        onBack={() => navigate('/assemblies')}
        extra={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/assemblies')} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> 返回
            </button>
            {!readonly && (
              <button onClick={handleSave} disabled={loading} className="btn-primary flex items-center gap-2">
                <Save className="w-4 h-4" /> {loading ? '保存中...' : '保存'}
              </button>
            )}
          </div>
        }
      />

      {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="card p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
            <select
              value={formData.asm_type || 'assemble'}
              onChange={(e) => setFormData(prev => ({ ...prev, asm_type: e.target.value }))}
              disabled={readonly}
              className="form-select w-full"
            >
              <option value="assemble">组装（组件出库 → 成品入库）</option>
              <option value="disassemble">拆解（成品出库 → 组件入库）</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">仓库 *</label>
            <SearchSelect
              required
              value={formData.warehouse_id}
              onChange={(v) => setFormData(prev => ({ ...prev, warehouse_id: v ?? '' }))}
              disabled={readonly}
              placeholder="请选择仓库"
              options={warehouses.map(w => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">成品 *</label>
            <SearchSelect
              required
              value={formData.product_id}
              onChange={(v) => setProduct(v ?? '')}
              disabled={readonly}
              placeholder="请选择成品"
              options={[
                // 编辑态保留已删除/不在列表中的商品（原样展示，不可再改选别的值）
                ...(!products.some((p) => p.id === formData.product_id) && formData.product_id
                  ? [{ value: formData.product_id, label: `${formData.product_code} - ${formData.product_name || '已删除商品'}` }]
                  : []),
                ...products.filter(p => (formData.asm_type === 'assemble' ? true : true)).map(p => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) })),
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">数量 *</label>
            <input
              type="text"
              inputMode="decimal"
              value={formData.qty ?? ''}
              onChange={(e) => setFormData(prev => ({ ...prev, qty: e.target.value }))}
              disabled={readonly}
              className="form-input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
            <input
              type="date"
              value={formData.asm_date || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, asm_date: e.target.value }))}
              disabled={readonly}
              className="form-input w-full"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <input
              type="text"
              value={formData.remark || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, remark: e.target.value }))}
              disabled={readonly}
              className="form-input w-full"
              placeholder="组装说明"
            />
          </div>
        </div>
        <div className="text-sm text-gray-600">
          组件成本合计：<span className="font-semibold text-gray-900">{format.currency(totalComponentCost)}</span>
          {Number(formData.qty) > 0 && (
            <>　·　预计成品单位成本：<span className="font-semibold text-gray-900">{(totalComponentCost / Number(formData.qty)).toFixed(2)}</span></>
          )}
        </div>
      </div>

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">{formData.asm_type === 'assemble' ? '组件（组装时出库）' : '组件（拆解时入库）'}</h3>
          {!readonly && (
            <div className="flex items-center gap-2">
              <button onClick={handleLoadBOM} className="btn-secondary flex items-center gap-2 text-sm">
                <ListTree className="w-4 h-4" /> 按BOM带出
              </button>
              <button onClick={addLine} className="btn-secondary flex items-center gap-2 text-sm">
                <Plus className="w-4 h-4" /> 添加组件
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">组件商品</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">数量</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">成本</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">批次</th>
                {!readonly && <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(formData.lines || []).map((line: any, index: number) => (
                <tr key={index}>
                  <td className="px-4 py-2">
                    <SearchSelect
                      value={line.product_id}
                      onChange={(v) => updateLine(index, 'product_id', v ?? '')}
                      disabled={readonly}
                      placeholder="请选择组件"
                      options={[
                        // 编辑态保留已删除/不在列表中的商品（原样展示，不可再改选别的值）
                        ...(!products.some((p) => p.id === line.product_id) && line.product_id
                          ? [{ value: line.product_id, label: `${line.product_code} - ${line.product_name || '已删除商品'}` }]
                          : []),
                        ...products.map(p => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) })),
                      ]}
                    />
                    <LineProductExt line={line} labels={productLabels} />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.qty ?? ''}
                      onChange={(e) => updateLine(index, 'qty', e.target.value)}
                      disabled={readonly}
                      className="form-input w-24 text-right"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.unit_cost ?? ''}
                      onChange={(e) => updateLine(index, 'unit_cost', e.target.value)}
                      disabled={readonly}
                      className="form-input w-24 text-right"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={line.batch_no || ''}
                      onChange={(e) => updateLine(index, 'batch_no', e.target.value)}
                      disabled={readonly}
                      className="form-input w-28"
                    />
                  </td>
                  {!readonly && (
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => removeLine(index)} className="icon-btn text-red-600" title="删除">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {(formData.lines || []).length === 0 && (
                <tr><td colSpan={readonly ? 4 : 5} className="px-4 py-6 text-center text-sm text-gray-400">暂无组件，点击「添加组件」</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
