import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, Wrench } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import {
  equipmentApi, equipmentMaintenanceApi, ProductionEquipment, EquipmentMaintenance,
  EQUIPMENT_STATUS_TEXT, MAINTENANCE_TYPE_TEXT, productionApi,
} from '@/api/production';
import { SearchSelect } from '@/components/SearchSelect';
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
 * 生产设备台账（2026-09-11）
 *
 * 生产资料管理之「设备」：设备档案 + 运行状态 + 保养/维修/点检记录。
 * 保养完成时设备自动从「维修中/保养中」回到「空闲」，避免状态卡死。
 */
const STATUS_CLS: Record<string, string> = {
  idle: 'bg-gray-100 text-gray-600',
  running: 'bg-green-50 text-green-600',
  maintenance: 'bg-amber-50 text-amber-600',
  repair: 'bg-red-50 text-red-600',
  scrapped: 'bg-gray-200 text-gray-500',
};

const emptyForm = {
  name: '', category: '', model: '', spec: '', manufacturer: '', serial_no: '',
  location: '', work_center_id: '', work_center_name: '', status: 'idle', capacity_per_hour: '',
  purchase_date: '', warranty_until: '', responsible: '', is_active: true, remark: '',
};

export function EquipmentList() {
  // [2026-09-18 权限细化·批 2 生产] 新增=equipment_create；编辑/保养维修点检登记与完成=equipment_edit；删除=equipment_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ page: 1, page_size: 10, keyword: '', status: '' });
  const [list, setList] = useState<ProductionEquipment[]>([]);
  const [workCenters, setWorkCenters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [applied, setApplied] = useState(String(urlFilters.keyword || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);

  // 详情 + 保养记录
  const [detail, setDetail] = useState<ProductionEquipment | null>(null);
  const [maintOpen, setMaintOpen] = useState(false);
  const [maintForm, setMaintForm] = useState<any>({ record_type: 'maintain', plan_date: '', content: '', executor: '', cost: '' });
  const [maintSaving, setMaintSaving] = useState(false);

  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    syncUrl({ keyword: applied, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, status, pagination.page, pagination.page_size]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await equipmentApi.list({
        page: pagination.page, page_size: pagination.page_size,
        keyword: applied || undefined, status: status || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list ?? []);
        setPagination((p) => ({ ...p, total: res.data?.total ?? 0 }));
      }
    } catch (e: any) {
      message.error(e?.message || '加载设备失败');
    } finally {
      if (isCurrent(seq)) setLoading(false);
    }
  }, [pagination.page, pagination.page_size, applied, status, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // 工作中心下拉（设备归属工序/产能中心；存 id + 名称快照）
  useEffect(() => {
    productionApi.workCenterList({ page: 1, page_size: 200 })
      .then((res: any) => { if (res.code === 0) setWorkCenters(res.data?.list || []); })
      .catch(() => { /* 静默：无工作中心不影响建台账 */ });
  }, []);

  const openCreate = () => { setEditId(''); setForm(emptyForm); setOpen(true); };
  const openEdit = (e: ProductionEquipment) => {
    setEditId(e.id);
    setForm({
      name: e.name || '', category: e.category || '', model: e.model || '', spec: e.spec || '',
      manufacturer: e.manufacturer || '', serial_no: e.serial_no || '', location: e.location || '',
      work_center_id: e.work_center_id || '', work_center_name: e.work_center_name || '',
      status: e.status || 'idle',
      capacity_per_hour: String(e.capacity_per_hour ?? ''), purchase_date: e.purchase_date?.slice(0, 10) || '',
      warranty_until: e.warranty_until?.slice(0, 10) || '', responsible: e.responsible || '',
      is_active: e.is_active !== false, remark: e.remark || '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { message.warning('请填写设备名称'); return; }
    setSaving(true);
    try {
      const data = {
        ...form,
        name: form.name.trim(),
        work_center_id: form.work_center_id || undefined,
        capacity_per_hour: Number(form.capacity_per_hour || 0),
        purchase_date: form.purchase_date || undefined,
        warranty_until: form.warranty_until || undefined,
      };
      const res = editId ? await equipmentApi.update(editId, data) : await equipmentApi.create(data);
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

  const openDetail = async (e: ProductionEquipment) => {
    setDetail(e);
    try {
      const res = await equipmentApi.get(e.id);
      if (res.code === 0) setDetail(res.data);
    } catch { /* 静默：保留列表行数据 */ }
  };

  const reloadDetail = async (id: string) => {
    try {
      const res = await equipmentApi.get(id);
      if (res.code === 0) setDetail(res.data);
    } catch { /* 静默 */ }
  };

  const handleDelete = async (e: ProductionEquipment) => {
    const ok = await confirmAction({
      title: `删除设备「${e.name}」？`,
      content: '该设备的保养/维修记录将一并删除（软删除）。',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await equipmentApi.remove(e.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); }
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    }
  };

  const submitMaintenance = async () => {
    if (!detail) return;
    if (!maintForm.content.trim()) { message.warning('请填写保养/维修内容'); return; }
    setMaintSaving(true);
    try {
      const res = await equipmentMaintenanceApi.create({
        equipment_id: detail.id,
        record_type: maintForm.record_type,
        plan_date: maintForm.plan_date || undefined,
        content: maintForm.content.trim(),
        executor: maintForm.executor.trim() || undefined,
        cost: maintForm.cost || undefined,
      });
      if (res.code === 0) {
        message.success('已登记');
        setMaintOpen(false);
        setMaintForm({ record_type: 'maintain', plan_date: '', content: '', executor: '', cost: '' });
        reloadDetail(detail.id);
        fetchList();
      }
    } catch (e: any) {
      message.error(e?.message || '登记失败');
    } finally {
      setMaintSaving(false);
    }
  };

  const doneMaintenance = async (rec: EquipmentMaintenance) => {
    const result = window.prompt('完成说明（可选）：', '正常');
    if (result === null) return;
    const cost = window.prompt('费用（可选，如 380.50）：', '');
    if (cost === null) return;
    try {
      const res = await equipmentMaintenanceApi.done(rec.id, { result, cost: cost || undefined });
      if (res.code === 0) {
        message.success('已完成');
        if (detail) reloadDetail(detail.id);
        fetchList();
      }
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const labelCls = 'block text-sm text-gray-600 mb-1';
  const inputCls = 'form-input';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: ProductionEquipment) => ReactNode;
  }
  const TH_C = 'px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-4';
  const rowCols: RowCol[] = [
    { key: 'equipment_no', header: '设备编号', cell: (e) => <span className="font-mono text-sm text-gray-900">{e.equipment_no}</span> },
    { key: 'name', header: '名称', cell: (e) => <span className="text-gray-900">{e.name}</span> },
    { key: 'model', header: '型号', cellCls: `${TD} text-gray-600 text-sm`, cell: (e) => <span>{e.model || '-'}</span> },
    { key: 'location', header: '位置', cellCls: `${TD} text-gray-600 text-sm`, cell: (e) => <span>{e.location || '-'}</span> },
    { key: 'work_center', header: '工作中心', cellCls: `${TD} text-gray-600 text-sm`, cell: (e) => <span>{e.work_center_name || '-'}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (e) => (
        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_CLS[e.status] || ''}`}>
          {EQUIPMENT_STATUS_TEXT[e.status] || e.status}
        </span>
      ),
    },
    { key: 'responsible', header: '负责人', cellCls: `${TD} text-gray-600 text-sm`, cell: (e) => <span>{e.responsible || '-'}</span> },
    {
      key: '__actions',
      header: '操作',
      cellCls: `${TD} whitespace-nowrap`,
      cell: (e) => (
        <RowActions
          actions={[
            { key: 'maint', label: '保养记录', icon: <Wrench className="w-4 h-4" />, onClick: () => openDetail(e) },
            ...(has('equipment_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(e) }]
              : []),
            ...(has('equipment_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(e) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'equipment-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="生产设备"
        subtitle="设备台账 + 保养/维修/点检记录（生产资料管理）"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={fetchList} className="btn-secondary flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">刷新</span>
            </button>
            {has('equipment_create') && (
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />新增设备
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
          placeholder="搜索设备编号/名称/型号/位置/负责人"
          className="form-input w-72"
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input w-36">
          <option value="">全部状态</option>
          {Object.entries(EQUIPMENT_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {(applied || status) && (
          <button
            onClick={() => { setKeyword(''); setApplied(''); setStatus(''); setPagination((p) => ({ ...p, page: 1 })); }}
            className="btn-secondary"
          >清空筛选</button>
        )}
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
                      filterNote={status ? `状态「${EQUIPMENT_STATUS_TEXT[status] || status}」` : undefined}
                      onClear={() => { setKeyword(''); setApplied(''); setStatus(''); }}
                      title="暂无设备"
                      description="点右上角「新增设备」建立设备台账，之后可登记保养/维修记录"
                    />
                  </td>
                </tr>
              ) : (
                list.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(e)}
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

      {/* 新增/编辑设备 */}
      <Modal title={editId ? '编辑设备' : '新增设备'} open={open} onCancel={() => setOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={720}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 py-2">
          <div className="md:col-span-2">
            <label className={labelCls}>设备名称 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="如：注塑机 1 号" />
          </div>
          <div>
            <label className={labelCls}>状态</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
              {Object.entries(EQUIPMENT_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>设备类别</label>
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} placeholder="加工/检验/包装…" />
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
            <label className={labelCls}>制造商</label>
            <input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>出厂编号</label>
            <input value={form.serial_no} onChange={(e) => setForm({ ...form, serial_no: e.target.value })} className={inputCls}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          </div>
          <div>
            <label className={labelCls}>存放位置</label>
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>工作中心</label>
            <SearchSelect
              value={form.work_center_id}
              onChange={(v) => {
                const wc = workCenters.find((w: any) => w.id === v);
                setForm({ ...form, work_center_id: v || '', work_center_name: wc?.name || '' });
              }}
              placeholder="请选择工作中心（可不选）"
              options={workCenters.map((w: any) => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div>
            <label className={labelCls}>产能（件/小时）</label>
            <input type="text" inputMode="decimal" value={form.capacity_per_hour} onChange={(e) => setForm({ ...form, capacity_per_hour: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>购入日期</label>
            <input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>保修至</label>
            <input type="date" value={form.warranty_until} onChange={(e) => setForm({ ...form, warranty_until: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>负责人</label>
            <input value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} className={inputCls} />
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>备注</label>
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className={inputCls} />
          </div>
          <label className="md:col-span-3 flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 accent-blue-600" />
            启用
          </label>
        </div>
      </Modal>

      {/* 详情 + 保养/维修记录 */}
      <Modal
        title={`${detail?.name || ''}（${detail?.equipment_no || ''}）保养/维修记录`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={820}
      >
        {detail && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-gray-400">状态</div>{EQUIPMENT_STATUS_TEXT[detail.status] || detail.status}</div>
              <div><div className="text-xs text-gray-400">型号/规格</div>{detail.model || '-'} {detail.spec || ''}</div>
              <div><div className="text-xs text-gray-400">位置</div>{detail.location || '-'}</div>
              <div><div className="text-xs text-gray-400">负责人</div>{detail.responsible || '-'}</div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-gray-700">保养 / 维修 / 点检记录</div>
              {has('equipment_edit') && (
                <button onClick={() => setMaintOpen(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
                  <Plus className="w-4 h-4" />登记记录
                </button>
              )}
            </div>

            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    {['类型', '计划日期', '完成日期', '内容', '执行人', '费用', '状态', '操作'].map((h) => (
                      <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(detail.edges?.maintenances || []).length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">暂无记录</td></tr>
                  ) : (
                    (detail.edges?.maintenances || []).map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 text-sm">{MAINTENANCE_TYPE_TEXT[r.record_type] || r.record_type}</td>
                        <td className="px-3 py-2 text-sm text-gray-600">{r.plan_date?.slice(0, 10) || '-'}</td>
                        <td className="px-3 py-2 text-sm text-gray-600">{r.done_date?.slice(0, 10) || '-'}</td>
                        <td className="px-3 py-2 text-sm text-gray-800">{r.content || '-'}{r.result ? `（${r.result}）` : ''}</td>
                        <td className="px-3 py-2 text-sm text-gray-600">{r.executor || '-'}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{r.cost && Number(r.cost) ? `¥${Number(r.cost).toFixed(2)}` : '-'}</td>
                        <td className="px-3 py-2 text-sm">
                          {r.status === 'done' ? <span className="text-green-600">已完成</span> : <span className="text-amber-600">计划中</span>}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          {r.status === 'planned' && has('equipment_edit') && (
                            <button onClick={() => doneMaintenance(r)} className="text-blue-600 hover:underline">完成</button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-400">
              完成保养/维修后，设备状态若为「保养中/维修中」会自动回到「空闲」。
            </div>
          </div>
        )}
      </Modal>

      {/* 登记保养/维修 */}
      <Modal title="登记保养 / 维修 / 点检" open={maintOpen} onCancel={() => setMaintOpen(false)} onOk={submitMaintenance} confirmLoading={maintSaving} okText="登记" cancelText="取消">
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>类型</label>
              <select value={maintForm.record_type} onChange={(e) => setMaintForm({ ...maintForm, record_type: e.target.value })} className={inputCls}>
                {Object.entries(MAINTENANCE_TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>计划日期</label>
              <input type="date" value={maintForm.plan_date} onChange={(e) => setMaintForm({ ...maintForm, plan_date: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>内容 *</label>
            <input value={maintForm.content} onChange={(e) => setMaintForm({ ...maintForm, content: e.target.value })} className={inputCls} placeholder="如：更换加热圈 / 月度保养" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>执行人 / 单位</label>
              <input value={maintForm.executor} onChange={(e) => setMaintForm({ ...maintForm, executor: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>费用（可空）</label>
              <input type="text" inputMode="decimal" value={maintForm.cost} onChange={(e) => setMaintForm({ ...maintForm, cost: e.target.value })} className={inputCls} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
