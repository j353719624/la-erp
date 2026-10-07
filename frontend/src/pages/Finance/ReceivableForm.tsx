import { format } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { receivableApi } from '@/api/finance';
import { customerApi } from '@/api/order';
import { ARInvoice } from '@/types/finance';
import { Customer } from '@/types/order';

export function ReceivableForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<ARInvoice>>({
    customer_id: '',
    customer_name: '',
    invoice_date: format.today(),
    due_date: format.today(),
    total_amount: 0,
    remark: '',
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) {
      fetchInvoice(id);
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      const customerRes = await customerApi.list({ page: 1, page_size: 1000 });
      if (customerRes.code === 0) setCustomers(customerRes.data.list);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchInvoice = async (invoiceId: string) => {
    setLoading(true);
    try {
      const response = await receivableApi.get(invoiceId);
      if (response.code === 0) {
        setFormData(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch receivable:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomerChange = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    setFormData(prev => ({
      ...prev,
      customer_id: customerId,
      customer_name: customer?.name || '',
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.customer_id) { setError('请选择客户'); return; }
    setLoading(true);
    try {
      if (isEdit && id) {
        const response = await receivableApi.update(id, formData);
        if (response.code === 0) {
          navigate('/finance/receivables');
        }
      } else {
        const response = await receivableApi.create(formData);
        if (response.code === 0) {
          navigate('/finance/receivables');
        }
      }
    } catch (err) {
      console.error('Failed to save receivable:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑应收单' : '新增应收单'}
        subtitle={isEdit ? '修改应收单信息' : '创建新的应收单'}
        onBack={() => { if (confirmLeave()) navigate('/finance/receivables'); }}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">客户 *</label>
                <SearchSelect
                  required
                  value={formData.customer_id}
                  onChange={(v) => handleCustomerChange(v ?? '')}
                  placeholder="请选择客户"
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">单据日期 *</label>
                <input
                  type="date"
                  value={formData.invoice_date || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, invoice_date: e.target.value }))}
                  required
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">到期日期</label>
                <input
                  type="date"
                  value={formData.due_date || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, due_date: e.target.value }))}
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">应收金额 *</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formData.total_amount || 0}
                  onChange={(e) => setFormData(prev => ({ ...prev, total_amount: parseFloat(e.target.value) || 0 }))}
                  required
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">已收金额</label>
                <input
                  type="text"
                  value={`¥${Number(formData.received_amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
              <textarea
                value={formData.remark || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                rows={2}
                className="form-input"
                placeholder="请输入备注信息"
              />
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/finance/receivables'); }} disabled={loading} className="btn-secondary">取消</button>
              <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                <Save className="w-5 h-5" />
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
