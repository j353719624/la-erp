import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, Users } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import {
  productionTeamApi, ProductionTeam, TeamMember, SHIFT_TEXT, SKILL_LEVEL_TEXT,
} from '@/api/production';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { Pagination } from '@/components/Pagination';
// [2026-09-19 班组关联员工] 成员姓名改「选员工」（未建档成员仍可手输）
import { SearchSelect } from '@/components/SearchSelect';
import { employeeApi, type Employee } from '@/api/hr';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { confirmAction } from '@/utils/confirm';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';

/**
 * 班组与操作工（2026-09-11）
 *
 * 生产资料管理之「人」：班组档案 + 成员（工种 / 技能等级），供排产与报工时选人。
 * 成员为子表：保存时整体替换（旧成员软删，禁止物理删除）。
 */
const emptyMember = (): TeamMember => ({ employee_id: '', name: '', employee_no: '', skill: '', skill_level: '', phone: '' });

export function TeamList() {
  // [2026-09-18 权限细化·批 2 生产] 新增=team_create；编辑=team_edit；删除=team_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ page: 1, page_size: 10, keyword: '', shift: '' });
  const [list, setList] = useState<ProductionTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [applied, setApplied] = useState(String(urlFilters.keyword || ''));
  const [shift, setShift] = useState(String(urlFilters.shift || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>({ name: '', workshop: '', leader: '', shift: 'day', is_active: true, remark: '' });
  const [members, setMembers] = useState<TeamMember[]>([emptyMember()]);
  const [saving, setSaving] = useState(false);
  // [2026-09-19 班组关联员工] 员工档案列表（选成员用；打开弹窗时惰性加载一次）
  const [emps, setEmps] = useState<Employee[]>([]);

  const [detail, setDetail] = useState<ProductionTeam | null>(null);

  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    syncUrl({ keyword: applied, shift, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, shift, pagination.page, pagination.page_size]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await productionTeamApi.list({
        page: pagination.page, page_size: pagination.page_size,
        keyword: applied || undefined, shift: shift || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list ?? []);
        setPagination((p) => ({ ...p, total: res.data?.total ?? 0 }));
      }
    } catch (e: any) {
      message.error(e?.message || '加载失败');
    } finally {
      if (isCurrent(seq)) setLoading(false);
    }
  }, [pagination.page, pagination.page_size, applied, shift, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // [2026-09-19 班组关联员工] 弹窗打开时加载员工档案（失败留痕，不阻断其他）
  useEffect(() => {
    if (!open || emps.length > 0) return;
    employeeApi.list({ page: 1, page_size: 200 }).then((res) => {
      if (res.code === 0) setEmps((res.data?.list ?? []).filter((e) => e.status !== 'left'));
    }).catch((err) => console.warn('员工列表加载失败', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, emps.length]);

  const openCreate = () => {
    setEditId('');
    setForm({ name: '', workshop: '', leader: '', shift: 'day', is_active: true, remark: '' });
    setMembers([emptyMember()]);
    setOpen(true);
  };

  const openEdit = async (t: ProductionTeam) => {
    setEditId(t.id);
    setForm({
      name: t.name || '', workshop: t.workshop || '', leader: t.leader || '',
      shift: t.shift || 'day', is_active: t.is_active !== false, remark: t.remark || '',
    });
    try {
      const res = await productionTeamApi.get(t.id);
      const ms = res.code === 0 ? (res.data?.edges?.members || []) : (t.edges?.members || []);
      setMembers(ms.length > 0 ? ms.map((m) => ({
        employee_id: m.employee_id || '', name: m.name || '', employee_no: m.employee_no || '', skill: m.skill || '',
        skill_level: m.skill_level || '', phone: m.phone || '',
      })) : [emptyMember()]);
    } catch {
      setMembers([emptyMember()]);
    }
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { message.warning('请填写班组名称'); return; }
    setSaving(true);
    try {
      const data = {
        ...form,
        name: form.name.trim(),
        members: members.filter((m) => m.name.trim()).map((m) => ({ ...m, employee_id: m.employee_id || undefined, name: m.name.trim() })),
      };
      const res = editId ? await productionTeamApi.update(editId, data) : await productionTeamApi.create(data);
      if (res.code === 0) {
        message.success(editId ? '已更新' : '已新增');
        setOpen(false);
        fetchList();
      }
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: ProductionTeam) => {
    const ok = await confirmAction({
      title: `删除班组「${t.name}」？`,
      content: '班组成员将一并删除（软删除）。',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await productionTeamApi.remove(t.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); }
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const openDetail = async (t: ProductionTeam) => {
    setDetail(t);
    try {
      const res = await productionTeamApi.get(t.id);
      if (res.code === 0) setDetail(res.data);
    } catch { /* 静默：保留行数据 */ }
  };

  const labelCls = 'block text-sm text-gray-600 mb-1';
  const inputCls = 'form-input';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: ProductionTeam) => ReactNode;
  }
  const TH_C = 'px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-4';
  const rowCols: RowCol[] = [
    { key: 'code', header: '班组编码', cell: (t) => <span className="font-mono text-sm text-gray-900">{t.code}</span> },
    { key: 'name', header: '班组名称', cell: (t) => <span className="text-gray-900">{t.name}</span> },
    { key: 'workshop', header: '车间', cellCls: `${TD} text-gray-600 text-sm`, cell: (t) => <span>{t.workshop || '-'}</span> },
    { key: 'leader', header: '班组长', cellCls: `${TD} text-gray-600 text-sm`, cell: (t) => <span>{t.leader || '-'}</span> },
    { key: 'shift', header: '班次', cellCls: `${TD} text-gray-600 text-sm`, cell: (t) => <span>{SHIFT_TEXT[t.shift] || t.shift}</span> },
    {
      key: 'member_count',
      header: '人数',
      cell: (t) => (
        <button onClick={() => openDetail(t)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm">
          <Users className="w-4 h-4" />{t.member_count} 人
        </button>
      ),
    },
    {
      key: 'is_active',
      header: '状态',
      cell: (t) => (
        t.is_active !== false
          ? <span className="px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">启用</span>
          : <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">停用</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      cellCls: `${TD} whitespace-nowrap`,
      cell: (t) => (
        <RowActions
          actions={[
            { key: 'view', label: '查看成员', icon: <Users className="w-4 h-4" />, onClick: () => openDetail(t) },
            ...(has('team_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(t) }]
              : []),
            ...(has('team_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(t) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'production-team-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="班组与操作工"
        subtitle="班组档案 + 成员技能（生产资料管理：排产与报工可选人）"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={fetchList} className="btn-secondary flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">刷新</span>
            </button>
            {has('team_create') && (
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />新增班组
              </button>
            )}
          </div>
        }
      />

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPagination((p) => ({ ...p, page: 1 })); setApplied(keyword.trim()); } }}
          placeholder="搜索班组编码/名称/班组长/车间"
          className="form-input w-72"
        />
        <select value={shift} onChange={(e) => { setShift(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input w-32">
          <option value="">全部班次</option>
          {Object.entries(SHIFT_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="ml-auto">{viewMenu}</div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH_C}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4">
                    <ListEmpty
                      keyword={applied}
                      onClear={() => { setKeyword(''); setApplied(''); setShift(''); }}
                      title="暂无班组"
                      description="点右上角「新增班组」录入班组与成员"
                    />
                  </td>
                </tr>
              ) : (
                list.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(t)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination
            page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))} loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        </div>
      </div>

      {/* 新增/编辑班组（含成员明细） */}
      <Modal title={editId ? '编辑班组' : '新增班组'} open={open} onCancel={() => setOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={880}>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className={labelCls}>班组名称 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="如：装配一班" />
            </div>
            <div>
              <label className={labelCls}>班次</label>
              <select value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })} className={inputCls}>
                {Object.entries(SHIFT_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>车间</label>
              <input value={form.workshop} onChange={(e) => setForm({ ...form, workshop: e.target.value })} className={inputCls} placeholder="总装车间" />
            </div>
            <div>
              <label className={labelCls}>班组长</label>
              <input value={form.leader} onChange={(e) => setForm({ ...form, leader: e.target.value })} className={inputCls} />
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>备注</label>
              <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className={inputCls} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">成员（{members.filter((m) => m.name.trim()).length} 人）</span>
              <button type="button" onClick={() => setMembers((p) => [...p, emptyMember()])} className="btn-secondary text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" />添加成员
              </button>
            </div>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    {['姓名 *', '工号', '工种/技能', '技能等级', '电话', '操作'].map((h) => (
                      <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map((m, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 align-top">
                        {/* [2026-09-19 班组关联员工] 首选员工档案（选中自动带姓名/工号/电话）；未建档成员手输姓名 */}
                        <SearchSelect
                          value={m.employee_id || undefined}
                          onChange={(v: unknown) => {
                            const id = typeof v === 'string' ? v : '';
                            const emp = emps.find((x) => x.id === id);
                            setMembers((p) => p.map((x, i) => (i === idx ? {
                              ...x, employee_id: id, name: emp?.name || '', employee_no: emp?.code || '', phone: emp?.phone || '',
                            } : x)));
                          }}
                          options={emps.map((e) => ({ label: `${e.name}（${e.code}）`, value: e.id, search: `${e.name} ${e.code}` }))}
                          placeholder="选员工"
                          allowClear
                          className="w-44"
                        />
                        {!m.employee_id && (
                          <input value={m.name} onChange={(e) => setMembers((p) => p.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} className="form-input w-28 mt-1" placeholder="或手输姓名" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input value={m.employee_no || ''} onChange={(e) => setMembers((p) => p.map((x, i) => (i === idx ? { ...x, employee_no: e.target.value } : x)))} className="form-input w-24" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={m.skill || ''} onChange={(e) => setMembers((p) => p.map((x, i) => (i === idx ? { ...x, skill: e.target.value } : x)))} className="form-input w-28" placeholder="装配/焊工…" />
                      </td>
                      <td className="px-3 py-2">
                        <select value={m.skill_level || ''} onChange={(e) => setMembers((p) => p.map((x, i) => (i === idx ? { ...x, skill_level: e.target.value } : x)))} className="form-input w-24">
                          <option value="">-</option>
                          {Object.entries(SKILL_LEVEL_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input value={m.phone || ''} onChange={(e) => setMembers((p) => p.map((x, i) => (i === idx ? { ...x, phone: e.target.value } : x)))} className="form-input w-32" />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setMembers((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : [emptyMember()]))}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                          title="移除成员"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-400 mt-1">未填姓名的行不会保存；保存时按当前列表整体替换成员。</div>
          </div>
        </div>
      </Modal>

      {/* 成员查看 */}
      <Modal title={`${detail?.name || ''} 成员（${detail?.member_count || 0} 人）`} open={!!detail} onCancel={() => setDetail(null)} footer={null} width={720}>
        {detail && (
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {['姓名', '工号', '工种', '等级', '电话', '状态'].map((h) => (
                    <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(detail.edges?.members || []).length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-400">暂无成员</td></tr>
                ) : (
                  (detail.edges?.members || []).map((m, i) => (
                    <tr key={m.id || i}>
                      <td className="px-3 py-2 text-sm text-gray-900">{m.name}</td>
                      <td className="px-3 py-2 text-sm text-gray-600">{m.employee_no || '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-600">{m.skill || '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-600">{m.skill_level ? (SKILL_LEVEL_TEXT[m.skill_level] || m.skill_level) : '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-600">{m.phone || '-'}</td>
                      <td className="px-3 py-2 text-sm">{m.is_active !== false ? <span className="text-green-600">在岗</span> : <span className="text-gray-400">离岗</span>}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
