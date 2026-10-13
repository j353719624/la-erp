import { format } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Plus, Trash2, SplitSquareHorizontal, AlertCircle } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { paymentPlanApi, PaymentPlan } from '@/api/finance';
import { customerApi, supplierApi } from '@/api/order';

interface PlanItemRow {
  seq: number;
  due_date: string;
  planned_amount: string;
  remark: string;
}

export function PaymentPlanForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<any>({
    plan_type: 'receivable',
    party_id: '',
    party_name: '',
    source_type: 'manual',
    source_no: '',
    total_amount: '',
    start_date: format.today(),
    remark: '',
    items: [] as PlanItemRow[],
  });
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    customerApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setCustomers(res.data?.list || []);
    }).catch((err: any) => console.warn('客户列表加载失败（可能缺 customer_list 权限）:', err?.message || err));
    supplierApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setSuppliers(res.data?.list || []);
    }).catch((err: any) => console.warn('供应商列表加载失败（可能缺 supplier_list 权限）:', err?.message || err));
    if (isEdit && id) fetchPlan(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchPlan = async (planId: string) => {
    try {
      const res = await paymentPlanApi.get(planId);
      if (res.code === 0) {
        const p = res.data;
        const items = (p.edges?.items || []).map((it: any) => ({
          seq: it.seq,
          due_date: it.due_date?.split('T')[0] || '',
          planned_amount: String(it.planned_amount ?? ''),
          remark: it.remark || '',
        }));
        setFormData({
          plan_type: p.plan_type,
          party_id: p.party_id || '',
          party_name: p.party_name || '',
          source_type: p.source_type || 'manual',
          source_no: p.source_no || '',
          total_amount: String(p.total_amount ?? ''),
          start_date: p.start_date?.split('T')[0] || '',
          remark: p.remark || '',
          items,
        });
      }
    } catch (err) {
      console.error('Failed to fetch plan:', err);
    }
  };

  const parties = formData.plan_type === 'receivable' ? customers : suppliers;

  const handleAddItem = () => {
    const items = [...(formData.items || [])];
    const seq = items.length > 0 ? Math.max(...items.map((i: any) => i.seq)) + 1 : 1;
    items.push({ seq, due_date: '', planned_amount: '', remark: '' });
    setFormData((prev: any) => ({ ...prev, items }));
  };

  const handleRemoveItem = (index: number) => {
    const items = [...(formData.items || [])];
    items.splice(index, 1);
    setFormData((prev: any) => ({ ...prev, items }));
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const items = [...(formData.items || [])];
    items[index] = { ...items[index], [field]: value };
    setFormData((prev: any) => ({ ...prev, items }));
  };

  // 按总金额等分拆分（把尾差加到最后一期）
  const handleSplitEqual = () => {
    const total = parseFloat(formData.total_amount);
    if (!total || total <= 0) {
      message.warning('请先填写总金额');
      return;
    }
    const count = (formData.items || []).length;
    if (count === 0) {
      message.warning('请先添加至少一条分期');
      return;
    }
    const base = Math.floor((total * 100) / count) / 100;
    const items = (formData.items || []).map((it: any, idx: number) => {
      const isLast = idx === count - 1;
      let amount = base;
      if (isLast) {
        // 尾差归最后一期
        amount = Math.round((total - base * (count - 1)) * 100) / 100;
      }
      return { ...it, planned_amount: String(amount) };
    });
    setFormData((prev: any) => ({ ...prev, items }));
    message.success(`已按 ${count} 期等分`);
  };

  const handleSubmit = async () => {
    setError('');
    if (!formData.total_amount || parseFloat(formData.total_amount) <= 0) {
      setError('请填写总金额');
      return;
    }
    if (!formData.items || formData.items.length === 0) {
      setError('请至少添加一条分期明细');
      return;
    }
    for (const it of formData.items) {
      if (!it.due_date) {
        setError(`第 ${it.seq} 期到期日必填`);
        return;
      }
      if (!it.planned_amount || parseFloat(it.planned_amount) <= 0) {
        setError(`第 ${it.seq} 期计划金额必须大于 0`);
        return;
      }
    }

    const party = parties.find((p: any) => p.id === formData.party_id);
    const payload = {
      plan_type: formData.plan_type,
      party_id: formData.party_id || null,
      party_name: party ? party.name : formData.party_name,
      source_type: formData.source_type || 'manual',
      source_no: formData.source_no || '',
      total_amount: formData.total_amount,
      start_date: formData.start_date || null,
      remark: formData.remark || '',
      items: (formData.items || []).map((it: any) => ({
        seq: it.seq,
        due_date: it.due_date,
        planned_amount: it.planned_amount,
        remark: it.remark || '',
      })),
    };

    setLoading(true);
    try {
      if (isEdit && id) {
        const res = await paymentPlanApi.update(id, payload);
        if (res.code === 0) {
          message.success('计划已更新');
          navigate('/finance/payment-plans');
        } else {
          setError(res.message || '更新失败');
        }
      } else {
        const res = await paymentPlanApi.create(payload);
        if (res.code === 0) {
          message.success('计划已创建');
          navigate('/finance/payment-plans');
        } else {
          setError(res.message || '创建失败');
        }
      }
    } catch (err: any) {
      setError(err?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const itemsSum = (formData.items || []).reduce((s: number, it: any) => s + (parseFloat(it.planned_amount) || 0), 0);
  const total = parseFloat(formData.total_amount) || 0;
  const sumMismatch = formData.items && formData.items.length > 0 && Math.abs(itemsSum - total) > 0.01;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑收付款计划' : '新建收付款计划'}
        subtitle="按到期日分期收/付款"
        onBack={() => navigate('/finance/payment-plans')}
        extra={
          <button onClick={() => navigate('/finance/payment-plans')} className="btn-secondary flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            返回列表
          </button>
        }
      />

      <div className="card p-6 space-y-5">
        {/* 基本信息 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">计划类型 *</label>
            <select
              value={formData.plan_type}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, plan_type: e.target.value, party_id: '' }))}
              className="form-input"
              disabled={isEdit}
            >
              <option value="receivable">收款计划（客户）</option>
              <option value="payable">付款计划（供应商）</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">{formData.plan_type === 'receivable' ? '客户 *' : '供应商 *'}</label>
            <SearchSelect
              value={formData.party_id}
              onChange={(v) => setFormData((prev: any) => ({ ...prev, party_id: v ?? '' }))}
              placeholder={`请选择${formData.plan_type === 'receivable' ? '客户' : '供应商'}`}
              options={parties.map((p: any) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">总金额 *</label>
            <input
              type="number"
              value={formData.total_amount}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, total_amount: e.target.value }))}
              className="form-input"
              placeholder="0.00"
              min={0}
              step="0.01"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">来源单号</label>
            <input
              type="text"
              value={formData.source_no}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, source_no: e.target.value }))}
              className="form-input"
              placeholder="如应收/应付/订单单号（可选）"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">起始日期</label>
            <input
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, start_date: e.target.value }))}
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">备注</label>
            <input
              type="text"
              value={formData.remark}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, remark: e.target.value }))}
              className="form-input"
            />
          </div>
        </div>

        {/* 分期明细 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">分期明细</h3>
            <div className="flex gap-2">
              <button onClick={handleSplitEqual} className="btn-secondary text-xs flex items-center gap-1">
                <SplitSquareHorizontal className="w-3.5 h-3.5" />
                按总金额等分
              </button>
              <button onClick={handleAddItem} className="btn-primary text-xs flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                添加分期
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center', width: 60 }}>期数</th>
                  <th style={{ textAlign: 'center' }}>到期日 *</th>
                  <th style={{ textAlign: 'center' }}>计划金额 *</th>
                  <th style={{ textAlign: 'center' }}>备注</th>
                  <th style={{ textAlign: 'center', width: 70 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {(formData.items || []).map((it: any, idx: number) => (
                  <tr key={idx}>
                    <td style={{ textAlign: 'center' }}>{it.seq}</td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="date"
                        value={it.due_date}
                        onChange={(e) => handleItemChange(idx, 'due_date', e.target.value)}
                        className="form-input"
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="number"
                        value={it.planned_amount}
                        onChange={(e) => handleItemChange(idx, 'planned_amount', e.target.value)}
                        className="form-input"
                        min={0}
                        step="0.01"
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="text"
                        value={it.remark}
                        onChange={(e) => handleItemChange(idx, 'remark', e.target.value)}
                        className="form-input"
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => handleRemoveItem(idx)}
                        className="icon-btn delete sm"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {(!formData.items || formData.items.length === 0) && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center' }} className="text-gray-400 py-6">
                      暂无分期，点击「添加分期」或「按总金额等分」
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {formData.items && formData.items.length > 0 && (
            <div className="mt-3 flex items-center gap-4 text-sm">
              <span className="text-gray-500">分期合计：<b>{itemsSum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>
              <span className="text-gray-500">总金额：<b>{total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>
              {sumMismatch && (
                <span className="text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  分期合计与总金额不一致（差异 {Math.abs(itemsSum - total).toFixed(2)}）
                </span>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 text-red-600 p-3 text-sm">{error}</div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button onClick={() => navigate('/finance/payment-plans')} className="btn-secondary">
            取消
          </button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4" />
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
