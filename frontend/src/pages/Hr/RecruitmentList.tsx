import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, UserCheck, Briefcase, Users } from 'lucide-react';
import { Modal, Input, Select } from 'antd';
import { message } from '@/utils/appMessage';
import {
  recruitmentApi, RecruitmentPosition, RecruitmentCandidate,
  POSITION_STATUS_TEXT, POSITION_STATUS_COLOR, CANDIDATE_STATUS_TEXT, CANDIDATE_STATUS_COLOR,
  CANDIDATE_SOURCE_TEXT, INTERVIEW_RESULT_TEXT,
} from '@/api/hr';
import { departmentApi } from '@/api/system';
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
import type { ReactNode } from 'react';

/**
 * 招聘管理（2026-09-19 第四批①）
 *
 * 两个页签：
 *  - 招聘职位（ZP 编号）：部门/人数/薪资范围/状态（招聘中/暂停/关闭）；被候选人引用不可删
 *  - 候选人（YP 编号）：简历登记 + 面试记录（子表）+ 状态推进 + 「录用」一键转员工档案
 */
interface CandidateForm {
  id: string;
  name: string;
  phone: string;
  email: string;
  position_id: string;
  source: string;
  education: string;
  experience_years: string;
  expected_salary: string;
  status: string;
  remark: string;
}
interface InterviewRow { round: number; interview_date: string; interviewer: string; result: string; comment: string; }

const emptyCandidateForm = (): CandidateForm => ({
  id: '', name: '', phone: '', email: '', position_id: '', source: '', education: '',
  experience_years: '', expected_salary: '', status: 'new', remark: '',
});
const emptyInterview = (round: number): InterviewRow => ({ round, interview_date: format.today(), interviewer: '', result: 'pending', comment: '' });

export function RecruitmentList() {
  // [权限] 新增=recruitment_create；编辑/录用=recruitment_edit；删除=recruitment_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ tab: 'positions', keyword: '', status: '', page: 1, page_size: 10 });
  const [tab, setTab] = useState<'positions' | 'candidates'>(urlFilters.tab === 'candidates' ? 'candidates' : 'positions');
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  useEffect(() => {
    syncUrl({ tab, keyword, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, keyword, status, pagination.page, pagination.page_size]);

  const [positions, setPositions] = useState<RecruitmentPosition[]>([]);
  const [candidates, setCandidates] = useState<RecruitmentCandidate[]>([]);
  // 职位下拉选项（独立于职位页签的筛选结果，避免筛选后选项被裁）
  const [positionOptions, setPositionOptions] = useState<RecruitmentPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  // 职位表单
  const [posOpen, setPosOpen] = useState(false);
  const [posEditId, setPosEditId] = useState('');
  const [posForm, setPosForm] = useState({ title: '', department_id: '', headcount: '1', salary_min: '', salary_max: '', owner: '', requirements: '', status: 'open', remark: '' });
  // 候选人表单
  const [candOpen, setCandOpen] = useState(false);
  const [candForm, setCandForm] = useState<CandidateForm>(emptyCandidateForm());
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  // 录用弹窗
  const [hireCand, setHireCand] = useState<RecruitmentCandidate | null>(null);
  const [hireForm, setHireForm] = useState({ department_id: '', position: '', hire_date: format.today(), base_salary: '' });
  const [saving, setSaving] = useState(false);

  // 部门下拉（职位表单 + 录用弹窗共用；失败留痕不阻断）
  useEffect(() => {
    departmentApi.listAll().then((res) => {
      if (res.code === 0) setDepts(res.data ?? []);
    }).catch((err) => console.warn('部门列表加载失败', err));
  }, []);

  // 职位选项（候选人表单 + 列表辅助；失败留痕不阻断）
  const loadPositions = useCallback(() => {
    recruitmentApi.positionList({ page: 1, page_size: 100 }).then((res) => {
      if (res.code === 0) setPositionOptions(res.data?.list ?? []);
    }).catch((err) => console.warn('职位列表加载失败', err));
  }, []);
  useEffect(() => { loadPositions(); }, [loadPositions]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const params = { page: pagination.page, page_size: pagination.page_size, keyword: debouncedKeyword || undefined, status: status || undefined };
      if (tab === 'positions') {
        const res = await recruitmentApi.positionList(params);
        if (res.code === 0) {
          if (!isCurrent(seq)) return;
          setPositions(res.data?.list ?? []);
          setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
        }
      } else {
        const res = await recruitmentApi.candidateList(params);
        if (res.code === 0) {
          if (!isCurrent(seq)) return;
          setCandidates(res.data?.list ?? []);
          setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
        }
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '加载失败');
    } finally { if (isCurrent(seq)) setLoading(false); }
  }, [tab, pagination.page, pagination.page_size, debouncedKeyword, status, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const switchTab = (t: 'positions' | 'candidates') => {
    setTab(t); setKeyword(''); setStatus(''); setPagination(p => ({ ...p, page: 1 }));
  };

  const deptName = (id?: string | null) => depts.find((d) => d.id === id)?.name || '-';

  // ── 职位 ─────────────────────────────────────────────────────────────────
  const openPosCreate = () => {
    setPosEditId('');
    setPosForm({ title: '', department_id: '', headcount: '1', salary_min: '', salary_max: '', owner: '', requirements: '', status: 'open', remark: '' });
    setPosOpen(true);
  };
  const openPosEdit = (p: RecruitmentPosition) => {
    setPosEditId(p.id);
    setPosForm({
      title: p.title, department_id: p.department_id || '', headcount: String(p.headcount || 1),
      salary_min: p.salary_min != null ? String(parseFloat(p.salary_min)) : '',
      salary_max: p.salary_max != null ? String(parseFloat(p.salary_max)) : '',
      owner: p.owner || '', requirements: p.requirements || '', status: p.status, remark: p.remark || '',
    });
    setPosOpen(true);
  };
  const savePosition = async () => {
    if (!posForm.title.trim()) { message.warning('请填写职位名称'); return; }
    setSaving(true);
    try {
      const payload = {
        title: posForm.title, department_id: posForm.department_id || undefined,
        headcount: parseInt(posForm.headcount) || 1,
        salary_min: posForm.salary_min ? parseFloat(posForm.salary_min) : undefined,
        salary_max: posForm.salary_max ? parseFloat(posForm.salary_max) : undefined,
        owner: posForm.owner, requirements: posForm.requirements, status: posForm.status, remark: posForm.remark,
      };
      const res = posEditId ? await recruitmentApi.positionUpdate(posEditId, payload) : await recruitmentApi.positionCreate(payload);
      if (res.code === 0) { message.success(posEditId ? '已更新' : '已创建'); setPosOpen(false); fetchList(); loadPositions(); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setSaving(false); }
  };
  const removePosition = async (p: RecruitmentPosition) => {
    if (!(await confirmAction({ title: `删除职位 ${p.title}？`, content: '被候选人引用的职位无法删除（可改为「已关闭」保留历史）', danger: true }))) return;
    try {
      const res = await recruitmentApi.positionRemove(p.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); loadPositions(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };

  // ── 候选人 ───────────────────────────────────────────────────────────────
  const openCandCreate = () => {
    setCandForm(emptyCandidateForm());
    setInterviews([]);
    setCandOpen(true);
  };
  const openCandEdit = async (c: RecruitmentCandidate) => {
    setCandForm({
      id: c.id, name: c.name, phone: c.phone || '', email: c.email || '', position_id: c.position_id || '',
      source: c.source || '', education: c.education || '',
      experience_years: c.experience_years != null ? String(c.experience_years) : '',
      expected_salary: c.expected_salary != null ? String(parseFloat(c.expected_salary)) : '',
      status: c.status, remark: c.remark || '',
    });
    setInterviews([]);
    setCandOpen(true);
    try {
      const res = await recruitmentApi.candidateGet(c.id);
      const list = res.code === 0 ? (res.data?.edges?.interviews || []) : [];
      setInterviews(list.map((it, i) => ({
        round: it.round || i + 1, interview_date: it.interview_date ? format.date(it.interview_date) : format.today(),
        interviewer: it.interviewer || '', result: it.result || 'pending', comment: it.comment || '',
      })));
    } catch (err) { console.warn('面试记录加载失败', err); }
  };
  const saveCandidate = async () => {
    if (!candForm.name.trim()) { message.warning('请填写候选人姓名'); return; }
    setSaving(true);
    try {
      const payload = {
        name: candForm.name, phone: candForm.phone, email: candForm.email,
        position_id: candForm.position_id || undefined, source: candForm.source, education: candForm.education,
        experience_years: candForm.experience_years ? parseInt(candForm.experience_years) : undefined,
        expected_salary: candForm.expected_salary ? parseFloat(candForm.expected_salary) : undefined,
        status: candForm.status, remark: candForm.remark,
        interviews: interviews.map((it, i) => ({
          round: i + 1, interview_date: toLocalDateISO(it.interview_date || format.today()),
          interviewer: it.interviewer, result: it.result, comment: it.comment,
        })),
      };
      const res = candForm.id ? await recruitmentApi.candidateUpdate(candForm.id, payload) : await recruitmentApi.candidateCreate(payload);
      if (res.code === 0) { message.success(candForm.id ? '已更新' : '已登记'); setCandOpen(false); fetchList(); loadPositions(); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setSaving(false); }
  };
  const removeCandidate = async (c: RecruitmentCandidate) => {
    if (!(await confirmAction({ title: `删除候选人 ${c.name}（${c.code}）？`, danger: true }))) return;
    try {
      const res = await recruitmentApi.candidateRemove(c.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };
  const openHire = (c: RecruitmentCandidate) => {
    setHireCand(c);
    setHireForm({ department_id: c.position_id ? (positionOptions.find((p) => p.id === c.position_id)?.department_id || '') : '', position: c.position_title || '', hire_date: format.today(), base_salary: '' });
  };
  const submitHire = async () => {
    if (!hireCand) return;
    if (!hireForm.department_id) { message.warning('请选择入职部门'); return; }
    setSaving(true);
    try {
      const res = await recruitmentApi.candidateHire(hireCand.id, {
        department_id: hireForm.department_id, position: hireForm.position || undefined,
        hire_date: toLocalDateISO(hireForm.hire_date),
        base_salary: hireForm.base_salary ? parseFloat(hireForm.base_salary) : undefined,
      });
      if (res.code === 0) {
        const empCode = (res.data as { code?: string } | undefined)?.code || '';
        message.success(`已录用并建档${empCode ? `（工号 ${empCode}）` : ''}`);
        setHireCand(null); fetchList();
      } else message.error(res.message || '录用失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '录用失败'); } finally { setSaving(false); }
  };

  // ── 列定义 ───────────────────────────────────────────────────────────────
  interface RowCol<T> { key: string; header: ReactNode; headCls?: string; cellCls?: string; cell: (row: T) => ReactNode; }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';

  const positionCols: RowCol<RecruitmentPosition>[] = [
    { key: 'code', header: '编号', cell: (p) => <span className="font-medium text-gray-900">{p.code}</span> },
    { key: 'title', header: '职位', cell: (p) => <span className="text-gray-900">{p.title}</span> },
    { key: 'department', header: '部门', cell: (p) => <span className="text-gray-500 text-sm">{deptName(p.department_id)}</span> },
    { key: 'headcount', header: '招聘人数', headCls: TH_R, cellCls: `${TD} text-right`, cell: (p) => <span className="text-gray-700">{p.headcount}</span> },
    {
      key: 'salary', header: '薪资范围', headCls: TH_R, cellCls: `${TD} text-right`,
      cell: (p) => (
        <span className="text-gray-600 text-sm">
          {p.salary_min != null || p.salary_max != null
            ? `${p.salary_min != null ? `¥${format.currency(parseFloat(p.salary_min))}` : '面议'} ~ ${p.salary_max != null ? `¥${format.currency(parseFloat(p.salary_max))}` : '面议'}`
            : '面议'}
        </span>
      ),
    },
    { key: 'owner', header: '负责人', cell: (p) => <span className="text-gray-500 text-sm">{p.owner || '-'}</span> },
    {
      key: 'status', header: '状态',
      cell: (p) => <span className={`px-2 py-0.5 rounded text-xs font-medium ${POSITION_STATUS_COLOR[p.status] || 'bg-gray-100'}`}>{POSITION_STATUS_TEXT[p.status] || p.status}</span>,
    },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (p) => (
        <RowActions
          actions={[
            ...(has('recruitment_edit') ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openPosEdit(p) }] : []),
            ...(has('recruitment_delete') ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => removePosition(p) }] : []),
          ]}
        />
      ),
    },
  ];
  const candidateCols: RowCol<RecruitmentCandidate>[] = [
    { key: 'code', header: '编号', cell: (c) => <span className="font-medium text-gray-900">{c.code}</span> },
    { key: 'name', header: '姓名', cell: (c) => <span className="text-gray-900">{c.name}</span> },
    { key: 'position_title', header: '应聘职位', cell: (c) => <span className="text-gray-600 text-sm">{c.position_title || '-'}</span> },
    { key: 'source', header: '来源', cell: (c) => <span className="text-gray-500 text-sm">{c.source ? (CANDIDATE_SOURCE_TEXT[c.source] || c.source) : '-'}</span> },
    {
      key: 'expected_salary', header: '期望薪资', headCls: TH_R, cellCls: `${TD} text-right`,
      cell: (c) => <span className="text-gray-600 text-sm">{c.expected_salary != null ? `¥${format.currency(parseFloat(c.expected_salary))}` : '-'}</span>,
    },
    {
      key: 'status', header: '状态',
      cell: (c) => <span className={`px-2 py-0.5 rounded text-xs font-medium ${CANDIDATE_STATUS_COLOR[c.status] || 'bg-gray-100'}`}>{CANDIDATE_STATUS_TEXT[c.status] || c.status}</span>,
    },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (c) => (
        <RowActions
          actions={[
            ...(has('recruitment_edit') ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openCandEdit(c) }] : []),
            ...(has('recruitment_edit') && has('employee_create') && c.status !== 'hired' && !c.employee_id
              ? [{ key: 'hire', label: '录用', icon: <UserCheck className="w-4 h-4" />, onClick: () => openHire(c) }]
              : []),
            ...(has('recruitment_delete') ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => removeCandidate(c) }] : []),
          ]}
        />
      ),
    },
  ];

  // [0.47] 同页两张表：次表必须传 paramNs（否则 ?cols= 互相裁列）
  const posView = useTableView({ pageKey: 'recruitment-positions', columns: positionCols, paramNs: 'positions', locked: { trailing: ['__actions'] } });
  const candView = useTableView({ pageKey: 'recruitment-candidates', columns: candidateCols, paramNs: 'candidates', locked: { trailing: ['__actions'] } });

  const active = tab === 'positions' ? posView : candView;
  const filterNote = status
    ? `状态「${tab === 'positions' ? (POSITION_STATUS_TEXT[status] || status) : (CANDIDATE_STATUS_TEXT[status] || status)}」`
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="招聘管理"
        subtitle="招聘职位 → 候选人登记（面试记录）→ 录用一键转员工档案（自动生成工号 + 入职留痕）"
        extra={
          <div className="flex items-center gap-2">
            {has('recruitment_create') && (
              <button onClick={tab === 'positions' ? openPosCreate : openCandCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" /><span className="hidden md:inline">{tab === 'positions' ? '新建职位' : '登记候选人'}</span>
              </button>
            )}
          </div>
        }
      />
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3 items-start md:items-center">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => switchTab('positions')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'positions' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <Briefcase className="w-4 h-4" />招聘职位
            </button>
            <button onClick={() => switchTab('candidates')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'candidates' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <Users className="w-4 h-4" />候选人
            </button>
          </div>
          <input
            type="text"
            placeholder={tab === 'positions' ? '搜索职位 / 编号 / 负责人...' : '搜索姓名 / 编号 / 电话...'}
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
            className="form-input md:max-w-xs"
            autoCapitalize="none"
          />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部状态</option>
            {Object.entries(tab === 'positions' ? POSITION_STATUS_TEXT : CANDIDATE_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="ml-auto flex items-center">{active.menu}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {active.visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={active.visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : (tab === 'positions' ? positions : candidates).length === 0 ? (
                <tr><td colSpan={active.visibleColumns.length} className="px-6">
                  <ListEmpty
                    keyword={keyword}
                    filterNote={filterNote}
                    onClear={() => { setKeyword(''); setStatus(''); setPagination(p => ({ ...p, page: 1 })); }}
                    title={tab === 'positions' ? '暂无招聘职位' : '暂无候选人'}
                    description={tab === 'positions' ? '点击右上角「新建职位」登记招聘需求' : '点击右上角「登记候选人」录入简历'}
                  />
                </td></tr>
              ) : tab === 'positions' ? (
                positions.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    {posView.visibleColumns.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(p)}</td>)}
                  </tr>
                ))
              ) : (
                candidates.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    {candView.visibleColumns.map((col) => <td key={col.key} className={col.cellCls || TD}>{col.cell(c)}</td>)}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total} onPageChange={(page) => setPagination(p => ({ ...p, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        </div>
      </div>

      {/* 职位 新建/编辑 */}
      <Modal title={posEditId ? '编辑职位' : '新建职位'} open={posOpen} onCancel={() => setPosOpen(false)} onOk={savePosition} confirmLoading={saving} okText="保存" cancelText="取消" width={640}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">职位名称 *</label>
              <Input value={posForm.title} onChange={(e) => setPosForm({ ...posForm, title: e.target.value })} placeholder="如：装配工" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">用人部门</label>
              <Select value={posForm.department_id || undefined} onChange={(v) => setPosForm({ ...posForm, department_id: v || '' })} placeholder="请选择部门" allowClear style={{ width: '100%' }}
                options={depts.map((d) => ({ label: d.name, value: d.id }))} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">招聘人数</label>
              <Input type="number" value={posForm.headcount} onChange={(e) => setPosForm({ ...posForm, headcount: e.target.value })} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">薪资下限</label>
              <Input type="number" value={posForm.salary_min} onChange={(e) => setPosForm({ ...posForm, salary_min: e.target.value })} placeholder="请输入" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">薪资上限</label>
              <Input type="number" value={posForm.salary_max} onChange={(e) => setPosForm({ ...posForm, salary_max: e.target.value })} placeholder="请输入" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">负责人</label>
              <Input value={posForm.owner} onChange={(e) => setPosForm({ ...posForm, owner: e.target.value })} placeholder="如：王经理" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">状态</label>
              <select value={posForm.status} onChange={(e) => setPosForm({ ...posForm, status: e.target.value })} className="form-input w-full">
                {Object.entries(POSITION_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          <div><label className="block text-sm text-gray-600 mb-1">任职要求</label>
            <Input.TextArea value={posForm.requirements} onChange={(e) => setPosForm({ ...posForm, requirements: e.target.value })} placeholder="请输入任职要求" rows={2} /></div>
          <div><label className="block text-sm text-gray-600 mb-1">备注</label>
            <Input value={posForm.remark} onChange={(e) => setPosForm({ ...posForm, remark: e.target.value })} placeholder="请输入备注" /></div>
        </div>
      </Modal>

      {/* 候选人 登记/编辑（含面试记录） */}
      <Modal title={candForm.id ? '编辑候选人' : '登记候选人'} open={candOpen} onCancel={() => setCandOpen(false)} onOk={saveCandidate} confirmLoading={saving} okText="保存" cancelText="取消" width={760}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">姓名 *</label>
              <Input value={candForm.name} onChange={(e) => setCandForm({ ...candForm, name: e.target.value })} placeholder="如：张三" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">电话</label>
              <Input value={candForm.phone} onChange={(e) => setCandForm({ ...candForm, phone: e.target.value })} placeholder="请输入" autoCapitalize="none" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">邮箱</label>
              <Input value={candForm.email} onChange={(e) => setCandForm({ ...candForm, email: e.target.value })} placeholder="请输入" autoCapitalize="none" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">应聘职位</label>
              <Select value={candForm.position_id || undefined} onChange={(v) => setCandForm({ ...candForm, position_id: v || '' })} placeholder="请选择职位" allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
                options={positionOptions.map((p) => ({ label: `${p.title}（${p.code}）`, value: p.id }))} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">来源</label>
              <select value={candForm.source} onChange={(e) => setCandForm({ ...candForm, source: e.target.value })} className="form-input w-full">
                <option value="">请选择</option>
                {Object.entries(CANDIDATE_SOURCE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="block text-sm text-gray-600 mb-1">状态</label>
              <select value={candForm.status} onChange={(e) => setCandForm({ ...candForm, status: e.target.value })} className="form-input w-full">
                {Object.entries(CANDIDATE_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">学历</label>
              <Input value={candForm.education} onChange={(e) => setCandForm({ ...candForm, education: e.target.value })} placeholder="如：本科" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">工作年限</label>
              <Input type="number" value={candForm.experience_years} onChange={(e) => setCandForm({ ...candForm, experience_years: e.target.value })} placeholder="请输入" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">期望薪资</label>
              <Input type="number" value={candForm.expected_salary} onChange={(e) => setCandForm({ ...candForm, expected_salary: e.target.value })} placeholder="请输入" /></div>
          </div>
          <div><label className="block text-sm text-gray-600 mb-1">备注</label>
            <Input value={candForm.remark} onChange={(e) => setCandForm({ ...candForm, remark: e.target.value })} placeholder="请输入备注" /></div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">面试记录（{interviews.length} 轮）</span>
              <button type="button" onClick={() => setInterviews((p) => [...p, emptyInterview(p.length + 1)])} className="btn-secondary text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" />添加面试
              </button>
            </div>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    {['轮次', '日期', '面试官', '结果', '评语', '操作'].map((h) => (
                      <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {interviews.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-gray-400">暂无面试记录</td></tr>
                  ) : interviews.map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 text-sm text-gray-600 text-center">{idx + 1}</td>
                      <td className="px-3 py-2"><Input type="date" value={it.interview_date} onChange={(e) => setInterviews((p) => p.map((x, i) => (i === idx ? { ...x, interview_date: e.target.value } : x)))} style={{ width: 150 }} /></td>
                      <td className="px-3 py-2"><Input value={it.interviewer} onChange={(e) => setInterviews((p) => p.map((x, i) => (i === idx ? { ...x, interviewer: e.target.value } : x)))} placeholder="面试官" style={{ width: 110 }} /></td>
                      <td className="px-3 py-2">
                        <select value={it.result} onChange={(e) => setInterviews((p) => p.map((x, i) => (i === idx ? { ...x, result: e.target.value } : x)))} className="form-input w-24">
                          {Object.entries(INTERVIEW_RESULT_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2"><Input value={it.comment} onChange={(e) => setInterviews((p) => p.map((x, i) => (i === idx ? { ...x, comment: e.target.value } : x)))} placeholder="评语" /></td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setInterviews((p) => p.filter((_, i) => i !== idx))} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="移除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-400 mt-1">保存后按当前列表整体替换面试记录（旧记录软删保留）。</div>
          </div>
        </div>
      </Modal>

      {/* 录用转档案 */}
      <Modal title={`录用转档案 — ${hireCand?.name || ''}`} open={!!hireCand} onCancel={() => setHireCand(null)} onOk={submitHire} confirmLoading={saving} okText="确认录用" cancelText="取消" width={520}>
        <div className="space-y-3 py-2">
          <div className="text-sm text-gray-500">将按候选人信息创建员工档案（自动生成 EMP 工号并记入「人事异动」），可修改入职信息：</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">入职部门 *</label>
              <Select value={hireForm.department_id || undefined} onChange={(v) => setHireForm({ ...hireForm, department_id: v || '' })} placeholder="请选择部门" style={{ width: '100%' }}
                options={depts.map((d) => ({ label: d.name, value: d.id }))} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">岗位</label>
              <Input value={hireForm.position} onChange={(e) => setHireForm({ ...hireForm, position: e.target.value })} placeholder="如：装配工" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">入职日期</label>
              <Input type="date" value={hireForm.hire_date} onChange={(e) => setHireForm({ ...hireForm, hire_date: e.target.value })} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">基本工资</label>
              <Input type="number" value={hireForm.base_salary} onChange={(e) => setHireForm({ ...hireForm, base_salary: e.target.value })} placeholder="请输入" /></div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
