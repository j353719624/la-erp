import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, RefreshCw, Archive, History } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import { fixedAssetApi } from '@/api/finance';
import { format, toLocalDateISO } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import { RowActions } from '@/components/RowActions';
import type { RowAction } from '@/components/RowActions';
import type { ReactNode } from 'react';
import { confirmAction } from '@/utils/confirm';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';

const CATEGORY_TEXT: Record<string, string> = { equipment: '设备', building: '房产', vehicle: '车辆', office: '办公', other: '其他' };
const STATUS_TEXT: Record<string, string> = { in_use: '使用中', retired: '已处置' };

interface Asset { id: string; asset_no: string; name: string; category: string; acquisition_date: string; original_value: string; monthly_depreciation: string; accumulated_depreciation: string; net_value: string; status: string; }

export function FixedAssets() {
  // [2026-09-18 权限细化] 新增/处置/计提折旧=fixed_asset_edit、create；删除=fixed_asset_delete
  const { has } = usePermission();
  const [list, setList] = useState<Asset[]>([]);
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
  const [depLoading, setDepLoading] = useState(false);
  const [depOpen, setDepOpen] = useState(false);
  const [depList, setDepList] = useState<any[]>([]);
  const [depListLoading, setDepListLoading] = useState(false);
  const [form, setForm] = useState<any>({ name: '', category: 'equipment', original_value: '', useful_life_months: 60, salvage_rate: '0.05', acquisition_date: format.today(), remark: '' });
  // 请求竞态守卫：快速翻页时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  const handleViewDepreciation = async () => {
    setDepOpen(true);
    setDepListLoading(true);
    try {
      const res = await fixedAssetApi.depreciationEntries();
      if (res.code === 0) setDepList(Array.isArray(res.data) ? res.data : []);
      else setDepList([]);
    } catch { setDepList([]); } finally { setDepListLoading(false); }
  };

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams = { page: pagination.page, page_size: pagination.page_size };
      const res = await fixedAssetApi.list(params);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []); setPagination(p => ({ ...p, total: res.data?.total ?? 0 }));
      }
    } catch { /* */ } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleCreate = async () => {
    if (!form.name.trim() || !(parseFloat(form.original_value) > 0)) { message.warning('请填写名称与原值'); return; }
    setSaving(true);
    try {
      const res = await fixedAssetApi.create({
        name: form.name, category: form.category, original_value: parseFloat(form.original_value),
        useful_life_months: parseInt(form.useful_life_months) || 60, salvage_rate: parseFloat(form.salvage_rate) || 0,
        acquisition_date: toLocalDateISO(form.acquisition_date),
        remark: form.remark || undefined,
      });
      if (res.code === 0) { message.success('资产已入账'); setOpen(false); fetchList(); } else { message.error(res.message || '创建失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '创建失败'); } finally { setSaving(false); }
  };

  const handleDepreciation = async () => {
    const period = prompt('请输入计提期间（YYYY-MM）：') || '';
    if (!/^\d{4}-\d{2}$/.test(period)) { message.warning('期间格式错误'); return; }
    setDepLoading(true);
    try {
      const res = await fixedAssetApi.runDepreciation(period);
      if (res.code === 0) { message.success(`已计提 ${res.data?.total ?? 0} 条折旧并生成凭证`); fetchList(); } else { message.error(res.message || '计提失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '计提失败'); } finally { setDepLoading(false); }
  };

  const handleRetire = async (a: Asset) => {
    if (!(await confirmAction({ title: `处置资产 ${a.asset_no}？`, danger: true }))) return;
    const res = await fixedAssetApi.retire(a.id);
    if (res.code === 0) { message.success('已处置'); fetchList(); } else { message.error(res.message || '处置失败'); }
  };

  const handleDelete = async (a: Asset) => {
    if (!(await confirmAction({ title: `删除资产 ${a.asset_no}？`, danger: true }))) return;
    const res = await fixedAssetApi.remove(a.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); } else { message.error(res.message || '删除失败'); }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Asset) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'asset_no', header: '资产编号', cell: (a) => <span className="font-medium text-gray-900">{a.asset_no}</span> },
    { key: 'name', header: '名称', cell: (a) => <span className="text-gray-900">{a.name}</span> },
    { key: 'category', header: '类别', cell: (a) => <span className="text-gray-500 text-sm">{CATEGORY_TEXT[a.category] || a.category}</span> },
    { key: 'original_value', header: '原值', headCls: TH_R, cellCls: `${TD} text-right`, cell: (a) => <span className="text-gray-900">¥{format.currency(parseFloat(a.original_value))}</span> },
    { key: 'monthly_depreciation', header: '月折旧', headCls: TH_R, cellCls: `${TD} text-right`, cell: (a) => <span className="text-gray-600">¥{format.currency(parseFloat(a.monthly_depreciation))}</span> },
    { key: 'accumulated_depreciation', header: '累计折旧', headCls: TH_R, cellCls: `${TD} text-right`, cell: (a) => <span className="text-gray-600">¥{format.currency(parseFloat(a.accumulated_depreciation))}</span> },
    { key: 'net_value', header: '净值', headCls: TH_R, cellCls: `${TD} text-right`, cell: (a) => <span className="font-medium text-gray-900">¥{format.currency(parseFloat(a.net_value))}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (a) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.status === 'in_use' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>{STATUS_TEXT[a.status] || a.status}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      // [2026-09-14 统一操作列] 手写条件按钮迁移 RowActions：窄屏折叠「主操作 + ⋮」，操作列 ~88px
      cell: (a) => {
        const actions: RowAction[] = [];
        if (a.status === 'in_use' && has('fixed_asset_edit')) {
          actions.push({ key: 'retire', label: '处置', icon: <Archive className="w-4 h-4" />, primary: true, onClick: () => handleRetire(a) });
        }
        if (parseFloat(a.accumulated_depreciation) === 0 && has('fixed_asset_delete')) {
          actions.push({ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(a) });
        }
        return <RowActions actions={actions} />;
      },
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'fixed-asset-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="固定资产"
        subtitle="资产卡片 + 按月计提折旧并自动生成凭证"
        extra={
          <>
            {has('fixed_asset_edit') && (
              <button onClick={handleDepreciation} disabled={depLoading} className="btn-secondary flex items-center gap-2 mr-2">
                <RefreshCw className={`w-4 h-4 ${depLoading ? 'animate-spin' : ''}`} /><span className="hidden md:inline">计提折旧</span>
              </button>
            )}
            <button onClick={handleViewDepreciation} className="btn-secondary flex items-center gap-2 mr-2">
              <History className="w-4 h-4" /><span className="hidden md:inline">折旧记录</span>
            </button>
            {has('fixed_asset_create') && (
              <button onClick={() => setOpen(true)} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" /><span className="hidden md:inline">新增资产</span>
              </button>
            )}
          </>
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
                : list.length === 0 ? (<tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty title="暂无固定资产" description="点击右上角「新增资产」建立资产卡片，按月计提折旧" /></td></tr>)
                : list.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(a)}
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

      <Modal title="新增固定资产" open={open} onCancel={() => setOpen(false)} onOk={handleCreate} confirmLoading={saving} okText="入账" cancelText="取消">
        <div className="space-y-3 py-2">
          <div><label className="block text-sm text-gray-600 mb-1">资产名称 *</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：数控机床" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">类别</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="form-input">
                {Object.entries(CATEGORY_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="block text-sm text-gray-600 mb-1">折旧月数</label><Input type="number" value={form.useful_life_months} onChange={(e) => setForm({ ...form, useful_life_months: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">原值 *</label><Input type="number" value={form.original_value} onChange={(e) => setForm({ ...form, original_value: e.target.value })} placeholder="如：120000" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">净残值率</label><Input type="number" value={form.salvage_rate} onChange={(e) => setForm({ ...form, salvage_rate: e.target.value })} placeholder="如：0.05" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">入账日期</label><Input type="date" value={form.acquisition_date} onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">备注</label><Input value={form.remark || ''} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="请选择日期" /></div>
          </div>
        </div>
      </Modal>

      <Modal title="折旧记录" open={depOpen} onCancel={() => setDepOpen(false)} footer={null} width={640}>
        <div className="overflow-x-auto py-2">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left">计提期间</th>
                <th className="px-4 py-2 text-left">资产</th>
                <th className="px-4 py-2 text-right">折旧金额</th>
                <th className="px-4 py-2 text-left">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {depListLoading ? <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">加载中...</td></tr>
                : depList.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">暂无折旧记录</td></tr>
                : depList.map((d, i) => {
                  const asset = list.find(a => a.id === d.asset_id);
                  return (
                    <tr key={i}>
                      <td className="px-4 py-2">{d.period || '-'}</td>
                      <td className="px-4 py-2">{asset ? `${asset.asset_no} ${asset.name}` : (d.asset_id || '-')}</td>
                      <td className="px-4 py-2 text-right">¥{format.currency(Number(d.amount) || 0)}</td>
                      <td className="px-4 py-2">{d.status === 'posted' ? '已过账' : (d.status || '-')}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
