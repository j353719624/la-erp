import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import {
  trainingApi, TrainingRecord,
  TRAINING_CATEGORY_TEXT, TRAINING_STATUS_TEXT, TRAINING_STATUS_COLOR, PARTICIPANT_RESULT_TEXT,
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
import type { ReactNode } from 'react';

/**
 * 培训管理（2026-09-19 人事第四批②）
 *
 * 培训记录（PX 单号）：主题/类型/讲师/日期/学时；参与人从员工档案选择（姓名/部门快照），
 * 支持手工录入未建档人员；状态：计划中 / 已完成。
 */
interface ParticipantRow { employee_id: string; employee_name: string; department: string; result: string; score: string; }
const emptyParticipant = (): ParticipantRow => ({ employee_id: '', employee_name: '', department: '', result: 'attended', score: '' });

export function TrainingList() {
  // [权限] 新增=training_create；编辑=training_edit；删除=training_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', status: '', category: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [category, setCategory] = useState(String(urlFilters.category || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [list, setList] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    syncUrl({ keyword, status, category, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, status, category, pagination.page, pagination.page_size]);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState({ title: '', category: '', trainer: '', training_date: format.today(), location: '', hours: '', status: 'planned', remark: '' });
  const [participants, setParticipants] = useState<ParticipantRow[]>([emptyParticipant()]);
  const [saving, setSaving] = useState(false);
  const [emps, setEmps] = useState<Employee[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);

  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await trainingApi.list({
        page: pagination.page, page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined, status: status || undefined, category: category || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '加载失败');
    } finally { if (isCurrent(seq)) setLoading(false); }
  }, [pagination.page, pagination.page_size, debouncedKeyword, status, category, nextSeq, isCurrent]);

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

  const openCreate = () => {
    setEditId('');
    setForm({ title: '', category: '', trainer: '', training_date: format.today(), location: '', hours: '', status: 'planned', remark: '' });
    setParticipants([emptyParticipant()]);
    setOpen(true);
  };
  const openEdit = async (t: TrainingRecord) => {
    setEditId(t.id);
    setForm({
      title: t.title, category: t.category || '', trainer: t.trainer || '',
      training_date: t.training_date ? format.date(t.training_date) : format.today(),
      location: t.location || '', hours: t.hours != null ? String(parseFloat(t.hours)) : '',
      status: t.status, remark: t.remark || '',
    });
    setParticipants([emptyParticipant()]);
    setOpen(true);
    try {
      const res = await trainingApi.get(t.id);
      const list = res.code === 0 ? (res.data?.edges?.participants || []) : [];
      setParticipants(list.length > 0 ? list.map((p) => ({
        employee_id: p.employee_id || '', employee_name: p.employee_name || '', department: p.department || '',
        result: p.result || 'attended', score: p.score != null ? String(parseFloat(p.score)) : '',
      })) : [emptyParticipant()]);
    } catch (err) { console.warn('参与人加载失败', err); }
  };
  const handleSave = async () => {
    if (!form.title.trim()) { message.warning('请填写培训主题'); return; }
    if (!form.training_date) { message.warning('请选择培训日期'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title, category: form.category, trainer: form.trainer,
        training_date: toLocalDateISO(form.training_date),
        location: form.location, hours: form.hours ? parseFloat(form.hours) : 0,
        status: form.status, remark: form.remark,
        participants: participants.filter((p) => p.employee_name.trim()).map((p) => ({
          employee_id: p.employee_id || undefined, employee_name: p.employee_name.trim(), department: p.department,
          result: p.result, score: p.score ? parseFloat(p.score) : undefined,
        })),
      };
      const res = editId ? await trainingApi.update(editId, payload) : await trainingApi.create(payload);
      if (res.code === 0) { message.success(editId ? '已更新' : '已创建'); setOpen(false); fetchList(); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setSaving(false); }
  };
  const handleDelete = async (t: TrainingRecord) => {
    if (!(await confirmAction({ title: `删除培训记录 ${t.code}（${t.title}）？`, danger: true }))) return;
    try {
      const res = await trainingApi.remove(t.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };

  interface RowCol { key: string; header: ReactNode; headCls?: string; cellCls?: string; cell: (row: TrainingRecord) => ReactNode; }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'code', header: '单号', cell: (t) => <span className="font-medium text-gray-900">{t.code}</span> },
    { key: 'title', header: '培训主题', cell: (t) => <span className="text-gray-900">{t.title}</span> },
    { key: 'category', header: '类型', cell: (t) => <span className="text-gray-600 text-sm">{t.category ? (TRAINING_CATEGORY_TEXT[t.category] || t.category) : '-'}</span> },
    { key: 'trainer', header: '讲师', cell: (t) => <span className="text-gray-500 text-sm">{t.trainer || '-'}</span> },
    { key: 'training_date', header: '培训日期', cell: (t) => <span className="text-gray-500 text-sm">{format.date(t.training_date)}</span> },
    { key: 'hours', header: '学时', headCls: TH_R, cellCls: `${TD} text-right`, cell: (t) => <span className="text-gray-700">{parseFloat(t.hours || '0')} 小时</span> },
    {
      key: 'status', header: '状态',
      cell: (t) => <span className={`px-2 py-0.5 rounded text-xs font-medium ${TRAINING_STATUS_COLOR[t.status] || 'bg-gray-100'}`}>{TRAINING_STATUS_TEXT[t.status] || t.status}</span>,
    },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (t) => (
        <RowActions
          actions={[
            ...(has('training_edit') ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(t) }] : []),
            ...(has('training_delete') ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(t) }] : []),
          ]}
        />
      ),
    },
  ];
  const { visibleColumns, menu: viewMenu } = useTableView({ pageKey: 'training-list', columns: rowCols, locked: { trailing: ['__actions'] } });

  const filterNote = [
    status && `状态「${TRAINING_STATUS_TEXT[status] || status}」`,
    category && `类型「${TRAINING_CATEGORY_TEXT[category] || category}」`,
  ].filter(Boolean).join(' + ') || undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="培训管理"
        subtitle="培训计划与记录：参与人从员工档案选择（姓名/部门快照），支持手工录入未建档人员"
        extra={
          has('training_create') && (
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /><span className="hidden md:inline">新建培训</span>
            </button>
          )
        }
      />
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <input type="text" placeholder="搜索单号 / 主题 / 讲师..." value={keyword} onChange={(e) => { setKeyword(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:max-w-xs" />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:w-32">
            <option value="">全部状态</option>
            {Object.entries(TRAINING_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:w-32">
            <option value="">全部类型</option>
            {Object.entries(TRAINING_CATEGORY_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="ml-auto flex items-center">{viewMenu}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6">
                  <ListEmpty
                    keyword={keyword}
                    filterNote={filterNote}
                    onClear={() => { setKeyword(''); setStatus(''); setCategory(''); setPagination(p => ({ ...p, page: 1 })); }}
                    title="暂无培训记录"
                    description="点击右上角「新建培训」登记培训计划"
                  />
                </td></tr>
              ) : list.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  {visibleColumns.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(t)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total} onPageChange={(page) => setPagination(p => ({ ...p, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        </div>
      </div>

      <Modal title={editId ? '编辑培训' : '新建培训'} open={open} onCancel={() => setOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={780}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className="block text-sm text-gray-600 mb-1">培训主题 *</label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：安全生产培训" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">类型</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="form-input w-full">
                <option value="">请选择</option>
                {Object.entries(TRAINING_CATEGORY_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">讲师</label>
              <Input value={form.trainer} onChange={(e) => setForm({ ...form, trainer: e.target.value })} placeholder="如：李工" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">培训日期 *</label>
              <Input type="date" value={form.training_date} onChange={(e) => setForm({ ...form, training_date: e.target.value })} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">学时</label>
              <Input type="number" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="如：2.5" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">状态</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="form-input w-full">
                {Object.entries(TRAINING_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">地点</label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="如：三楼会议室" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">备注</label>
              <Input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="请输入备注" /></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">参与人（{participants.filter((p) => p.employee_name.trim()).length} 人）</span>
              <button type="button" onClick={() => setParticipants((p) => [...p, emptyParticipant()])} className="btn-secondary text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" />添加参与人
              </button>
            </div>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    {['员工 *', '结果', '成绩', '操作'].map((h) => (
                      <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {participants.map((p, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 align-top">
                        <SearchSelect
                          value={p.employee_id || undefined}
                          onChange={(v: unknown) => {
                            const id = typeof v === 'string' ? v : '';
                            const emp = emps.find((x) => x.id === id);
                            setParticipants((prev) => prev.map((x, i) => (i === idx ? {
                              ...x, employee_id: id, employee_name: emp?.name || '',
                              department: emp?.department_id ? (depts.find((d) => d.id === emp.department_id)?.name || '') : '',
                            } : x)));
                          }}
                          options={emps.map((e) => ({ label: `${e.name}（${e.code}）`, value: e.id, search: `${e.name} ${e.code}` }))}
                          placeholder="选员工"
                          allowClear
                          className="w-48"
                        />
                        {!p.employee_id && (
                          <input value={p.employee_name} onChange={(e) => setParticipants((prev) => prev.map((x, i) => (i === idx ? { ...x, employee_name: e.target.value } : x)))} className="form-input w-48 mt-1" placeholder="或手输姓名" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select value={p.result} onChange={(e) => setParticipants((prev) => prev.map((x, i) => (i === idx ? { ...x, result: e.target.value } : x)))} className="form-input w-24">
                          {Object.entries(PARTICIPANT_RESULT_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" value={p.score} onChange={(e) => setParticipants((prev) => prev.map((x, i) => (i === idx ? { ...x, score: e.target.value } : x)))} placeholder="如：95" style={{ width: 100 }} />
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setParticipants((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : [emptyParticipant()]))} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="移除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-400 mt-1">未填姓名的行不会保存；保存时按当前列表整体替换参与人（旧记录软删保留）。</div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
