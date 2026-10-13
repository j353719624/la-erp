import { format, toLocalDateISO } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle, CheckCircle, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { salesReturnApi, customerApi, salesOrderApi } from '@/api/order';
import { productApi } from '@/api/product';
import { Customer, SalesReturn, SalesReturnLine, SalesOrder } from '@/types/order';
import { Product } from '@/types/product';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { mergeAddsIntoLines, recomputePricedLine } from '@/utils/docLines';
import { loadOptions } from '@/utils/loadOptions';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

export function SalesReturnForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<SalesReturn>>({
    customer_id: '',
    customer_name: '',
    order_no: '',
    return_date: format.today(),
    reason: '',
    lines: [],
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
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
      const [customerRes, orderRes, productRes] = await loadOptions([
        customerApi.list({ page: 1, page_size: 1000 }),
        salesOrderApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
      ], '销售退货');
      if (customerRes?.code === 0) setCustomers(customerRes.data.list);
      // 退货来源订单：排除草稿/已取消（未确认或已取消的单不可执行退货）
      if (orderRes?.code === 0) setSalesOrders((orderRes.data.list || []).filter((o: any) => o.status !== 'draft' && o.status !== 'cancelled'));
      if (productRes?.code === 0) setProducts(productRes.data.list);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchReturn = async (returnId: string) => {
    setLoading(true);
    try {
      const response = await salesReturnApi.get(returnId);
      if (response.code === 0) {
        const data = response.data;
        const linesFromServer = data.edges?.lines || data.lines || [];
        const lines: SalesReturnLine[] = linesFromServer.map((line: any) => ({
          id: line.id,
          product_id: line.product_id,
          product_code: line.product_code || line.edges?.product?.code || '',
          product_name: line.product_name || line.edges?.product?.name || '',
          spec: line.spec || line.edges?.product?.spec || '',
          // [2026-09-16] 回填商品自定义字段（行内「商品信息」小字）
          ext_fields: line.edges?.product?.ext_fields,
          quantity: Number(line.quantity || line.qty || 0),
          price: Number(line.price) || 0,
          amount: Number(line.amount) || 0,
          tax_rate: Number(line.tax_rate) || 0,
          tax_amount: Number(line.tax_amount) || 0,
          expand_to_components: !!line.expand_to_components,
        }));
        setFormData({
          id: data.id,
          return_no: data.return_no,
          order_no: data.sales_order_no || data.order_no,
          sales_order_id: data.sales_order_id,
          customer_id: data.customer_id,
          customer_name: data.customer_name || data.edges?.customer?.name || '',
          return_date: data.return_date?.split('T')[0] || data.order_date?.split('T')[0] || '',
          reason: data.return_reason || data.reason,
          total_amount: data.total_amount || lines.reduce((sum, line) => sum + (line.amount || 0), 0),
          status: data.status,
          lines,
        });
      }
    } catch (err) {
      console.error('Failed to fetch sales return:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOrderChange = async (orderId: string) => {
    const order = salesOrders.find(o => o.id === orderId);
    if (!order) return;

    const orderLines = order.edges?.lines || order.lines || [];
    const lines: SalesReturnLine[] = orderLines.map((line: any) => ({
      id: '',
      product_id: line.product_id,
      product_code: line.product_code || line.edges?.product?.code || '',
      product_name: line.product_name || line.edges?.product?.name || '',
      spec: line.spec || line.edges?.product?.spec || '',
      // [2026-09-16] 从销售订单带入的行：带回商品自定义字段（行内「商品信息」小字）
      ext_fields: line.edges?.product?.ext_fields,
      quantity: Number(line.quantity || line.qty || 0),
      price: Number(line.price) || 0,
      amount: Number(line.amount) || 0,
      tax_rate: Number(line.tax_rate) || 0,
      tax_amount: Number(line.tax_amount) || 0,
      expand_to_components: false,
    }));

    setFormData(prev => ({
      ...prev,
      order_no: order.order_no,
      sales_order_id: order.id,
      customer_id: order.customer_id,
      customer_name: order.customer_name || order.edges?.customer?.name || '',
      lines,
      total_amount: lines.reduce((sum, line) => sum + (line.amount || 0), 0),
    }));
  };

  const handleCustomerChange = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    setFormData(prev => ({
      ...prev,
      customer_id: customerId,
      customer_name: customer?.name || '',
    }));
  };

  const handleAddLine = () => {
    const newLine: SalesReturnLine = {
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
      expand_to_components: false,
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
        const price = Number(p.sale_price) || 0;
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
          expand_to_components: false,
          // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字）
          ext_fields: p.ext_fields,
        } as SalesReturnLine;
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

  /** 判断商品是否为组合商品（组装商品，可拆回配件） */
  const isComboProduct = (pid: string) => {
    const p = products.find(x => x.id === pid);
    return !!p?.is_combo;
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
        newLines[index].price = product.sale_price;
        // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字；保存后由商品边提供）
        newLines[index].ext_fields = product.ext_fields;
      }
      // 切换商品后重置拆回配件标记（仅组合商品可勾选）
      newLines[index].expand_to_components = false;
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
    if (!formData.customer_id) { setError('请选择客户'); return; }
    setLoading(true);
    try {
      // 金额统一 round 2 后提交（浮点尾差防护）：空串/null → 0，杜绝脏值/空串入后端
      const r2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100;
      const submitData = {
        ...formData,
        sales_order_id: formData.sales_order_id,
        sales_order_no: formData.order_no,
        order_date: toLocalDateISO(formData.return_date),
        remark: formData.reason,
        lines: (formData.lines || []).map(line => ({
          product_id: line.product_id,
          product_code: line.product_code,
          product_name: line.product_name,
          spec: line.spec,
          qty: Number(line.quantity) || 0,
          price: r2(line.price),
          amount: r2(line.amount),
          tax_rate: Number(line.tax_rate) || 0,
          tax_amount: r2(line.tax_amount),
          remark: line.remark || '',
          expand_to_components: !!line.expand_to_components,
        })),
      };

      if (isEdit && id) {
        const response = await salesReturnApi.update(id, submitData);
        if (response.code === 0) {
          navigate('/sales-returns');
        }
      } else {
        const response = await salesReturnApi.create(submitData);
        if (response.code === 0) {
          navigate('/sales-returns');
        }
      }
    } catch (err) {
      console.error('Failed to save sales return:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!id) return;
    if (!(await confirmAction({ title: '确认要确认此退货单吗？', content: '确认后将无法修改' }))) return;
    try {
      const response = await salesReturnApi.confirm(id);
      if (response.code === 0) {
        setFormData(prev => ({ ...prev, status: 'confirmed' }));
        message.success('退货单已确认');
      } else {
        message.error(response.message || '确认失败');
      }
    } catch (err) {
      console.error('Failed to confirm sales return:', err);
      message.error(err instanceof Error && err.message ? err.message : '确认失败');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑销售退货' : '新建销售退货'}
        subtitle={isEdit ? '修改销售退货信息' : '创建新的销售退货单'}
        onBack={() => { if (confirmLeave()) navigate('/sales-returns'); }}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">退货单号</label>
                <input
                  type="text"
                  value={formData.order_no || ''}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                  placeholder="自动生成"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">客户 *</label>
                <SearchSelect
                  required
                  value={formData.customer_id}
                  onChange={(v) => handleCustomerChange(v ?? '')}
                  placeholder="请选择客户"
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">原订单号</label>
                <SearchSelect
                  value={formData.sales_order_id}
                  onChange={(v) => handleOrderChange(v ?? '')}
                  placeholder="请选择订单"
                  options={salesOrders.map((o) => ({ value: o.id, label: o.order_no }))}
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
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">回补方式</th>
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
                        <td className="px-4 py-3 text-center">
                          {isComboProduct(line.product_id) ? (
                            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs" title="勾选后审批按配方拆回配件库存（苹果+香蕉+火龙果），不勾选则退回成品自身库存">
                              <input
                                type="checkbox"
                                checked={!!line.expand_to_components}
                                onChange={(e) => handleLineChange(index, 'expand_to_components', e.target.checked)}
                                className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                              />
                              <span className="whitespace-nowrap">拆回配件</span>
                            </label>
                          ) : (
                            <span className="text-xs text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => handleRemoveLine(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(!formData.lines || formData.lines.length === 0) && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">点击上方按钮添加商品</td></tr>
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
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/sales-returns'); }} disabled={loading} className="btn-secondary">取消</button>
              {isEdit && formData.status === 'draft' && (
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="btn-primary flex items-center gap-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  确认
                </button>
              )}
              <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                <Save className="w-5 h-5" />
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* W-01：多规格商品按款矩阵批量录入（销售退货：单价取商品售价） */}
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
