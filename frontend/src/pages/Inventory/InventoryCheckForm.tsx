import { format } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { inventoryCheckApi } from '@/api/inventory';
import { productApi, warehouseApi } from '@/api/product';
import { InventoryCheck, InventoryCheckLine } from '@/types/inventory';
import { Product, Warehouse } from '@/types/product';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { mergeAddsIntoLines } from '@/utils/docLines';
import { message } from '@/utils/appMessage';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

export function InventoryCheckForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<InventoryCheck>>({
    warehouse_id: '',
    warehouse_name: '',
    check_date: format.today(),
    lines: [],
  });

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // [2026-09-16] 商品自定义字段中文名（行内「商品信息」小字展示用）
  const productLabels = useProductFieldLabels();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // W-01：扫码快录输入框 + 「按规格批量添加」弹窗（扫码=连续点数：同商品每次扫到实际数量+1）
  const [scanValue, setScanValue] = useState('');
  const [specPickerOpen, setSpecPickerOpen] = useState(false);

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) {
      fetchCheck(id);
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单个接口失败不得拖垮其它下拉（同入库单缺陷模式）
      const [whRes, productRes] = await Promise.allSettled([
        warehouseApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
      ]);
      if (whRes.status === 'fulfilled' && whRes.value.code === 0) setWarehouses(whRes.value.data.list);
      if (productRes.status === 'fulfilled' && productRes.value.code === 0) setProducts(productRes.value.data.list);
      for (const r of [whRes, productRes]) {
        if (r.status === 'rejected') console.warn('部分选项加载失败（可能缺模块权限）:', r.reason?.message || r.reason);
      }
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchCheck = async (checkId: string) => {
    setLoading(true);
    try {
      const response = await inventoryCheckApi.get(checkId);
      if (response.code === 0) {
        const data = response.data as any;
        // 盘点明细后端挂在 edges.lines（ent 图）；数量为 decimal 字符串 → 统一 Number
        const lines: InventoryCheckLine[] = ((data.edges?.lines || data.lines) || []).map((line: any) => ({
          id: line.id || '',
          product_id: line.product_id,
          product_code: line.product_code || line.edges?.product?.code || '',
          product_name: line.product_name || line.edges?.product?.name || '',
          spec: line.edges?.product?.spec || '',
          unit_id: line.unit_id || '',
          unit_name: line.edges?.unit?.name || '',
          // [2026-09-16] 回填商品自定义字段（行内「商品信息」小字）
          ext_fields: line.edges?.product?.ext_fields,
          book_qty: Number(line.book_qty) || 0,
          actual_qty: Number(line.actual_qty) || 0,
          diff_qty: Number(line.diff_qty) || 0,
          diff_amount: Number(line.diff_amount) || 0,
        }));
        setFormData({ ...data, lines });
      }
    } catch (err) {
      console.error('Failed to fetch inventory check:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleWarehouseChange = (warehouseId: string) => {
    const warehouse = warehouses.find(w => w.id === warehouseId);
    setFormData(prev => ({
      ...prev,
      warehouse_id: warehouseId,
      warehouse_name: warehouse?.name || '',
    }));
  };

  const handleAddLine = () => {
    const newLine: InventoryCheckLine = {
      id: '',
      product_id: '',
      product_code: '',
      product_name: '',
      spec: '',
      unit_id: '',
      unit_name: '',
      book_qty: 0,
      actual_qty: 0,
      diff_qty: 0,
      diff_amount: 0,
    };
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), newLine],
    }));
  };

  // W-01：批量添加（规格矩阵 / 扫码共用）——矩阵填的就是「实际数量」；同商品已在明细则在已填实际数量上累加
  const handleBatchAdd = (adds: SpecBatchItem[]) => {
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
          book_qty: 0,
          actual_qty: qty,
          diff_qty: qty,
          diff_amount: 0,
          // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字）
          ext_fields: p.ext_fields,
        } as InventoryCheckLine;
      },
      (line, addQty) => {
        // 盘点行没有 quantity 字段：累加在 actual_qty 上（扫码点数：同商品每扫到一次 +1）
        const actualQty = (Number(line.actual_qty) || 0) + addQty;
        return {
          ...line,
          actual_qty: actualQty,
          diff_qty: Math.round((actualQty - (Number(line.book_qty) || 0)) * 1000) / 1000,
        };
      },
    );
    setFormData((prev) => ({ ...prev, lines }));
    message.success(`已添加 ${adds.length} 个商品${merged ? `，其中 ${merged} 个累加到已有明细行` : ''}`);
  };

  // W-01：扫码/输码快速添加——条码/编码精确优先；连续扫同一商品自动累加实际数量
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
        newLines[index].unit_id = product.unit_id;
        newLines[index].unit_name = product.unit_name;
        // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字；保存后由商品边提供）
        newLines[index].ext_fields = product.ext_fields;
      }
    }

    newLines[index].diff_qty = newLines[index].actual_qty - newLines[index].book_qty;

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
    // 仓库为必填（原原生 select required；改用 antd 后此处显式校验兜底）
    if (!formData.warehouse_id) {
      setError('请选择仓库');
      return;
    }
    setLoading(true);
    try {
      // 数量以字符串保留小数中间态；提交前 Number() 化并重算差异
      const submitData = {
        ...formData,
        lines: (formData.lines || []).map((l) => {
          const bookQty = Number(l.book_qty) || 0;
          const actualQty = Number(l.actual_qty) || 0;
          return {
            ...l,
            book_qty: bookQty,
            actual_qty: actualQty,
            diff_qty: Math.round((actualQty - bookQty) * 1000) / 1000,
            diff_amount: Number(l.diff_amount) || 0,
          };
        }),
      };
      if (isEdit && id) {
        const response = await inventoryCheckApi.update(id, submitData);
        if (response.code === 0) {
          navigate('/inventory/check');
        }
      } else {
        const response = await inventoryCheckApi.create(submitData);
        if (response.code === 0) {
          navigate('/inventory/check');
        }
      }
    } catch (err) {
      console.error('Failed to save inventory check:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑库存盘点' : '新建库存盘点'}
        subtitle={isEdit ? '修改库存盘点信息' : '创建新的盘点单'}
        onBack={() => { if (confirmLeave()) navigate('/inventory/check'); }}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">仓库 *</label>
                <SearchSelect
                  required
                  value={formData.warehouse_id}
                  onChange={(v) => handleWarehouseChange(v ?? '')}
                  placeholder="请选择仓库"
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">盘点日期 *</label>
                <input
                  type="date"
                  value={formData.check_date || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, check_date: e.target.value }))}
                  required
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">商品数量</label>
                <input
                  type="text"
                  value={`${(formData.lines || []).length} 种`}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3">
                <h3 className="font-medium text-gray-700 whitespace-nowrap">盘点明细</h3>
                <div className="w-full sm:max-w-xs">
                  <BarcodeInput
                    value={scanValue}
                    onChange={setScanValue}
                    onDetect={handleScanDetect}
                    placeholder="扫码点数：同商品每扫一次实际数量 +1"
                  />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSpecPickerOpen(true)}
                    className="btn-secondary text-sm flex items-center gap-1"
                    title="多规格商品：选款后在「颜色×尺码」网格里直接填实际数量，一次生成多条明细"
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">单位</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">账面数量</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">实际数量</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">差异</th>
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
                        <td className="px-4 py-3 text-gray-500 text-sm">{line.unit_name}</td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.book_qty ?? ''}
                            onChange={(e) => handleLineChange(index, 'book_qty', e.target.value)}
                            className="form-input text-right"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.actual_qty ?? ''}
                            onChange={(e) => handleLineChange(index, 'actual_qty', e.target.value)}
                            className="form-input text-right"
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          <span className={line.diff_qty !== 0 ? 'text-red-600' : 'text-gray-600'}>
                            {line.diff_qty > 0 ? '+' : ''}{line.diff_qty}
                          </span>
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

            <div className="form-actions">
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/inventory/check'); }} disabled={loading} className="btn-secondary">取消</button>
              <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                <Save className="w-5 h-5" />
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* W-01：多规格商品按款矩阵批量录入（盘点：填的就是实际数量；仓库未选时格子不显示可用库存） */}
      <MultiSpecPickerModal
        open={specPickerOpen}
        onClose={() => setSpecPickerOpen(false)}
        products={products}
        stockWarehouseId={formData.warehouse_id}
        existingProductIds={(formData.lines || []).map((l) => l.product_id).filter(Boolean) as string[]}
        onConfirm={(items) => {
          handleBatchAdd(items);
          setSpecPickerOpen(false);
        }}
      />
    </div>
  );
}
