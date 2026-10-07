import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { message } from '@/utils/appMessage';
import { ArrowLeft, Save, Plus, Trash2, Check, ShoppingCart, FileText } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { RowActions } from '@/components/RowActions';
import { SearchSelect } from '@/components/SearchSelect';
import { rfqApi, supplierApi } from '@/api/order';
import { productApi } from '@/api/product';
import { Product } from '@/types/product';
import { format } from '@/utils/format';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { loadOptions } from '@/utils/loadOptions';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

interface EntityOption { id: string; name: string; }
interface RfqLine {
  id?: string;
  product_id: string;
  product_code: string;
  product_name: string;
  spec: string;
  qty: number;
  quoted_price: number;
  remark: string;
  // [2026-09-16] 商品自定义字段（行内小字展示）
  ext_fields?: Record<string, unknown>;
}
interface QuoteDraftLine {
  product_id: string;
  product_name: string;
  qty: number;
  price: number;
}

export function PurchaseRFQForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  // [2026-09-16] 商品自定义字段中文名（行内小字展示用）
  const productLabels = useProductFieldLabels();

  const [formData, setFormData] = useState({
    supplier_id: '',
    supplier_name: '',
    rfq_date: format.today(),
    remark: '',
    status: '',
    lines: [] as RfqLine[],
  });

  const [suppliers, setSuppliers] = useState<EntityOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // A-1 多供应商报价
  const [quotes, setQuotes] = useState<any[]>([]);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState({
    supplier_id: '',
    supplier_name: '',
    quote_date: format.today(),
    remark: '',
    lines: [] as QuoteDraftLine[],
  });
  const [quoteSaving, setQuoteSaving] = useState(false);

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) fetchRfq(id);
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [suppRes, productRes] = await loadOptions([
        supplierApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
      ], '询价单');
      if (suppRes?.code === 0) setSuppliers((suppRes.data?.list || []).map((s: any) => ({ id: s.id, name: s.name })));
      if (productRes?.code === 0) setProducts(productRes.data.list);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchRfq = async (rfqId: string) => {
    setLoading(true);
    try {
      const response = await rfqApi.get(rfqId);
      if (response.code === 0 && response.data) {
        const d = response.data;
        const lines = (d.edges?.lines || d.lines || []).map((l: any) => ({
          id: l.id,
          product_id: l.product_id,
          product_code: l.product_code || '',
          product_name: l.product_name || '',
          spec: l.spec || '',
          qty: Number(l.qty) || 0,
          quoted_price: Number(l.quoted_price) || 0,
          remark: l.remark || '',
          // [2026-09-16] 商品自定义字段（行内小字展示）
          ext_fields: l.edges?.product?.ext_fields,
        }));
        setFormData({
          supplier_id: d.supplier_id || '',
          supplier_name: d.supplier_name || '',
          rfq_date: d.rfq_date ? format.date(d.rfq_date) : '',
          remark: d.remark || '',
          status: d.status || '',
          lines,
        });
        // 已存在的报价
        const qs = d.edges?.quotes || [];
        if (qs.length) {
          setQuotes(qs);
        } else {
          fetchQuotes(rfqId);
        }
      }
    } catch (err) {
      console.error('Failed to fetch rfq:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchQuotes = async (rfqId: string) => {
    try {
      const res = await rfqApi.listQuotes(rfqId);
      if (res.code === 0) setQuotes(res.data || []);
    } catch (err) {
      console.error('Failed to fetch quotes:', err);
    }
  };

  const openQuoteForm = () => {
    setQuoteDraft({
      supplier_id: '',
      supplier_name: '',
      quote_date: format.today(),
      remark: '',
      lines: formData.lines.map(l => ({ product_id: l.product_id, product_name: l.product_name, qty: Number(l.qty) || 0, price: 0 })),
    });
    setShowQuoteForm(true);
  };

  const handleQuoteSupplierChange = (supplierId: string) => {
    const s = suppliers.find(x => x.id === supplierId);
    setQuoteDraft(prev => ({ ...prev, supplier_id: supplierId, supplier_name: s?.name || '' }));
  };

  const updateQuotePrice = (index: number, value: any) => {
    setQuoteDraft(prev => {
      const lines = [...prev.lines];
      lines[index] = { ...lines[index], price: value };
      return { ...prev, lines };
    });
  };

  const handleAddQuote = async () => {
    if (!quoteDraft.supplier_id) { message.warning('请选择报价供应商'); return; }
    if (!quoteDraft.lines.length) { message.warning('请填写报价明细'); return; }
    for (const l of quoteDraft.lines) {
      if (!l.product_id) { message.warning('报价明细缺少商品'); return; }
      if (!l.qty || l.qty <= 0) { message.warning('报价明细数量必须大于0'); return; }
    }
    setQuoteSaving(true);
    try {
      const payload = {
        supplier_id: quoteDraft.supplier_id,
        supplier_name: quoteDraft.supplier_name,
        quote_date: quoteDraft.quote_date || undefined,
        remark: quoteDraft.remark,
        lines: quoteDraft.lines.map((l, i) => ({
          line_no: i + 1,
          product_id: l.product_id,
          qty: Number(l.qty),
          price: Number(l.price) || 0,
        })),
      };
      const res = await rfqApi.addQuote(id!, payload);
      if (res.code === 0) {
        message.success('报价已保存');
        setShowQuoteForm(false);
        fetchQuotes(id!);
      } else {
        message.error(res.message || '保存报价失败');
      }
    } catch (err: any) {
      console.error('Failed to add quote:', err);
      message.error(err?.message || '保存报价失败');
    } finally {
      setQuoteSaving(false);
    }
  };

  const handleSelectQuote = async (quoteId: string) => {
    try {
      const res = await rfqApi.selectQuote(id!, quoteId);
      if (res.code === 0) {
        message.success('已选中该报价');
        fetchQuotes(id!);
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err: any) {
      message.error(err?.message || '操作失败');
    }
  };

  const handleDeleteQuote = async (quoteId: string) => {
    try {
      const res = await rfqApi.deleteQuote(id!, quoteId);
      if (res.code === 0) {
        message.success('报价已删除');
        fetchQuotes(id!);
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    }
  };

  const handleConvert = async (quoteId?: string) => {
    try {
      const res = await rfqApi.convert(id!, quoteId);
      if (res.code === 0) {
        message.success('已生成采购订单');
        navigate('/purchase-orders');
      } else {
        message.error(res.message || '转采购订单失败');
      }
    } catch (err: any) {
      message.error(err?.message || '转采购订单失败');
    }
  };

  const addLine = () => {
    setFormData(prev => ({ ...prev, lines: [...prev.lines, { product_id: '', product_code: '', product_name: '', spec: '', qty: 1, quoted_price: 0, remark: '' }] }));
  };

  const removeLine = (index: number) => {
    setFormData(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));
  };

  const updateLine = (index: number, key: string, value: any) => {
    setFormData(prev => {
      const lines = [...prev.lines];
      if (key === 'product_id') {
        const p = products.find(x => x.id === value);
        lines[index] = { ...lines[index], product_id: value, product_code: p?.code || '', product_name: p?.name || '', spec: p?.spec || '', ext_fields: p?.ext_fields };
      } else {
        lines[index] = { ...lines[index], [key]: value };
      }
      return { ...prev, lines };
    });
  };

  const validate = (): string => {
    if (formData.lines.length === 0) return '请添加询价明细';
    for (const line of formData.lines) {
      if (!line.product_id) return '请选择商品';
      if (!line.qty || Number(line.qty) <= 0) return '数量必须大于0';
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
        supplier_id: formData.supplier_id,
        supplier_name: formData.supplier_name,
        rfq_date: formData.rfq_date || undefined,
        remark: formData.remark,
        lines: formData.lines.map((line, i) => ({
          line_no: i + 1,
          product_id: line.product_id,
          product_name: line.product_name,
          product_code: line.product_code,
          spec: line.spec,
          qty: Number(line.qty),
          quoted_price: Number(line.quoted_price) || 0,
          remark: line.remark || '',
        })),
      };
      const response = isEdit ? await rfqApi.update(id!, payload) : await rfqApi.create(payload);
      if (response.code === 0) {
        message.success(isEdit ? '询价单已更新' : '询价单已创建');
        navigate('/purchase-rfqs');
      } else {
        setError(response.message || '保存失败');
      }
    } catch (err: any) {
      console.error('Failed to save rfq:', err);
      setError(err?.message || '保存失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSupplierChange = (supplierId: string) => {
    const s = suppliers.find(x => x.id === supplierId);
    setFormData(prev => ({ ...prev, supplier_id: supplierId, supplier_name: s?.name || '' }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑询价单' : '新建询价单'}
        subtitle="供应商询价比价"
        onBack={() => navigate('/purchase-rfqs')}
        extra={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/purchase-rfqs')} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> 返回
            </button>
            <button onClick={handleSave} disabled={loading} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" /> {loading ? '保存中...' : '保存'}
            </button>
          </div>
        }
      />

      {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="card p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">主供应商（可选，也可由各家报价）</label>
            <SearchSelect
              value={formData.supplier_id}
              onChange={(v) => handleSupplierChange(v ?? '')}
              placeholder="请选择供应商"
              options={suppliers.map(s => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">询价日期</label>
            <input type="date" value={formData.rfq_date} onChange={(e) => setFormData(prev => ({ ...prev, rfq_date: e.target.value }))} className="form-input w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <input type="text" value={formData.remark} onChange={(e) => setFormData(prev => ({ ...prev, remark: e.target.value }))} className="form-input w-full" placeholder="询价说明" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">询价明细</h3>
          <button onClick={addLine} className="btn-secondary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> 添加行
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">商品</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">数量</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">报价</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">金额</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {formData.lines.map((line, index) => (
                <tr key={index}>
                  <td className="px-4 py-2">
                    <SearchSelect
                      value={line.product_id}
                      onChange={(v) => updateLine(index, 'product_id', v ?? '')}
                      placeholder="请选择商品"
                      options={[
                        // 编辑态保留已删除/不在列表中的商品（原样展示，不可再改选别的值）
                        ...(!products.some((p) => p.id === line.product_id) && line.product_id
                          ? [{ value: line.product_id, label: `${line.product_name} (${line.product_code})` }]
                          : []),
                        ...products.map(p => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) })),
                      ]}
                    />
                    <LineProductExt line={line} labels={productLabels} />
                  </td>
                  <td className="px-4 py-2">
                    <input type="text" inputMode="decimal" value={line.qty ?? ''} onChange={(e) => updateLine(index, 'qty', e.target.value)} className="form-input w-24 text-right" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="text" inputMode="decimal" value={line.quoted_price ?? ''} onChange={(e) => updateLine(index, 'quoted_price', e.target.value)} className="form-input w-24 text-right" placeholder="供应商报价" />
                  </td>
                  <td className="px-4 py-2 text-right text-sm text-gray-700">{format.currency((Number(line.qty) || 0) * (Number(line.quoted_price) || 0))}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => removeLine(index)} className="icon-btn text-red-600" title="删除">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {formData.lines.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">暂无明细，点击「添加行」</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isEdit && (
        <div className="card">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-800">供应商报价（多供应商比价）</h3>
            <div className="flex items-center gap-2">
              {formData.status === 'confirmed' && (
                <button onClick={() => handleConvert()} className="btn-primary flex items-center gap-2 text-sm">
                  <ShoppingCart className="w-4 h-4" /> 转采购订单（选中报价）
                </button>
              )}
              {formData.status === 'confirmed' && (
                <button onClick={openQuoteForm} className="btn-secondary flex items-center gap-2 text-sm">
                  <Plus className="w-4 h-4" /> 添加报价
                </button>
              )}
            </div>
          </div>

          {showQuoteForm && (
            <div className="p-4 border-b border-gray-100 bg-gray-50/50 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">报价供应商 *</label>
                  <SearchSelect
                    required
                    requiredMessage="请选择报价供应商"
                    value={quoteDraft.supplier_id}
                    onChange={(v) => handleQuoteSupplierChange(v ?? '')}
                    placeholder="请选择供应商"
                    options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">报价日期</label>
                  <input type="date" value={quoteDraft.quote_date} onChange={(e) => setQuoteDraft(prev => ({ ...prev, quote_date: e.target.value }))} className="form-input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <input type="text" value={quoteDraft.remark} onChange={(e) => setQuoteDraft(prev => ({ ...prev, remark: e.target.value }))} className="form-input w-full" placeholder="如：含税含运费" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">商品</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">数量</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">报价单价</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">小计</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {quoteDraft.lines.map((l, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 text-sm text-gray-700">{l.product_name}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-700">{l.qty}</td>
                        <td className="px-4 py-2 text-right">
                          <input type="text" inputMode="decimal" value={l.price ?? ''} onChange={(e) => updateQuotePrice(idx, e.target.value)} className="form-input w-28 text-right" placeholder="报价" />
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-700">{((Number(l.qty) || 0) * (Number(l.price) || 0)).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setShowQuoteForm(false)} className="btn-secondary text-sm">取消</button>
                <button onClick={handleAddQuote} disabled={quoteSaving} className="btn-primary text-sm">
                  {quoteSaving ? '保存中...' : '保存报价'}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">供应商</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">报价日期</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">报价明细</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">合计金额</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {quotes.map((q: any) => {
                  const qLines: any[] = q.edges?.lines || q.lines || [];
                  return (
                    <tr key={q.id} className={q.status === 'selected' ? 'bg-green-50/60' : ''}>
                      <td className="px-4 py-3 text-center text-sm text-gray-800">{q.supplier_name || q.supplier_id}</td>
                      <td className="px-4 py-3 text-center text-sm text-gray-600">{q.quote_date ? format.date(q.quote_date) : '-'}</td>
                      <td className="px-4 py-3 text-left text-xs text-gray-600">
                        {qLines.map((l: any, i: number) => (
                          <div key={i}>{l.product_name} × {l.qty} @ {Number(l.price).toFixed(2)}</div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-gray-800">{Number(q.total_amount || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-center">
                        {q.status === 'selected'
                          ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700"><Check className="w-3 h-3" /> 已选中</span>
                          : <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">待选</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {/* [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多） */}
                        <RowActions
                          actions={[
                            { key: 'convert', label: '用该报价转采购订单', icon: <ShoppingCart className="w-4 h-4" />, onClick: () => handleConvert(q.id) },
                            ...(q.status !== 'selected'
                              ? [{ key: 'select', label: '选中该报价', icon: <Check className="w-4 h-4" />, onClick: () => handleSelectQuote(q.id) }]
                              : []),
                            { key: 'del', label: '删除报价', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDeleteQuote(q.id) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
                {quotes.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">暂无供应商报价，确认询价单后点击「添加报价」</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-gray-50/70 text-xs text-gray-500 border-t border-gray-100 flex items-center gap-1">
            <FileText className="w-3.5 h-3.5" /> 提示：先录入多家供应商报价进行比价，选中最优报价后再转采购订单；转单按选中报价的供应商与价格生成。
          </div>
        </div>
      )}
    </div>
  );
}
