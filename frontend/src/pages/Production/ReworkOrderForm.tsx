import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { productionApi } from '@/api/production';
import { ReworkOrder, WorkOrder, WorkOrderProcess } from '@/types/production';
import { message } from '@/utils/appMessage';

export function ReworkOrderForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [formData, setFormData] = useState<Partial<ReworkOrder>>({
    status: 'draft',
    qty_rework: 1,
    qty_good: 0,
    qty_bad: 0,
    reason: '',
    work_order_id: '',
    process_id: '',
    process_name: '',
    operator_name: '',
    remark: '',
  });
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [processes, setProcesses] = useState<WorkOrderProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 判断是否编辑态：/rework-orders/:id（详情查看，禁改）与 /edit
  const isView = !!id && !window.location.pathname.endsWith('/edit');
  const editable = !isView;

  useEffect(() => {
    fetchWorkOrders();
    if (id && isView) fetchDetail(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchWorkOrders = async () => {
    try {
      const res = await productionApi.workOrderList({ page: 1, page_size: 1000 });
      if (res.code === 0) {
        const list = (res.data?.list || []).map((w: any) => ({
          id: w.id,
          work_order_no: w.order_no,
          product_name: w.product_name,
          status: w.status,
          edges: w.edges,
        }));
        setWorkOrders(list);
      }
    } catch (e) {
      console.error('Failed to fetch work orders:', e);
    }
  };

  const fetchDetail = async (rid: string) => {
    setLoading(true);
    try {
      const res = await productionApi.getReworkOrder(rid);
      if (res.code === 0 && res.data) {
        const d = res.data;
        setFormData({
          id: d.id,
          code: d.code,
          status: d.status,
          work_order_id: d.work_order_id || '',
          work_order_no: d.work_order_no,
          process_id: d.process_id || '',
          process_code: d.process_code,
          process_name: d.process_name,
          qty_rework: Number(d.qty_rework || 0),
          qty_good: Number(d.qty_good || 0),
          qty_bad: Number(d.qty_bad || 0),
          reason: d.reason,
          operator_id: d.operator_id,
          operator_name: d.operator_name,
          remark: d.remark,
        });
        // 加载工序
        if (d.work_order_id) loadProcesses(d.work_order_id);
      }
    } catch (e) {
      console.error('Failed to fetch rework order:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadProcesses = async (woId: string) => {
    try {
      const res = await productionApi.getWorkOrder(woId);
      if (res.code === 0 && res.data) {
        setProcesses((res.data as any).edges?.processes || []);
      }
    } catch {
      setProcesses([]);
    }
  };

  const handleWOChange = (woId: string) => {
    const wo = workOrders.find(w => w.id === woId);
    setFormData(prev => ({
      ...prev,
      work_order_id: woId,
      work_order_no: wo?.work_order_no || '',
      process_id: '',
      process_name: '',
    }));
    if (woId) loadProcesses(woId);
    else setProcesses([]);
  };

  const handleSubmit = async () => {
    if (Number(formData.qty_rework || 0) <= 0) {
      message.warning('返工数量必须大于0');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        work_order_id: formData.work_order_id || null,
        work_order_no: formData.work_order_no,
        process_id: formData.process_id || null,
        process_code: formData.process_code,
        process_name: formData.process_name,
        qty_rework: Number(formData.qty_rework || 0),
        qty_good: Number(formData.qty_good || 0),
        qty_bad: Number(formData.qty_bad || 0),
        reason: formData.reason,
        operator_name: formData.operator_name,
        remark: formData.remark,
      };
      const res = id
        ? await productionApi.updateReworkOrder(id, payload)
        : await productionApi.createReworkOrder(payload);
      if (res.code === 0) {
        message.success('保存成功');
        navigate('/production/rework-orders');
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40';

  return (
    <div className="space-y-6">
      <PageHeader
        title={isView ? '返工单详情' : '新建返工单'}
        subtitle={isView ? formData.code || '' : '记录不合格品返工执行'}
        onBack={() => navigate('/production/rework-orders')}
        backDisabled={loading}
        extra={
          editable && (
            <button onClick={handleSubmit} disabled={saving} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" /> {saving ? '保存中...' : '保存'}
            </button>
          )
        }
      />

      <div className="card p-6 max-w-3xl">
        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">加载中...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <div>
              <label className="block text-sm text-gray-600 mb-1">返工单号</label>
              <input value={formData.code || '(保存后自动生成)'} disabled className={inputCls + ' bg-gray-50 text-gray-500'}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">状态</label>
              <input value={formData.status === 'completed' ? '已完成' : formData.status === 'confirmed' ? '已确认' : formData.status === 'cancelled' ? '已取消' : '草稿'} disabled className={inputCls + ' bg-gray-50 text-gray-500'} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">关联工单</label>
              <SearchSelect
                value={formData.work_order_id}
                onChange={(v) => handleWOChange(v ?? '')}
                disabled={!editable}
                placeholder="不关联工单"
                options={[
                  // 查看态保留已删除/不在列表中的工单（原样展示，不可再改选别的值）
                  ...(!workOrders.some(w => w.id === formData.work_order_id) && formData.work_order_id
                    ? [{ value: formData.work_order_id, label: `${formData.work_order_no || '已删除工单'}` }]
                    : []),
                  ...workOrders.map(w => ({ value: w.id, label: `${w.work_order_no}（${w.product_name}）` })),
                ]}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">返工工序</label>
              <SearchSelect
                value={formData.process_id}
                onChange={(v) => {
                  const p = processes.find(x => x.id === v);
                  setFormData(prev => ({
                    ...prev,
                    process_id: v ?? '',
                    process_name: p?.process_name || p?.process_code || '',
                    process_code: p?.process_code || '',
                  }));
                }}
                disabled={!editable || processes.length === 0}
                placeholder={processes.length ? '选择工序' : '（先选择关联工单）'}
                options={[
                  // 查看态保留已删除/不在列表中的工序（原样展示，不可再改选别的值）
                  ...(!processes.some(x => x.id === formData.process_id) && formData.process_id
                    ? [{ value: formData.process_id, label: formData.process_name || formData.process_code || '已删除工序' }]
                    : []),
                  ...processes.map(p => ({ value: p.id, label: p.process_name || p.process_code })),
                ]}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">返工数量 *</label>
              <input
                type="text"
                inputMode="decimal"
                value={formData.qty_rework ?? ''}
                onChange={(e) => setFormData(prev => ({ ...prev, qty_rework: e.target.value }))}
                disabled={!editable}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">返工合格</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.qty_good ?? ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, qty_good: e.target.value }))}
                  disabled={!editable}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">仍不合格</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.qty_bad ?? ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, qty_bad: e.target.value }))}
                  disabled={!editable}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">返工原因</label>
              <input
                value={formData.reason || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                disabled={!editable}
                placeholder="如：尺寸超差、外观不良..."
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">负责人</label>
              <input
                value={formData.operator_name || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, operator_name: e.target.value }))}
                disabled={!editable}
                className={inputCls}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">备注</label>
              <textarea
                value={formData.remark || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                disabled={!editable}
                rows={2}
                className={inputCls}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
