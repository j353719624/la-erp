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
import { loanApi } from '@/api/inventory';
import { productApi, warehouseApi } from '@/api/product';
import { LoanOrderLine } from '@/types/inventory';
import { Product, Warehouse } from '@/types/product';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { cleanSerialNos, parseSerialNos, mergeAddsIntoLines } from '@/utils/docLines';
import { message } from '@/utils/appMessage';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

export function LoanForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  // [2026-09-16] 商品自定义字段中文名（行内小字展示用）
  const productLabels = useProductFieldLabels();

  const [formData, setFormData] = useState<any>({
    loan_type: 'out',
    party_name: '',
    warehouse_id: '',
    loan_date: format.today(),
    expected_return_date: '',
    remark: '',
    lines: [],
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // W-01：扫码快录输入框 + 「按规格批量添加」弹窗
  const [scanValue, setScanValue] = useState('');
  const [specPickerOpen, setSpecPickerOpen] = useState(false);

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) fetchLoan(id);
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单个接口失败不得拖垮其它下拉（同入库单缺陷模式）
      const [productRes, whRes] = await Promise.allSettled([
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        warehouseApi.list({ page: 1, page_size: 1000 }),
      ]);
      if (productRes.status === 'fulfilled' && productRes.value.code === 0) setProducts(productRes.value.data.list);
      if (whRes.status === 'fulfilled' && whRes.value.code === 0) setWarehouses(whRes.value.data?.list || []);
      for (const r of [productRes, whRes]) {
        if (r.status === 'rejected') console.warn('部分选项加载失败（可能缺模块权限）:', r.reason?.message || r.reason);
      }
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchLoan = async (loanId: string) => {
    try {
      const response = await loanApi.get(loanId);
      if (response.code === 0) {
        const lo = response.data;
        const rows = (lo.edges?.lines || lo.lines || []).map((l: any) => ({
          id: l.id,
          product_id: l.product_id,
          product_code: l.product_code || l.edges?.product?.code || '',
          product_name: l.product_name || l.edges?.product?.name || '',
          spec: l.spec || '',
          qty: l.qty || 0,
          unit_cost: Number(l.unit_cost) || 0,
          serial_nos: l.serial_nos || [],
          // [2026-09-16] 商品自定义字段（行内小字展示）
          ext_fields: l.edges?.product?.ext_fields,
        }));
        setFormData({
          loan_type: lo.loan_type,
          party_name: lo.party_name || '',
          warehouse_id: lo.warehouse_id || '',
          loan_date: lo.loan_date?.split('T')[0] || format.today(),
          expected_return_date: lo.expected_return_date ? lo.expected_return_date.split('T')[0] : '',
          remark: lo.remark || '',
          lines: rows,
        });
      }
    } catch (err) {
      console.error('Failed to fetch loan:', err);
    }
  };

  const handleAddLine = () => {
    const line: any = {
      id: '',
      product_id: '',
      product_code: '',
      product_name: '',
      spec: '',
      qty: 1,
      unit_cost: 0,
      serial_nos: [],
    };
    setFormData(prev => ({ ...prev, lines: [...(prev.lines || []), line] }));
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
      const product = products.find(p => p.id === value);
      if (product) {
        lines[index].product_code = product.code;
        lines[index].product_name = product.name;
        lines[index].spec = product.spec;
        if (!lines[index].unit_cost) lines[index].unit_cost = Number(product.purchase_price) || 0;
        // [2026-09-16] 商品自定义字段（行内小字展示）
        lines[index].ext_fields = product.ext_fields;
      }
    }
    setFormData(prev => ({ ...prev, lines }));
  };

  const handleRemoveLine = (index: number) => {
    const lines = [...(formData.lines || [])];
    lines.splice(index, 1);
    setFormData(prev => ({ ...prev, lines }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.warehouse_id) {
      setError('请选择仓库');
      return;
    }
    if (!formData.party_name.trim()) {
      setError('请填写往来方');
      return;
    }
    const validLines = (formData.lines || []).filter((l: any) => l.product_id && l.qty > 0);
    if (validLines.length === 0) {
      setError('请至少添加一条有效明细');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        loan_type: formData.loan_type,
        party_name: formData.party_name,
        warehouse_id: formData.warehouse_id,
        loan_date: formData.loan_date || undefined,
        expected_return_date: formData.expected_return_date || undefined,
        remark: formData.remark,
        lines: validLines.map((l: any) => ({
          product_id: l.product_id,
          product_code: l.product_code,
          product_name: l.product_name,
          spec: l.spec,
          qty: Number(l.qty) || 0,
          unit_cost: Number(l.unit_cost) || 0,
          serial_nos: cleanSerialNos(l.serial_nos),
        })),
      };
      let response;
      if (isEdit && id) {
        response = await loanApi.update(id, payload);
      } else {
        response = await loanApi.create(payload);
      }
      if (response.code === 0) {
        navigate('/inventory/loans');
      } else {
        setError(response.message || '保存失败');
      }
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑借出/借入单' : '新建借出/借入单'}
        subtitle="借出/借入仅影响库存，不生成应收应付"
        onBack={() => { if (confirmLeave()) navigate('/inventory/loans'); }}
        backDisabled={loading}
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">类型 *</label>
              <select
                value={formData.loan_type}
                onChange={(e) => setFormData(prev => ({ ...prev, loan_type: e.target.value }))}
                className="form-select"
                disabled={isEdit}
              >
                <option value="out">借出（库存减少）</option>
                <option value="in">借入（库存增加）</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">往来方 *</label>
              <input
                type="text"
                value={formData.party_name}
                onChange={(e) => setFormData(prev => ({ ...prev, party_name: e.target.value }))}
                placeholder="客户/个人/其他单位"
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">仓库 *</label>
              <SearchSelect
                required
                value={formData.warehouse_id}
                onChange={(v) => setFormData(prev => ({ ...prev, warehouse_id: v ?? '' }))}
                placeholder="请选择仓库"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">借出/借入日期</label>
              <input
                type="date"
                value={formData.loan_date}
                onChange={(e) => setFormData(prev => ({ ...prev, loan_date: e.target.value }))}
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">预计归还日期</label>
              <input
                type="date"
                value={formData.expected_return_date}
                onChange={(e) => setFormData(prev => ({ ...prev, expected_return_date: e.target.value }))}
                className="form-input"
              />
            </div>
            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
              <input
                type="text"
                value={formData.remark}
                onChange={(e) => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                className="form-input"
              />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h3 className="font-medium text-gray-700 whitespace-nowrap">明细</h3>
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
                  <th className="px-4 py-2 text-left text-xs text-gray-500">商品</th>
                  <th className="px-4 py-2 text-right text-xs text-gray-500">数量</th>
                  <th className="px-4 py-2 text-right text-xs text-gray-500">成本单价</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-500">序列号（逗号分隔，序列号商品必填）</th>
                  <th className="px-4 py-2 text-right text-xs text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(formData.lines || []).map((line: any, index: number) => (
                  <tr key={index}>
                    <td className="px-4 py-2">
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
                    <td className="px-4 py-2 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.qty ?? ''}
                        onChange={(e) => handleLineChange(index, 'qty', e.target.value)}
                        className="form-input text-right w-32"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.unit_cost ?? ''}
                        onChange={(e) => handleLineChange(index, 'unit_cost', e.target.value)}
                        className="form-input text-right w-32"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={(line.serial_nos || []).join(', ')}
                        onChange={(e) => handleLineChange(index, 'serial_nos', parseSerialNos(e.target.value))}
                        onBlur={(e) => handleLineChange(index, 'serial_nos', cleanSerialNos(parseSerialNos(e.target.value)))}
                        className="form-input w-48"
                        placeholder="SN0001, SN0002"
                       autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => handleRemoveLine(index)} className="icon-btn delete sm" title="删除">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => { if (confirmLeave()) navigate('/inventory/loans'); }} disabled={loading} className="btn-secondary">取消</button>
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
            <Save className="w-5 h-5" />
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </form>

      {/* W-01：多规格商品按款矩阵批量录入（借出/借入：显示所选仓库可用作参考） */}
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
