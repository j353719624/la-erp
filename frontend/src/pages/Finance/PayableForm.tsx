import { format } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { payableApi } from '@/api/finance';
import { supplierApi } from '@/api/order';
import { APInvoice } from '@/types/finance';
import { Supplier } from '@/types/order';

export function PayableForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<APInvoice>>({
    supplier_id: '',
    supplier_name: '',
    invoice_date: format.today(),
    due_date: format.today(),
    total_amount: 0,
    remark: '',
  });

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
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
      const supplierRes = await supplierApi.list({ page: 1, page_size: 1000 });
      if (supplierRes.code === 0) setSuppliers(supplierRes.data.list);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchInvoice = async (invoiceId: string) => {
    setLoading(true);
    try {
      const response = await payableApi.get(invoiceId);
      if (response.code === 0) {
        setFormData(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch payable:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliers.find(s => s.id === supplierId);
    setFormData(prev => ({
      ...prev,
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.supplier_id) { setError('请选择供应商'); return; }
    setLoading(true);
    try {
      if (isEdit && id) {
        const response = await payableApi.update(id, formData);
        if (response.code === 0) {
          navigate('/finance/payables');
        }
      } else {
        const response = await payableApi.create(formData);
        if (response.code === 0) {
          navigate('/finance/payables');
        }
      }
    } catch (err) {
      console.error('Failed to save payable:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑应付单' : '新增应付单'}
        subtitle={isEdit ? '修改应付单信息' : '创建新的应付单'}
        onBack={() => { if (confirmLeave()) navigate('/finance/payables'); }}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">供应商 *</label>
                <SearchSelect
                  required
                  value={formData.supplier_id}
                  onChange={(v) => handleSupplierChange(v ?? '')}
                  placeholder="请选择供应商"
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">应付金额 *</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">已付金额</label>
                <input
                  type="text"
                  value={`¥${Number(formData.paid_amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/finance/payables'); }} disabled={loading} className="btn-secondary">取消</button>
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
