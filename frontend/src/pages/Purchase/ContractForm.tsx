import { format } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { contractApi } from '@/api/order';
import { supplierApi } from '@/api/order';

export function ContractForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<any>({
    supplier_id: '',
    supplier_name: '',
    contract_date: format.today(),
    start_date: '',
    end_date: '',
    total_amount: '',
    remark: '',
  });
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supplierApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setSuppliers(res.data?.list || []);
    }).catch((err: any) => console.warn('供应商列表加载失败（可能缺 supplier_list 权限）:', err?.message || err));
    if (isEdit && id) fetchContract(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchContract = async (cid: string) => {
    try {
      const res = await contractApi.get(cid);
      if (res.code === 0) {
        const c = res.data;
        setFormData({
          supplier_id: c.supplier_id || '',
          supplier_name: c.supplier_name || '',
          contract_date: c.contract_date?.split('T')[0] || '',
          start_date: c.start_date ? c.start_date.split('T')[0] : '',
          end_date: c.end_date ? c.end_date.split('T')[0] : '',
          total_amount: String(c.total_amount ?? ''),
          remark: c.remark || '',
        });
      }
    } catch (err) {
      console.error('fetch contract failed:', err);
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!formData.total_amount || parseFloat(formData.total_amount) < 0) {
      setError('请填写合同金额');
      return;
    }
    const supplier = suppliers.find((s: any) => s.id === formData.supplier_id);
    const payload = {
      supplier_id: formData.supplier_id || null,
      supplier_name: supplier ? supplier.name : formData.supplier_name,
      contract_date: formData.contract_date || null,
      start_date: formData.start_date || null,
      end_date: formData.end_date || null,
      total_amount: formData.total_amount,
      remark: formData.remark || '',
      // 清空结束日期：后端是部分更新语义（未传 = 保留原值）→ 必须显式声明清空
      //（2026-09-22 遗留项修复）。
      clear_end_date: isEdit && !formData.end_date ? true : undefined,
    };
    setLoading(true);
    try {
      const res = isEdit && id ? await contractApi.update(id, payload) : await contractApi.create(payload);
      if (res.code === 0) {
        message.success(isEdit ? '合同已更新' : '合同已创建');
        navigate('/purchase-contracts');
      } else {
        setError(res.message || '保存失败');
      }
    } catch (err: any) {
      setError(err?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑采购合同' : '新建采购合同'}
        subtitle="与供应商签订采购框架合同"
        onBack={() => { if (confirmLeave()) navigate('/purchase-contracts'); }}
        extra={
          <button onClick={() => navigate('/purchase-contracts')} className="btn-secondary flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            返回列表
          </button>
        }
      />

      <div className="card p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">供应商</label>
            <SearchSelect
              value={formData.supplier_id}
              onChange={(v) => setFormData((p: any) => ({ ...p, supplier_id: v ?? '' }))}
              placeholder="请选择供应商"
              options={[
                // 编辑态保留已选供应商（即使不在当前加载列表中，仍原样展示）
                ...(formData.supplier_id && !suppliers.some((s: any) => s.id === formData.supplier_id)
                  ? [{ value: formData.supplier_id, label: formData.supplier_name || '已选供应商' }]
                  : []),
                ...suppliers.map((s: any) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">签订日期</label>
            <input type="date" value={formData.contract_date} onChange={(e) => setFormData((p: any) => ({ ...p, contract_date: e.target.value }))} className="form-input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">合同金额 *</label>
            <input type="number" min={0} step="any" value={formData.total_amount} onChange={(e) => setFormData((p: any) => ({ ...p, total_amount: e.target.value }))} className="form-input" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">生效日期</label>
            <input type="date" value={formData.start_date} onChange={(e) => setFormData((p: any) => ({ ...p, start_date: e.target.value }))} className="form-input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">有效期至</label>
            <input type="date" value={formData.end_date} onChange={(e) => setFormData((p: any) => ({ ...p, end_date: e.target.value }))} className="form-input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">备注</label>
            <input type="text" value={formData.remark} onChange={(e) => setFormData((p: any) => ({ ...p, remark: e.target.value }))} className="form-input" />
          </div>
        </div>

        {error && <div className="rounded-md bg-red-50 text-red-600 p-3 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button onClick={() => navigate('/purchase-contracts')} className="btn-secondary">取消</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4" />
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
