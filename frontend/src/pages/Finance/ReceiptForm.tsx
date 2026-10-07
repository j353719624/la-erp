import { format } from '@/utils/format';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { PaymentMethodSelect } from '@/components/PaymentMethodSelect';
import { receiptApi, receivableApi, currencyApi, accountApi } from '@/api/finance';
import { customerApi } from '@/api/order';
import { PaymentReceipt, PaymentReceiptLine, ARInvoice, Account } from '@/types/finance';
import { Customer } from '@/types/order';
import { loadOptions } from '@/utils/loadOptions';

export function ReceiptForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<PaymentReceipt>>({
    customer_id: '',
    customer_name: '',
    receipt_date: format.today(),
    receipt_type: '银行转账',
    currency_code: '',
    cash_account_id: '',
    cash_account_code: '',
    cash_account_name: '',
    amount: 0,
    lines: [],
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [currencies, setCurrencies] = useState<{ code: string; name: string; exchange_rate?: string }[]>([]);
  const [invoices, setInvoices] = useState<ARInvoice[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOptions();
    if (isEdit && id) {
      fetchReceipt(id);
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前串行 await 一挂全挂）
      const [customerRes, curRes, accRes] = await loadOptions([
        customerApi.list({ page: 1, page_size: 1000 }),
        currencyApi.list(),
        accountApi.all(),
      ], '收款单');
      if (customerRes?.code === 0) setCustomers(customerRes.data.list);
      if (curRes?.code === 0) setCurrencies(Array.isArray(curRes.data) ? curRes.data : []);
      if (accRes?.code === 0) {
        const all = Array.isArray(accRes.data) ? accRes.data : (accRes.data?.list || []);
        // 收款科目 = 现金/银行类叶子科目，确认时据此生成自动凭证
        setAccounts(all.filter((a: Account) => a.is_leaf && (a.sub_category === 'cash' || a.sub_category === 'bank')));
      }
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const handleCashAccountChange = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId);
    setFormData(prev => ({
      ...prev,
      cash_account_id: accountId,
      cash_account_code: account?.code || '',
      cash_account_name: account?.name || '',
    }));
  };

  // 切换币种时自动带出汇率
  const handleCurrencyChange = (code: string) => {
    const cur = currencies.find(c => c.code === code);
    setFormData(prev => ({
      ...prev,
      currency_code: code,
      exchange_rate: cur && cur.exchange_rate ? cur.exchange_rate : prev.exchange_rate,
    }));
  };

  const fetchReceipt = async (receiptId: string) => {
    setLoading(true);
    try {
      const response = await receiptApi.get(receiptId);
      if (response.code === 0 && response.data) {
        const data: any = response.data;
        // 明细在 edges.lines（ent 序列化）；此前只读 data.lines 恒空 → 核销明细与 keepIds 失效
        const lines = ((data.edges?.lines || data.lines) || []).map((l: any) => ({
          id: l.id || '',
          ar_invoice_id: l.ar_invoice_id || '',
          ar_invoice_no: l.ar_invoice_no || l.edges?.ar_invoice?.invoice_no || '',
          amount: Number(l.amount) || 0,
        }));
        setFormData({ ...data, lines });
        // 编辑回显：行内应收单需要选项数据源（此前仅在用户改客户时才拉取 → 编辑必为空）
        if (data.customer_id) {
          await fetchInvoices(data.customer_id, lines.map((l: any) => l.ar_invoice_id).filter(Boolean));
        }
      }
    } catch (err) {
      console.error('Failed to fetch receipt:', err);
    } finally {
      setLoading(false);
    }
  };

  // 拉取某客户可核销应收单；keepIds 为行已引用单据（编辑回显用：即使已结清/不满足余额>0 也保留在选项里）
  const fetchInvoices = async (customerId: string, keepIds: string[] = []) => {
    try {
      const res = await receivableApi.list({ customer_id: customerId, page: 1, page_size: 1000 });
      if (res.code === 0) {
        const list = Array.isArray(res.data) ? res.data : (res.data?.list || []);
        // 仅显示未结清的应收单（余额 > 0），避免重复核销
        const merged = list.filter((i: any) => (i.balance ?? 0) > 0);
        const missing = keepIds.filter((rid) => rid && !merged.some((i: any) => i.id === rid));
        for (const rid of missing) {
          try {
            const g = await receivableApi.get(rid);
            if (g.code === 0 && g.data) merged.push(g.data);
          } catch {
            // 单据已被删除：跳过，行级占位仍可显示
          }
        }
        setInvoices(merged);
      }
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
    }
  };

  const handleCustomerChange = async (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    setFormData(prev => ({
      ...prev,
      customer_id: customerId,
      customer_name: customer?.name || '',
    }));

    if (customerId) {
      await fetchInvoices(customerId);
    } else {
      setInvoices([]);
    }
  };

  const handleAddLine = () => {
    const newLine: PaymentReceiptLine = {
      id: '',
      ar_invoice_id: '',
      ar_invoice_no: '',
      amount: 0,
    };
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), newLine],
    }));
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    const newLines = [...(formData.lines || [])];
    newLines[index] = { ...newLines[index], [field]: value };

    if (field === 'ar_invoice_id') {
      const invoice = invoices.find(i => i.id === value);
      if (invoice) {
        newLines[index].ar_invoice_no = invoice.invoice_no;
        // 自动带出可核销余额：Number() 化并 round 2，避免浮点尾差
        newLines[index].amount = Math.round((Number(invoice.total_amount) - Number(invoice.received_amount || 0)) * 100) / 100;
      }
    }

    setFormData(prev => ({
      ...prev,
      lines: newLines,
      amount: Math.round(newLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0) * 100) / 100,
    }));
  };

  const handleRemoveLine = (index: number) => {
    const newLines = [...(formData.lines || [])];
    newLines.splice(index, 1);
    setFormData(prev => ({
      ...prev,
      lines: newLines,
      amount: Math.round(newLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0) * 100) / 100,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isEdit && !formData.customer_id) { setError('请选择客户'); return; }
    // 外币单必须显式填汇率，避免静默按 1:1 折算核销（本位币 CNY）
    const curCode = formData.currency_code || '';
    if (curCode && curCode !== 'CNY' && !(Number(formData.exchange_rate) > 0)) {
      setError('外币单据请填写汇率（大于 0），确认时按汇率折算本币');
      return;
    }
    setLoading(true);
    try {
      if (isEdit && id) {
        // 收/付款单保存后不可修改（后端无更新端点），编辑页仅作查看
        navigate('/finance/receipts');
        return;
      }
      // 核销金额输入以字符串保留小数中间态；提交前 Number() 化并 round 2
      const clean = (v: any) => (v === '' || v === null || v === undefined ? 0 : Math.round(Number(v) * 100) / 100);
      const payload = { ...formData, amount: clean(formData.amount), lines: (formData.lines || []).map((l: any) => ({ ...l, amount: clean(l.amount) })) };
      const response = await receiptApi.create(payload);
      if (response.code === 0) {
        navigate('/finance/receipts');
      }
    } catch (err) {
      console.error('Failed to save receipt:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '查看收款单' : '新建收款单'}
        subtitle={isEdit ? '收/付款单保存后不可修改' : '创建新的收款单'}
        onBack={() => { if (confirmLeave()) navigate('/finance/receipts'); }}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">收款日期 *</label>
                <input
                  type="date"
                  value={formData.receipt_date || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, receipt_date: e.target.value }))}
                  required
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">收款方式</label>
                <PaymentMethodSelect
                  value={formData.receipt_type || ''}
                  onChange={(v) => setFormData(prev => ({ ...prev, receipt_type: v }))}
                  placeholder="请选择或输入收款方式（如 承兑汇票）"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">收款科目</label>
                <SearchSelect
                  value={formData.cash_account_id}
                  onChange={(v) => handleCashAccountChange(v ?? '')}
                  placeholder="请选择收款科目（确认时生成凭证）"
                  options={accounts.map((a) => ({ value: a.id, label: `${a.code} - ${a.name}` }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">币种（多币种收款）</label>
                <SearchSelect
                  value={formData.currency_code}
                  onChange={(v) => handleCurrencyChange(v ?? '')}
                  placeholder="本币（CNY）"
                  options={currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">汇率（对本币）</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={formData.exchange_rate || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, exchange_rate: e.target.value }))}
                  placeholder="外币收款时填写，如 7.2"
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">收款金额</label>
                <input
                  type="text"
                  value={`¥${Number(formData.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-medium text-gray-700">收款明细</h3>
                <button type="button" onClick={handleAddLine} className="btn-secondary text-sm flex items-center gap-1">
                  <Plus className="w-4 h-4" />
                  添加
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">应收单</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">金额</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(formData.lines || []).map((line, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3">
                          <SearchSelect
                            value={line.ar_invoice_id}
                            onChange={(v) => handleLineChange(index, 'ar_invoice_id', v ?? '')}
                            placeholder="请选择应收单"
                            options={(() => {
                              const base = invoices.map((i) => ({ value: i.id, label: i.invoice_no }));
                              // 已引用单据不在选项（已结清/已删除）时补占位，保证编辑回显不丢
                              if (line.ar_invoice_id && !base.some((o) => o.value === line.ar_invoice_id)) {
                                base.unshift({ value: line.ar_invoice_id, label: line.ar_invoice_no ? `原单 ${line.ar_invoice_no}` : '原应收单（不可选）' });
                              }
                              return base;
                            })()}
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.amount ?? ''}
                            onChange={(e) => handleLineChange(index, 'amount', e.target.value)}
                            className="form-input text-right"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => handleRemoveLine(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(!formData.lines || formData.lines.length === 0) && (
                      <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">点击上方按钮添加</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="form-actions">
              {isEdit && (
                <p className="text-sm text-gray-500 flex-1">该单据已保存，不可修改；如需调整请取消后重新创建</p>
              )}
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/finance/receipts'); }} disabled={loading} className="btn-secondary">取消</button>
              {!isEdit && (
                <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                  <Save className="w-5 h-5" />
                  {loading ? '保存中...' : '保存'}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
