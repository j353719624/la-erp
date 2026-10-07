import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, RefreshCw, Link2 } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import { bankApi } from '@/api/finance';
import { format } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { SearchSelect } from '@/components/SearchSelect';
import { confirmAction } from '@/utils/confirm';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

interface BankAccount { id: string; account_no: string; bank_name: string; account_name: string; currency: string; opening_balance: string; }
interface Statement { id: string; statement_date: string; transaction_no: string; description: string; amount: string; balance_after: string; reconciled: boolean; matched_ref: string; }

export function BankReconciliation() {
  // [2026-09-18 权限细化] 新增账户/对账单=create；自动勾对=edit；删除=delete
  const { has } = usePermission();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [acctLoading, setAcctLoading] = useState(true);
  const [selAccount, setSelAccount] = useState<string>('');
  const [statements, setStatements] = useState<Statement[]>([]);
  const [stLoading, setStLoading] = useState(false);
  // [易用性 P1] 页码写入 URL（刷新/发链接保留当前页）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 页码变化 → 写回 URL
  useEffect(() => {
    syncUrl({ page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.page_size]);
  const [summary, setSummary] = useState<any>(null);
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctForm, setAcctForm] = useState<any>({ account_no: '', bank_name: '', account_name: '', opening_balance: '', currency: 'CNY', is_active: true, remark: '' });
  const [stOpen, setStOpen] = useState(false);
  const [stForm, setStForm] = useState<any>({ statement_date: '', transaction_no: '', description: '', amount: '', balance_after: '' });
  const [saving, setSaving] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  // 请求竞态守卫：银行账户切换/翻页时丢弃过期响应，防 A 账户对账单覆盖 B 账户
  const { nextSeq, isCurrent } = useRequestGuard();

  const loadAccounts = useCallback(async () => {
    setAcctLoading(true);
    try {
      const res = await bankApi.accounts();
      if (res.code === 0) {
        const arr = Array.isArray(res.data) ? res.data : [];
        setAccounts(arr);
        if (arr.length > 0) setSelAccount(prev => prev || arr[0].id);
      }
    } catch { /* */ } finally { setAcctLoading(false); }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const loadStatements = useCallback(async () => {
    if (!selAccount) return;
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setStLoading(true);
    try {
      const res = await bankApi.statements({ page: pagination.page, page_size: pagination.page_size, account_id: selAccount });
      if (!isCurrent(seq)) return; // 账户/翻页快速切换时丢弃过期响应
      if (res.code === 0) {
        const arr = Array.isArray(res.data) ? res.data : (res.data?.list || []);
        setStatements(arr);
        setPagination(p => ({ ...p, total: res.data?.total ?? arr.length }));
      }
      const sm = await bankApi.summary(selAccount);
      if (!isCurrent(seq)) return;
      if (sm.code === 0) setSummary(sm.data);
    } catch { /* */ } finally {
      if (isCurrent(seq)) setStLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [selAccount, pagination.page, pagination.page_size, nextSeq, isCurrent]);

  useEffect(() => { loadStatements(); }, [loadStatements]);

  const createAccount = async () => {
    if (!acctForm.account_no.trim()) { message.warning('请填写账号'); return; }
    setSaving(true);
    try {
      const res = await bankApi.createAccount({ ...acctForm, opening_balance: parseFloat(acctForm.opening_balance) || 0 });
      if (res.code === 0) { message.success('账户已创建'); setAcctOpen(false); setAcctForm({ account_no: '', bank_name: '', account_name: '', opening_balance: '', currency: 'CNY', is_active: true, remark: '' }); loadAccounts(); } else { message.error(res.message || '创建失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '创建失败'); } finally { setSaving(false); }
  };

  const addStatement = async () => {
    if (!(parseFloat(stForm.amount) !== 0)) { message.warning('请输入金额（正收负支）'); return; }
    setSaving(true);
    try {
      const res = await bankApi.addStatement({ account_id: selAccount, ...stForm, amount: parseFloat(stForm.amount), balance_after: parseFloat(stForm.balance_after) || 0 });
      if (res.code === 0) { message.success('对账单已添加'); setStOpen(false); setStForm({ statement_date: '', transaction_no: '', description: '', amount: '', balance_after: '' }); loadStatements(); } else { message.error(res.message || '添加失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '添加失败'); } finally { setSaving(false); }
  };

  const doReconcile = async () => {
    if (!selAccount) return;
    setReconciling(true);
    try {
      const res = await bankApi.reconcile(selAccount);
      if (res.code === 0) { message.success(`自动勾对完成，匹配 ${res.data?.matched ?? 0} 笔`); loadStatements(); } else { message.error(res.message || '勾对失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '勾对失败'); } finally { setReconciling(false); }
  };

  const delStatement = async (id: string) => {
    if (!(await confirmAction({ title: '删除该对账单行？', danger: true }))) return;
    const res = await bankApi.deleteStatement(id);
    if (res.code === 0) { message.success('已删除'); loadStatements(); } else { message.error(res.message || '删除失败'); }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Statement) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'statement_date', header: '日期', cell: (s) => <span className="text-gray-600 text-sm">{format.date(s.statement_date)}</span> },
    { key: 'transaction_no', header: '交易号', cell: (s) => <span className="text-gray-600 text-sm">{s.transaction_no || '-'}</span> },
    { key: 'description', header: '摘要', cell: (s) => <span className="text-gray-700 text-sm">{s.description || '-'}</span> },
    {
      key: 'amount',
      header: '金额',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (s) => (
        <span className={`font-medium ${parseFloat(s.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {parseFloat(s.amount) >= 0 ? '+' : ''}{format.currency(parseFloat(s.amount))}
        </span>
      ),
    },
    { key: 'balance_after', header: '余额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (s) => <span className="text-gray-600 text-sm">{format.currency(parseFloat(s.balance_after))}</span> },
    {
      key: 'reconciled',
      header: '勾对',
      cell: (s) => (
        s.reconciled ? (
          <span className="px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">{s.matched_ref || '已勾对'}</span>
        ) : (
          <span className="px-2 py-0.5 rounded text-xs bg-yellow-50 text-yellow-600">未勾对</span>
        )
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (s) => (
        has('bank_reconciliation_delete') ? (
          <button onClick={() => delStatement(s.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="删除"><Trash2 className="w-4 h-4" /></button>
        ) : <span className="text-gray-300">-</span>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'bank-reconciliation',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="银行对账"
        subtitle="银行账户与对账单管理，自动勾对已确认收付款单"
        extra={
          <>
            {selAccount && has('bank_reconciliation_edit') && (
              <button onClick={doReconcile} disabled={reconciling} className="btn-secondary flex items-center gap-2 mr-2">
                <Link2 className="w-4 h-4" /><span className="hidden md:inline">{reconciling ? '勾对中...' : '自动勾对'}</span>
              </button>
            )}
            {has('bank_reconciliation_create') && (
              <button onClick={() => setAcctOpen(true)} className="btn-primary flex items-center gap-2 mr-2">
                <Plus className="w-4 h-4" /><span className="hidden md:inline">新增账户</span>
              </button>
            )}
            {selAccount && has('bank_reconciliation_create') && (
              <button onClick={() => setStOpen(true)} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /><span className="hidden md:inline">添加对账单</span>
              </button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3 items-center">
          <SearchSelect
            value={selAccount}
            onChange={(v) => { setSelAccount(v ?? ''); setPagination(p => ({ ...p, page: 1 })); }}
            style={{ width: 288 }}
            placeholder="请选择银行账户"
            options={accounts.map(a => ({ value: a.id, label: `${a.bank_name || '银行'} · ${a.account_no}（${a.currency}）` }))}
          />
          {summary && (
            <div className="text-sm text-gray-500 flex gap-4 flex-wrap">
              <span>对账单 <b>{summary.statement_count}</b> 笔</span>
              <span>已勾对 <b className="text-green-600">{summary.reconciled_count}</b> 笔</span>
              <span>未勾对金额 <b className="text-orange-600">¥{format.currency(parseFloat(summary.unreconciled_amount || '0'))}</b></span>
            </div>
          )}
          <div className="ml-auto">{viewMenu}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stLoading ? (<tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>)
                : statements.length === 0 ? (<tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty title="暂无对账单" description="点右上角「添加对账单」录入银行流水，再逐笔勾对" /></td></tr>)
                : statements.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(s)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total} onPageChange={(page) => setPagination(p => ({ ...p, page }))} loading={stLoading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        </div>
      </div>

      <Modal title="新增银行账户" open={acctOpen} onCancel={() => setAcctOpen(false)} onOk={createAccount} confirmLoading={saving} okText="创建" cancelText="取消">
        <div className="space-y-3 py-2">
          <Input placeholder="账号 *" value={acctForm.account_no} onChange={(e) => setAcctForm({ ...acctForm, account_no: e.target.value })}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="请输入开户行" value={acctForm.bank_name} onChange={(e) => setAcctForm({ ...acctForm, bank_name: e.target.value })} />
            <Input placeholder="请输入户名" value={acctForm.account_name} onChange={(e) => setAcctForm({ ...acctForm, account_name: e.target.value })}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="请输入币种" value={acctForm.currency || 'CNY'} onChange={(e) => setAcctForm({ ...acctForm, currency: e.target.value })} />
            <select value={acctForm.is_active ? 'active' : 'inactive'} onChange={(e) => setAcctForm({ ...acctForm, is_active: e.target.value === 'active' })} className="form-select">
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
          <Input type="number" placeholder="请输入期初余额" value={acctForm.opening_balance} onChange={(e) => setAcctForm({ ...acctForm, opening_balance: e.target.value })} />
          <Input placeholder="请输入备注" value={acctForm.remark || ''} onChange={(e) => setAcctForm({ ...acctForm, remark: e.target.value })} />
        </div>
      </Modal>

      <Modal title="添加对账单行" open={stOpen} onCancel={() => setStOpen(false)} onOk={addStatement} confirmLoading={saving} okText="添加" cancelText="取消">
        <div className="space-y-3 py-2">
          <Input type="date" value={stForm.statement_date} onChange={(e) => setStForm({ ...stForm, statement_date: e.target.value })} />
          <Input placeholder="请输入交易号" value={stForm.transaction_no} onChange={(e) => setStForm({ ...stForm, transaction_no: e.target.value })} />
          <Input placeholder="请输入摘要" value={stForm.description} onChange={(e) => setStForm({ ...stForm, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" placeholder="金额（正收负支）*" value={stForm.amount} onChange={(e) => setStForm({ ...stForm, amount: e.target.value })} />
            <Input type="number" placeholder="请输入余额" value={stForm.balance_after} onChange={(e) => setStForm({ ...stForm, balance_after: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
