import { format } from '@/utils/format';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { voucherApi, accountApi } from '@/api/finance';
import { Voucher, VoucherEntry, Account } from '@/types/finance';

export function VoucherForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Voucher>>({
    voucher_date: format.today(),
    type: 'general',
    currency_code: 'CNY',
    exchange_rate: '',
    remark: '',
    entries: [],
  });

  const [accounts, setAccounts] = useState<Account[]>([]);
  // 科目全量引用（回填分录 account_id 时规避 state 异步竞态）
  const accountsRef = useRef<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      // 先加载科目（分录回显需按 account_code 匹配 account_id），再拉凭证
      await fetchAccounts();
      if (isEdit && id) {
        await fetchVoucher(id);
      }
    })();
  }, [id]);

  const fetchAccounts = async () => {
    try {
      // 全量科目：分录需在所有末级科目中选择，分页 list 只取 10 条会漏科目
      const response = await accountApi.all();
      if (response.code === 0) {
        const list = response.data?.list || [];
        setAccounts(list);
        accountsRef.current = list;
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  };

  const fetchVoucher = async (voucherId: string) => {
    setLoading(true);
    try {
      const response = await voucherApi.get(voucherId);
      if (response.code === 0) {
        const d: any = response.data;
        // 明细在 edges.entries（ent 序列化）；此前整包 setFormData(data) 致编辑凭证 entries 恒空，
        // 保存时按空 entries 重建 = 原分录被覆盖清空（P0，同采购退货当年的坑）。
        // 分录行存 account_code/name 快照（无 account_id 外键），按 code 回填 account_id 供下拉选中。
        const accList = accountsRef.current;
        const entries = ((d.edges?.entries || d.entries) || []).map((l: any) => {
          const code = l.account_code || l.edges?.account?.code || '';
          const acc = accList.find((a: any) => a.code === code);
          return {
            id: l.id || '',
            account_id: acc?.id || '',
            account_code: code,
            account_name: l.account_name || acc?.name || '',
            direction: l.direction || 'debit',
            amount: Number(l.amount) || 0,
            remark: l.remark || '',
          };
        });
        setFormData({ ...d, voucher_date: (d.voucher_date || '').slice(0, 10), entries });
      }
    } catch (err) {
      console.error('Failed to fetch voucher:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddEntry = () => {
    const newEntry: VoucherEntry = {
      id: '',
      account_id: '',
      account_code: '',
      account_name: '',
      direction: 'debit',
      amount: 0,
      remark: '',
    };
    setFormData(prev => ({
      ...prev,
      entries: [...(prev.entries || []), newEntry],
    }));
  };

  const handleEntryChange = (index: number, field: string, value: any) => {
    const newEntries = [...(formData.entries || [])];
    newEntries[index] = { ...newEntries[index], [field]: value };

    if (field === 'account_id') {
      const account = accounts.find(a => a.id === value);
      if (account) {
        newEntries[index].account_code = account.code;
        newEntries[index].account_name = account.name;
      }
    }

    const totalDebit = Math.round(newEntries
      .filter(e => e.direction === 'debit')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0) * 100) / 100;
    const totalCredit = Math.round(newEntries
      .filter(e => e.direction === 'credit')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0) * 100) / 100;

    setFormData(prev => ({
      ...prev,
      entries: newEntries,
      total_debit: totalDebit,
      total_credit: totalCredit,
    }));
  };

  const handleRemoveEntry = (index: number) => {
    const newEntries = [...(formData.entries || [])];
    newEntries.splice(index, 1);

    const totalDebit = Math.round(newEntries
      .filter(e => e.direction === 'debit')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0) * 100) / 100;
    const totalCredit = Math.round(newEntries
      .filter(e => e.direction === 'credit')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0) * 100) / 100;

    setFormData(prev => ({
      ...prev,
      entries: newEntries,
      total_debit: totalDebit,
      total_credit: totalCredit,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // 金额输入以字符串保留小数中间态；提交前 Number() 化并 round 2，杜绝脏值/空串
      const clean = (v: any) => (v === '' || v === null || v === undefined ? 0 : Math.round(Number(v) * 100) / 100);
      const payload = { ...formData, entries: (formData.entries || []).map((e: any) => ({ ...e, amount: clean(e.amount) })) };
      if (isEdit && id) {
        const response = await voucherApi.update(id, payload);
        if (response.code === 0) {
          navigate('/finance/vouchers');
        }
      } else {
        const response = await voucherApi.create(payload);
        if (response.code === 0) {
          navigate('/finance/vouchers');
        }
      }
    } catch (err) {
      console.error('Failed to save voucher:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑凭证' : '新增凭证'}
        subtitle={isEdit ? '修改凭证信息' : '创建新的记账凭证'}
        onBack={() => { if (confirmLeave()) navigate('/finance/vouchers'); }}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">凭证日期 *</label>
                <input
                  type="date"
                  value={formData.voucher_date || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, voucher_date: e.target.value }))}
                  required
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">凭证类型</label>
                <select
                  value={formData.type || 'general'}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                  className="form-select"
                >
                  <option value="general">记账凭证</option>
                  <option value="receipt">收款凭证</option>
                  <option value="payment">付款凭证</option>
                  <option value="transfer">转账凭证</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">币种</label>
                <input
                  type="text"
                  value={formData.currency_code || 'CNY'}
                  onChange={(e) => setFormData(prev => ({ ...prev, currency_code: e.target.value }))}
                  className="form-input"
                  placeholder="如：CNY / USD"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">汇率（对本币）</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formData.exchange_rate ?? ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, exchange_rate: e.target.value }))}
                  className="form-input"
                  placeholder="外币凭证填写，如 7.2"
                />
              </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">借方合计</label>
                    <input
                      type="text"
                      value={`¥${Number(formData.total_debit || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      disabled
                      className="form-input bg-gray-50 text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">贷方合计</label>
                    <input
                      type="text"
                      value={`¥${Number(formData.total_credit || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
                placeholder="请输入凭证备注"
              />
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-medium text-gray-700">凭证明细</h3>
                <button type="button" onClick={handleAddEntry} className="btn-secondary text-sm flex items-center gap-1">
                  <Plus className="w-4 h-4" />
                  添加行
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">科目</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">方向</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">金额</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">摘要</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(formData.entries || []).map((entry, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3">
                          <SearchSelect
                            value={entry.account_id}
                            onChange={(v) => handleEntryChange(index, 'account_id', v ?? '')}
                            placeholder="请选择科目"
                            options={accounts.filter(a => a.is_leaf).map((a) => ({ value: a.id, label: `${a.code} - ${a.name}` }))}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={entry.direction}
                            onChange={(e) => handleEntryChange(index, 'direction', e.target.value)}
                            className="form-select"
                          >
                            <option value="debit">借</option>
                            <option value="credit">贷</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={entry.amount ?? ''}
                            onChange={(e) => handleEntryChange(index, 'amount', e.target.value)}
                            className="form-input text-right"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={entry.remark || ''}
                            onChange={(e) => handleEntryChange(index, 'remark', e.target.value)}
                            className="form-input"
                            placeholder="摘要"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => handleRemoveEntry(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(!formData.entries || formData.entries.length === 0) && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">点击上方按钮添加行</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/finance/vouchers'); }} disabled={loading} className="btn-secondary">取消</button>
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
