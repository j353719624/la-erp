import { format, toLocalDateISO } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { purchaseReturnApi, supplierApi, purchaseOrderApi } from '@/api/order';
import { productApi } from '@/api/product';
import { Supplier, PurchaseReturn, PurchaseReturnLine, PurchaseOrder } from '@/types/order';
import { Product } from '@/types/product';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { mergeAddsIntoLines, recomputePricedLine } from '@/utils/docLines';
import { message } from '@/utils/appMessage';
import { loadOptions } from '@/utils/loadOptions';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

export function PurchaseReturnForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<PurchaseReturn>>({
    supplier_id: '',
    supplier_name: '',
    order_no: '',
    return_date: format.today(),
    reason: '',
    lines: [],
  });

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // [2026-09-16] 商品自定义字段中文名（行内「商品信息」小字展示用）
  const productLabels = useProductFieldLabels();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // W-01：扫码快录输入框 + 「按规格批量添加」弹窗
  const [scanValue, setScanValue] = useState('');
  const [specPickerOpen, setSpecPickerOpen] = useState(false);

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) {
      fetchReturn(id);
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [supplierRes, orderRes, productRes] = await loadOptions([
        supplierApi.list({ page: 1, page_size: 1000 }),
        purchaseOrderApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
      ], '采购退货');
      if (supplierRes?.code === 0) setSuppliers(supplierRes.data.list);
      // 退货来源订单：排除草稿/已取消（未确认或已取消的单不可执行退货）
      if (orderRes?.code === 0) setPurchaseOrders((orderRes.data.list || []).filter((o: any) => o.status !== 'draft' && o.status !== 'cancelled'));
      if (productRes?.code === 0) setProducts(productRes.data.list);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchReturn = async (returnId: string) => {
    setLoading(true);
    try {
      const response = await purchaseReturnApi.get(returnId);
      if (response.code === 0) {
        const data = response.data as any;
        // 后端明细挂在 edges.lines（ent 图）；金额为 decimal 字符串 → 统一转 number，避免合计拼接
        const lines = (data.edges?.lines || data.lines || []).map((line: any) => ({
          ...line,
          quantity: Number(line.quantity || line.qty || 0),
          price: Number(line.price) || 0,
          amount: Number(line.amount) || 0,
          tax_rate: Number(line.tax_rate) || 0,
          tax_amount: Number(line.tax_amount) || 0,
        }));
        // 后端字段为 order_date/remark，前端表单用 return_date/reason 显示，提交时映射回去
        setFormData({
          ...data,
          lines,
          return_date: (data.return_date || data.order_date || '').slice(0, 10),
          reason: data.reason || data.remark || '',
        });
      }
    } catch (err) {
      console.error('Failed to fetch purchase return:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliers.find(s => s.id === supplierId);
    setFormData(prev => ({
      ...prev,
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
    }));
  };

  const handleAddLine = () => {
    const newLine: PurchaseReturnLine = {
      id: '',
      product_id: '',
      product_code: '',
      product_name: '',
      spec: '',
      quantity: 1,
      price: 0,
      amount: 0,
      tax_rate: 0,
      tax_amount: 0,
    };
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), newLine],
    }));
  };

  // W-01：批量添加（规格矩阵 / 扫码共用）——同商品已在明细则数量累加，不产生重复行
  const handleBatchAdd = (adds: SpecBatchItem[]) => {
    if (!adds.length) return;
    const productOf = new Map(adds.map((a) => [a.product.id, a.product]));
    const { lines, merged } = mergeAddsIntoLines(
      formData.lines || [],
      adds.map((a) => ({ productId: a.product.id, qty: a.qty })),
      (add) => {
        const p = productOf.get(add.productId)!;
        const qty = add.qty;
        const price = Number(p.purchase_price) || 0;
        return {
          id: '',
          product_id: p.id,
          product_code: p.code,
          product_name: p.name,
          spec: p.spec,
          quantity: qty,
          price,
          amount: qty * price,
          tax_rate: 0,
          tax_amount: 0,
          // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字）
          ext_fields: p.ext_fields,
        } as PurchaseReturnLine;
      },
      (line, addQty) => recomputePricedLine(line, addQty),
    );
    setFormData((prev) => ({
      ...prev,
      lines,
      total_amount: lines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
    }));
    message.success(`已添加 ${adds.length} 个商品${merged ? `，其中 ${merged} 个累加到已有明细行` : ''}`);
  };

  // W-01：扫码/输码快速添加——条码/编码精确优先；连续扫同一商品自动累加数量
  const handleScanDetect = async (code: string) => {
    const raw = code.trim();
    setScanValue('');
    if (!raw) return;
    let match = matchProductByScan(products, raw);
    if (!match.hit && match.count === 0) {
      // 本地列表（1000 上限）未命中：按关键词回源查一次，支持大目录扫码
      try {
        const res = await productApi.list({ page: 1, page_size: 20, keyword: raw, status: 'active' });
        if (res.code === 0) match = matchProductByScan(res.data?.list || [], raw);
      } catch {
        /* 回源失败按未找到提示 */
      }
    }
    if (!match.hit) {
      message.warning(match.count > 1 ? `「${raw}」匹配到 ${match.count} 个商品，请扫条码或用编码精确录入` : `未找到商品：${raw}`);
      return;
    }
    handleBatchAdd([{ product: match.hit, qty: 1 }]);
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    const newLines = [...(formData.lines || [])];
    newLines[index] = { ...newLines[index], [field]: value };

    if (field === 'product_id') {
      const product = products.find(p => p.id === value);
      if (product) {
        newLines[index].product_code = product.code;
        newLines[index].product_name = product.name;
        newLines[index].spec = product.spec;
        newLines[index].price = product.purchase_price;
        // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字；保存后由商品边提供）
        newLines[index].ext_fields = product.ext_fields;
      }
    }

    const taxRate = newLines[index].tax_rate || 0;
    newLines[index].amount = newLines[index].quantity * newLines[index].price;
    newLines[index].tax_amount = (newLines[index].amount * taxRate) / 100;

    setFormData(prev => ({
      ...prev,
      lines: newLines,
      total_amount: newLines.reduce((sum, line) => sum + (line.amount || 0), 0),
    }));
  };

  const handleRemoveLine = (index: number) => {
    const newLines = [...(formData.lines || [])];
    newLines.splice(index, 1);
    setFormData(prev => ({
      ...prev,
      lines: newLines,
      total_amount: newLines.reduce((sum, line) => sum + (line.amount || 0), 0),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.supplier_id) { setError('请选择供应商'); return; }
    setLoading(true);
    try {
      // 金额统一 round 2 后提交（浮点尾差防护）：空串/null → 0，杜绝脏值/空串入后端
      const r2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100;
      const submitData = {
        ...formData,
        order_date: toLocalDateISO(formData.return_date),
        remark: formData.reason,
        lines: (formData.lines || []).map((line: any) => ({
          ...line,
          qty: Number(line.quantity) || 0,
          quantity: Number(line.quantity) || 0,
          price: r2(line.price),
          amount: r2(line.amount),
          tax_rate: Number(line.tax_rate) || 0,
          tax_amount: r2(line.tax_amount),
        })),
      };
      if (isEdit && id) {
        const response = await purchaseReturnApi.update(id, submitData);
        if (response.code === 0) {
          navigate('/purchase-returns');
        }
      } else {
        const response = await purchaseReturnApi.create(submitData);
        if (response.code === 0) {
          navigate('/purchase-returns');
        }
      }
    } catch (err) {
      console.error('Failed to save purchase return:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑采购退货' : '新建采购退货'}
        subtitle={isEdit ? '修改采购退货信息' : '创建新的采购退货单'}
        onBack={() => { if (confirmLeave()) navigate('/purchase-returns'); }}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">供应商 *</label>
                <SearchSelect
                  required
                  value={formData.supplier_id}
                  onChange={(v) => handleSupplierChange(v ?? '')}
                  placeholder="请选择供应商"
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">原订单号</label>
                <SearchSelect
                  value={formData.purchase_order_id}
                  onChange={(v) => {
                    const po = purchaseOrders.find(o => o.id === v);
                    setFormData(prev => ({
                      ...prev,
                      purchase_order_id: v ?? '',
                      purchase_order_no: po?.order_no || '',
                      order_no: po?.order_no || '',
                    }));
                  }}
                  placeholder="请选择订单"
                  options={purchaseOrders.map((o) => ({ value: o.id, label: o.order_no }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">退货日期 *</label>
                <input
                  type="date"
                  value={formData.return_date || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, return_date: e.target.value }))}
                  required
                  className="form-input"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">退货原因</label>
                <textarea
                  value={formData.reason || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                  className="form-input"
                  rows={2}
                  placeholder="请输入退货原因"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">总金额</label>
                <input
                  type="text"
                  value={`¥${Number(formData.total_amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3">
                <h3 className="font-medium text-gray-700 whitespace-nowrap">退货明细</h3>
                <div className="w-full sm:max-w-xs">
                  <BarcodeInput
                    value={scanValue}
                    onChange={setScanValue}
                    onDetect={handleScanDetect}
                    placeholder="扫码/输码快速添加：条码 / 编码，回车"
                  />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSpecPickerOpen(true)}
                    className="btn-secondary text-sm flex items-center gap-1"
                    title="多规格商品：选款后在「颜色×尺码」网格里直接填数量，一次生成多条明细"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    按规格批量添加
                  </button>
                  <button type="button" onClick={handleAddLine} className="btn-secondary text-sm flex items-center gap-1">
                    <Plus className="w-4 h-4" />
                    添加商品
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">商品</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">规格</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">单价</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">数量</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">税率%</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">税额</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">金额</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(formData.lines || []).map((line, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3">
                          <SearchSelect
                            value={line.product_id}
                            onChange={(v) => handleLineChange(index, 'product_id', v ?? '')}
                            placeholder="请选择商品"
                            options={[
                              // 编辑态保留已删除/不在列表中的商品（原样展示，不可再改选别的值）
                              ...(!products.some((p) => p.id === line.product_id) && line.product_id
                                ? [{ value: line.product_id, label: `${line.product_code} - ${line.product_name || '已删除商品'}` }]
                                : []),
                              ...productSelectGroups(products),
                            ]}
                          />
                          <LineProductExt line={line} labels={productLabels} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-sm">{line.spec}</td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.price ?? ''}
                            onChange={(e) => handleLineChange(index, 'price', e.target.value)}
                            className="form-input text-right"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.quantity ?? ''}
                            onChange={(e) => handleLineChange(index, 'quantity', e.target.value)}
                            className="form-input text-right"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.tax_rate ?? ''}
                            onChange={(e) => handleLineChange(index, 'tax_rate', e.target.value)}
                            className="form-input text-right w-20"
                          />
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">¥{formatCurrency(line.tax_amount)}</td>
                        <td className="px-4 py-3 text-right font-medium">¥{formatCurrency(line.amount)}</td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => handleRemoveLine(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(!formData.lines || formData.lines.length === 0) && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">点击上方按钮添加商品</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-6 text-sm">
              <div>
                <span className="text-gray-500">税额合计：</span>
                <span className="font-medium">¥{formatCurrency((formData.lines || []).reduce((s, l) => s + (Number(l.tax_amount) || 0), 0))}</span>
              </div>
              <div>
                <span className="text-gray-500">价税合计：</span>
                <span className="font-medium">¥{formatCurrency((formData.lines || []).reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.tax_amount) || 0), 0))}</span>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/purchase-returns'); }} disabled={loading} className="btn-secondary">取消</button>
              <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                <Save className="w-5 h-5" />
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* W-01：多规格商品按款矩阵批量录入（采购退货：单价取商品进价） */}
      <MultiSpecPickerModal
        open={specPickerOpen}
        onClose={() => setSpecPickerOpen(false)}
        products={products}
        existingProductIds={(formData.lines || []).map((l) => l.product_id).filter(Boolean) as string[]}
        onConfirm={(items) => {
          handleBatchAdd(items);
          setSpecPickerOpen(false);
        }}
      />
    </div>
  );
}

function formatCurrency(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
