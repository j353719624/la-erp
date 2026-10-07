import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Save, AlertCircle } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { productionApi } from '@/api/production';
import { productApi, warehouseApi } from '@/api/product';
import { WorkOrder } from '@/types/production';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { format, toLocalDateISO } from '@/utils/format';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

interface LineRow {
  product_id: string;
  product_name: string;
  product_code: string;
  // 数量/成本以字符串保留输入中间态（type=text inputMode=decimal），提交前 Number() 化
  qty: number | string;
  unit_cost: number | string;
  batch_no: string;
  // [2026-09-16] 商品自定义字段（行内小字展示）
  ext_fields?: Record<string, unknown>;
}

export function ProductionReturnForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const preselectWoId = searchParams.get('work_order_id') || '';
  const isEdit = !!id;
  const isView = isEdit; // 编辑/查看：加载单据
  // [2026-09-16] 商品自定义字段中文名（退料行内小字展示用）
  const productLabels = useProductFieldLabels();

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [workOrderId, setWorkOrderId] = useState('');
  const [workOrderNo, setWorkOrderNo] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('excess');
  const [returnDate, setReturnDate] = useState(format.today());
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<LineRow[]>([]);
  const [status, setStatus] = useState('draft');
  const [returnNo, setReturnNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    productionApi.workOrderList({ page: 1, page_size: 1000 }).then(res => {
      if (res.code === 0) {
        const list = res.data?.list ?? [];
        setWorkOrders(list);
        if (!isEdit && preselectWoId) {
          const wo = list.find(w => w.id === preselectWoId);
          if (wo) loadBomItems(wo.id || '', wo.order_no || '');
        }
      }
    }).catch((err: any) => console.warn('工单列表加载失败（可能缺 work_order 权限）:', err?.message || err));
    warehouseApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setWarehouses(res.data?.list ?? []);
    }).catch((err: any) => console.warn('仓库列表加载失败（可能缺 warehouse_list 权限）:', err?.message || err));
    // 手动添加行的商品数据源
    productApi.list({ page: 1, page_size: 1000, status: 'active' }).then((res: any) => {
      if (res.code === 0) setProducts(res.data?.list ?? []);
    }).catch((err: any) => console.warn('商品列表加载失败（可能缺 product_list 权限）:', err?.message || err));
    if (isEdit && id) fetchReturn(id);
  }, [id]);

  const fetchReturn = async (rid: string) => {
    setLoading(true);
    try {
      const res = await productionApi.getReturn(rid);
      if (res.code === 0 && res.data) {
        const r = res.data as any;
        setReturnNo(r.return_no);
        setWorkOrderId(r.work_order_id || '');
        setWorkOrderNo(r.work_order_no || '');
        setWarehouseId(r.warehouse_id || '');
        setReason(r.reason || 'excess');
        setReturnDate((r.return_date || '').slice(0, 10));
        setRemark(r.remark || '');
        setStatus(r.status);
        // 明细在 edges.lines（ent 序列化）；此前只读 r.lines 恒空 → 查看退料单明细为空
        setLines(((r.edges?.lines || r.lines) || []).map((l: any) => ({
          product_id: l.product_id,
          product_name: l.product_name || '',
          product_code: l.product_code || '',
          qty: Number(l.qty) || 0,
          unit_cost: Number(l.unit_cost) || 0,
          batch_no: l.batch_no || '',
          // [2026-09-16] 商品自定义字段（行内小字展示）
          ext_fields: l.edges?.product?.ext_fields,
        })));
      }
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  };

  const loadBomItems = async (woId: string, woNo: string) => {
    setWorkOrderId(woId);
    setWorkOrderNo(woNo);
    if (!woId) { setLines([]); return; }
    try {
      const res = await productionApi.getBomItems(woId);
      if (res.code === 0 && Array.isArray(res.data)) {
        setLines((res.data as any[]).map((item: any) => ({
          product_id: item.product_id,
          product_name: item.product_name || item.edges?.product?.name || '',
          product_code: item.product_code || item.edges?.product?.code || '',
          qty: Number(item.qty) || 0,
          unit_cost: Number(item.unit_cost) || 0,
          batch_no: '',
          // [2026-09-16] 商品自定义字段（BOM 带出行内小字展示）
          ext_fields: item.ext_fields,
        })));
      }
    } catch {
      // 静默
    }
  };

  const updateLine = (idx: number, patch: Partial<LineRow>) => {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleSave = async () => {
    if (lines.length === 0 || lines.every(l => !l.product_id)) {
      setError('请至少添加一条退料明细');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = {
        work_order_id: workOrderId || undefined,
        work_order_no: workOrderNo || undefined,
        warehouse_id: warehouseId || undefined,
        return_date: toLocalDateISO(returnDate),
        reason,
        remark,
        lines: lines
          .filter(l => l.product_id && Number(l.qty) > 0)
          .map((l, i) => ({ product_id: l.product_id, product_name: l.product_name, product_code: l.product_code, qty: Number(l.qty) || 0, unit_cost: Number(l.unit_cost) || 0, batch_no: l.batch_no })),
      };
      const res = await productionApi.createReturn(payload);
      if (res.code === 0) {
        message.success('退料单已创建，请确认后生成入库');
        navigate('/production-returns');
      } else {
        setError(res.message || '创建失败');
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '创建失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isView ? '生产退料单' : '新增退料'}
        subtitle={isView ? returnNo || '退料详情' : '多余/不良物料退回仓库'}
        onBack={() => navigate('/production-returns')}
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
          <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">生产工单</label>
                {isView ? (
                  <input value={workOrderNo} disabled className="form-input" />
                ) : (
                  <SearchSelect
                    value={workOrderId}
                    onChange={(v) => {
                      const wo = workOrders.find(w => w.id === v);
                      loadBomItems(v ?? '', wo?.order_no || '');
                    }}
                    placeholder="请选择工单（自动带出物料）"
                    options={workOrders.map(wo => ({ value: wo.id, label: `${wo.order_no}（${wo.product_name}）` }))}
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">退料仓库</label>
                <SearchSelect
                  value={warehouseId}
                  onChange={(v) => setWarehouseId(v ?? '')}
                  disabled={isView}
                  placeholder="请选择仓库"
                  options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">退料原因</label>
                <select value={reason} onChange={e => setReason(e.target.value)} className="form-input" disabled={isView}>
                  <option value="excess">多余退回</option>
                  <option value="bad">不良退回</option>
                  <option value="other">其他</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">退料明细</label>
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">物料</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">退料数量</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">单位成本</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">批号</th>
                      {!isView && <th className="px-4 py-2 w-12" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lines.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">选择工单后自动带出物料，或手动添加</td></tr>
                    ) : (
                      lines.map((l, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm text-gray-700">
                            {isView || l.product_id ? (
                              l.product_name ? `${l.product_name}（${l.product_code}）` : '-'
                            ) : (
                              // 手动添加的行：提供商品选择（BOM 自动带出的行以只读文本展示）
                              <SearchSelect
                                value={l.product_id}
                                onChange={(v) => {
                                  const p = products.find((x: any) => x.id === v);
                                  updateLine(idx, {
                                    product_id: v ?? '',
                                    product_code: p?.code || '',
                                    product_name: p?.name || '',
                                    unit_cost: Number(p?.purchase_price) || 0,
                                    // [2026-09-16] 商品自定义字段（行内小字展示）
                                    ext_fields: p?.ext_fields,
                                  });
                                }}
                                placeholder="请选择物料"
                                options={products.map((p: any) => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) }))}
                              />
                            )}
                            <LineProductExt line={l} labels={productLabels} />
                          </td>
                          <td className="px-4 py-2">
                            <input type="text" inputMode="decimal" value={l.qty ?? ''} disabled={isView}
                              onChange={e => updateLine(idx, { qty: e.target.value })}
                              className="form-input !py-1" />
                          </td>
                          <td className="px-4 py-2">
                            <input type="text" inputMode="decimal" value={l.unit_cost ?? ''} disabled={isView}
                              onChange={e => updateLine(idx, { unit_cost: e.target.value })}
                              className="form-input !py-1" />
                          </td>
                          <td className="px-4 py-2">
                            <input type="text" value={l.batch_no} disabled={isView}
                              onChange={e => updateLine(idx, { batch_no: e.target.value })}
                              className="form-input !py-1" />
                          </td>
                          {!isView && (
                            <td className="px-4 py-2">
                              <button type="button" onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-red-400 hover:text-red-600">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {!isView && (
                <button
                  type="button"
                  onClick={() => setLines(prev => [...prev, { product_id: '', product_name: '', product_code: '', qty: 0, unit_cost: 0, batch_no: '' }])}
                  className="mt-2 text-sm text-blue-600 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> 手动添加行
                </button>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
              <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2} className="form-input" disabled={isView} />
            </div>

            {!isView && (
              <div className="flex gap-3">
                <button onClick={handleSave} disabled={loading} className="btn-primary flex items-center gap-2">
                  <Save className="w-4 h-4" /> {loading ? '保存中...' : '保存草稿'}
                </button>
                <button onClick={() => navigate('/production-returns')} disabled={loading} className="btn-secondary">取消</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
