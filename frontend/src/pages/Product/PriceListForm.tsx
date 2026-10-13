import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { message } from '@/utils/appMessage';
import { ArrowLeft, Save, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { priceListApi } from '@/api/product';
import { customerApi, supplierApi } from '@/api/order';
import { currencyApi } from '@/api/finance';
import { productApi } from '@/api/product';
import { PriceList, PriceListLine } from '@/types/product';
import { Product } from '@/types/product';
import { format } from '@/utils/format';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { loadOptions } from '@/utils/loadOptions';

interface EntityOption { id: string; name: string; }

// [2026-09-15] 明细变化签名：只取用户可编辑的业务字段（商品/价格/阶梯/备注），
// 数量/价格统一转数字再比较（避免字符串与数字形态差异造成误判）；
// 用于判断保存时是否携带 lines——启用中的价目表只拦「改明细」，表头仍可保存
const lineSignature = (ls: PriceListLine[] | undefined) =>
  JSON.stringify((ls || []).map((l) => [l.product_id || '', String(Number(l.price) || 0), String(Number(l.min_qty) || 0), l.remark || '']));

export function PriceListForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<PriceList>>({
    name: '',
    list_type: 'customer',
    entity_id: '',
    entity_name: '',
    currency: 'CNY',
    effective_date: '',
    expiry_date: '',
    remark: '',
    lines: [],
  });

  const [customers, setCustomers] = useState<EntityOption[]>([]);
  const [suppliers, setSuppliers] = useState<EntityOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // [S-05 2026-09-13] 币种改取 Currency 主数据（与销售/采购订单同源）；此前这里写死 6 个硬编码选项
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // [2026-09-15] 编辑模式的「明细原始签名」：保存时判断用户是否真的改了明细
  const originalLineSig = useRef<string>('');
  // 启用中的价目表：明细不可修改（与后端守卫同口径），名称/有效期等表头仍可保存
  const detailsLocked = isEdit && formData.status === 'active';

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) {
      fetchList(id);
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [custRes, suppRes, productRes, curRes] = await loadOptions([
        customerApi.list({ page: 1, page_size: 1000 }),
        supplierApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        currencyApi.list(),
      ], '价目表');
      if (custRes?.code === 0) setCustomers((custRes.data?.list || []).map((c: any) => ({ id: c.id, name: c.name })));
      if (suppRes?.code === 0) setSuppliers((suppRes.data?.list || []).map((s: any) => ({ id: s.id, name: s.name })));
      if (productRes?.code === 0) setProducts(productRes.data.list);
      if (curRes?.code === 0) setCurrencies(Array.isArray(curRes.data) ? curRes.data : []);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchList = async (listId: string) => {
    setLoading(true);
    try {
      const response = await priceListApi.get(listId);
      if (response.code === 0 && response.data) {
        const data = response.data;
        const lines = (data.edges?.lines || data.lines || []).map((l: any) => ({
          id: l.id,
          product_id: l.product_id,
          product_name: l.product_name,
          product_code: l.product_code,
          price: Number(l.price) || 0,
          min_qty: Number(l.min_qty) || 0,
          remark: l.remark || '',
        }));
        originalLineSig.current = lineSignature(lines);
        setFormData({
          ...data,
          entity_id: data.entity_id || '',
          entity_name: data.entity_name || '',
          effective_date: data.effective_date ? format.date(data.effective_date) : '',
          expiry_date: data.expiry_date ? format.date(data.expiry_date) : '',
          lines,
        });
      }
    } catch (err) {
      console.error('Failed to fetch price list:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateField = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    if (key === 'entity_id') {
      const opts = formData.list_type === 'customer' ? customers : suppliers;
      const ent = opts.find(x => x.id === value);
      setFormData(prev => ({ ...prev, entity_id: value, entity_name: ent?.name || '' }));
    }
  };

  const addLine = () => {
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), { product_id: '', product_name: '', product_code: '', price: 0, min_qty: 0, remark: '' }],
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
          product_name: p?.name || '',
          product_code: p?.code || '',
        };
      } else {
        lines[index] = { ...lines[index], [key]: value };
      }
      return { ...prev, lines };
    });
  };

  const validate = (): string => {
    if (!formData.name) return '请输入价目表名称';
    if (!formData.entity_id) return '请选择客户/供应商';
    if (!formData.lines || formData.lines.length === 0) return '请添加价格行';
    for (const line of formData.lines) {
      if (!line.product_id) return '请选择商品';
      if (!line.price || Number(line.price) < 0) return '价格不能为负';
    }
    return '';
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      message.warning(err);
      return;
    }
    // [2026-09-15] 明细真实变化检测 + 启用中阻止改明细（与后端守卫同口径，避免“点了保存才知道不让改”）
    const linesPayload = (formData.lines || []).map((line) => ({
      product_id: line.product_id,
      product_name: line.product_name,
      product_code: line.product_code,
      price: Number(line.price),
      min_qty: Number(line.min_qty) || 0,
      remark: line.remark || '',
    }));
    const linesChanged = !isEdit || lineSignature(formData.lines) !== originalLineSig.current;
    if (detailsLocked && linesChanged) {
      message.warning('启用中的价目表明细不可修改：请先「停用」后再编辑明细');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const payload = {
        name: formData.name,
        list_type: formData.list_type,
        entity_id: formData.entity_id,
        entity_name: formData.entity_name,
        currency: formData.currency,
        effective_date: formData.effective_date || undefined,
        expiry_date: formData.expiry_date || undefined,
        remark: formData.remark || '',
        // 明细未变时不携带 lines：启用中的价目表允许改表头（后端仅在携带 lines 时校验明细守卫）
        ...(linesChanged ? { lines: linesPayload } : {}),
      };
      const response = isEdit
        ? await priceListApi.update(id!, payload)
        : await priceListApi.create(payload);
      if (response.code === 0) {
        message.success(isEdit ? '价目表已更新' : '价目表已创建');
        navigate('/price-lists');
      } else {
        setError(response.message || '保存失败');
      }
    } catch (err: any) {
      console.error('Failed to save price list:', err);
      setError(err?.message || '保存失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // [2026-09-15] 页面内一键停用：停用后明细即可直接编辑（此前需回列表页停用，且停用后明细仍不可改）
  const handleDeactivate = async () => {
    try {
      const response = await priceListApi.update(id!, { status: 'inactive' });
      if (response.code === 0) {
        setFormData(prev => ({ ...prev, status: 'inactive' }));
        message.success('已停用，现在可以修改价格明细');
      } else {
        message.error(response.message || '停用失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '停用失败');
    }
  };

  const entityOptions = formData.list_type === 'customer' ? customers : suppliers;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑价目表' : '新建价目表'}
        subtitle="客户/供应商价格管理"
        onBack={() => navigate('/price-lists')}
        extra={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/price-lists')} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> 返回
            </button>
            <button onClick={handleSave} disabled={loading} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" /> {loading ? '保存中...' : '保存'}
            </button>
          </div>
        }
      />

      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {detailsLocked && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm flex flex-wrap items-center justify-between gap-3">
          <span>启用中的价目表：价格明细不可修改（正在被开单取价引用），需要改价请先停用；名称、有效期等表头信息仍可直接保存。</span>
          <button type="button" onClick={handleDeactivate} disabled={loading} className="btn-secondary whitespace-nowrap">
            停用并继续编辑
          </button>
        </div>
      )}
      {isEdit && formData.status === 'inactive' && (
        <div className="bg-gray-50 border border-gray-200 text-gray-600 px-4 py-3 rounded-lg text-sm">
          该价目表已停用：可自由修改明细，保存后可在列表页重新「启用」。
        </div>
      )}

      <div className="card p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
            <input type="text" value={formData.name || ''} onChange={(e) => updateField('name', e.target.value)} className="form-input w-full" placeholder="如：华东客户价目表" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
            <select
              value={formData.list_type || 'customer'}
              onChange={(e) => updateField('list_type', e.target.value)}
              className="form-select w-full"
            >
              <option value="customer">客户价目表</option>
              <option value="supplier">供应商价目表</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">客户/供应商 *</label>
            <SearchSelect
              value={formData.entity_id}
              onChange={(v) => updateField('entity_id', v ?? '')}
              placeholder="请选择"
              allowClear
              options={entityOptions.map(e => ({ value: e.id, label: e.name }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">币种</label>
            <SearchSelect
              value={formData.currency || 'CNY'}
              onChange={(v) => updateField('currency', v ?? 'CNY')}
              placeholder="请选择币种"
              options={(currencies.length > 0 ? currencies : [{ code: 'CNY', name: '人民币' }]).map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">生效日期</label>
            <input type="date" value={formData.effective_date || ''} onChange={(e) => updateField('effective_date', e.target.value)} className="form-input w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">失效日期</label>
            <input type="date" value={formData.expiry_date || ''} onChange={(e) => updateField('expiry_date', e.target.value)} className="form-input w-full" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <input type="text" value={formData.remark || ''} onChange={(e) => updateField('remark', e.target.value)} className="form-input w-full" placeholder="请输入说明" />
        </div>
      </div>

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">价格行</h3>
          <button
            onClick={addLine}
            disabled={detailsLocked}
            title={detailsLocked ? '启用中的价目表不可修改明细，请先「停用」' : undefined}
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> 添加行
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">商品</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">价格</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">最低数量(阶梯)</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">备注</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(formData.lines || []).map((line, index) => (
                <tr key={index}>
                  <td className="px-4 py-2">
                    <SearchSelect
                      value={line.product_id}
                      onChange={(v) => updateLine(index, 'product_id', v ?? '')}
                      placeholder="请选择商品"
                      allowClear
                      disabled={detailsLocked}
                      options={[
                        ...(!products.some((p) => p.id === line.product_id) && line.product_id
                          ? [{ value: line.product_id, label: `${line.product_code} - ${line.product_name || '已删除商品'}` }]
                          : []),
                        ...products.map(p => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) })),
                      ]}
                      className="min-w-[180px]"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" step="any" value={line.price} disabled={detailsLocked} onChange={(e) => updateLine(index, 'price', e.target.value)} className="form-input w-24 text-right" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" step="any" value={line.min_qty} disabled={detailsLocked} onChange={(e) => updateLine(index, 'min_qty', e.target.value)} className="form-input w-24 text-right" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="text" value={line.remark || ''} disabled={detailsLocked} onChange={(e) => updateLine(index, 'remark', e.target.value)} className="form-input w-32" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => removeLine(index)}
                      disabled={detailsLocked}
                      className="icon-btn text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      title={detailsLocked ? '启用中的价目表不可修改明细，请先「停用」' : '删除'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {(formData.lines || []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">暂无价格行，点击「添加行」</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
