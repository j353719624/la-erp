import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { toLocalDateISO } from '@/utils/format';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Save, AlertCircle, PackagePlus, PackageMinus, Undo2, Play, CheckCircle2, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { productionApi } from '@/api/production';
import { productApi, warehouseApi } from '@/api/product';
import { WorkOrder, WorkOrderProcess, WorkOrderMaterial, MaterialAvailabilityItem, Bom, Routing } from '@/types/production';
import { Product, Warehouse } from '@/types/product';
import { format } from '@/utils/format';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { useDocDefaultWarehouse } from '@/hooks/useDocDefaultWarehouse';
import { loadOptions } from '@/utils/loadOptions';

export function WorkOrderForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<WorkOrder>>({
    work_order_no: '',
    product_id: '',
    quantity: 1,
    bom_id: '',
    routing_id: '',
    warehouse_id: '',
    priority: 'normal',
    start_date: formatDate(new Date()),
    end_date: formatDate(new Date()),
    status: 'draft',
    remark: '',
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [routings, setRoutings] = useState<Routing[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  // [2026-09-12] 开单默认仓库（P-02）：上次使用 → 仓库档案默认 → 第一个；选中后自动记住（领料仓库）
  useDocDefaultWarehouse('work-order', {
    isEdit,
    warehouses,
    value: formData.warehouse_id,
    onChange: (id) => setFormData((prev) => ({ ...prev, warehouse_id: id })),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [processes, setProcesses] = useState<WorkOrderProcess[]>([]);
  const [costs, setCosts] = useState<{ material?: string; labor?: string; overhead?: string; total?: string }>({});
  const [availability, setAvailability] = useState<MaterialAvailabilityItem[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [materials, setMaterials] = useState<WorkOrderMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [woLoaded, setWoLoaded] = useState(false);

  // 工序报工弹窗（数值输入以字符串保留小数中间态，提交前 Number() 化）
  const [completeTarget, setCompleteTarget] = useState<WorkOrderProcess | null>(null);
  const [completeForm, setCompleteForm] = useState<{ qty_good: number | string; qty_bad: number | string; actual_time: number | string; labor_rate: number | string }>({ qty_good: 0, qty_bad: 0, actual_time: 0, labor_rate: 0 });
  const [acting, setActing] = useState(false);

  useEffect(() => {
    fetchProducts();
    if (isEdit && id) {
      fetchWorkOrder(id);
    }
  }, [id]);

  const fetchProducts = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [productRes, bomRes, routingRes, warehouseRes] = await loadOptions([
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        productionApi.bomList({ page: 1, page_size: 1000 }),
        productionApi.routingList({ page: 1, page_size: 1000 }),
        warehouseApi.list({ page: 1, page_size: 1000 }),
      ], '生产工单');
      if (productRes?.code === 0) setProducts(productRes.data?.list || []);
      if (bomRes?.code === 0) setBoms(bomRes.data?.list || []);
      if (routingRes?.code === 0) setRoutings(routingRes.data?.list || []);
      if (warehouseRes?.code === 0) setWarehouses(warehouseRes.data?.list || []);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchWorkOrder = async (workOrderId: string) => {
    setLoading(true);
    try {
      const response = await productionApi.getWorkOrder(workOrderId);
      if (response.code === 0 && response.data) {
        const data = response.data as any;
        setFormData({
          id: data.id,
          work_order_no: data.order_no,
          product_id: data.product_id,
          product_name: data.edges?.product?.name || data.product_name,
          product_spec: data.edges?.product?.spec || data.product_code || '',
          quantity: data.qty || 0,
          bom_id: data.bom_id || '',
          routing_id: data.routing_id || '',
          warehouse_id: data.warehouse_id || '',
          priority: data.priority || 'normal',
          start_date: parseDate(data.planned_start_date),
          end_date: parseDate(data.planned_end_date),
          status: data.status,
          remark: data.remark,
        });
        setProcesses(data.edges?.processes || []);
        setCosts({
          material: data.material_cost,
          labor: data.labor_cost,
          overhead: data.overhead_cost,
          total: data.total_cost,
        });
        setWoLoaded(true);
      }
    } catch (err) {
      console.error('Failed to fetch work order:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailability = useCallback(async () => {
    if (!id) return;
    setAvailabilityLoading(true);
    try {
      const res = await productionApi.materialAvailability(id);
      if (res.code === 0 && Array.isArray(res.data)) {
        setAvailability(res.data);
      }
    } catch {
      // 静默
    } finally {
      setAvailabilityLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (isEdit && id) fetchAvailability();
  }, [isEdit, id, fetchAvailability]);

  // 物料需求跟踪（逐料：需领/已领/已退/待领）
  const fetchMaterials = useCallback(async () => {
    if (!id) return;
    setMaterialsLoading(true);
    try {
      const res = await productionApi.getWorkOrderMaterials(id);
      if (res.code === 0 && Array.isArray(res.data)) {
        setMaterials(res.data);
      }
    } catch {
      // 静默
    } finally {
      setMaterialsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (isEdit && id) fetchMaterials();
  }, [isEdit, id, fetchMaterials]);

  const refreshCosts = async () => {
    if (!id) return;
    const res = await productionApi.getWorkOrder(id);
    if (res.code === 0 && res.data) {
      const d = res.data as any;
      setCosts({ material: d.material_cost, labor: d.labor_cost, overhead: d.overhead_cost, total: d.total_cost });
      setProcesses(d.edges?.processes || []);
      setFormData(prev => ({ ...prev, status: d.status }));
    }
  };

  const handleStartProcess = async (p: WorkOrderProcess) => {
    if (!p.id) return;
    const res = await productionApi.startProcess(p.id, {});
    if (res.code === 0) {
      message.success(`工序「${p.process_name}」已开始`);
      refreshCosts();
    } else {
      message.error(res.message || '开始失败');
    }
  };

  const openComplete = (p: WorkOrderProcess) => {
    setCompleteTarget(p);
    setCompleteForm({
      qty_good: Number(p.qty_planned) || 0,
      qty_bad: 0,
      actual_time: Number(p.standard_time) || 0,
      labor_rate: Number(p.labor_rate) || 0,
    });
  };

  const submitComplete = async () => {
    if (!completeTarget?.id) return;
    setActing(true);
    try {
      const res = await productionApi.completeProcess(completeTarget.id, {
        qty_good: Number(completeForm.qty_good) || 0,
        qty_bad: Number(completeForm.qty_bad) || 0,
        actual_time: Number(completeForm.actual_time) || 0,
        labor_rate: Number(completeForm.labor_rate) || 0,
      });
      if (res.code === 0) {
        message.success(`工序「${completeTarget.process_name}」已完成`);
        setCompleteTarget(null);
        refreshCosts();
      } else {
        message.error(res.message || '完成失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '完成失败');
    } finally {
      setActing(false);
    }
  };

  const costCard = (label: string, value?: string, color = 'text-gray-900') => (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold mt-1 ${color}`}>{format.currency(Number(value) || 0)}</p>
    </div>
  );

  const statusBadge = (s: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      pending: { text: '待开始', cls: 'bg-gray-100 text-gray-600' },
      in_progress: { text: '进行中', cls: 'bg-blue-50 text-blue-600' },
      completed: { text: '已完成', cls: 'bg-green-50 text-green-600' },
    };
    const m = map[s] || { text: s, cls: 'bg-gray-100 text-gray-600' };
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${m.cls}`}>{m.text}</span>;
  };

  const availStatus = (s: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      ok: { text: '充足', cls: 'text-green-600' },
      low: { text: '不足', cls: 'text-yellow-600' },
      shortage: { text: '短缺', cls: 'text-red-600' },
    };
    return map[s] || { text: s, cls: 'text-gray-600' };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // 生产产品为必填（原原生 select required；改用 antd 后此处显式校验兜底）
    if (!formData.product_id) {
      setError('请选择生产产品');
      return;
    }
    setLoading(true);
    try {
      const product = products.find(p => p.id === formData.product_id);
      const submitData = {
        product_id: formData.product_id || undefined,
        product_name: product?.name || '',
        product_code: product?.code || '',
        qty: Number(formData.quantity) || 0,
        bom_id: formData.bom_id || undefined,
        routing_id: formData.routing_id || undefined,
        warehouse_id: formData.warehouse_id || undefined,
        priority: formData.priority || 'normal',
        planned_start_date: toLocalDateISO(formData.start_date),
        planned_end_date: toLocalDateISO(formData.end_date),
        remark: formData.remark,
      };
      if (isEdit && id) {
        const response = await productionApi.updateWorkOrder(id, submitData);
        if (response.code === 0) {
          navigate('/production/work-orders');
        }
      } else {
        const response = await productionApi.createWorkOrder(submitData);
        if (response.code === 0) {
          navigate('/production/work-orders');
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) || 0 : value,
    }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑生产工单' : '新建生产工单'}
        subtitle={isEdit ? '修改生产工单信息' : '创建新的生产工单'}
        onBack={() => { if (confirmLeave()) navigate('/production/work-orders'); }}
        backDisabled={loading}
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">工单编号 *</label>
              <input
                type="text"
                name="work_order_no"
                value={formData.work_order_no || ''}
                onChange={handleInputChange}
                required
                className="form-input"
                placeholder="请输入工单编号"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">生产产品 *</label>
              <SearchSelect
                required
                value={formData.product_id}
                onChange={(v) => setFormData(prev => ({ ...prev, product_id: v ?? '' }))}
                placeholder="请选择产品"
                options={[
                  // 编辑态保留已删除/不在列表中的产品（原样展示，不可再改选别的值）
                  ...(!products.some((p) => p.id === formData.product_id) && formData.product_id
                    ? [{ value: formData.product_id, label: formData.product_name || '已删除产品' }]
                    : []),
                  ...products.map((p) => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) })),
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">生产数量 *</label>
              <input
                type="text"
                inputMode="decimal"
                name="quantity"
                value={formData.quantity ?? ''}
                onChange={handleInputChange}
                required
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">关联 BOM</label>
              <SearchSelect
                value={formData.bom_id}
                onChange={(v) => setFormData(prev => ({ ...prev, bom_id: v ?? '' }))}
                placeholder="请选择 BOM（展开物料需求）"
                options={boms.map((b) => ({ value: b.id, label: `${b.code} - ${b.product_name}` }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">工艺路线</label>
              <SearchSelect
                value={formData.routing_id}
                onChange={(v) => setFormData(prev => ({ ...prev, routing_id: v ?? '' }))}
                placeholder="请选择工艺路线（生成工序）"
                options={routings.map((r) => ({
                  value: r.id,
                  // 2026-09-14 真机实测修复：name 为空时显示 "RT… - undefined"（工艺 name 可能未落库），
                  // 兜底 routing_name/product_name，全空则只显示编码
                  label: [r.code, r.name || r.routing_name || r.product_name].filter(Boolean).join(' - '),
                }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">领料仓库</label>
              <SearchSelect
                value={formData.warehouse_id}
                onChange={(v) => setFormData(prev => ({ ...prev, warehouse_id: v ?? '' }))}
                placeholder="请选择仓库"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">优先级</label>
              <select
                name="priority"
                value={formData.priority || 'normal'}
                onChange={handleInputChange}
                className="form-select"
              >
                <option value="low">低</option>
                <option value="normal">普通</option>
                <option value="high">高</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
              <input
                type="text"
                value={getStateLabel(formData.status)}
                disabled
                className="form-input bg-gray-50 text-gray-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">开始日期 *</label>
              <input
                type="date"
                name="start_date"
                value={formData.start_date || ''}
                onChange={handleInputChange}
                required
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">结束日期 *</label>
              <input
                type="date"
                name="end_date"
                value={formData.end_date || ''}
                onChange={handleInputChange}
                required
                className="form-input"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
            <textarea
              name="remark"
              value={formData.remark || ''}
              onChange={handleInputChange}
              rows={2}
              className="form-input"
              placeholder="请输入备注信息"
            />
          </div>

          <div className="form-actions">
            {/* [物理保护] 保存中锁定取消：防请求飞行+导航竞态 */}
            <button type="button" onClick={() => { if (confirmLeave()) navigate('/production/work-orders'); }} disabled={loading} className="btn-secondary">取消</button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              <Save className="w-5 h-5" />
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>

      {isEdit && woLoaded && (
        <>
          {/* 执行操作 */}
          <div className="card p-4 flex flex-col md:flex-row items-start md:items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Wallet className="w-5 h-5 text-blue-600" />
              生产执行
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => navigate('/production/pickings')} className="btn-secondary flex items-center gap-2 text-sm">
                <PackageMinus className="w-4 h-4" /> 领料
              </button>
              <button onClick={() => navigate('/production/receipts')} className="btn-secondary flex items-center gap-2 text-sm">
                <PackagePlus className="w-4 h-4" /> 生产入库
              </button>
              <button onClick={() => navigate(`/production-returns/create?work_order_id=${id}`)} className="btn-secondary flex items-center gap-2 text-sm">
                <Undo2 className="w-4 h-4" /> 生产退料
              </button>
            </div>
          </div>

          {/* 成本汇总 */}
          <div className="card p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">成本汇总</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {costCard('材料成本', costs.material)}
              {costCard('人工成本', costs.labor)}
              {costCard('制造费用', costs.overhead)}
              {costCard('合计成本', costs.total, 'text-blue-600')}
            </div>
          </div>

          {/* 物料需求跟踪（逐料：需领/已领/已退/待领） */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">物料需求跟踪</h3>
              <button onClick={fetchMaterials} className="text-sm text-blue-600 hover:underline">
                {materialsLoading ? '加载中...' : '刷新'}
              </button>
            </div>
            {!materialsLoading && materials.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">暂无物料需求，请在工单上选择 BOM 后重新保存生成</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">物料</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">单位</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">需领</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">已领</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">已退</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">待领</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(materialsLoading ? [] : materials).map((m, i) => {
                      const required = Number(m.qty_required || 0);
                      const issued = Number(m.qty_issued || 0);
                      const returned = Number(m.qty_returned || 0);
                      const pending = Number(m.qty_pending || 0);
                      return (
                        <tr key={m.id || i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm text-gray-700">{m.product_name}（{m.product_code}）</td>
                          <td className="px-4 py-2 text-sm text-gray-500">{m.unit_name || '-'}</td>
                          <td className="px-4 py-2 text-right text-sm text-gray-600">{required}</td>
                          <td className="px-4 py-2 text-right text-sm text-gray-600">{issued}</td>
                          <td className="px-4 py-2 text-right text-sm text-gray-600">{returned}</td>
                          <td className={`px-4 py-2 text-right text-sm font-medium ${pending > 0 ? 'text-red-600' : 'text-green-600'}`}>{pending}</td>
                          <td className="px-4 py-2 text-center">
                            {pending <= 0 ? (
                              <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-md">已齐套</span>
                            ) : (
                              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded-md">待领料</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 缺料分析 */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">物料齐套分析</h3>
              <button onClick={fetchAvailability} className="text-sm text-blue-600 hover:underline">
                {availabilityLoading ? '加载中...' : '刷新'}
              </button>
            </div>
            {!availabilityLoading && availability.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">暂无 BOM 或未展开物料需求</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">物料</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">需求</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">已领</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">可用库存</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">缺口</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(availabilityLoading ? [] : availability).map((a, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm text-gray-700">{a.product_name}（{a.product_code}）</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-600">{a.required}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-600">{a.picked}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-600">{a.available}</td>
                        <td className="px-4 py-2 text-right text-sm font-medium text-red-600">{a.shortage}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`text-xs font-medium ${availStatus(a.status).cls}`}>{availStatus(a.status).text}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 工序执行 */}
          <div className="card p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">工序执行</h3>
            {processes.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">该工单未配置工序，请在工单创建时选择工艺路线</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">序号</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">工序</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">工作中心</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">计划数量</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">合格数</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">不良数</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">实际工时</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">人工费率</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">状态</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {processes.map((p, i) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm text-gray-500">{i + 1}</td>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{p.process_name || p.process_code}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{p.work_center_name || p.work_center || '-'}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-600">{p.qty_planned ?? '-'}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-600">{p.qty_good ?? '-'}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-600">{p.qty_bad ?? '-'}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-600">{p.actual_time ? `${p.actual_time}h` : '-'}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-600">{p.labor_rate ? format.currency(Number(p.labor_rate)) : '-'}</td>
                        <td className="px-4 py-2 text-center">{statusBadge(p.status || 'pending')}</td>
                        <td className="px-4 py-2 text-right">
                          {p.status === 'pending' && (
                            <button onClick={() => handleStartProcess(p)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md">
                              <Play className="w-3.5 h-3.5" /> 开始
                            </button>
                          )}
                          {p.status === 'in_progress' && (
                            <button onClick={() => openComplete(p)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-green-600 bg-green-50 hover:bg-green-100 rounded-md">
                              <CheckCircle2 className="w-3.5 h-3.5" /> 报工
                            </button>
                          )}
                          {p.status === 'completed' && <span className="text-xs text-gray-400">已完成</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* 工序报工弹窗 */}
      <Modal
        title={completeTarget ? `报工 - ${completeTarget.process_name}` : '报工'}
        open={!!completeTarget}
        onCancel={() => setCompleteTarget(null)}
        footer={null}
        width={480}
      >
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">合格数量</label>
              <input type="text" inputMode="decimal" value={completeForm.qty_good ?? ''}
                onChange={e => setCompleteForm(prev => ({ ...prev, qty_good: e.target.value }))} className="form-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">不良数量</label>
              <input type="text" inputMode="decimal" value={completeForm.qty_bad ?? ''}
                onChange={e => setCompleteForm(prev => ({ ...prev, qty_bad: e.target.value }))} className="form-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">实际工时（小时）</label>
              <input type="text" inputMode="decimal" value={completeForm.actual_time ?? ''}
                onChange={e => setCompleteForm(prev => ({ ...prev, actual_time: e.target.value }))} className="form-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">人工费率（元/小时）</label>
              <input type="text" inputMode="decimal" value={completeForm.labor_rate ?? ''}
                onChange={e => setCompleteForm(prev => ({ ...prev, labor_rate: e.target.value }))} className="form-input" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setCompleteTarget(null)} className="btn-secondary">取消</button>
            <button onClick={submitComplete} disabled={acting} className="btn-primary">
              {acting ? '提交中...' : '确认报工'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function getStateLabel(status?: string): string {
  const labels: Record<string, string> = {
    draft: '草稿',
    confirmed: '已确认',
    in_progress: '生产中',
    completed: '已完成',
    cancelled: '已取消',
  };
  return labels[status || ''] || status || '';
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDate(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
