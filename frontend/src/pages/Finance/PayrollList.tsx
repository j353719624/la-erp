import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Check, Eye, UserPlus, Calculator } from 'lucide-react';
import { Modal, Input, Select } from 'antd';
import { message } from '@/utils/appMessage';
import { payrollApi } from '@/api/finance';
import { employeeApi, type Employee } from '@/api/hr';
import { pieceworkApi } from '@/api/hr';
import { departmentApi } from '@/api/system';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';
import { RowActions } from '@/components/RowActions';
import { confirmAction } from '@/utils/confirm';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';

const STATUS_TEXT: Record<string, string> = { draft: '草稿', confirmed: '已确认' };
const STATUS_COLOR: Record<string, string> = { draft: 'bg-yellow-50 text-yellow-700', confirmed: 'bg-green-50 text-green-600' };

interface Payroll { id: string; batch_no: string; period: string; status: string; total_amount: string; remark?: string; edges?: { items?: any[] }; }
// [2026-09-19 工资打通] employee_id：从员工档案带入的行携带（服务端按档案回填姓名/部门快照）
interface Item { employee_id?: string; employee_name: string; department: string; base_salary: string; bonus: string; allowance: string; deduction: string; }
interface DeptOption { id: string; name: string; }

export function PayrollList() {
  // [2026-09-18 权限细化] 新建=payroll_create；确认计提=payroll_edit；删除=payroll_delete
  const { has } = usePermission();
  const [list, setList] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 页码写入 URL（刷新/发链接保留当前页）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 页码变化 → 写回 URL
  useEffect(() => {
    syncUrl({ page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.page_size]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [period, setPeriod] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<Item[]>([{ employee_name: '', department: '', base_salary: '', bonus: '', allowance: '', deduction: '' }]);
  // [2026-09-19 工资打通] 「从员工档案带入」：部门筛选 + 在职员工列表
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [fillDept, setFillDept] = useState('');
  const [fillLoading, setFillLoading] = useState(false);
  // [2026-09-19 计件薪酬] 「从计件汇总带入」：按期间拉月度汇总，金额累计到「奖金」栏
  const [pieceLoading, setPieceLoading] = useState(false);
  const [detail, setDetail] = useState<Payroll | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // 请求竞态守卫：快速翻页时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams = { page: pagination.page, page_size: pagination.page_size };
      const res = await payrollApi.list(params);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []); setPagination(p => ({ ...p, total: res.data?.total ?? 0 }));
      }
    } catch { /* */ } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const netOf = (i: Item) => (parseFloat(i.base_salary) || 0) + (parseFloat(i.bonus) || 0) + (parseFloat(i.allowance) || 0) - (parseFloat(i.deduction) || 0);

  // [2026-09-19 工资打通] 新建弹窗打开时加载部门下拉（独立请求失败留痕，不阻断其他）
  useEffect(() => {
    if (!open || depts.length > 0) return;
    departmentApi.listAll().then((res) => {
      if (res.code === 0) setDepts(res.data ?? []);
    }).catch((err) => console.warn('部门列表加载失败', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, depts.length]);

  // [2026-09-19 工资打通] 一键带入：选部门 → 拉在职员工 → 按姓名去重追加（带基本工资/部门快照）
  const handleFillFromHr = async () => {
    setFillLoading(true);
    try {
      const res = await employeeApi.list({ page: 1, page_size: 200, department_id: fillDept || undefined });
      if (res.code !== 0) { message.error(res.message || '员工档案加载失败'); return; }
      const emps = (res.data?.list ?? []).filter((e: Employee) => e.status !== 'left');
      if (emps.length === 0) { message.warning('该范围内没有在职员工，请先在「人事管理 → 员工档案」建档'); return; }
      const deptNameOf = (id?: string | null) => depts.find((d) => d.id === id)?.name || '';
      const next = [...items];
      const seen = new Set(next.map((i) => i.employee_name.trim()).filter(Boolean));
      let added = 0;
      let skipped = 0;
      for (const e of emps) {
        if (seen.has(e.name.trim())) { skipped++; continue; }
        seen.add(e.name.trim());
        const salary = e.base_salary != null && e.base_salary !== '' && !Number.isNaN(parseFloat(e.base_salary)) ? String(parseFloat(e.base_salary)) : '';
        next.push({ employee_id: e.id, employee_name: e.name, department: deptNameOf(e.department_id), base_salary: salary, bonus: '', allowance: '', deduction: '' });
        added++;
      }
      // 清掉全空的占位行（至少保留一行）
      const cleaned = next.filter((i) => i.employee_name.trim() || i.department || i.base_salary || i.bonus || i.allowance || i.deduction);
      setItems(cleaned.length > 0 ? cleaned : next);
      message.success(`已带入 ${added} 人${skipped > 0 ? `，跳过同名 ${skipped} 人` : ''}`);
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '员工档案加载失败');
    } finally {
      setFillLoading(false);
    }
  };

  // [2026-09-19 计件薪酬] 从计件汇总带入：按「员工ID/姓名」合并，金额累加到奖金栏（不覆盖手工填写的基本工资）
  const handleFillFromPiecework = async () => {
    if (!/^\d{4}-\d{2}$/.test(period)) { message.warning('请先填写期间（YYYY-MM），计件汇总按该期间统计'); return; }
    setPieceLoading(true);
    try {
      const res = await pieceworkApi.summary(period);
      if (res.code !== 0) { message.error(res.message || '计件汇总加载失败'); return; }
      const rows = (res.data ?? []).filter((r) => parseFloat(r.total_amount || '0') > 0);
      if (rows.length === 0) { message.warning('该期间没有计件登记金额，请先在「人事管理 → 计件工资」登记'); return; }
      const next = [...items];
      let added = 0;
      let merged = 0;
      for (const r of rows) {
        const amount = parseFloat(r.total_amount || '0');
        const hit = next.findIndex((i) =>
          (r.employee_id && i.employee_id === r.employee_id) ||
          (i.employee_name.trim() && i.employee_name.trim() === r.employee_name.trim())
        );
        if (hit >= 0) {
          const base = parseFloat(next[hit].bonus) || 0;
          next[hit] = { ...next[hit], bonus: String(Math.round((base + amount) * 100) / 100) };
          merged++;
        } else {
          next.push({
            employee_id: r.employee_id || undefined, employee_name: r.employee_name,
            department: r.department || '', base_salary: '',
            bonus: String(Math.round(amount * 100) / 100), allowance: '', deduction: '',
          });
          added++;
        }
      }
      const cleaned = next.filter((i) => i.employee_name.trim() || i.department || i.base_salary || i.bonus || i.allowance || i.deduction);
      setItems(cleaned.length > 0 ? cleaned : next);
      message.success(`已带入 ${added + merged} 人计件金额（累计到「奖金」栏，合并同名 ${merged} 人）`);
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '计件汇总加载失败');
    } finally {
      setPieceLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!/^\d{4}-\d{2}$/.test(period)) { message.warning('请填写期间（YYYY-MM）'); return; }
    const its = items.filter(i => i.employee_name.trim()).map(i => ({ employee_id: i.employee_id || undefined, employee_name: i.employee_name, department: i.department, base_salary: parseFloat(i.base_salary) || 0, bonus: parseFloat(i.bonus) || 0, allowance: parseFloat(i.allowance) || 0, deduction: parseFloat(i.deduction) || 0 }));
    if (its.length === 0) { message.warning('请至少填写一名员工'); return; }
    setSaving(true);
    try {
      const res = await payrollApi.create({ period, remark, items: its });
      if (res.code === 0) { message.success('工资批次已创建'); setOpen(false); setRemark(''); setItems([{ employee_name: '', department: '', base_salary: '', bonus: '', allowance: '', deduction: '' }]); fetchList(); } else { message.error(res.message || '创建失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '创建失败'); } finally { setSaving(false); }
  };

  const handleConfirm = async (p: Payroll) => {
    if (!(await confirmAction({ title: `确认工资批次 ${p.batch_no}？`, content: '确认后将生成工资计提凭证（借费用贷应付职工薪酬）' }))) return;
    const res = await payrollApi.confirm(p.id);
    if (res.code === 0) { message.success('已确认并计提'); fetchList(); } else { message.error(res.message || '确认失败'); }
  };

  const handleDelete = async (p: Payroll) => {
    if (!(await confirmAction({ title: `删除工资批次 ${p.batch_no}？`, danger: true }))) return;
    const res = await payrollApi.remove(p.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); } else { message.error(res.message || '删除失败'); }
  };

  const viewDetail = async (p: Payroll) => {
    setDetailOpen(true);
    const res = await payrollApi.get(p.id);
    if (res.code === 0) setDetail(res.data);
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Payroll) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'batch_no', header: '批次号', cell: (p) => <span className="font-medium text-gray-900">{p.batch_no}</span> },
    { key: 'period', header: '期间', cell: (p) => <span className="text-gray-600">{p.period}</span> },
    { key: 'total_amount', header: '应发合计', headCls: TH_R, cellCls: `${TD} text-right`, cell: (p) => <span className="font-medium text-gray-900">¥{format.currency(parseFloat(p.total_amount))}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (p) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[p.status] || ''}`}>{STATUS_TEXT[p.status] || p.status}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (p) => (
        // [易用性] 行操作统一折叠；确认/删除的确认仍在 handler（confirmAction）内
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => viewDetail(p) },
            ...(p.status === 'draft' && has('payroll_edit')
              ? [
                  { key: 'confirm', label: '确认计提', icon: <Check className="w-4 h-4" />, onClick: () => handleConfirm(p) },
                ]
              : []),
            ...(p.status === 'draft' && has('payroll_delete')
              ? [
                  { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(p) },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'payroll-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="工资核算"
        subtitle="按月工资批次：确认后自动生成计提凭证"
        extra={
          has('payroll_create') && (
            <button onClick={() => setOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /><span className="hidden md:inline">新建批次</span>
            </button>
          )
        }
      />
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center justify-end">
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
              {loading ? (<tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>)
                : list.length === 0 ? (<tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty title="暂无工资批次" description="点击右上角「新建批次」录入员工工资" /></td></tr>)
                : list.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(p)}
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

      <Modal title="新建工资批次" open={open} onCancel={() => setOpen(false)} onOk={handleCreate} confirmLoading={saving} okText="创建" cancelText="取消" width={760}>
        <div className="space-y-3 py-2">
          <div className="flex gap-2">
            <Input placeholder="期间（YYYY-MM）*" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 180 }} />
            <Input placeholder="备注（可选）" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">员工工资</div>
            <div className="flex items-center gap-2">
              <Select
                size="small"
                value={fillDept || undefined}
                onChange={(v) => setFillDept(v || '')}
                placeholder="全部部门"
                allowClear
                style={{ width: 140 }}
                options={depts.map((d) => ({ label: d.name, value: d.id }))}
              />
              <button onClick={handleFillFromHr} disabled={fillLoading} className="text-sm text-blue-600 disabled:opacity-50 flex items-center gap-1">
                <UserPlus className="w-4 h-4" />{fillLoading ? '带入中…' : '从员工档案带入'}
              </button>
              <button onClick={handleFillFromPiecework} disabled={pieceLoading} className="text-sm text-blue-600 disabled:opacity-50 flex items-center gap-1">
                <Calculator className="w-4 h-4" />{pieceLoading ? '带入中…' : '从计件汇总带入'}
              </button>
            </div>
          </div>
          {items.map((it, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <Input placeholder="员工" value={it.employee_name} onChange={(e) => { const ns = [...items]; ns[idx] = { ...ns[idx], employee_name: e.target.value }; setItems(ns); }} style={{ width: 120 }} />
              <Input placeholder="部门" value={it.department} onChange={(e) => { const ns = [...items]; ns[idx] = { ...ns[idx], department: e.target.value }; setItems(ns); }} style={{ width: 100 }} />
              <Input type="number" placeholder="基本工资" value={it.base_salary} onChange={(e) => { const ns = [...items]; ns[idx] = { ...ns[idx], base_salary: e.target.value }; setItems(ns); }} style={{ width: 110 }} />
              <Input type="number" placeholder="奖金" value={it.bonus} onChange={(e) => { const ns = [...items]; ns[idx] = { ...ns[idx], bonus: e.target.value }; setItems(ns); }} style={{ width: 90 }} />
              <Input type="number" placeholder="补贴" value={it.allowance} onChange={(e) => { const ns = [...items]; ns[idx] = { ...ns[idx], allowance: e.target.value }; setItems(ns); }} style={{ width: 90 }} />
              <Input type="number" placeholder="扣款" value={it.deduction} onChange={(e) => { const ns = [...items]; ns[idx] = { ...ns[idx], deduction: e.target.value }; setItems(ns); }} style={{ width: 90 }} />
              <span className="text-xs text-gray-400 w-16 text-right">净 {netOf(it)}</span>
              {items.length > 1 && <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-red-500">✕</button>}
            </div>
          ))}
          <button onClick={() => setItems([...items, { employee_name: '', department: '', base_salary: '', bonus: '', allowance: '', deduction: '' }])} className="text-sm text-blue-600">+ 添加员工</button>
        </div>
      </Modal>

      <Modal title={detail ? `工资批次 ${detail.batch_no}` : '批次详情'} open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={640}>
        {detail && (
          <div className="space-y-3">
            <div className="flex gap-4 text-sm">
              <span>期间 <b>{detail.period}</b></span>
              <span>应发合计 <b className="text-blue-600">¥{format.currency(parseFloat(detail.total_amount))}</b></span>
              <span>状态 <b>{STATUS_TEXT[detail.status] || detail.status}</b></span>
            </div>
            <table className="w-full min-w-max">
              <thead><tr className="bg-gray-50">
                <th className="px-4 py-2 text-left text-xs text-gray-500">员工</th>
                <th className="px-4 py-2 text-right text-xs text-gray-500">基本工资</th>
                <th className="px-4 py-2 text-right text-xs text-gray-500">奖金</th>
                <th className="px-4 py-2 text-right text-xs text-gray-500">补贴</th>
                <th className="px-4 py-2 text-right text-xs text-gray-500">扣款</th>
                <th className="px-4 py-2 text-right text-xs text-gray-500">实发</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {(detail.edges?.items ?? []).map((it: any) => (
                  <tr key={it.id}>
                    <td className="px-4 py-2 text-gray-900">{it.employee_name}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{format.currency(parseFloat(it.base_salary))}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{format.currency(parseFloat(it.bonus))}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{format.currency(parseFloat(it.allowance))}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{format.currency(parseFloat(it.deduction))}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900">{format.currency(parseFloat(it.net_pay))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
