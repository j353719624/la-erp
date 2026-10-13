import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { format, toLocalDateISO } from '@/utils/format';
import { EmptyState } from '@/components/EmptyState';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle, Check, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { stockOutApi, locationApi, rackApi } from '@/api/inventory';
import { productApi, warehouseApi } from '@/api/product';
import { salesOrderApi, purchaseReturnApi } from '@/api/order';
import { StockOut, StockOutLine, Location, Rack } from '@/types/inventory';
import { Product, Warehouse } from '@/types/product';
import { SalesOrder, PurchaseReturn } from '@/types/order';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { docLineTotals, mergeAddsIntoLines, cleanSerialNos, parseSerialNos } from '@/utils/docLines';
import { useDocDefaultWarehouse } from '@/hooks/useDocDefaultWarehouse';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

export function StockOutForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<StockOut>>({
    warehouse_id: '',
    warehouse_name: '',
    location_id: '',
    rack_id: '',
    source_type: 'sales',
    source_no: '',
    source_id: '',
    lines: [],
  });

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  // [2026-09-12] 开单默认仓库（P-02）：上次使用 → 仓库档案默认 → 第一个；选中后自动记住
  useDocDefaultWarehouse('stock-out', {
    isEdit,
    warehouses,
    value: formData.warehouse_id,
    onChange: (id) => setFormData((prev) => ({ ...prev, warehouse_id: id })),
  });
  const [locations, setLocations] = useState<Location[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // [2026-09-16] 商品自定义字段中文名（行内「商品信息」小字展示用）
  const productLabels = useProductFieldLabels();
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  // W-01：规格矩阵批量添加弹窗 / 扫码快速添加输入（连续扫码自动累加数量）
  const [specPickerOpen, setSpecPickerOpen] = useState(false);
  const [scanValue, setScanValue] = useState('');

  // 商品下拉选项：多规格 SKU 按款分组（组装商品带「无现货自动扣配件」提示）
  const productOptions = useMemo(() => productSelectGroups(products, { comboHint: true }), [products]);

  useEffect(() => {
    fetchOptions();
  }, []);

  useEffect(() => {
    if (isEdit) {
      fetchDetail();
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 各数据源相互独立：单个接口失败（如当前角色无销售订单/采购退货模块权限）
      // 不得拖垮其它下拉——与入库单同一缺陷模式（Promise.all 一拒全空）。
      const [whRes, productRes, soRes, prRes, locRes, rackRes] = await Promise.allSettled([
        warehouseApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        // 来源单候选放开：已确认 + 已审核（approve/审批通过后订单才能发货出库；仅 confirmed 会匹配不到已审核单）
        salesOrderApi.list({ page: 1, page_size: 1000 }),
        purchaseReturnApi.list({ page: 1, page_size: 1000 }),
        locationApi.list({ page: 1, page_size: 1000 }),
        rackApi.list({ page: 1, page_size: 1000 }),
      ]);
      if (whRes.status === 'fulfilled' && whRes.value.code === 0) setWarehouses(whRes.value.data.list);
      if (productRes.status === 'fulfilled' && productRes.value.code === 0) setProducts(productRes.value.data.list);
      if (soRes.status === 'fulfilled' && soRes.value.code === 0) setSalesOrders((soRes.value.data.list || []).filter((o: any) => o.status === 'confirmed' || o.status === 'approved'));
      if (prRes.status === 'fulfilled' && prRes.value.code === 0) setPurchaseReturns((prRes.value.data.list || []).filter((o: any) => o.status === 'confirmed' || o.status === 'approved'));
      if (locRes.status === 'fulfilled' && locRes.value.code === 0) setLocations(locRes.value.data?.list || []);
      if (rackRes.status === 'fulfilled' && rackRes.value.code === 0) setRacks(rackRes.value.data?.list || []);
      // 失败项控制台留痕（常见原因：当前角色缺对应模块权限），不阻塞表单
      for (const r of [whRes, productRes, soRes, prRes, locRes, rackRes]) {
        if (r.status === 'rejected') console.warn('部分选项加载失败（可能缺模块权限）:', r.reason?.message || r.reason);
      }
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchDetail = async () => {
    if (!id) return;
    setDetailLoading(true);
    try {
      const res = await stockOutApi.get(id);
      if (res.code === 0 && res.data) {
        const data = res.data;
        const lines = (data.edges?.lines || data.lines || []).map((line: any) => ({
          id: line.id,
          product_id: line.product_id,
          product_code: line.product_code || line.edges?.product?.code || '',
          product_name: line.product_name || line.edges?.product?.name || '',
          spec: line.spec || line.edges?.product?.spec || '',
          unit_id: line.unit_id || line.edges?.product?.unit_id || '',
          // [2026-09-16] 回填商品自定义字段（行内「商品信息」小字）
          ext_fields: line.edges?.product?.ext_fields,
          quantity: Number(line.qty || 0),
          cost_price: Number(line.unit_cost) || 0,
          amount: Number(line.amount) || (Number(line.qty || 0) * Number(line.unit_cost || 0)) || 0,
          batch_no: line.batch_no || '',
          serial_nos: line.serial_nos || [],
        }));
        setFormData({
          id: data.id,
          stock_out_no: data.stock_out_no,
          source_type: data.type,
          source_no: data.source_no,
          source_id: data.source_id,
          warehouse_id: data.warehouse_id,
          warehouse_name: data.edges?.warehouse?.name || data.warehouse_name,
          location_id: data.location_id || '',
          rack_id: data.rack_id || '',
          stock_out_date: data.stock_out_date,
          status: data.status,
          total_amount: data.total_amount,
          total_qty: data.total_qty,
          remark: data.remark,
          lines,
        });

        // 编辑回显：来源单若已不在候选状态（如已关闭/完成等）则补拉，保证下拉可见可改
        const sid = data.source_id as string;
        const stype = data.type as string;
        if (sid && stype === 'sales') {
          try {
            const g = await salesOrderApi.get(sid);
            if (g.code === 0 && g.data) setSalesOrders(prev => (prev.some((o: any) => o.id === g.data.id) ? prev : [g.data, ...prev]));
          } catch { /* 来源单已删除则忽略 */ }
        } else if (sid && stype === 'purchase_return') {
          try {
            const g = await purchaseReturnApi.get(sid);
            if (g.code === 0 && g.data) setPurchaseReturns(prev => (prev.some((r: any) => r.id === g.data.id) ? prev : [g.data, ...prev]));
          } catch { /* 来源单已删除则忽略 */ }
        }
      }
    } catch (err) {
      console.error('Failed to fetch detail:', err);
      setError(err instanceof Error && err.message ? err.message : '加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleWarehouseChange = (warehouseId: string) => {
    const warehouse = warehouses.find(w => w.id === warehouseId);
    setFormData(prev => ({
      ...prev,
      warehouse_id: warehouseId,
      warehouse_name: warehouse?.name || '',
      location_id: '',
      rack_id: '',
    }));
  };

  const handleSourceTypeChange = (type: string) => {
    setFormData(prev => ({
      ...prev,
      source_type: type,
      source_no: '',
      source_id: '',
      lines: isEdit && prev.status === 'confirmed' ? prev.lines : [],
      total_amount: isEdit && prev.status === 'confirmed' ? prev.total_amount : 0,
    }));
  };

  const handleSourceOrderChange = async (orderId: string) => {
    if (!orderId) {
      setFormData(prev => ({
        ...prev,
        source_no: '',
        source_id: '',
        lines: isEdit && prev.status === 'confirmed' ? prev.lines : [],
        total_amount: isEdit && prev.status === 'confirmed' ? prev.total_amount : 0,
      }));
      return;
    }

    if (formData.source_type === 'sales') {
      const order = salesOrders.find(o => o.id === orderId);
      if (order) {
        const orderLines = order.edges?.lines || order.lines || [];
        // C-2：自动带出未发明细行（数量=剩余未发，已发满跳过）
        const lines: StockOutLine[] = orderLines
          .map((line: any) => {
            const total = Number(line.quantity || line.qty || 0);
            const delivered = Number(line.delivered_qty || 0);
            const remaining = Math.max(0, total - delivered);
            return {
              id: '',
              product_id: line.product_id,
              product_code: line.product_code || line.edges?.product?.code || '',
              product_name: line.product_name || line.edges?.product?.name || '',
              spec: line.spec || line.edges?.product?.spec || '',
              // [2026-09-16] 从销售订单带入的行：带回商品自定义字段（行内「商品信息」小字）
              ext_fields: line.edges?.product?.ext_fields,
              unit_id: line.unit_id,
              unit_name: line.unit_name || line.edges?.unit?.name || '',
              quantity: remaining,
              // 成本价（2026-09-11 修复）：原用「订单售价 line.price」→ 导致流水/凭证成本=销售额（毛利恒 0）；
              // 改为优先用订单行成本价，无则置 0 → 确认出库时后端按「库存加权成本」入账
              cost_price: Number(line.cost_price) || 0,
              amount: remaining * (Number(line.cost_price) || 0),
              batch_no: line.batch_no || '',
            };
          })
          .filter((l: StockOutLine) => (l.quantity || 0) > 0);
        setFormData(prev => ({
          ...prev,
          source_no: order.order_no,
          source_id: order.id,
          lines,
          total_amount: lines.reduce((sum, line) => sum + (line.amount || 0), 0),
          total_qty: lines.reduce((sum, line) => sum + (line.quantity || 0), 0),
        }));
      }
    } else if (formData.source_type === 'purchase_return') {
      const ret = purchaseReturns.find(r => r.id === orderId);
      if (ret) {
        const retLines = ret.edges?.lines || ret.lines || [];
        const lines: StockOutLine[] = retLines.map((line: any) => ({
          id: '',
          product_id: line.product_id,
          product_code: line.product_code || '',
          product_name: line.product_name || '',
          spec: line.spec || '',
          unit_id: line.unit_id,
          unit_name: line.unit_name || '',
          quantity: Number(line.quantity || 0),
          cost_price: Number(line.price) || 0,
          amount: Number(line.amount) || 0,
          batch_no: line.batch_no || '',
        }));
        setFormData(prev => ({
          ...prev,
          source_no: ret.order_no,
          source_id: ret.id,
          lines,
          total_amount: lines.reduce((sum, line) => sum + (line.amount || 0), 0),
          total_qty: lines.reduce((sum, line) => sum + (line.quantity || 0), 0),
        }));
      }
    }
  };

  const handleAddLine = () => {
    if (isEdit && formData.status === 'confirmed') return;
    const newLine: StockOutLine = {
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
      batch_no: '',
      serial_nos: [],
    };
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), newLine],
    }));
  };

  // W-01：批量添加（规格矩阵 / 扫码共用）——同商品已在明细则数量累加，不产生重复行
  const handleBatchAdd = (adds: SpecBatchItem[]) => {
    if (isEdit && formData.status === 'confirmed') return;
    if (!adds.length) return;
    const productOf = new Map(adds.map((a) => [a.product.id, a.product]));
    const { lines, merged } = mergeAddsIntoLines(
      formData.lines || [],
      adds.map((a) => ({ productId: a.product.id, qty: a.qty })),
      (add) => {
        const p = productOf.get(add.productId)!;
        const qty = add.qty;
        return {
          id: '',
          product_id: p.id,
          product_code: p.code,
          product_name: p.name,
          spec: p.spec,
          unit_id: p.unit_id,
          unit_name: p.unit_name,
          quantity: qty,
          // 成本价默认值同单行选择：采购价近似（确认时后端一律以库存加权成本入账）
          cost_price: Number(p.purchase_price) || 0,
          amount: qty * (Number(p.purchase_price) || 0),
          // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字）
          ext_fields: p.ext_fields,
          batch_no: '',
          serial_nos: [],
        };
      },
    );
    const totals = docLineTotals(lines);
    setFormData((prev) => ({ ...prev, lines, total_amount: totals.totalAmount, total_qty: totals.totalQty }));
    message.success(`已添加 ${adds.length} 个商品${merged ? `，其中 ${merged} 个累加到已有明细行` : ''}`);
  };

  // W-01：扫码/输码快速添加——条码/编码精确命中，连续扫码同一商品自动累加数量
  const handleScanDetect = async (code: string) => {
    if (isEdit && formData.status === 'confirmed') return;
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
    if (isEdit && formData.status === 'confirmed') return;
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
        // 成本价默认值（2026-09-11 修复）：原用 sale_price（售价）→ 成本=售价；改采购价近似，
        // 销售出库确认时后端一律以「库存加权成本」入账（见 inout_service.go Confirm）
        newLines[index].cost_price = product.purchase_price;
        // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字；保存后由商品边提供）
        newLines[index].ext_fields = product.ext_fields;
      }
    }
    
    // 数量/成本输入以字符串保留小数中间态；参与 + 求和处必须 Number() 化（避免字符串拼接）
    newLines[index].amount = (Number(newLines[index].quantity) || 0) * (Number(newLines[index].cost_price) || 0);
    
    const { totalAmount, totalQty } = docLineTotals(newLines);
    
    setFormData(prev => ({
      ...prev,
      lines: newLines,
      total_amount: totalAmount,
      total_qty: totalQty,
    }));
  };

  const handleRemoveLine = (index: number) => {
    if (isEdit && formData.status === 'confirmed') return;
    const newLines = [...(formData.lines || [])];
    newLines.splice(index, 1);
    const { totalAmount, totalQty } = docLineTotals(newLines);
    setFormData(prev => ({
      ...prev,
      lines: newLines,
      total_amount: totalAmount,
      total_qty: totalQty,
    }));
  };

  const handleConfirm = async () => {
    if (!id || !(await confirmAction({ title: '确定确认该出库单吗？', content: '确认后不可修改' }))) return;
    try {
      const res = await stockOutApi.confirm(id);
      if (res.code === 0) {
        fetchDetail();
      }
    } catch (err) {
      console.error('Failed to confirm:', err);
      setError(err instanceof Error && err.message ? err.message : '确认失败');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit && formData.status === 'confirmed') return;
    setError('');
    if (!formData.warehouse_id) { setError('请选择仓库'); return; }
    // 退货类出库已由退货单审批自动回冲，禁止手工建单（防库存翻番双轨）
    if (formData.source_type === 'purchase_return') {
      setError('采购退货已由退货单审批自动回冲出库，禁止手工建「退货出库」单，请删除本单或改用其他类型');
      return;
    }
    setLoading(true);
    try {
      const submitData = {
        type: formData.source_type || 'sales',
        warehouse_id: formData.warehouse_id,
        location_id: formData.location_id || undefined,
        rack_id: formData.rack_id || undefined,
        stock_out_date: formData.stock_out_date || toLocalDateISO(format.today()),
        source_no: formData.source_no || '',
        source_id: formData.source_id || undefined,
        remark: formData.remark,
        lines: (formData.lines || []).map((line, index) => ({
          line_no: index + 1,
          product_id: line.product_id,
          unit_id: line.unit_id || null,
          product_name: line.product_name,
          product_code: line.product_code,
          qty: Number(line.quantity) || 0,
          unit_cost: Number(line.cost_price) || 0,
          batch_no: line.batch_no || '',
          serial_nos: cleanSerialNos(line.serial_nos),
          remark: '',
        })),
      };

      let response;
      if (isEdit) {
        response = await stockOutApi.update(id, submitData);
      } else {
        response = await stockOutApi.create(submitData);
      }
      if (response.code === 0) {
        navigate('/stock-out');
      }
    } catch (err) {
      console.error('Failed to save stock out:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  if (detailLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isConfirmed = isEdit && formData.status === 'confirmed';
  // 采购退货出库真实类型值为 purchase_return（与 select option / 取数分支一致）
  const showSourceOrder = formData.source_type === 'sales' || formData.source_type === 'purchase_return';

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '出库单详情' : '新建出库单'}
        subtitle={isEdit ? '查看出库单详情' : '创建新的出库单'}
        onBack={() => navigate('/stock-out')}
        backDisabled={loading}
        extra={
          isConfirmed && (
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
              已确认
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
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {isEdit && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">出库单号</label>
                <input
                  type="text"
                  value={formData.stock_out_no || ''}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">仓库 *</label>
              <SearchSelect
                required
                value={formData.warehouse_id}
                onChange={(v) => handleWarehouseChange(v ?? '')}
                placeholder="请选择仓库"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                disabled={isConfirmed}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">库位</label>
              <SearchSelect
                value={formData.location_id}
                onChange={(v) => setFormData(prev => ({ ...prev, location_id: v ?? '', rack_id: '' }))}
                placeholder="请选择库位"
                options={locations.filter(l => !formData.warehouse_id || l.warehouse_id === formData.warehouse_id).map((l) => ({ value: l.id, label: l.name }))}
                disabled={isConfirmed}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">货架</label>
              <SearchSelect
                value={formData.rack_id}
                onChange={(v) => setFormData(prev => ({ ...prev, rack_id: v ?? '' }))}
                placeholder="请选择货架"
                options={racks.filter(r => !formData.location_id || r.location_id === formData.location_id).map((r) => ({ value: r.id, label: r.name }))}
                disabled={isConfirmed}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">来源类型</label>
              <select
                value={formData.source_type || 'sales'}
                onChange={(e) => handleSourceTypeChange(e.target.value)}
                disabled={isConfirmed}
                className="form-select"
              >
                <option value="sales">销售出库</option>
                <option value="purchase_return" disabled>采购退货（已停用：由退货单审批自动回冲出库）</option>
                <option value="production" disabled>生产领料（已停用：请使用「生产领料单」）</option>
                <option value="transfer" disabled>调拨出库（已停用：请使用「库存调拨单」）</option>
                <option value="manual">其他出库</option>
              </select>
            </div>
            {showSourceOrder && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {formData.source_type === 'sales' ? '销售订单' : '退货单号'}
                </label>
                <SearchSelect
                  value={formData.source_id}
                  onChange={(v) => handleSourceOrderChange(v ?? '')}
                  placeholder="请选择"
                  options={
                    formData.source_type === 'sales'
                      ? salesOrders.map((o) => ({ value: o.id, label: o.order_no }))
                      : formData.source_type === 'purchase_return'
                        ? purchaseReturns.map((r) => ({ value: r.id, label: r.order_no }))
                        : []
                  }
                  disabled={isConfirmed}
                />
              </div>
            )}
            {showSourceOrder && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">来源单号</label>
                <input
                  type="text"
                  value={formData.source_no || ''}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">总数量</label>
              <input
                type="text"
                value={formData.total_qty || 0}
                disabled
                className="form-input bg-gray-50 text-gray-600"
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
            {isEdit && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
                <input
                  type="text"
                  value={formData.status === 'confirmed' ? '已确认' : '草稿'}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3">
              <h3 className="font-medium text-gray-700 whitespace-nowrap">出库明细</h3>
              {!isConfirmed && (
                <div className="w-full sm:max-w-xs">
                  <BarcodeInput
                    value={scanValue}
                    onChange={setScanValue}
                    onDetect={handleScanDetect}
                    placeholder="扫码/输码快速添加：条码 / 编码，回车"
                  />
                </div>
              )}
              {!isConfirmed && (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSpecPickerOpen(true)}
                    className="btn-secondary text-sm flex items-center gap-1"
                    title="多规格商品：选款后在「颜色×尺码」网格里直接填数量（格子显示所选仓库可用库存）"
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
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500" title="销售出库确认时以「库存加权成本」入账（可先填参考值）">成本价</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">数量</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">批次号</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">序列号（逗号分隔）</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">金额</th>
                    {!isConfirmed && (
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">操作</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(formData.lines || []).map((line, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3">
                        {isConfirmed ? (
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
                              // 多规格 SKU 按款分组（叶子=规格（编码）），选规格不用再逐个对编码
                              ...productOptions,
                            ]}
                          />
                        )}
                        <LineProductExt line={line} labels={productLabels} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{line.spec || '-'}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{line.unit_name || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        {isConfirmed ? (
                          <span className="text-gray-900">¥{formatCurrency(line.cost_price)}</span>
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
                        {isConfirmed ? (
                          <span className="text-gray-900">{line.quantity}</span>
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
                      <td className="px-4 py-3">
                        {isConfirmed ? (
                          <span className="text-gray-900 text-sm">{line.batch_no || '-'}</span>
                        ) : (
                          <input
                            type="text"
                            value={line.batch_no || ''}
                            onChange={(e) => handleLineChange(index, 'batch_no', e.target.value)}
                            className="form-input"
                            placeholder="批次号"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isConfirmed ? (
                          <span className="text-gray-500 text-sm">{(line.serial_nos || []).join(', ') || '-'}</span>
                        ) : (
                          <input
                            type="text"
                            value={(line.serial_nos || []).join(', ')}
                            onChange={(e) => handleLineChange(index, 'serial_nos', parseSerialNos(e.target.value))}
                            onBlur={(e) => handleLineChange(index, 'serial_nos', cleanSerialNos(parseSerialNos(e.target.value)))}
                            className="form-input"
                            placeholder="SN0001, SN0002"
                           autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">¥{formatCurrency(line.amount)}</td>
                      {!isConfirmed && (
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => handleRemoveLine(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {(!formData.lines || formData.lines.length === 0) && (
                    <tr><td colSpan={isConfirmed ? 8 : 9} className="px-4 py-8"><EmptyState title="暂无明细数据" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={() => navigate('/stock-out')} className="btn-secondary">返回</button>
            {!isConfirmed && (
              <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                <Save className="w-5 h-5" />
                {loading ? '保存中...' : '保存'}
              </button>
            )}
            {isEdit && formData.status === 'draft' && (
              <button type="button" onClick={handleConfirm} className="btn-success flex items-center gap-2">
                <Check className="w-5 h-5" />
                确认
              </button>
            )}
          </div>
        </form>
      </div>

      {/* W-01：多规格商品按款矩阵批量录入（出库：格子显示所选仓库可用库存，超量标红） */}
      <MultiSpecPickerModal
        open={specPickerOpen}
        onClose={() => setSpecPickerOpen(false)}
        products={products}
        stockWarehouseId={formData.warehouse_id || undefined}
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
  return (value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
