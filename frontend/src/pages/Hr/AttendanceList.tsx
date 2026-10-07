import { useCallback, useEffect, useState } from 'react';
import { Plus, Check, Ban, Trash2, Send, X, Pencil, CalendarDays } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import {
  attendanceApi, AttendanceRequest, AttendanceSummaryItem,
  ATTENDANCE_STATUS_TEXT, ATTENDANCE_STATUS_COLOR, ATTENDANCE_TYPE_TEXT,
  LEAVE_CATEGORY_TEXT, OVERTIME_CATEGORY_TEXT,
} from '@/api/hr';
import { employeeApi, type Employee } from '@/api/hr';
import { departmentApi } from '@/api/system';
import { SearchSelect } from '@/components/SearchSelect';
import { format, toLocalDateISO } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import type { ReactNode } from 'react';

/**
 * 请假/加班（轻量考勤，2026-09-19 人事第三批②）
 *
 * 请假与加班申请：草稿→提交→审批（通过/驳回/取消）；员工优先从员工档案选择（未建档可手输）；
 * 「月度汇总」按员工聚合已通过单的请假天数/加班小时（工资联动基础）。
 */
export function AttendanceList() {
  // [权限] 新增=attendance_create；提交/审批/编辑=attendance_edit；删除=attendance_delete
  const { has } = usePermission();
  const [list, setList] = useState<AttendanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', status: '', request_type: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [requestType, setRequestType] = useState(String(urlFilters.request_type || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  useEffect(() => {
    syncUrl({ keyword, status, request_type: requestType, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, status, requestType, pagination.page, pagination.page_size]);

  // 新建/编辑弹窗
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [employee, setEmployee] = useState('');
  const [department, setDepartment] = useState('');
  const [formType, setFormType] = useState('leave');
  const [category, setCategory] = useState('');
  const [startDate, setStartDate] = useState(format.today());
  const [endDate, setEndDate] = useState('');
  const [days, setDays] = useState('1');
  const [hours, setHours] = useState('1');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [emps, setEmps] = useState<Employee[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);

  // 月度汇总
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryPeriod, setSummaryPeriod] = useState(format.today().slice(0, 7));
  const [summaryItems, setSummaryItems] = useState<AttendanceSummaryItem[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await attendanceApi.list({
        page: pagination.page, page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined, status: status || undefined, request_type: requestType || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch { /* 拦截器已提示 */ } finally { if (isCurrent(seq)) setLoading(false); }
  }, [pagination.page, pagination.page_size, debouncedKeyword, status, requestType, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // 弹窗打开时加载员工/部门下拉（独立请求失败留痕，不阻断其他）
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

  const resetForm = () => {
    setEditId('');
    setEmployeeId(''); setEmployee(''); setDepartment('');
    setFormType('leave'); setCategory('');
    setStartDate(format.today()); setEndDate('');
    setDays('1'); setHours('1'); setReason('');
  };

  const openEdit = (rec: AttendanceRequest) => {
    setEditId(rec.id);
    setEmployeeId(rec.employee_id || ''); setEmployee(rec.employee_name || ''); setDepartment(rec.department || '');
    setFormType(rec.request_type); setCategory(rec.category || '');
    setStartDate(rec.start_date ? format.date(rec.start_date) : format.today());
    setEndDate(rec.end_date ? format.date(rec.end_date) : '');
    setDays(rec.request_type === 'leave' ? String(parseFloat(rec.days || '0') || 1) : '1');
    setHours(rec.request_type === 'overtime' ? String(parseFloat(rec.hours || '0') || 1) : '1');
    setReason(rec.reason || '');
    setOpen(true);
  };

  const handleSave = async () => {
    if (!employee.trim()) { message.warning('请选择员工或填写姓名'); return; }
    if (!startDate) { message.warning('请选择开始日期'); return; }
    if (endDate && endDate < startDate) { message.warning('结束日期不能早于开始日期'); return; }
    if (formType === 'leave' && !(parseFloat(days) > 0)) { message.warning('请假天数必须大于 0'); return; }
    if (formType === 'overtime' && !(parseFloat(hours) > 0)) { message.warning('加班小时数必须大于 0'); return; }
    setSaving(true);
    try {
      const payload = {
        employee_id: employeeId || undefined,
        employee_name: employee,
        department,
        request_type: formType,
        category,
        start_date: toLocalDateISO(startDate),
        end_date: toLocalDateISO(endDate),
        days: formType === 'leave' ? (parseFloat(days) || 0) : 0,
        hours: formType === 'overtime' ? (parseFloat(hours) || 0) : 0,
        reason,
      };
      const res = editId ? await attendanceApi.update(editId, payload) : await attendanceApi.create(payload);
      if (res.code === 0) {
        message.success(editId ? '已更新' : '已创建');
        setOpen(false); resetForm(); fetchList();
      } else { message.error(res.message || '保存失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setSaving(false); }
  };

  const action = async (fn: () => Promise<any>, msg: string, title?: string, danger = false) => {
    if (title && !(await confirmAction({ title, danger }))) return;
    try {
      const res = await fn();
      if (res.code === 0) { message.success(msg); fetchList(); } else { message.error(res.message || msg); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : msg); }
  };

  const loadSummary = async (period: string) => {
    setSummaryLoading(true);
    try {
      const res = await attendanceApi.summary(period);
      if (res.code === 0) setSummaryItems(res.data ?? []);
      else message.error(res.message || '汇总加载失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '汇总加载失败'); } finally { setSummaryLoading(false); }
  };

  const openSummary = () => {
    setSummaryOpen(true);
    loadSummary(summaryPeriod);
  };

  // [U-05] 批量审批/驳回：逐条执行（每条都走完整状态机）+ 失败原因汇总
  const sel = useRowSelection({ rows: list, getKey: (c) => c.id });
  const batch = useBatchAction({
    selection: sel,
    label: (c) => c.code || c.id,
    onDone: fetchList,
    actions: [
      {
        key: 'approve',
        label: '批量审批',
        icon: <Check className="w-4 h-4" />,
        eligible: (c) => c.status === 'submitted' && has('attendance_edit'),
        confirm: (rows) => ({ title: `确定审批通过选中的 ${rows.length} 条考勤申请？`, content: '通过的将从月度汇总中计入；失败的会列出单号与原因' }),
        run: (c) => attendanceApi.approve(c.id),
      },
      {
        key: 'reject',
        label: '批量驳回',
        icon: <X className="w-4 h-4" />,
        eligible: (c) => c.status === 'submitted' && has('attendance_edit'),
        confirm: (rows) => ({ title: `确定驳回选中的 ${rows.length} 条考勤申请？`, content: '驳回后退回申请人修改；失败的会列出单号与原因', danger: true }),
        run: (c) => attendanceApi.reject(c.id),
      },
    ],
    exportSpec: {
      filename: `考勤申请_选中_${format.today()}.csv`,
      headers: ['单号', '员工', '部门', '类型', '开始日期', '数量', '状态'],
      row: (c) => [
        c.code, c.employee_name || '', c.department || '', ATTENDANCE_TYPE_TEXT[c.request_type] || c.request_type,
        format.date(c.start_date),
        c.request_type === 'leave' ? `${parseFloat(c.days || '0')} 天` : `${parseFloat(c.hours || '0')} 小时`,
        ATTENDANCE_STATUS_TEXT[c.status] || c.status,
      ],
    },
  });

  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: AttendanceRequest) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
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
    { key: 'code', header: '单号', cell: (c) => <span className="font-medium text-gray-900">{c.code}</span> },
    { key: 'employee_name', header: '员工', cell: (c) => <span className="text-gray-900">{c.employee_name}</span> },
    { key: 'department', header: '部门', cell: (c) => <span className="text-gray-500 text-sm">{c.department || '-'}</span> },
    {
      key: 'request_type',
      header: '类型',
      cell: (c) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.request_type === 'leave' ? 'bg-purple-50 text-purple-600' : 'bg-orange-50 text-orange-600'}`}>
          {ATTENDANCE_TYPE_TEXT[c.request_type] || c.request_type}
        </span>
      ),
    },
    {
      key: 'category',
      header: '细分',
      cell: (c) => (
        <span className="text-gray-600 text-sm">
          {(c.request_type === 'leave' ? LEAVE_CATEGORY_TEXT[c.category || ''] : OVERTIME_CATEGORY_TEXT[c.category || '']) || '-'}
        </span>
      ),
    },
    { key: 'start_date', header: '开始日期', cell: (c) => <span className="text-gray-500 text-sm">{format.date(c.start_date)}</span> },
    {
      key: 'quantity',
      header: '数量',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (c) => (
        <span className="font-medium text-gray-900">
          {c.request_type === 'leave' ? `${parseFloat(c.days || '0')} 天` : `${parseFloat(c.hours || '0')} 小时`}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (c) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${ATTENDANCE_STATUS_COLOR[c.status] || 'bg-gray-100'}`}>{ATTENDANCE_STATUS_TEXT[c.status] || c.status}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (c) => (
        <RowActions
          actions={[
            ...(c.status === 'draft' && has('attendance_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(c) }]
              : []),
            ...(c.status === 'draft' && has('attendance_edit')
              ? [{ key: 'submit', label: '提交', icon: <Send className="w-4 h-4" />, onClick: () => action(() => attendanceApi.submit(c.id), '已提交审批', `提交考勤申请 ${c.code}？`) }]
              : []),
            ...(c.status === 'submitted' && has('attendance_edit')
              ? [
                  { key: 'approve', label: '审批', icon: <Check className="w-4 h-4" />, onClick: () => action(() => attendanceApi.approve(c.id), '已审批通过', `审批通过 ${c.code}？`) },
                  { key: 'reject', label: '驳回', icon: <X className="w-4 h-4" />, danger: true, onClick: () => action(() => attendanceApi.reject(c.id), '已驳回', `驳回考勤申请 ${c.code}？`, true) },
                ]
              : []),
            ...(c.status === 'draft' && has('attendance_edit')
              ? [{ key: 'cancel', label: '取消', icon: <Ban className="w-4 h-4" />, onClick: () => action(() => attendanceApi.cancel(c.id), '已取消') }]
              : []),
            ...((c.status === 'draft' || c.status === 'cancelled') && has('attendance_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => action(() => attendanceApi.remove(c.id), '已删除', `删除考勤申请 ${c.code}？`, true) }]
              : []),
          ]}
        />
      ),
    },
  ];
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'attendance-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  const filterNote = [status && `状态「${ATTENDANCE_STATUS_TEXT[status] || status}」`, requestType && `类型「${ATTENDANCE_TYPE_TEXT[requestType] || requestType}」`].filter(Boolean).join(' + ') || undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="请假/加班"
        subtitle="轻量考勤：请假与加班申请提交审批，支持按月汇总（工资联动基础）"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={openSummary} className="btn-secondary flex items-center gap-2">
              <CalendarDays className="w-5 h-5" /><span className="hidden md:inline">月度汇总</span>
            </button>
            {has('attendance_create') && (
              <button onClick={() => { resetForm(); setOpen(true); }} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" /><span className="hidden md:inline">新建申请</span>
              </button>
            )}
          </div>
        }
      />
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <input type="text" placeholder="搜索单号 / 员工姓名..." value={keyword} onChange={(e) => { setKeyword(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:max-w-xs" />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:w-36">
            <option value="">全部状态</option>
            {Object.entries(ATTENDANCE_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={requestType} onChange={(e) => { setRequestType(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:w-32">
            <option value="">全部类型</option>
            {Object.entries(ATTENDANCE_TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="ml-auto flex items-center">{viewMenu}</div>
        </div>
        {/* [U-05] 批量工具条（勾选后出现；失败汇总弹窗必须独立渲染） */}
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
                : list.length === 0 ? (
                  <tr><td colSpan={visibleColumns.length} className="px-6">
                    <ListEmpty
                      keyword={keyword}
                      filterNote={filterNote}
                      onClear={() => { setKeyword(''); setStatus(''); setRequestType(''); setPagination(p => ({ ...p, page: 1 })); }}
                      title="暂无考勤申请"
                      description="点击右上角「新建申请」录入请假或加班"
                    />
                  </td></tr>
                )
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

      <Modal title={editId ? '编辑考勤申请' : '新建考勤申请'} open={open} onCancel={() => setOpen(false)} onOk={handleSave} confirmLoading={saving} okText={editId ? '保存' : '创建'} cancelText="取消" width={640}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">员工 *</label>
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
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="如：生产部" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">申请类型 *</label>
              <select value={formType} onChange={(e) => { setFormType(e.target.value); setCategory(''); }} className="form-input w-full">
                {Object.entries(ATTENDANCE_TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="block text-sm text-gray-600 mb-1">类型细分</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="form-input w-full">
                <option value="">请选择</option>
                {Object.entries(formType === 'leave' ? LEAVE_CATEGORY_TEXT : OVERTIME_CATEGORY_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">开始日期 *</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">{formType === 'leave' ? '结束日期' : '结束日期（可空）'}</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
            {formType === 'leave' ? (
              <div><label className="block text-sm text-gray-600 mb-1">请假天数 *</label>
                <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} placeholder="支持 0.5 天" /></div>
            ) : (
              <div><label className="block text-sm text-gray-600 mb-1">加班小时 *</label>
                <Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="如：4.5" /></div>
            )}
          </div>
          <div><label className="block text-sm text-gray-600 mb-1">事由</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请输入请假/加班事由" /></div>
        </div>
      </Modal>

      {/* 月度汇总（已通过单：请假天数/加班小时，工资联动基础） */}
      <Modal title="月度考勤汇总" open={summaryOpen} onCancel={() => setSummaryOpen(false)} footer={null} width={640}>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <Input type="month" value={summaryPeriod} onChange={(e) => setSummaryPeriod(e.target.value)} style={{ width: 180 }} />
            <button onClick={() => loadSummary(summaryPeriod)} disabled={summaryLoading} className="btn-secondary text-sm disabled:opacity-50">{summaryLoading ? '加载中…' : '查询'}</button>
            <span className="text-xs text-gray-400">仅统计「已通过」的申请（按开始日期归属月份）</span>
          </div>
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {['员工', '请假（天）', '请假次数', '加班（小时）', '加班次数'].map((h) => (
                    <th key={h} className="px-4 py-2 text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summaryLoading ? (
                  <tr><td colSpan={5} className="px-4 py-4"><TableSkeleton rows={3} /></td></tr>
                ) : summaryItems.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">该月暂无已通过的考勤申请</td></tr>
                ) : (
                  summaryItems.map((it, i) => (
                    <tr key={it.employee_id || `${it.employee_name}-${i}`}>
                      <td className="px-4 py-2 text-sm text-gray-900">{it.employee_name}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{parseFloat(it.leave_days || '0')}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{it.leave_count}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{parseFloat(it.overtime_hours || '0')}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{it.overtime_count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
