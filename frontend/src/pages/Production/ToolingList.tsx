import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, Wrench } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import {
  toolingApi, Tooling, TOOLING_CATEGORY_TEXT, TOOLING_STATUS_TEXT,
} from '@/api/production';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { Pagination } from '@/components/Pagination';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { confirmAction } from '@/utils/confirm';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';

/**
 * 模具 / 工装 / 夹具 / 量具（2026-09-11）
 *
 * 生产资料管理之「工装」：设计寿命 + 累计使用次数（寿命预警）、保养周期（到期提醒）。
 * 使用登记 / 保养登记 / 报废 三个动作都要留痕，状态自动流转。
 */
const STATUS_CLS: Record<string, string> = {
  idle: 'bg-gray-100 text-gray-600',
  in_use: 'bg-green-50 text-green-600',
  maintenance: 'bg-amber-50 text-amber-600',
  scrapped: 'bg-gray-200 text-gray-500',
};

const emptyForm = {
  name: '', category: 'mold', model: '', spec: '', applicable_product_name: '',
  life_times: '', location: '', responsible: '', purchase_date: '', cost: '',
  last_maintain_date: '', next_maintain_date: '', maintain_interval_days: '', remark: '',
};

export function ToolingList() {
  // [2026-09-18 权限细化·批 2 生产] 新增=tooling_create；使用登记/保养登记/报废/编辑=tooling_edit；删除=tooling_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ page: 1, page_size: 10, keyword: '', category: '', status: '' });
  const [list, setList] = useState<Tooling[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [applied, setApplied] = useState(String(urlFilters.keyword || ''));
  const [category, setCategory] = useState(String(urlFilters.category || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [nearing, setNearing] = useState(false);
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);

  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    syncUrl({ keyword: applied, category, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, category, status, pagination.page, pagination.page_size]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await toolingApi.list({
        page: pagination.page, page_size: pagination.page_size,
        keyword: applied || undefined, category: category || undefined, status: status || undefined,
        nearing_days: nearing ? 30 : undefined,
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
  }, [pagination.page, pagination.page_size, applied, category, status, nearing, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openCreate = () => { setEditId(''); setForm(emptyForm); setOpen(true); };
  const openEdit = (t: Tooling) => {
    setEditId(t.id);
    setForm({
      name: t.name || '', category: t.category || 'mold', model: t.model || '', spec: t.spec || '',
      applicable_product_name: t.applicable_product_name || '', life_times: String(t.life_times ?? ''),
      location: t.location || '', responsible: t.responsible || '',
      purchase_date: t.purchase_date?.slice(0, 10) || '', cost: t.cost ? String(Number(t.cost)) : '',
      last_maintain_date: t.last_maintain_date?.slice(0, 10) || '',
      next_maintain_date: t.next_maintain_date?.slice(0, 10) || '',
      maintain_interval_days: String(t.maintain_interval_days ?? ''), remark: t.remark || '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { message.warning('请填写工装名称'); return; }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        category: form.category,
        model: form.model,
        spec: form.spec,
        applicable_product_name: form.applicable_product_name,
        life_times: Number(form.life_times || 0),
        location: form.location,
        responsible: form.responsible,
        purchase_date: form.purchase_date || undefined,
        cost: form.cost || '',
        last_maintain_date: form.last_maintain_date || undefined,
        next_maintain_date: form.next_maintain_date || undefined,
        maintain_interval_days: Number(form.maintain_interval_days || 0),
        remark: form.remark,
      };
      const res = editId ? await toolingApi.update(editId, data) : await toolingApi.create(data);
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

  const doUse = async (t: Tooling) => {
    const input = window.prompt(`登记使用次数（${t.name}，当前累计 ${t.used_times}）：`, '1');
    if (input === null) return;
    const times = Number(input || 0);
    if (!(times > 0)) { message.warning('次数需大于 0'); return; }
    try {
      const res = await toolingApi.use(t.id, times);
      if (res.code === 0) {
        const after = res.data;
        if (after.life_times > 0 && after.used_times >= after.life_times) {
          message.warning(`已登记；累计使用 ${after.used_times} 次，达设计寿命 ${after.life_times} 次，建议检修或报废`);
        } else {
          message.success(`已登记使用 ${times} 次（累计 ${after.used_times}）`);
        }
        fetchList();
      }
    } catch (e: any) {
      message.error(e?.message || '登记失败');
    }
  };

  const doMaintain = async (t: Tooling) => {
    const ok = await confirmAction({
      title: `登记保养：${t.name}`,
      content: t.maintain_interval_days > 0
        ? `将记录本次保养日期，并按 ${t.maintain_interval_days} 天周期自动推算下次保养日期。`
        : '将记录本次保养日期（未设置保养周期，不会推算下次日期）。',
    });
    if (!ok) return;
    try {
      const res = await toolingApi.maintain(t.id, {});
      if (res.code === 0) {
        message.success(res.data?.next_maintain_date ? `已保养；下次保养 ${String(res.data.next_maintain_date).slice(0, 10)}` : '已登记保养');
        fetchList();
      }
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const doScrap = async (t: Tooling) => {
    const ok = await confirmAction({
      title: `报废工装「${t.name}」？`,
      content: '报废后不可再登记使用；如需重新启用请编辑状态。',
      okText: '报废',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await toolingApi.scrap(t.id);
      if (res.code === 0) { message.success('已报废'); fetchList(); }
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const handleDelete = async (t: Tooling) => {
    const ok = await confirmAction({ title: `删除工装「${t.name}」？`, danger: true });
    if (!ok) return;
    try {
      const res = await toolingApi.remove(t.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); }
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const lifeHint = (t: Tooling) => {
    if (!t.life_times) return <span className="text-gray-400 text-xs">未设置寿命</span>;
    const rate = Math.min(100, Math.round((t.used_times / t.life_times) * 100));
    return (
      <div>
        <div className="text-xs text-gray-600">{t.used_times} / {t.life_times} 次（{rate}%）</div>
        <div className="mt-1 h-1.5 w-20 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${rate >= 90 ? 'bg-red-500' : rate >= 70 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${rate}%` }} />
        </div>
      </div>
    );
  };

  const labelCls = 'block text-sm text-gray-600 mb-1';
  const inputCls = 'form-input';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Tooling) => ReactNode;
  }
  const TH_C = 'px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-4';
  const rowCols: RowCol[] = [
    { key: 'tooling_no', header: '工装编号', cell: (t) => <span className="font-mono text-sm text-gray-900">{t.tooling_no}</span> },
    {
      key: 'name',
      header: '名称',
      cell: (t) => (
        <>
          {t.name}
          {t.model && <div className="text-xs text-gray-400">{t.model}{t.spec ? ` / ${t.spec}` : ''}</div>}
        </>
      ),
    },
    { key: 'category', header: '类别', cellCls: `${TD} text-gray-600 text-sm`, cell: (t) => <span>{TOOLING_CATEGORY_TEXT[t.category] || t.category}</span> },
    { key: 'applicable', header: '适用产品', cellCls: `${TD} text-gray-600 text-sm`, cell: (t) => <span>{t.applicable_product_name || '-'}</span> },
    { key: 'life', header: '寿命使用', cell: (t) => lifeHint(t) },
    { key: 'next_maintain', header: '下次保养', cellCls: `${TD} text-gray-600 text-sm`, cell: (t) => <span>{t.next_maintain_date ? String(t.next_maintain_date).slice(0, 10) : '-'}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (t) => (
        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_CLS[t.status] || ''}`}>
          {TOOLING_STATUS_TEXT[t.status] || t.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      cellCls: `${TD} whitespace-nowrap`,
      cell: (t) => (
        <RowActions
          actions={[
            ...(t.status !== 'scrapped' && has('tooling_edit')
              ? [
                  { key: 'use', label: '登记使用', icon: <Plus className="w-4 h-4" />, onClick: () => doUse(t) },
                  { key: 'maint', label: '登记保养', icon: <Wrench className="w-4 h-4" />, onClick: () => doMaintain(t) },
                ]
              : []),
            ...(has('tooling_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(t) }]
              : []),
            ...(t.status !== 'scrapped'
              ? (has('tooling_edit')
                  ? [{ key: 'scrap', label: '报废', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => doScrap(t) }]
                  : [])
              : (has('tooling_delete')
                  ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(t) }]
                  : [])),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'tooling-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="模具工装"
        subtitle="模具 / 夹具 / 量具台账：寿命预警、使用登记与保养周期（生产资料管理）"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={fetchList} className="btn-secondary flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">刷新</span>
            </button>
            {has('tooling_create') && (
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />新增工装
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
          placeholder="搜索编号/名称/型号/适用产品/负责人"
          className="form-input w-72"
        />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input w-32">
          <option value="">全部类别</option>
          {Object.entries(TOOLING_CATEGORY_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input w-32">
          <option value="">全部状态</option>
          {Object.entries(TOOLING_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={nearing} onChange={(e) => { setNearing(e.target.checked); setPagination((p) => ({ ...p, page: 1 })); }} className="w-4 h-4 accent-blue-600" />
          只看 30 天内需保养
        </label>
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
                      onClear={() => { setKeyword(''); setApplied(''); setCategory(''); setStatus(''); setNearing(false); }}
                      title="暂无工装"
                      description="点右上角「新增工装」建立模具/工装台账"
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

      <Modal title={editId ? '编辑工装' : '新增工装'} open={open} onCancel={() => setOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={720}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 py-2">
          <div className="md:col-span-2">
            <label className={labelCls}>名称 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="如：手机外壳注塑模" />
          </div>
          <div>
            <label className={labelCls}>类别</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
              {Object.entries(TOOLING_CATEGORY_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>型号</label>
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>规格</label>
            <input value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>适用产品</label>
            <input value={form.applicable_product_name} onChange={(e) => setForm({ ...form, applicable_product_name: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>设计寿命（次，0 = 不限）</label>
            <input type="text" inputMode="numeric" value={form.life_times} onChange={(e) => setForm({ ...form, life_times: e.target.value })} className={inputCls} placeholder="100000" />
          </div>
          <div>
            <label className={labelCls}>保养周期（天，0 = 不提醒）</label>
            <input type="text" inputMode="numeric" value={form.maintain_interval_days} onChange={(e) => setForm({ ...form, maintain_interval_days: e.target.value })} className={inputCls} placeholder="30" />
          </div>
          <div>
            <label className={labelCls}>下次保养日期</label>
            <input type="date" value={form.next_maintain_date} onChange={(e) => setForm({ ...form, next_maintain_date: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>存放位置</label>
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>负责人</label>
            <input value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>购入日期</label>
            <input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>成本（元）</label>
            <input type="text" inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className={inputCls} placeholder={`如 ${format.currency(0)}`} />
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>备注</label>
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className={inputCls} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
