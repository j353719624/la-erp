import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { message } from '@/utils/appMessage';
import { ArrowLeft, Save, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { stockAdjustApi, locationApi, rackApi } from '@/api/inventory';
import { productApi, warehouseApi } from '@/api/product';
import { StockAdjust, StockAdjustLine, Location, Rack } from '@/types/inventory';
import { Product, Warehouse } from '@/types/product';
import { format } from '@/utils/format';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

const ADJUST_TYPES = [
  { value: 'profit', label: '盘盈（入库）' },
  { value: 'loss', label: '盘亏（出库）' },
  { value: 'write_off', label: '报损（出库）' },
  { value: 'cost', label: '成本调整' },
];

export function StockAdjustForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  // [2026-09-16] 商品自定义字段中文名（行内小字展示用）
  const productLabels = useProductFieldLabels();

  const [formData, setFormData] = useState<Partial<StockAdjust>>({
    warehouse_id: '',
    location_id: '',
    rack_id: '',
    adjust_type: 'profit',
    adjust_date: format.today(),
    remark: '',
    lines: [],
  });

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isDraft = !formData.status || formData.status === 'draft';
  const readonly = isEdit && !isDraft;
  // 成本调整：不改变数量，仅重估均价（qty 语义不适用，恒 0）
  const isCost = formData.adjust_type === 'cost';

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) {
      fetchAdjust(id);
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单个接口失败不得拖垮其它下拉（同入库单缺陷模式）
      const [whRes, productRes, locRes, rackRes] = await Promise.allSettled([
        warehouseApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        locationApi.list({ page: 1, page_size: 1000 }),
        rackApi.list({ page: 1, page_size: 1000 }),
      ]);
      if (whRes.status === 'fulfilled' && whRes.value.code === 0) setWarehouses(whRes.value.data.list);
      if (productRes.status === 'fulfilled' && productRes.value.code === 0) setProducts(productRes.value.data.list);
      if (locRes.status === 'fulfilled' && locRes.value.code === 0) setLocations(locRes.value.data?.list || []);
      if (rackRes.status === 'fulfilled' && rackRes.value.code === 0) setRacks(rackRes.value.data?.list || []);
      for (const r of [whRes, productRes, locRes, rackRes]) {
        if (r.status === 'rejected') console.warn('部分选项加载失败（可能缺模块权限）:', r.reason?.message || r.reason);
      }
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchAdjust = async (adjustId: string) => {
    setLoading(true);
    try {
      const response = await stockAdjustApi.get(adjustId);
      if (response.code === 0 && response.data) {
        const data = response.data;
        const lines = (data.edges?.lines || data.lines || []).map((line: any) => ({
          id: line.id,
          product_id: line.product_id,
          product_code: line.product_code,
          product_name: line.product_name,
          spec: line.spec || '',
          qty: Number(line.qty) || 0,
          unit_cost: Number(line.unit_cost) || 0,
          batch_no: line.batch_no || '',
          remark: line.remark || '',
          // [2026-09-16] 商品自定义字段（行内小字展示）
          ext_fields: line.edges?.product?.ext_fields,
        }));
        setFormData({
          ...data,
          warehouse_id: data.warehouse_id || '',
          location_id: data.location_id || '',
          rack_id: data.rack_id || '',
          adjust_type: data.adjust_type || 'profit',
          adjust_date: format.date(data.adjust_date),
          lines,
        });
      }
    } catch (err) {
      console.error('Failed to fetch stock adjust:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateField = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const addLine = () => {
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), {
        product_id: '',
        product_code: '',
        product_name: '',
        spec: '',
        qty: 0,
        unit_cost: 0,
        batch_no: '',
        remark: '',
      }],
    }));
  };

  const removeLine = (index: number) => {
    setFormData(prev => ({
      ...prev,
      lines: (prev.lines || []).filter((_, i) => i !== index),
    }));
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
          // [2026-09-16] 商品自定义字段（行内小字展示）
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
    if (!formData.lines || formData.lines.length === 0) return '请添加调整明细';
    for (const line of formData.lines) {
      if (!line.product_id) return '请选择商品';
      if (isCost) {
        // 成本调整：仅需目标成本（均价），数量不适用
        const uc = Number(line.unit_cost);
        if (String(line.unit_cost).trim() === '' || Number.isNaN(uc) || uc < 0) {
          return '成本调整行请填写调整后的成本价（不能为负）';
        }
      } else if (!line.qty || Number(line.qty) === 0) {
        return '调整数量不能为0（填正值即可，方向由调整类型决定：盘盈入库 / 盘亏·报损出库）';
      }
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
        warehouse_id: formData.warehouse_id,
        location_id: formData.location_id || undefined,
        rack_id: formData.rack_id || undefined,
        adjust_type: formData.adjust_type,
        adjust_date: formData.adjust_date,
        remark: formData.remark || '',
        lines: (formData.lines || []).map((line, i) => ({
          line_no: i + 1,
          product_id: line.product_id,
          product_name: line.product_name,
          product_code: line.product_code,
          spec: line.spec,
          // 成本调整数量不适用，一律传 0（不产生数量变动）
          qty: isCost ? 0 : Number(line.qty),
          unit_cost: Number(line.unit_cost) || 0,
          batch_no: line.batch_no || '',
          remark: line.remark || '',
        })),
      };
      const response = isEdit
        ? await stockAdjustApi.update(id!, payload)
        : await stockAdjustApi.create(payload);
      if (response.code === 0) {
        message.success(isEdit ? '调整单已更新' : '调整单已创建');
        navigate('/inventory/adjust');
      } else {
        setError(response.message || '保存失败');
      }
    } catch (err: any) {
      console.error('Failed to save stock adjust:', err);
      setError(err?.message || '保存失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑库存调整单' : '新建库存调整单'}
        subtitle="盘盈/盘亏/报损/成本调整"
        onBack={() => navigate('/inventory/adjust')}
        extra={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/inventory/adjust')} className="btn-secondary flex items-center gap-2">
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

      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="card p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">仓库 *</label>
            <SearchSelect
              required
              value={formData.warehouse_id}
              onChange={(v) => updateField('warehouse_id', v ?? '')}
              disabled={readonly}
              placeholder="请选择仓库"
              options={warehouses.map(w => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">库位</label>
            <SearchSelect
              value={formData.location_id}
              onChange={(v) => updateField('location_id', v ?? '')}
              disabled={readonly}
              placeholder="请选择库位"
              options={locations.filter(l => !formData.warehouse_id || l.warehouse_id === formData.warehouse_id).map(l => ({ value: l.id, label: l.name }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">货架</label>
            <SearchSelect
              value={formData.rack_id}
              onChange={(v) => updateField('rack_id', v ?? '')}
              disabled={readonly}
              placeholder="请选择货架"
              options={racks.filter(r => !formData.location_id || r.location_id === formData.location_id).map(r => ({ value: r.id, label: r.name }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">调整类型 *</label>
            <select
              value={formData.adjust_type || 'profit'}
              onChange={(e) => updateField('adjust_type', e.target.value)}
              disabled={readonly}
              className="form-select w-full"
            >
              {ADJUST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">调整日期</label>
            <input
              type="date"
              value={formData.adjust_date || ''}
              onChange={(e) => updateField('adjust_date', e.target.value)}
              disabled={readonly}
              className="form-input w-full"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <input
            type="text"
            value={formData.remark || ''}
            onChange={(e) => updateField('remark', e.target.value)}
            disabled={readonly}
            placeholder="请输入调整原因说明"
            className="form-input w-full"
          />
        </div>
      </div>

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">调整明细</h3>
          {!readonly && (
            <button onClick={addLine} className="btn-secondary flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" /> 添加行
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">商品</th>
                {isCost ? (
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">调整后成本价(均价)</th>
                ) : (
                  <>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">数量(填正值，方向看类型)</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">成本价</th>
                  </>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">批次</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">备注</th>
                {!readonly && <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(formData.lines || []).map((line, index) => (
                <tr key={index}>
                  <td className="px-4 py-2">
                    <SearchSelect
                      value={line.product_id}
                      onChange={(v) => updateLine(index, 'product_id', v ?? '')}
                      disabled={readonly}
                      placeholder="请选择商品"
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
                  {isCost ? (
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={line.unit_cost}
                        onChange={(e) => updateLine(index, 'unit_cost', e.target.value)}
                        disabled={readonly}
                        placeholder="调整后均价"
                        className="form-input w-28 text-right"
                      />
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          step="any"
                          value={line.qty}
                          onChange={(e) => updateLine(index, 'qty', e.target.value)}
                          disabled={readonly}
                          className="form-input w-24 text-right"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          step="any"
                          value={line.unit_cost}
                          onChange={(e) => updateLine(index, 'unit_cost', e.target.value)}
                          disabled={readonly}
                          className="form-input w-24 text-right"
                        />
                      </td>
                    </>
                  )}
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={line.batch_no || ''}
                      onChange={(e) => updateLine(index, 'batch_no', e.target.value)}
                      disabled={readonly}
                      className="form-input w-28"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={line.remark || ''}
                      onChange={(e) => updateLine(index, 'remark', e.target.value)}
                      disabled={readonly}
                      className="form-input w-32"
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
                <tr><td colSpan={readonly ? 5 : 6} className="px-4 py-6 text-center text-sm text-gray-400">暂无明细，点击「添加行」</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
