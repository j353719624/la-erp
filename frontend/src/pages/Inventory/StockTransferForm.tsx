import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle, Play, CheckCircle, XCircle, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { stockTransferApi, locationApi } from '@/api/inventory';
import { productApi, warehouseApi } from '@/api/product';
import { StockTransfer, StockTransferLine, Location } from '@/types/inventory';
import { Product, Warehouse } from '@/types/product';
import { format } from '@/utils/format';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { mergeAddsIntoLines } from '@/utils/docLines';
import { useDocDefaultWarehouse } from '@/hooks/useDocDefaultWarehouse';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

export function StockTransferForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const isView = isEdit && false;

  const [formData, setFormData] = useState<Partial<StockTransfer>>({
    from_warehouse_id: '',
    from_warehouse_name: '',
    to_warehouse_id: '',
    to_warehouse_name: '',
    from_location_id: '',
    to_location_id: '',
    transfer_date: format.today(),
    lines: [],
  });

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  // [2026-09-12] 开单默认仓库（P-02）：调拨默认带出「调出仓」（上次使用 → 仓库档案默认 → 第一个）
  useDocDefaultWarehouse('stock-transfer', {
    isEdit,
    warehouses,
    value: formData.from_warehouse_id,
    onChange: (id) => setFormData((prev) => ({ ...prev, from_warehouse_id: id })),
  });
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // [2026-09-16] 商品自定义字段中文名（行内「商品信息」小字展示用）
  const productLabels = useProductFieldLabels();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // W-01：扫码快录输入框 + 「按规格批量添加」弹窗
  const [scanValue, setScanValue] = useState('');
  const [specPickerOpen, setSpecPickerOpen] = useState(false);

  const isDraft = !formData.status || formData.status === 'draft';
  const isInTransit = formData.status === 'in_transit';
  const isCompleted = formData.status === 'completed';
  const isCancelled = formData.status === 'cancelled';
  const readonly = isEdit && !isDraft;

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) {
      fetchTransfer(id);
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单个接口失败不得拖垮其它下拉（同入库单缺陷模式）
      const [whRes, productRes, locRes] = await Promise.allSettled([
        warehouseApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        locationApi.list({ page: 1, page_size: 1000 }),
      ]);
      if (whRes.status === 'fulfilled' && whRes.value.code === 0) setWarehouses(whRes.value.data.list);
      if (productRes.status === 'fulfilled' && productRes.value.code === 0) setProducts(productRes.value.data.list);
      if (locRes.status === 'fulfilled' && locRes.value.code === 0) setLocations(locRes.value.data?.list || []);
      for (const r of [whRes, productRes, locRes]) {
        if (r.status === 'rejected') console.warn('部分选项加载失败（可能缺模块权限）:', r.reason?.message || r.reason);
      }
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchTransfer = async (transferId: string) => {
    setLoading(true);
    try {
      const response = await stockTransferApi.get(transferId);
      if (response.code === 0 && response.data) {
        const data = response.data;
        const lines = (data.edges?.lines || data.lines || []).map((line: any) => ({
          id: line.id,
          product_id: line.product_id,
          product_code: line.product_code,
          product_name: line.product_name,
          spec: line.spec || '',
          // [2026-09-16] 回填商品自定义字段（行内「商品信息」小字）
          ext_fields: line.edges?.product?.ext_fields,
          unit_id: line.unit_id,
          unit_name: line.unit_name || '',
          quantity: Number(line.qty) || 0,
          cost_price: Number(line.cost_price) || 0,
          amount: Number(line.amount) || 0,
        }));
        setFormData({
          id: data.id,
          transfer_no: data.transfer_no,
          from_warehouse_id: data.from_warehouse_id,
          from_warehouse_name: data.edges?.fromWarehouse?.name || data.from_warehouse_name,
          to_warehouse_id: data.to_warehouse_id,
          to_warehouse_name: data.edges?.toWarehouse?.name || data.to_warehouse_name,
          from_location_id: data.from_location_id || '',
          to_location_id: data.to_location_id || '',
          transfer_date: data.transfer_date,
          status: data.status,
          lines,
        });
      }
    } catch (err) {
      console.error('Failed to fetch stock transfer:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFromWarehouseChange = (warehouseId: string) => {
    const warehouse = warehouses.find(w => w.id === warehouseId);
    setFormData(prev => ({
      ...prev,
      from_warehouse_id: warehouseId,
      from_warehouse_name: warehouse?.name || '',
      from_location_id: '',
    }));
  };

  const handleToWarehouseChange = (warehouseId: string) => {
    const warehouse = warehouses.find(w => w.id === warehouseId);
    setFormData(prev => ({
      ...prev,
      to_warehouse_id: warehouseId,
      to_warehouse_name: warehouse?.name || '',
      to_location_id: '',
    }));
  };

  const handleAddLine = () => {
    const newLine: StockTransferLine = {
      id: '',
      product_id: '',
      product_code: '',
      product_name: '',
      spec: '',
      unit_id: '',
      unit_name: '',
      quantity: 1,
      cost_price: 0,
      amount: 0,
    };
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), newLine],
    }));
  };

  // W-01：批量添加（规格矩阵 / 扫码共用）——同商品已在明细则数量累加，不产生重复行
  const handleBatchAdd = (adds: SpecBatchItem[]) => {
    if (readonly || !adds.length) return;
    const productOf = new Map(adds.map((a) => [a.product.id, a.product]));
    const { lines, merged } = mergeAddsIntoLines(
      formData.lines || [],
      adds.map((a) => ({ productId: a.product.id, qty: a.qty })),
      (add) => {
        const p = productOf.get(add.productId)!;
        const qty = add.qty;
        const cost = Number(p.purchase_price) || 0;
        return {
          id: '',
          product_id: p.id,
          product_code: p.code,
          product_name: p.name,
          spec: p.spec,
          unit_id: p.unit_id,
          unit_name: p.unit_name,
          quantity: qty,
          cost_price: cost,
          amount: qty * cost,
          // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字）
          ext_fields: p.ext_fields,
        } as StockTransferLine;
      },
    );
    setFormData((prev) => ({ ...prev, lines }));
    message.success(`已添加 ${adds.length} 个商品${merged ? `，其中 ${merged} 个累加到已有明细行` : ''}`);
  };

  // W-01：扫码/输码快速添加——条码/编码精确优先；连续扫同一商品自动累加数量
  const handleScanDetect = async (code: string) => {
    if (readonly) return;
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
        newLines[index].unit_id = product.unit_id;
        newLines[index].unit_name = product.unit_name;
        newLines[index].cost_price = product.purchase_price;
        // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字；保存后由商品边提供）
        newLines[index].ext_fields = product.ext_fields;
      }
    }

    newLines[index].amount = newLines[index].quantity * newLines[index].cost_price;

    setFormData(prev => ({
      ...prev,
      lines: newLines,
    }));
  };

  const handleRemoveLine = (index: number) => {
    const newLines = [...(formData.lines || [])];
    newLines.splice(index, 1);
    setFormData(prev => ({
      ...prev,
      lines: newLines,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // 调出/调入仓库为必填（原原生 select required；改用 antd 后此处显式校验兜底）
    if (!formData.from_warehouse_id) {
      setError('请选择调出仓库');
      return;
    }
    if (!formData.to_warehouse_id) {
      setError('请选择调入仓库');
      return;
    }
    setLoading(true);
    try {
      const submitData = {
        ...formData,
        lines: (formData.lines || []).map(line => ({
          ...line,
          qty: Number(line.quantity) || 0,
          quantity: undefined,
          cost_price: line.cost_price == null ? line.cost_price : Math.round(Number(line.cost_price) * 100) / 100,
          amount: line.amount == null ? line.amount : Math.round(Number(line.amount) * 100) / 100,
        })),
      };
      if (isEdit && id) {
        const response = await stockTransferApi.update(id, submitData);
        if (response.code === 0) {
          navigate('/inventory/transfer');
        }
      } else {
        const response = await stockTransferApi.create(submitData);
        if (response.code === 0) {
          navigate('/inventory/transfer');
        }
      }
    } catch (err: any) {
      console.error('Failed to save stock transfer:', err);
      setError(err.response?.data?.message || err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDispatch = async () => {
    if (!id || !(await confirmAction({ title: '确定发运此调拨单吗？' }))) return;
    try {
      const response = await stockTransferApi.dispatch(id);
      if (response.code === 0) {
        message.success('调拨单已发运');
        // 操作后后端返回的明细在 edges.lines，需重新 fetch 映射，避免本页明细即时清空
        await fetchTransfer(id);
      }
    } catch (err: any) {
      console.error('Failed to dispatch:', err);
      setError(err.response?.data?.message || err.message || '发运失败');
    }
  };

  const handleComplete = async () => {
    if (!id || !(await confirmAction({ title: '确定完成此调拨单吗？', content: '确认后库存将正式入库' }))) return;
    try {
      const response = await stockTransferApi.complete(id);
      if (response.code === 0) {
        message.success('调拨单已完成');
        // 操作后后端返回的明细在 edges.lines，需重新 fetch 映射，避免本页明细即时清空
        await fetchTransfer(id);
      }
    } catch (err: any) {
      console.error('Failed to complete:', err);
      setError(err.response?.data?.message || err.message || '确认失败');
    }
  };

  const handleCancel = async () => {
    if (!id || !(await confirmAction({ title: '确定取消此调拨单吗？', danger: true }))) return;
    try {
      const response = await stockTransferApi.cancel(id);
      if (response.code === 0) {
        message.success('调拨单已取消');
        // 操作后后端返回的明细在 edges.lines，需重新 fetch 映射，避免本页明细即时清空
        await fetchTransfer(id);
      }
    } catch (err: any) {
      console.error('Failed to cancel:', err);
      setError(err.response?.data?.message || err.message || '取消失败');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? (readonly ? '库存调拨详情' : '编辑库存调拨') : '新建库存调拨'}
        subtitle={isEdit ? (readonly ? '查看调拨单详情' : '修改调拨单信息') : '创建新的调拨单'}
        onBack={() => navigate('/inventory/transfer')}
        backDisabled={loading}
        extra={
          isEdit && formData.status && (
            <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${format.statusColor(formData.status)}`}>
              {format.statusText(formData.status)}
            </span>
          )
        }
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
                <label className="block text-sm font-medium text-gray-700 mb-2">调出仓库 *</label>
                {readonly ? (
                  <div className="form-input bg-gray-50 text-gray-600">{formData.from_warehouse_name}</div>
                ) : (
                  <SearchSelect
                    required
                    value={formData.from_warehouse_id}
                    onChange={(v) => handleFromWarehouseChange(v ?? '')}
                    placeholder="请选择仓库"
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">调出库位</label>
                {readonly ? (
                  <div className="form-input bg-gray-50 text-gray-600">{locations.find(l => l.id === formData.from_location_id)?.name || '-'}</div>
                ) : (
                  <SearchSelect
                    value={formData.from_location_id}
                    onChange={(v) => setFormData(prev => ({ ...prev, from_location_id: v ?? '' }))}
                    placeholder="请选择库位"
                    options={locations.filter(l => !formData.from_warehouse_id || l.warehouse_id === formData.from_warehouse_id).map((l) => ({ value: l.id, label: l.name }))}
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">调入仓库 *</label>
                {readonly ? (
                  <div className="form-input bg-gray-50 text-gray-600">{formData.to_warehouse_name}</div>
                ) : (
                  <SearchSelect
                    required
                    value={formData.to_warehouse_id}
                    onChange={(v) => handleToWarehouseChange(v ?? '')}
                    placeholder="请选择仓库"
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">调入库位</label>
                {readonly ? (
                  <div className="form-input bg-gray-50 text-gray-600">{locations.find(l => l.id === formData.to_location_id)?.name || '-'}</div>
                ) : (
                  <SearchSelect
                    value={formData.to_location_id}
                    onChange={(v) => setFormData(prev => ({ ...prev, to_location_id: v ?? '' }))}
                    placeholder="请选择库位"
                    options={locations.filter(l => !formData.to_warehouse_id || l.warehouse_id === formData.to_warehouse_id).map((l) => ({ value: l.id, label: l.name }))}
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">调拨日期 *</label>
                {readonly ? (
                  <div className="form-input bg-gray-50 text-gray-600">{format.date(formData.transfer_date || '')}</div>
                ) : (
                  <input
                    type="date"
                    value={formData.transfer_date || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, transfer_date: e.target.value }))}
                    required
                    className="form-input"
                  />
                )}
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3">
                <h3 className="font-medium text-gray-700 whitespace-nowrap">调拨明细</h3>
                {!readonly && (
                  <div className="w-full sm:max-w-xs">
                    <BarcodeInput
                      value={scanValue}
                      onChange={setScanValue}
                      onDetect={handleScanDetect}
                      placeholder="扫码/输码快速添加：条码 / 编码，回车"
                    />
                  </div>
                )}
                {!readonly && (
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
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">商品</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">规格</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">单位</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">成本价</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">数量</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">金额</th>
                      {!readonly && (
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">操作</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(formData.lines || []).map((line, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3">
                          {readonly ? (
                            <span className="text-gray-900">{line.product_code} - {line.product_name}</span>
                          ) : (
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
                          )}
                          <LineProductExt line={line} labels={productLabels} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-sm">{line.spec}</td>
                        <td className="px-4 py-3 text-gray-500 text-sm">{line.unit_name}</td>
                        <td className="px-4 py-3 text-right">
                          {readonly ? (
                            <span>{formatCurrency(line.cost_price)}</span>
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.cost_price ?? ''}
                              onChange={(e) => handleLineChange(index, 'cost_price', e.target.value)}
                              className="form-input text-right"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {readonly ? (
                            <span>{line.quantity}</span>
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.quantity ?? ''}
                              onChange={(e) => handleLineChange(index, 'quantity', e.target.value)}
                              className="form-input text-right"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">¥{formatCurrency(line.amount)}</td>
                        {!readonly && (
                          <td className="px-4 py-3 text-right">
                            <button type="button" onClick={() => handleRemoveLine(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {(!formData.lines || formData.lines.length === 0) && (
                      <tr><td colSpan={readonly ? 6 : 7} className="px-4 py-8 text-center text-gray-500">
                        {readonly ? '暂无明细数据' : '点击上方按钮添加商品'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                {isEdit && isDraft && (
                  <button type="button" onClick={handleCancel} className="btn-danger flex items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    取消单据
                  </button>
                )}
                {isEdit && isInTransit && (
                  <button type="button" onClick={handleCancel} className="btn-danger flex items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    取消调拨
                  </button>
                )}
              </div>
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => navigate('/inventory/transfer')} className="btn-secondary">返回</button>
                {isEdit && isDraft && (
                  <button type="button" onClick={handleDispatch} className="btn-success flex items-center gap-2">
                    <Play className="w-4 h-4" />
                    发运
                  </button>
                )}
                {isEdit && isInTransit && (
                  <button type="button" onClick={handleComplete} className="btn-success flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    确认收货
                  </button>
                )}
                {!readonly && (
                  <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                    <Save className="w-5 h-5" />
                    {loading ? '保存中...' : '保存'}
                  </button>
                )}
              </div>
            </div>
          </form>
        )}
      </div>

      {/* W-01：多规格商品按款矩阵批量录入（调拨：显示调出仓可用库存，超量标红） */}
      <MultiSpecPickerModal
        open={specPickerOpen}
        onClose={() => setSpecPickerOpen(false)}
        products={products}
        stockWarehouseId={formData.from_warehouse_id}
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
