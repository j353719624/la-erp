import { useCallback, useEffect, useState } from 'react';
import { Plus, Check, Ban, Trash2, Send, BadgeCheck, CircleDollarSign, X, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import { expenseApi } from '@/api/finance';
// [2026-09-19 工资打通] 报销人改「选员工」：从员工档案选取（未建档人员仍可手工填写）
import { employeeApi, type Employee } from '@/api/hr';
import { departmentApi } from '@/api/system';
import { SearchSelect } from '@/components/SearchSelect';
import { PaymentMethodSelect } from '@/components/PaymentMethodSelect';
import { format, toLocalDateISO } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import type { ReactNode } from 'react';
const STATUS_TEXT: Record<string, string> = {
  draft: '草稿', submitted: '待审批', approved: '已审批', paid: '已付款', rejected: '已驳回', cancelled: '已取消',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-yellow-50 text-yellow-700',
  submitted: 'bg-blue-50 text-blue-600',
  approved: 'bg-green-50 text-green-600',
  paid: 'bg-green-50 text-green-600',
  rejected: 'bg-red-50 text-red-600',
  cancelled: 'bg-gray-100 text-gray-500',
};
const TYPE_TEXT: Record<string, string> = { travel: '差旅', entertainment: '招待', office: '办公', other: '其他' };

interface ExpenseLine { expense_type: string; description: string; amount: string; }
interface ExpenseClaim { id: string; claim_no: string; employee_name: string; department?: string; claim_date: string; total_amount: string; status: string; payment_status?: string; edges?: { lines?: any[] }; }

export function ExpenseClaims() {
  // [2026-09-18 权限细化] 新增=expense_create；提交/审批/驳回/付款=expense_edit；删除=expense_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [list, setList] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [status, setStatus] = useState('');
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [open, setOpen] = useState(false);
  const [employee, setEmployee] = useState('');
  // [2026-09-19 工资打通] employee_id：选了员工档案时携带（服务端按档案回填姓名快照）
  const [employeeId, setEmployeeId] = useState('');
  const [emps, setEmps] = useState<Employee[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [department, setDepartment] = useState('');
  const [lines, setLines] = useState<ExpenseLine[]>([{ expense_type: 'travel', description: '', amount: '' }]);
  const [saving, setSaving] = useState(false);
  const [claimDate, setClaimDate] = useState(format.today());
  const [claimRemark, setClaimRemark] = useState('');

  // 标记付款弹窗（选付款方式）
  const [payClaim, setPayClaim] = useState<ExpenseClaim | null>(null);
  const [payMethod, setPayMethod] = useState('');
  const [paying, setPaying] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const res = await expenseApi.list({ page: pagination.page, page_size: pagination.page_size, claim_no: debouncedKeyword || undefined, status: status || undefined });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch { /* */ } finally { if (isCurrent(seq)) setLoading(false); } // [FIX-Rev] 仅最新请求结束才收起 loading
  }, [pagination.page, pagination.page_size, debouncedKeyword, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // [2026-09-19 工资打通] 新建弹窗打开时加载员工/部门下拉（独立请求失败留痕，不阻断其他）
  useEffect(() => {
    if (!open) return;
    if (emps.length === 0) {
      employeeApi.list({ page: 1, page_size: 200 }).then((res) => {
        if (res.code === 0) setEmps((res.data?.list ?? []).filter((e) => e.status !== 'left'));
      }).catch((err) => console.warn('员工列表加载失败', err));
    }
    if (depts.length === 0) {
      departmentApi.listAll().then((res) => {
        if (res.code === 0) setDepts(res.data ?? []);
      }).catch((err) => console.warn('部门列表加载失败', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, emps.length, depts.length]);

  const action = async (fn: () => Promise<any>, id: string, msg: string, danger = false, title?: string) => {
    if (title && !(await confirmAction({ title, danger }))) return;
    const res = await fn();
    if (res.code === 0) { message.success(msg); fetchList(); } else { message.error(res.message || msg); }
  };

  const handleCreate = async () => {
    if (!employee.trim()) { message.warning('请填写报销人'); return; }
    const items = lines.filter(l => parseFloat(l.amount) > 0).map(l => ({ expense_type: l.expense_type, description: l.description, amount: parseFloat(l.amount) }));
    if (items.length === 0) { message.warning('请至少填写一条明细'); return; }
    setSaving(true);
    try {
      const res = await expenseApi.create({ employee_id: employeeId || undefined, employee_name: employee, department, claim_date: toLocalDateISO(claimDate), remark: claimRemark, lines: items });
      if (res.code === 0) { message.success('报销单已创建'); setOpen(false); setEmployee(''); setEmployeeId(''); setClaimDate(format.today()); setClaimRemark(''); setLines([{ expense_type: 'travel', description: '', amount: '' }]); fetchList(); }
      else { message.error(res.message || '创建失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '创建失败'); } finally { setSaving(false); }
  };

  const handlePaid = async () => {
    if (!payClaim) return;
    setPaying(true);
    try {
      const res = await expenseApi.paid(payClaim.id, payMethod || undefined);
      if (res.code === 0) { message.success('已标记付款'); setPayClaim(null); setPayMethod(''); fetchList(); }
      else { message.error(res.message || '标记付款失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '标记付款失败'); } finally { setPaying(false); }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: any) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  // [2026-09-13 U-05] 批量审批/驳回：逐条执行（每条都走完整状态机与自动过账）+ 失败原因汇总 + 导出选中
  const sel = useRowSelection({ rows: list, getKey: (c) => c.id });
  const batch = useBatchAction({
    selection: sel,
    label: (c) => c.claim_no || c.id,
    onDone: fetchList,
    actions: [
      {
        key: 'approve',
        label: '批量审批',
        icon: <Check className="w-4 h-4" />,
        eligible: (c) => c.status === 'submitted' && has('expense_edit'),
        confirm: (rows) => ({ title: `确定审批通过选中的 ${rows.length} 张报销单？`, content: '审批后将自动生成费用凭证（逐条过账），失败的会列出单号与原因' }),
        run: (c) => expenseApi.approve(c.id),
      },
      {
        key: 'reject',
        label: '批量驳回',
        icon: <X className="w-4 h-4" />,
        danger: true,
        eligible: (c) => c.status === 'submitted' && has('expense_edit'),
        confirm: (rows) => ({ title: `确定驳回选中的 ${rows.length} 张报销单？`, content: '驳回后退回报销人修改；失败的会列出单号与原因', danger: true }),
        run: (c) => expenseApi.reject(c.id),
      },
    ],
    exportSpec: {
      filename: `费用报销_选中_${format.today()}.csv`,
      headers: ['单号', '报销人', '部门', '日期', '金额', '状态'],
      row: (c) => [c.claim_no, c.employee_name || '', c.department || '', format.date(c.claim_date), Number(c.total_amount || 0).toFixed(2), format.statusText(c.status)],
    },
  });
  const rowCols: RowCol[] = [
    {
      key: '__sel',
      header: (
        <input
          type="checkbox"
          className="w-4 h-4 accent-blue-600"
          checked={sel.state === 'all'}
          ref={(el) => { if (el) el.indeterminate = sel.state === 'some'; }}
          onChange={sel.toggleAll}
          title="全选本页"
        />
      ),
      headCls: 'px-4 py-3 w-10',
      cellCls: 'px-4 py-4',
      cell: (c) => (
        <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={sel.isSelected(c)} onChange={() => sel.toggle(c)} />
      ),
    },
    { key: 'claim_no', header: '单号', cell: (c) => <span className="font-medium text-gray-900">{c.claim_no}</span> },
    { key: 'employee_name', header: '报销人', cell: (c) => <span className="text-gray-900">{c.employee_name}</span> },
    { key: 'department', header: '部门', cell: (c) => <span className="text-gray-500 text-sm">{c.department || '-'}</span> },
    { key: 'claim_date', header: '日期', cell: (c) => <span className="text-gray-500 text-sm">{format.date(c.claim_date)}</span> },
    { key: 'total_amount', header: '金额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (c) => <span className="font-medium text-gray-900">¥{format.currency(parseFloat(c.total_amount))}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (c) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[c.status] || 'bg-gray-100'}`}>{STATUS_TEXT[c.status] || c.status}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (c) => (
        // [易用性] 行操作统一折叠；确认文案仍在 action() 内
        <>
          <RowActions
            actions={[
              { key: 'print', label: '打印报销单', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/expense_claim/${c.id}`) },
              ...(c.status === 'draft' && has('expense_edit')
                ? [
                    { key: 'submit', label: '提交', icon: <Send className="w-4 h-4" />, onClick: () => action(() => expenseApi.submit(c.id), c.id, '已提交审批', false, `提交报销单 ${c.claim_no}？`) },
                    { key: 'cancel', label: '取消', icon: <Ban className="w-4 h-4" />, onClick: () => action(() => expenseApi.cancel(c.id), c.id, '已取消') },
                  ]
                : []),
              ...(c.status === 'draft' && has('expense_delete')
                ? [
                    { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => action(() => expenseApi.remove(c.id), c.id, '已删除', true) },
                  ]
                : []),
              ...(c.status === 'submitted' && has('expense_edit')
                ? [
                    { key: 'approve', label: '审批', icon: <Check className="w-4 h-4" />, onClick: () => action(() => expenseApi.approve(c.id), c.id, '已审批并自动过账', false, `审批通过 ${c.claim_no}？将生成费用凭证`) },
                    { key: 'reject', label: '驳回', icon: <X className="w-4 h-4" />, danger: true, onClick: () => action(() => expenseApi.reject(c.id), c.id, '已驳回') },
                  ]
                : []),
              ...(c.status === 'approved' && has('expense_edit')
                ? [{ key: 'pay', label: '标记付款', icon: <CircleDollarSign className="w-4 h-4" />, onClick: () => { setPayClaim(c); setPayMethod(''); } }]
                : []),
            ]}
          />
          <BadgeCheck className="w-4 h-4 text-gray-300" />
        </>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'expense-claim-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="费用报销"
        subtitle="员工费用报销：提交审批、自动过账、付款登记"
        extra={
          has('expense_create') && (
            <button onClick={() => setOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /><span className="hidden md:inline">新增报销</span>
            </button>
          )
        }
      />
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <input type="text" placeholder="搜索报销单号..." value={keyword} onChange={(e) => { setKeyword(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:max-w-xs" />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部状态</option>
            {Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="ml-auto flex items-center">{viewMenu}</div>
        </div>
        {/* [2026-09-13 U-05] 批量工具条（勾选后出现；失败汇总弹窗必须独立渲染） */}
        {sel.count > 0 && <div className="px-4 pb-3">{batch.bar}</div>}
        {batch.failureModal}
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
              {loading ? (<tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>)
                : list.length === 0 ? (<tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无报销单" /></td></tr>)
                : list.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((col) => (
                      <td key={col.key} className={col.cellCls || TD}>
                        {col.cell(c)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total} onPageChange={(page) => setPagination(p => ({ ...p, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        </div>
      </div>

      <Modal title="新增费用报销" open={open} onCancel={() => setOpen(false)} onOk={handleCreate} confirmLoading={saving} okText="创建" cancelText="取消" width={640}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">报销人 *</label>
              <SearchSelect
                value={employeeId || undefined}
                onChange={(v: unknown) => {
                  const id = typeof v === 'string' ? v : '';
                  setEmployeeId(id);
                  const e = emps.find((x) => x.id === id);
                  if (e) {
                    setEmployee(e.name);
                    if (!department && e.department_id) setDepartment(depts.find((d) => d.id === e.department_id)?.name || '');
                  } else {
                    setEmployee('');
                  }
                }}
                options={emps.map((e) => ({ label: `${e.name}（${e.code}）`, value: e.id, search: `${e.name} ${e.code}` }))}
                placeholder="请选择员工（未建档人员可在下方手工填写）"
                allowClear
              />
              {!employeeId && (<Input value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="未建档人员可手工填写，如：张三" className="mt-2" />)}
            </div>
            <div><label className="block text-sm text-gray-600 mb-1">部门</label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="如：销售部" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">报销日期</label>
              <Input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">备注</label>
              <Input value={claimRemark} onChange={(e) => setClaimRemark(e.target.value)} placeholder="请输入备注" /></div>
          </div>
          <div className="text-sm text-gray-600">报销明细</div>
          {lines.map((l, idx) => (
            <div key={idx} className="flex gap-2">
              <select value={l.expense_type} onChange={(e) => { const ns = [...lines]; ns[idx] = { ...ns[idx], expense_type: e.target.value }; setLines(ns); }} className="form-input w-32">
                {Object.entries(TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <Input placeholder="说明" value={l.description} onChange={(e) => { const ns = [...lines]; ns[idx] = { ...ns[idx], description: e.target.value }; setLines(ns); }} />
              <Input type="number" placeholder="金额" value={l.amount} onChange={(e) => { const ns = [...lines]; ns[idx] = { ...ns[idx], amount: e.target.value }; setLines(ns); }} style={{ width: 120 }} />
              {lines.length > 1 && <button onClick={() => setLines(lines.filter((_, i) => i !== idx))} className="text-red-500">✕</button>}
            </div>
          ))}
          <button onClick={() => setLines([...lines, { expense_type: 'travel', description: '', amount: '' }])} className="text-sm text-blue-600">+ 添加明细</button>
        </div>
      </Modal>

      {/* 标记付款：选择付款方式（可配置字典 + 可手输） */}
      <Modal
        title={`标记付款 — ${payClaim?.claim_no || ''}`}
        open={!!payClaim}
        onCancel={() => { if (!paying) setPayClaim(null); }}
        onOk={handlePaid}
        confirmLoading={paying}
        okText="确认付款"
        cancelText="取消"
        width={480}
      >
        {payClaim && (
          <div className="space-y-3 py-2">
            <div className="text-sm text-gray-600">
              报销人：<b>{payClaim.employee_name}</b>
              {'　'}金额：<b>¥{format.currency(parseFloat(payClaim.total_amount))}</b>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">付款方式</label>
              <PaymentMethodSelect
                value={payMethod}
                onChange={(v) => setPayMethod(v || '')}
                placeholder="请选择或输入付款方式"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
