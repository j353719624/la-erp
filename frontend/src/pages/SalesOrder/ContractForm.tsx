import { format } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { salesContractApi, customerApi } from '@/api/order';

/**
 * 销售合同表单（2026-09-11，与采购合同对称）
 *
 * 客户方合同号 = 客户自己的合同号/PO 号，客户对账常用（发票与对账单一栏）。
 */
export function ContractForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<any>({
    customer_id: '',
    customer_name: '',
    customer_contract_no: '',
    contract_date: format.today(),
    start_date: '',
    end_date: '',
    total_amount: '',
    remark: '',
  });
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    customerApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setCustomers(res.data?.list || []);
    }).catch((err: any) => console.warn('客户列表加载失败（可能缺 customer_list 权限）:', err?.message || err));
    if (isEdit && id) fetchContract(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchContract = async (cid: string) => {
    try {
      const res = await salesContractApi.get(cid);
      if (res.code === 0) {
        const c = res.data;
        setFormData({
          customer_id: c.customer_id || '',
          customer_name: c.customer_name || '',
          customer_contract_no: c.customer_contract_no || '',
          contract_date: c.contract_date?.split('T')[0] || '',
          start_date: c.start_date ? c.start_date.split('T')[0] : '',
          end_date: c.end_date ? c.end_date.split('T')[0] : '',
          total_amount: String(c.total_amount ?? ''),
          remark: c.remark || '',
        });
      }
    } catch (e: any) {
      message.error(e?.message || '加载合同失败');
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!formData.total_amount || parseFloat(formData.total_amount) < 0) {
      setError('请填写合同金额');
      return;
    }
    const customer = customers.find((c: any) => c.id === formData.customer_id);
    const payload = {
      customer_id: formData.customer_id || null,
      customer_name: customer ? customer.name : formData.customer_name,
      customer_contract_no: formData.customer_contract_no || '',
      contract_date: formData.contract_date || null,
      start_date: formData.start_date || null,
      end_date: formData.end_date || null,
      total_amount: formData.total_amount,
      remark: formData.remark || '',
      // 清空结束日期：后端是部分更新语义（未传 = 保留原值）→ 必须显式声明清空，
      // 否则用户删掉日期保存后旧值静默残留（2026-09-22 遗留项修复）。
      clear_end_date: isEdit && !formData.end_date ? true : undefined,
    };
    setLoading(true);
    try {
      const res = isEdit && id ? await salesContractApi.update(id, payload) : await salesContractApi.create(payload);
      if (res.code === 0) {
        message.success(isEdit ? '合同已更新' : '合同已创建');
        navigate('/sales-contracts');
      } else {
        setError(res.message || '保存失败');
      }
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (confirmLeave()) navigate('/sales-contracts');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑销售合同' : '新建销售合同'}
        subtitle="与客户签订销售合同；订单关联合同后可统计执行率与收款率"
        onBack={goBack}
        extra={
          <button onClick={goBack} className="btn-secondary flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            返回列表
          </button>
        }
      />

      <div className="card p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">客户</label>
            <SearchSelect
              value={formData.customer_id}
              onChange={(v) => setFormData((p: any) => ({ ...p, customer_id: v ?? '' }))}
              placeholder="请选择客户"
              options={[
                // 编辑态保留已选客户（即使不在当前加载列表中，仍原样展示）
                ...(formData.customer_id && !customers.some((c: any) => c.id === formData.customer_id)
                  ? [{ value: formData.customer_id, label: formData.customer_name || '已选客户' }]
                  : []),
                ...customers.map((c: any) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">客户合同号 / 客户 PO 号</label>
            <input
              type="text"
              value={formData.customer_contract_no}
              onChange={(e) => setFormData((p: any) => ({ ...p, customer_contract_no: e.target.value }))}
              className="form-input"
              placeholder="客户方单号（对账用）"
             autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">合同金额 *</label>
            <input type="number" min={0} step="any" value={formData.total_amount} onChange={(e) => setFormData((p: any) => ({ ...p, total_amount: e.target.value }))} className="form-input" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">签订日期</label>
            <input type="date" value={formData.contract_date} onChange={(e) => setFormData((p: any) => ({ ...p, contract_date: e.target.value }))} className="form-input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">生效日期</label>
            <input type="date" value={formData.start_date} onChange={(e) => setFormData((p: any) => ({ ...p, start_date: e.target.value }))} className="form-input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">有效期至</label>
            <input type="date" value={formData.end_date} onChange={(e) => setFormData((p: any) => ({ ...p, end_date: e.target.value }))} className="form-input" />
          </div>
          <div className="md:col-span-3">
            <label className="block text-sm text-gray-600 mb-1">备注</label>
            <input type="text" value={formData.remark} onChange={(e) => setFormData((p: any) => ({ ...p, remark: e.target.value }))} className="form-input" />
          </div>
        </div>

        {error && <div className="rounded-md bg-red-50 text-red-600 p-3 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button onClick={goBack} className="btn-secondary">取消</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4" />
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
