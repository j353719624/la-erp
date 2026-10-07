import { format } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle, LayoutGrid } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { consignmentApi } from '@/api/inventory';
import { productApi, warehouseApi } from '@/api/product';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { cleanSerialNos, parseSerialNos, mergeAddsIntoLines } from '@/utils/docLines';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

export function ConsignmentForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  // [2026-09-16] 商品自定义字段中文名（行内小字展示用）
  const productLabels = useProductFieldLabels();

  const [formData, setFormData] = useState<any>({
    party_name: '',
    warehouse_id: '',
    consignment_date: format.today(),
    expected_return_date: '',
    remark: '',
    lines: [] as any[],
  });
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // W-01：扫码快录输入框 + 「按规格批量添加」弹窗
  const [scanValue, setScanValue] = useState('');
  const [specPickerOpen, setSpecPickerOpen] = useState(false);

  useEffect(() => {
    // [2026-09-14] 两个数据源独立加载（互不拖垮）；失败留痕不阻塞表单
    productApi.list({ page: 1, page_size: 1000, status: 'active' }).then((res: any) => {
      if (res.code === 0) setProducts(res.data?.list || []);
    }).catch((err: any) => console.warn('商品加载失败（可能缺 product_list 权限）:', err?.message || err));
    warehouseApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setWarehouses(res.data?.list || []);
    }).catch((err: any) => console.warn('仓库加载失败（可能缺 warehouse_list 权限）:', err?.message || err));
    if (isEdit && id) fetchConsignment(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchConsignment = async (cid: string) => {
    try {
      const res = await consignmentApi.get(cid);
      if (res.code === 0) {
        const co = res.data;
        const lines = (co.edges?.lines || []).map((l: any) => ({
          id: l.id,
          product_id: l.product_id,
          product_code: l.product_code || '',
          product_name: l.product_name || '',
          spec: l.spec || '',
          qty: l.qty || 0,
          unit_cost: Number(l.unit_cost) || 0,
          serial_nos: l.serial_nos || [],
          // [2026-09-16] 商品自定义字段（行内小字展示）
          ext_fields: l.edges?.product?.ext_fields,
        }));
        setFormData({
          party_name: co.party_name || '',
          warehouse_id: co.warehouse_id || '',
          consignment_date: co.consignment_date?.split('T')[0] || '',
          expected_return_date: co.expected_return_date ? co.expected_return_date.split('T')[0] : '',
          remark: co.remark || '',
          lines,
        });
      }
    } catch (err) {
      console.error('fetch consignment failed:', err);
    }
  };

  const handleAddLine = () => {
    setFormData((prev: any) => ({
      ...prev,
      lines: [...(prev.lines || []), { id: '', product_id: '', product_code: '', product_name: '', spec: '', qty: 1, unit_cost: 0, serial_nos: [] }],
    }));
  };

  // W-01：批量添加（规格矩阵 / 扫码共用）——同商品已在明细则数量累加（本单数量字段是 qty）
  const handleBatchAdd = (adds: SpecBatchItem[]) => {
    if (!adds.length) return;
    const productOf = new Map(adds.map((a) => [a.product.id, a.product]));
    const { lines, merged } = mergeAddsIntoLines(
      formData.lines || [],
      adds.map((a) => ({ productId: a.product.id, qty: a.qty })),
      (add) => {
        const p = productOf.get(add.productId)!;
        return {
          id: '',
          product_id: p.id,
          product_code: p.code,
          product_name: p.name,
          spec: p.spec,
          qty: add.qty,
          unit_cost: Number(p.purchase_price) || 0,
          serial_nos: [],
          // [2026-09-16] 商品自定义字段（行内小字展示）
          ext_fields: p.ext_fields,
        };
      },
      // 本单明细数量字段是 qty（无 quantity/amount）：在 qty 上累加，序列号等其它字段不动
      (line, addQty) => ({ ...line, qty: (Number(line.qty) || 0) + addQty }),
    );
    setFormData((prev: any) => ({ ...prev, lines }));
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
    const lines = [...(formData.lines || [])];
    lines[index] = { ...lines[index], [field]: value };
    if (field === 'product_id') {
      const p = products.find((x: any) => x.id === value);
      if (p) {
        lines[index].product_code = p.code;
        lines[index].product_name = p.name;
        lines[index].spec = p.spec || '';
        if (!lines[index].unit_cost || lines[index].unit_cost === 0) lines[index].unit_cost = Number(p.purchase_price) || 0;
        // [2026-09-16] 商品自定义字段（行内小字展示）
        lines[index].ext_fields = p.ext_fields;
      }
    }
    setFormData((prev: any) => ({ ...prev, lines }));
  };

  const handleRemoveLine = (index: number) => {
    const lines = [...(formData.lines || [])];
    lines.splice(index, 1);
    setFormData((prev: any) => ({ ...prev, lines }));
  };

  const handleSubmit = async () => {
    setError('');
    if (!formData.warehouse_id) {
      setError('请选择仓库');
      return;
    }
    if (!formData.lines || formData.lines.length === 0) {
      setError('请至少添加一行寄售明细');
      return;
    }
    for (const l of formData.lines) {
      if (!l.product_id) {
        setError('请选择商品');
        return;
      }
      if (!l.qty || parseFloat(l.qty) <= 0) {
        setError('寄售数量必须大于 0');
        return;
      }
    }
    const payload = {
      party_name: formData.party_name || '',
      warehouse_id: formData.warehouse_id,
      consignment_date: formData.consignment_date || null,
      expected_return_date: formData.expected_return_date || null,
      remark: formData.remark || '',
      lines: (formData.lines || []).map((l: any) => ({
        product_id: l.product_id,
        product_name: l.product_name || '',
        product_code: l.product_code || '',
        spec: l.spec || '',
        qty: l.qty,
        unit_cost: l.unit_cost || 0,
        serial_nos: cleanSerialNos(l.serial_nos),
      })),
    };
    setLoading(true);
    try {
      const res = isEdit && id ? await consignmentApi.update(id, payload) : await consignmentApi.create(payload);
      if (res.code === 0) {
        message.success(isEdit ? '寄售单已更新' : '寄售单已创建');
        navigate('/inventory/consignments');
      } else {
        setError(res.message || '保存失败');
      }
    } catch (err: any) {
      setError(err?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const totalQty = (formData.lines || []).reduce((s: number, l: any) => s + (parseFloat(l.qty) || 0), 0);
  const totalAmount = (formData.lines || []).reduce((s: number, l: any) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unit_cost) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑寄售单' : '新建寄售单'}
        subtitle="商品发往代销方，售出结算、未售退回"
        onBack={() => { if (confirmLeave()) navigate('/inventory/consignments'); }}
        extra={
          <button onClick={() => navigate('/inventory/consignments')} className="btn-secondary flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            返回列表
          </button>
        }
      />

      <div className="card p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">代销方</label>
            <input type="text" value={formData.party_name} onChange={(e) => setFormData((p: any) => ({ ...p, party_name: e.target.value }))} className="form-input" placeholder="请输入客户/经销商名称" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">仓库 *</label>
            <SearchSelect
              required
              value={formData.warehouse_id}
              onChange={(v) => setFormData((p: any) => ({ ...p, warehouse_id: v ?? '' }))}
              placeholder="请选择仓库"
              options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">寄售日期</label>
            <input type="date" value={formData.consignment_date} onChange={(e) => setFormData((p: any) => ({ ...p, consignment_date: e.target.value }))} className="form-input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">预计退回日期</label>
            <input type="date" value={formData.expected_return_date} onChange={(e) => setFormData((p: any) => ({ ...p, expected_return_date: e.target.value }))} className="form-input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">备注</label>
            <input type="text" value={formData.remark} onChange={(e) => setFormData((p: any) => ({ ...p, remark: e.target.value }))} className="form-input" />
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h3 className="text-sm font-semibold text-gray-700 whitespace-nowrap">寄售明细</h3>
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
                className="btn-secondary text-xs flex items-center gap-1"
                title="多规格商品：选款后在「颜色×尺码」网格里直接填数量，一次生成多条明细"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                按规格批量添加
              </button>
              <button onClick={handleAddLine} className="btn-primary text-xs flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                添加商品
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>商品 *</th>
                  <th style={{ textAlign: 'center' }}>规格</th>
                  <th style={{ textAlign: 'center' }}>寄售数量 *</th>
                  <th style={{ textAlign: 'center' }}>寄售成本</th>
                  <th style={{ textAlign: 'center' }}>金额</th>
                  <th style={{ textAlign: 'center' }}>序列号（逗号分隔，序列号商品必填）</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {(formData.lines || []).map((l: any, idx: number) => (
                  <tr key={idx}>
                    <td style={{ textAlign: 'center' }}>
                      <SearchSelect
                        value={l.product_id}
                        onChange={(v) => handleLineChange(idx, 'product_id', v ?? '')}
                        placeholder="请选择商品"
                        options={[
                          // 编辑态保留已删除/不在列表中的商品（原样展示，不可再改选别的值）
                          ...(!products.some((p: any) => p.id === l.product_id) && l.product_id
                            ? [{ value: l.product_id, label: `${l.product_code} - ${l.product_name || '已删除商品'}` }]
                            : []),
                          ...productSelectGroups(products),
                        ]}
                      />
                      <LineProductExt line={l} labels={productLabels} />
                    </td>
                    <td style={{ textAlign: 'center' }}>{l.spec}</td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="number" min={0} step="any" value={l.qty} onChange={(e) => handleLineChange(idx, 'qty', e.target.value)} className="form-input" />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="number" min={0} step="any" value={l.unit_cost} onChange={(e) => handleLineChange(idx, 'unit_cost', e.target.value)} className="form-input" />
                    </td>
                    <td style={{ textAlign: 'center' }}>{format.currency((parseFloat(l.qty) || 0) * (parseFloat(l.unit_cost) || 0))}</td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="text"
                        value={(l.serial_nos || []).join(', ')}
                        onChange={(e) => handleLineChange(idx, 'serial_nos', parseSerialNos(e.target.value))}
                        onBlur={(e) => handleLineChange(idx, 'serial_nos', cleanSerialNos(parseSerialNos(e.target.value)))}
                        className="form-input"
                        placeholder="SN0001, SN0002"
                       autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button onClick={() => handleRemoveLine(idx)} className="icon-btn delete sm" title="删除">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {(!formData.lines || formData.lines.length === 0) && (
                  <tr><td colSpan={6} style={{ textAlign: 'center' }} className="text-gray-400 py-6">暂无明细，点击「添加商品」</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-sm text-gray-500">
            寄出合计：<b>{totalQty}</b>　寄售成本合计：<b>{totalAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
          </div>
        </div>

        {error && <div className="rounded-md bg-red-50 text-red-600 p-3 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button onClick={() => navigate('/inventory/consignments')} className="btn-secondary">取消</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4" />
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* W-01：多规格商品按款矩阵批量录入（寄售：显示所选仓库可用作参考） */}
      <MultiSpecPickerModal
        open={specPickerOpen}
        onClose={() => setSpecPickerOpen(false)}
        products={products}
        stockWarehouseId={formData.warehouse_id}
        existingProductIds={(formData.lines || []).map((l: any) => l.product_id).filter(Boolean) as string[]}
        onConfirm={(items) => {
          handleBatchAdd(items);
          setSpecPickerOpen(false);
        }}
      />
    </div>
  );
}
