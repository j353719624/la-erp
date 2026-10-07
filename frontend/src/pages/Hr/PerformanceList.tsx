import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, CheckCircle2, Target, FileSpreadsheet } from 'lucide-react';
import { Modal, Input, Select } from 'antd';
import { message } from '@/utils/appMessage';
import {
  perfApi, perfTemplateApi, PerfAssessment, PerfTemplate,
  PERF_STATUS_TEXT, PERF_STATUS_COLOR, PERF_LEVEL_TEXT, PERF_LEVEL_COLOR,
} from '@/api/hr';
import { employeeApi, type Employee } from '@/api/hr';
import { departmentApi } from '@/api/system';
import { SearchSelect } from '@/components/SearchSelect';
import { format } from '@/utils/format';
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
 * 绩效考核（2026-09-19 人事第四批③）
 *
 * 两个页签：
 *  - 考核单（JX 单号）：选员工 + 模板 → 逐指标评分 → 加权总分（Σ 得分×权重/100）→ 等级 A/B/C/D → 定案（只读）
 *  - 考核模板：指标 + 权重（合计必须 = 100，前后端双校验）
 */
interface AssessItemRow { indicator: string; weight: string; score: string; remark: string; }
interface TplItemRow { indicator: string; weight: string; description: string; }

export function PerformanceList() {
  // [权限] 新增=perf_create；编辑/定案=perf_edit；删除=perf_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ tab: 'assessments', keyword: '', status: '', page: 1, page_size: 10 });
  const [tab, setTab] = useState<'assessments' | 'templates'>(urlFilters.tab === 'templates' ? 'templates' : 'assessments');
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [list, setList] = useState<PerfAssessment[]>([]);
  const [templates, setTemplates] = useState<PerfTemplate[]>([]);
  const [allTemplates, setAllTemplates] = useState<PerfTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [emps, setEmps] = useState<Employee[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    syncUrl({ tab, keyword, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, keyword, status, pagination.page, pagination.page_size]);

  // 考核单弹窗
  const [aOpen, setAOpen] = useState(false);
  const [aEditId, setAEditId] = useState('');
  const [aForm, setAForm] = useState({ employee_id: '', employee_name: '', department: '', template_id: '', period: format.today().slice(0, 7), remark: '' });
  const [aItems, setAItems] = useState<AssessItemRow[]>([]);
  // 模板弹窗
  const [tOpen, setTOpen] = useState(false);
  const [tEditId, setTEditId] = useState('');
  const [tForm, setTForm] = useState({ name: '', remark: '' });
  const [tItems, setTItems] = useState<TplItemRow[]>([]);
  const [saving, setSaving] = useState(false);

  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const loadTemplates = useCallback(() => {
    perfTemplateApi.list({ page: 1, page_size: 100 }).then((res) => {
      if (res.code === 0) setAllTemplates(res.data?.list ?? []);
    }).catch((err) => console.warn('模板列表加载失败', err));
  }, []);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const params = { page: pagination.page, page_size: pagination.page_size, keyword: debouncedKeyword || undefined, status: status || undefined };
      if (tab === 'assessments') {
        const res = await perfApi.list(params);
        if (res.code === 0) {
          if (!isCurrent(seq)) return;
          setList(res.data?.list ?? []);
          setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
        }
      } else {
        const res = await perfTemplateApi.list({ page: pagination.page, page_size: pagination.page_size, keyword: debouncedKeyword || undefined });
        if (res.code === 0) {
          if (!isCurrent(seq)) return;
          setTemplates(res.data?.list ?? []);
          setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
        }
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '加载失败');
    } finally { if (isCurrent(seq)) setLoading(false); }
  }, [tab, pagination.page, pagination.page_size, debouncedKeyword, status, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const switchTab = (t: 'assessments' | 'templates') => {
    setTab(t); setKeyword(''); setStatus(''); setPagination(p => ({ ...p, page: 1 }));
  };

  // 员工/部门下拉（考核单弹窗；失败留痕不阻断）
  useEffect(() => {
    if (!aOpen) return;
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
  }, [aOpen, emps.length, depts.length]);

  // 加权总分（前端展示用；后端保存时重算）
  const weightedTotal = (items: AssessItemRow[]) => {
    const total = items.reduce((acc, it) => acc + (parseFloat(it.score) || 0) * (parseFloat(it.weight) || 0), 0) / 100;
    return Math.round(total * 100) / 100;
  };
  const weightsSum = (items: { weight: string }[]) => Math.round(items.reduce((acc, it) => acc + (parseFloat(it.weight) || 0), 0) * 100) / 100;

  // ── 考核单 ───────────────────────────────────────────────────────────────
  const openAssessCreate = () => {
    setAEditId('');
    setAForm({ employee_id: '', employee_name: '', department: '', template_id: '', period: format.today().slice(0, 7), remark: '' });
    setAItems([]);
    setAOpen(true);
  };
  const openAssessEdit = async (a: PerfAssessment) => {
    setAEditId(a.id);
    setAForm({
      employee_id: a.employee_id || '', employee_name: a.employee_name, department: a.department || '',
      template_id: a.template_id || '', period: a.period, remark: a.remark || '',
    });
    setAItems([]);
    setAOpen(true);
    try {
      const res = await perfApi.get(a.id);
      const items = res.code === 0 ? (res.data?.edges?.items || []) : [];
      setAItems(items.map((it) => ({
        indicator: it.indicator, weight: it.weight != null ? String(parseFloat(it.weight)) : '',
        score: it.score != null ? String(parseFloat(it.score)) : '0', remark: it.remark || '',
      })));
    } catch (err) { console.warn('考核指标加载失败', err); }
  };
  const pickTemplate = async (id: string) => {
    setAForm((f) => ({ ...f, template_id: id }));
    if (!id) return;
    try {
      const res = await perfTemplateApi.get(id);
      const items = res.code === 0 ? (res.data?.edges?.items || []) : [];
      setAItems(items.map((it) => ({
        indicator: it.indicator, weight: it.weight != null ? String(parseFloat(it.weight)) : '',
        score: '0', remark: '',
      })));
    } catch (err) { console.warn('模板指标加载失败', err); }
  };
  const saveAssess = async () => {
    if (!aForm.employee_name.trim() && !aForm.employee_id) { message.warning('请选择员工或填写姓名'); return; }
    if (!/^\d{4}-\d{2}$/.test(aForm.period)) { message.warning('请选择考核期间（YYYY-MM）'); return; }
    if (aItems.length === 0) { message.warning('请选择模板带出指标，或至少添加一个指标'); return; }
    if (Math.abs(weightsSum(aItems) - 100) > 0.01) { message.warning(`权重合计必须等于 100（当前 ${weightsSum(aItems)}）`); return; }
    setSaving(true);
    try {
      const payload = {
        employee_id: aForm.employee_id || undefined, employee_name: aForm.employee_name, department: aForm.department,
        template_id: aForm.template_id || undefined, period: aForm.period, remark: aForm.remark,
        items: aItems.filter((it) => it.indicator.trim()).map((it) => ({
          indicator: it.indicator.trim(), weight: parseFloat(it.weight) || 0, score: parseFloat(it.score) || 0, remark: it.remark,
        })),
      };
      const res = aEditId ? await perfApi.update(aEditId, payload) : await perfApi.create(payload);
      if (res.code === 0) { message.success(aEditId ? '已更新' : '已创建'); setAOpen(false); fetchList(); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setSaving(false); }
  };
  const finalizeAssess = async (a: PerfAssessment) => {
    if (!(await confirmAction({ title: `定案考核单 ${a.code}（${a.employee_name}）？`, content: '定案后只读，不可再修改；得分与等级将按当前指标重算' }))) return;
    try {
      const res = await perfApi.finalize(a.id);
      if (res.code === 0) { message.success(`已定案（总分 ${parseFloat((res.data as PerfAssessment | undefined)?.total_score || a.total_score)}，等级 ${(res.data as PerfAssessment | undefined)?.level || a.level}）`); fetchList(); }
      else message.error(res.message || '定案失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '定案失败'); }
  };
  const removeAssess = async (a: PerfAssessment) => {
    if (!(await confirmAction({ title: `删除考核单 ${a.code}（${a.employee_name}）？`, danger: true }))) return;
    try {
      const res = await perfApi.remove(a.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };

  // ── 模板 ─────────────────────────────────────────────────────────────────
  const openTplCreate = () => {
    setTEditId('');
    setTForm({ name: '', remark: '' });
    setTItems([{ indicator: '', weight: '100', description: '' }]);
    setTOpen(true);
  };
  const openTplEdit = async (t: PerfTemplate) => {
    setTEditId(t.id);
    setTForm({ name: t.name, remark: t.remark || '' });
    setTItems([]);
    setTOpen(true);
    try {
      const res = await perfTemplateApi.get(t.id);
      const items = res.code === 0 ? (res.data?.edges?.items || []) : [];
      setTItems(items.length > 0 ? items.map((it) => ({
        indicator: it.indicator, weight: it.weight != null ? String(parseFloat(it.weight)) : '', description: it.description || '',
      })) : [{ indicator: '', weight: '100', description: '' }]);
    } catch (err) { console.warn('模板指标加载失败', err); }
  };
  const saveTemplate = async () => {
    if (!tForm.name.trim()) { message.warning('请填写模板名称'); return; }
    const items = tItems.filter((it) => it.indicator.trim());
    if (items.length > 0 && Math.abs(weightsSum(items) - 100) > 0.01) {
      message.warning(`权重合计必须等于 100（当前 ${weightsSum(items)}）`); return;
    }
    setSaving(true);
    try {
      const payload = {
        name: tForm.name.trim(), remark: tForm.remark,
        items: items.map((it) => ({ indicator: it.indicator.trim(), weight: parseFloat(it.weight) || 0, description: it.description })),
      };
      const res = tEditId ? await perfTemplateApi.update(tEditId, payload) : await perfTemplateApi.create(payload);
      if (res.code === 0) { message.success(tEditId ? '已更新' : '已创建'); setTOpen(false); fetchList(); loadTemplates(); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setSaving(false); }
  };
  const removeTemplate = async (t: PerfTemplate) => {
    if (!(await confirmAction({ title: `删除模板「${t.name}」？`, content: '被考核单引用的模板无法删除', danger: true }))) return;
    try {
      const res = await perfTemplateApi.remove(t.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); loadTemplates(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };

  // ── 列定义 ───────────────────────────────────────────────────────────────
  interface RowCol<T> { key: string; header: ReactNode; headCls?: string; cellCls?: string; cell: (row: T) => ReactNode; }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';

  const assessCols: RowCol<PerfAssessment>[] = [
    { key: 'code', header: '单号', cell: (a) => <span className="font-medium text-gray-900">{a.code}</span> },
    { key: 'employee_name', header: '员工', cell: (a) => <span className="text-gray-900">{a.employee_name}</span> },
    { key: 'department', header: '部门', cell: (a) => <span className="text-gray-500 text-sm">{a.department || '-'}</span> },
    { key: 'period', header: '期间', cell: (a) => <span className="text-gray-600 text-sm">{a.period}</span> },
    { key: 'template_name', header: '模板', cell: (a) => <span className="text-gray-500 text-sm">{a.template_name || '-'}</span> },
    {
      key: 'total_score', header: '总分', headCls: TH_R, cellCls: `${TD} text-right`,
      cell: (a) => <span className="font-medium text-gray-900">{parseFloat(a.total_score || '0')}</span>,
    },
    {
      key: 'level', header: '等级',
      cell: (a) => a.level
        ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${PERF_LEVEL_COLOR[a.level] || 'bg-gray-100'}`}>{PERF_LEVEL_TEXT[a.level] || a.level}</span>
        : <span className="text-gray-400 text-sm">-</span>,
    },
    {
      key: 'status', header: '状态',
      cell: (a) => <span className={`px-2 py-0.5 rounded text-xs font-medium ${PERF_STATUS_COLOR[a.status] || 'bg-gray-100'}`}>{PERF_STATUS_TEXT[a.status] || a.status}</span>,
    },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (a) => (
        <RowActions
          actions={[
            ...(a.status === 'draft' && has('perf_edit') ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openAssessEdit(a) }] : []),
            ...(a.status === 'draft' && has('perf_edit') ? [{ key: 'finalize', label: '定案', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => finalizeAssess(a) }] : []),
            ...(has('perf_delete') ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => removeAssess(a) }] : []),
          ]}
        />
      ),
    },
  ];
  const templateCols: RowCol<PerfTemplate>[] = [
    { key: 'name', header: '模板名称', cell: (t) => <span className="font-medium text-gray-900">{t.name}</span> },
    { key: 'remark', header: '备注', cell: (t) => <span className="text-gray-500 text-sm">{t.remark || '-'}</span> },
    { key: 'created_at', header: '创建时间', cell: (t) => <span className="text-gray-400 text-xs">{format.date(t.created_at || '')}</span> },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (t) => (
        <RowActions
          actions={[
            ...(has('perf_edit') ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openTplEdit(t) }] : []),
            ...(has('perf_delete') ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => removeTemplate(t) }] : []),
          ]}
        />
      ),
    },
  ];

  // [0.47] 同页两张表：次表必须传 paramNs（否则 ?cols= 互相裁列）
  const assessView = useTableView({ pageKey: 'perf-assessments', columns: assessCols, paramNs: 'assessments', locked: { trailing: ['__actions'] } });
  const templateView = useTableView({ pageKey: 'perf-templates', columns: templateCols, paramNs: 'templates', locked: { trailing: ['__actions'] } });
  const active = tab === 'assessments' ? assessView : templateView;

  const filterNote = status ? `状态「${PERF_STATUS_TEXT[status] || status}」` : undefined;
  const aTotal = weightedTotal(aItems);

  return (
    <div className="space-y-6">
      <PageHeader
        title="绩效考核"
        subtitle="模板（指标+权重，合计=100）→ 考核单逐项评分 → 加权总分与等级（A/B/C/D）→ 定案只读"
        extra={
          has('perf_create') && (
            <button onClick={tab === 'assessments' ? openAssessCreate : openTplCreate} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /><span className="hidden md:inline">{tab === 'assessments' ? '新建考核' : '新建模板'}</span>
            </button>
          )
        }
      />
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3 items-start md:items-center">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => switchTab('assessments')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'assessments' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <FileSpreadsheet className="w-4 h-4" />考核单
            </button>
            <button onClick={() => switchTab('templates')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'templates' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <Target className="w-4 h-4" />考核模板
            </button>
          </div>
          <input
            type="text"
            placeholder={tab === 'assessments' ? '搜索单号 / 员工姓名...' : '搜索模板名称...'}
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
            className="form-input md:max-w-xs"
          />
          {tab === 'assessments' && (
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:w-32">
              <option value="">全部状态</option>
              {Object.entries(PERF_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
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
              ) : (tab === 'assessments' ? list : templates).length === 0 ? (
                <tr><td colSpan={active.visibleColumns.length} className="px-6">
                  <ListEmpty
                    keyword={keyword}
                    filterNote={filterNote}
                    onClear={() => { setKeyword(''); setStatus(''); setPagination(p => ({ ...p, page: 1 })); }}
                    title={tab === 'assessments' ? '暂无考核单' : '暂无考核模板'}
                    description={tab === 'assessments' ? '点击右上角「新建考核」开始评分' : '点击右上角「新建模板」配置指标与权重'}
                  />
                </td></tr>
              ) : tab === 'assessments' ? (
                list.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    {assessView.visibleColumns.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(a)}</td>)}
                  </tr>
                ))
              ) : (
                templates.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    {templateView.visibleColumns.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(t)}</td>)}
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

      {/* 考核单 新建/编辑 */}
      <Modal title={aEditId ? '编辑考核单' : '新建考核单'} open={aOpen} onCancel={() => setAOpen(false)} onOk={saveAssess} confirmLoading={saving} okText="保存" cancelText="取消" width={820}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">考核员工 *</label>
              <SearchSelect
                value={aForm.employee_id || undefined}
                onChange={(v: unknown) => {
                  const id = typeof v === 'string' ? v : '';
                  const e = emps.find((x) => x.id === id);
                  setAForm((f) => ({
                    ...f, employee_id: id, employee_name: e?.name || (id ? f.employee_name : ''),
                    department: e?.department_id ? (depts.find((d) => d.id === e.department_id)?.name || '') : f.department,
                  }));
                }}
                options={emps.map((e) => ({ label: `${e.name}（${e.code}）`, value: e.id, search: `${e.name} ${e.code}` }))}
                placeholder="请选择员工（未建档可在下方手工填写）"
                allowClear
              />
              {!aForm.employee_id && (<Input value={aForm.employee_name} onChange={(e) => setAForm({ ...aForm, employee_name: e.target.value })} placeholder="未建档人员可手工填写，如：张三" className="mt-2" />)}
            </div>
            <div><label className="block text-sm text-gray-600 mb-1">考核期间 *</label>
              <Input type="month" value={aForm.period} onChange={(e) => setAForm({ ...aForm, period: e.target.value })} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">考核模板</label>
              <Select value={aForm.template_id || undefined} onChange={(v) => pickTemplate(v || '')} placeholder="请选择模板（自动带出指标）" allowClear style={{ width: '100%' }}
                options={allTemplates.map((t) => ({ label: t.name, value: t.id }))} /></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                考核指标（权重合计 {weightsSum(aItems)}，必须 = 100；当前加权总分 <b className="text-blue-600">{aTotal}</b>）
              </span>
              <button type="button" onClick={() => setAItems((p) => [...p, { indicator: '', weight: '0', score: '0', remark: '' }])} className="btn-secondary text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" />添加指标
              </button>
            </div>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    {['指标 *', '权重(%)', '得分(0-100)', '备注', '操作'].map((h) => (
                      <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {aItems.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-sm text-gray-400">请选择模板带出指标，或点「添加指标」手工录入</td></tr>
                  ) : aItems.map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2"><Input value={it.indicator} onChange={(e) => setAItems((p) => p.map((x, i) => (i === idx ? { ...x, indicator: e.target.value } : x)))} placeholder="如：产量达成率" style={{ width: 200 }} /></td>
                      <td className="px-3 py-2"><Input type="number" value={it.weight} onChange={(e) => setAItems((p) => p.map((x, i) => (i === idx ? { ...x, weight: e.target.value } : x)))} style={{ width: 90 }} /></td>
                      <td className="px-3 py-2"><Input type="number" value={it.score} onChange={(e) => setAItems((p) => p.map((x, i) => (i === idx ? { ...x, score: e.target.value } : x)))} style={{ width: 100 }} /></td>
                      <td className="px-3 py-2"><Input value={it.remark} onChange={(e) => setAItems((p) => p.map((x, i) => (i === idx ? { ...x, remark: e.target.value } : x)))} placeholder="请输入" /></td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setAItems((p) => p.filter((_, i) => i !== idx))} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="移除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div><label className="block text-sm text-gray-600 mb-1">备注</label>
            <Input value={aForm.remark} onChange={(e) => setAForm({ ...aForm, remark: e.target.value })} placeholder="请输入备注" /></div>
        </div>
      </Modal>

      {/* 模板 新建/编辑 */}
      <Modal title={tEditId ? '编辑模板' : '新建模板'} open={tOpen} onCancel={() => setTOpen(false)} onOk={saveTemplate} confirmLoading={saving} okText="保存" cancelText="取消" width={720}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">模板名称 *</label>
              <Input value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })} placeholder="如：装配工月度考核" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">备注</label>
              <Input value={tForm.remark} onChange={(e) => setTForm({ ...tForm, remark: e.target.value })} placeholder="请输入备注" /></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">考核指标（权重合计 {weightsSum(tItems)}，必须 = 100）</span>
              <button type="button" onClick={() => setTItems((p) => [...p, { indicator: '', weight: '0', description: '' }])} className="btn-secondary text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" />添加指标
              </button>
            </div>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    {['指标 *', '权重(%)', '指标说明', '操作'].map((h) => (
                      <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tItems.map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2"><Input value={it.indicator} onChange={(e) => setTItems((p) => p.map((x, i) => (i === idx ? { ...x, indicator: e.target.value } : x)))} placeholder="如：产量达成率" style={{ width: 180 }} /></td>
                      <td className="px-3 py-2"><Input type="number" value={it.weight} onChange={(e) => setTItems((p) => p.map((x, i) => (i === idx ? { ...x, weight: e.target.value } : x)))} style={{ width: 90 }} /></td>
                      <td className="px-3 py-2"><Input value={it.description} onChange={(e) => setTItems((p) => p.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} placeholder="请输入" /></td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setTItems((p) => p.filter((_, i) => i !== idx))} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="移除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-400 mt-1">空指标行不会保存；权重合计不满足 100 时保存会被拒绝（前后端双校验）。</div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
