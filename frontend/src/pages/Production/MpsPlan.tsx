import { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw, Hammer, List } from 'lucide-react';
import { productionApi } from '@/api/production';
import { productApi } from '@/api/product';
import { MPSPlan, MPSPlanLine } from '@/types/production';
import { Pagination } from '@/components/Pagination';
import { SearchSelect } from '@/components/SearchSelect';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { RowActions } from '@/components/RowActions';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { toLocalDateISO, DATE_END_SUFFIX } from '@/utils/format';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

const fmt = (v: string | number | undefined, d = 0) => (v === undefined || v === null || v === '' ? '0' : Number(v).toFixed(d));
const fmtDate = (s?: string) => (s ? s.slice(0, 10) : '-');

export function MpsPlan() {
  // [2026-09-18 权限细化·批 2 生产] 生成=mps_create；生成工单=mps_edit；删除=mps_delete
  const { has } = usePermission();
  const [plans, setPlans] = useState<MPSPlan[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 页码写入 URL（刷新/发链接保留当前页）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 页码变化 → 写回 URL
  useEffect(() => {
    syncUrl({ page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.page_size]);

  // 生成弹窗
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ period_start: '', period_end: '', product_ids: [] as string[] });

  // 详情
  const [detail, setDetail] = useState<MPSPlan | null>(null);
  // 请求竞态守卫：快速翻页时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => { fetchPlans(); }, [pagination.page]);

  const fetchPlans = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await productionApi.mpsList({ page: pagination.page, page_size: pagination.page_size });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setPlans(res.data?.list || []);
        setPagination(prev => ({ ...prev, total: res.data?.total || 0 }));
      }
    } catch { /* 静默 */ }
    finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const openGen = async () => {
    setGenOpen(true);
    setForm({ period_start: '', period_end: '', product_ids: [] });
    try {
      const res = await productApi.list({ page: 1, page_size: 1000, status: 'active' });
      setProducts((res as any).data?.list || []);
    } catch { /* 静默 */ }
  };

  const handleGenerate = async () => {
    if (!form.period_start || !form.period_end) { message.warning('请选择计划期间'); return; }
    if (form.period_end < form.period_start) { message.warning('结束日期不能早于开始日期'); return; }
    setGenLoading(true);
    try {
      const res = await productionApi.mpsGenerate({
        period_start: toLocalDateISO(form.period_start),
        // 结束日必须用**本地**当日末刻（曾写 `T23:59:59Z`＝本地次日 07:59:59 → 把结束日后一天的订单算进需求）
        period_end: form.period_end ? form.period_end + DATE_END_SUFFIX : undefined,
        product_ids: form.product_ids.length ? form.product_ids : undefined,
      });
      if (res.code === 0) {
        message.success(`计划 ${res.data?.code} 已生成`);
        setGenOpen(false);
        fetchPlans();
      } else { message.error(res.message || '生成失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '生成失败'); }
    finally { setGenLoading(false); }
  };

  const openDetail = async (id: string) => {
    const res = await productionApi.mpsGet(id);
    if (res.code === 0) setDetail(res.data || null);
    else message.error(res.message || '加载失败');
  };

  const handleDelete = async (id: string, code: string) => {
    if (!(await confirmAction({ title: `确定删除计划 ${code}？`, danger: true }))) return;
    const res = await productionApi.mpsDelete(id);
    if (res.code === 0) { message.success('已删除'); fetchPlans(); }
    else message.error(res.message || '删除失败');
  };

  const handleGenWO = async (id: string, code: string) => {
    if (!(await confirmAction({ title: `确定为计划 ${code} 生成工单？`, content: '为净需求>0 的物料创建生产工单' }))) return;
    try {
      const res = await productionApi.mpsGenerateWorkOrders(id);
      if (res.code === 0) {
        message.success(`已生成 ${(res.data as any)?.created || 0} 张工单`);
        setDetail(null);
        fetchPlans();
      } else { message.error(res.message || '操作失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '操作失败'); }
  };

  const lines = detail?.edges?.lines || [];
  const netCount = lines.filter(l => Number(l.net_qty || 0) > 0).length;
  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: MPSPlan) => ReactNode;
  }
  const TH_L = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_C = 'px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-3';
  const rowCols: RowCol[] = [
    { key: 'code', header: '计划号', cellCls: `${TD} font-medium text-gray-900`, cell: (p) => <span>{p.code}</span> },
    { key: 'period', header: '期间', cellCls: `${TD} text-sm text-gray-600`, cell: (p) => <span>{fmtDate(p.period_start)} ~ {fmtDate(p.period_end)}</span> },
    {
      key: 'materials',
      header: '物料数',
      headCls: TH_C,
      cellCls: `${TD} text-center text-sm text-gray-700`,
      cell: (p) => <span>{(p.edges?.lines || []).length}</span>,
    },
    {
      key: 'nets',
      header: '净需求物料',
      headCls: TH_C,
      cellCls: `${TD} text-center text-sm text-gray-700`,
      cell: (p) => <span>{(p.edges?.lines || []).filter(l => Number(l.net_qty || 0) > 0).length}</span>,
    },
    {
      key: 'status',
      header: '状态',
      headCls: TH_C,
      cellCls: 'px-4 py-3 text-center',
      cell: (p) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${p.status === 'planned' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-600'}`}>
          {p.status === 'planned' ? '已排产' : '草稿'}
        </span>
      ),
    },
    { key: 'created_at', header: '创建时间', cellCls: `${TD} text-sm text-gray-500`, cell: (p) => <span>{(p.created_at || '').replace('T', ' ').slice(0, 16)}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (p) => (
        <RowActions
          actions={[
            { key: 'view', label: '查看明细', icon: <List className="w-4 h-4" />, onClick: () => openDetail(p.id!) },
            ...(p.status === 'draft'
              ? [
                  ...(has('mps_edit')
                    ? [{ key: 'gen', label: '生成工单', icon: <Hammer className="w-4 h-4" />, onClick: () => handleGenWO(p.id!, p.code!) }]
                    : []),
                  ...(has('mps_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(p.id!, p.code!) }]
                    : []),
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'mps-plan-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="主生产计划 MPS"
        subtitle="按期间汇总销售需求 → 扣除库存/在制得净需求 → 一键转工单"
        extra={
          has('mps_create') && (
            <button onClick={openGen} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /><span className="hidden md:inline">生成计划</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center justify-end">{viewMenu}</div>
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
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : plans.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-8"><EmptyState title="暂无计划" description="点击「生成计划」按期间汇总销售需求" /></td></tr>
              ) : (
                plans.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(p)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && plans.length > 0 && (
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        )}
      </div>

      {/* 生成弹窗 */}
      <Modal open={genOpen} onCancel={() => setGenOpen(false)} title="生成主生产计划" width={520}
        onOk={handleGenerate} okText={genLoading ? '生成中...' : '生成'} confirmLoading={genLoading}>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">开始日期 *</label>
              <input type="date" value={form.period_start} onChange={(e) => setForm(prev => ({ ...prev, period_start: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">结束日期 *</label>
              <input type="date" value={form.period_end} onChange={(e) => setForm(prev => ({ ...prev, period_end: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">产品（不选则汇总期间内全部销售需求）</label>
            <SearchSelect
              mode="multiple"
              value={form.product_ids}
              onChange={(v) => setForm(prev => ({ ...prev, product_ids: v ?? [] }))}
              placeholder="请选择产品（可搜索）"
              options={products.map(x => ({ value: x.id, label: productOptionLabel(x), search: productOptionSearch(x) }))}
            />
          </div>
          <p className="text-xs text-gray-400">需求 = 期间内确认/审批销售订单汇总；净需求 = 需求 - 现有库存 - 在制</p>
        </div>
      </Modal>

      {/* 计划明细 */}
      <Modal open={!!detail} onCancel={() => setDetail(null)} width={800} footer={null}
        title={detail ? `计划明细 ${detail.code}` : ''}>
        {detail && (
          <div>
            <div className="flex flex-wrap gap-4 mb-3 text-sm text-gray-600">
              <span>期间：<b className="text-gray-900">{fmtDate(detail.period_start)} ~ {fmtDate(detail.period_end)}</b></span>
              <span>物料数：<b className="text-gray-900">{lines.length}</b></span>
              <span>需排产：<b className="text-red-600">{netCount}</b></span>
              {has('mps_edit') && (
                <button onClick={() => handleGenWO(detail.id!, detail.code!)} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-green-600 bg-green-50 hover:bg-green-100 rounded-lg">
                  <Hammer className="w-3.5 h-3.5" /> 生成工单
                </button>
              )}
            </div>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">物料</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">期间需求</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">现有库存</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">在制</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">净需求</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-gray-400">该期间无销售需求</td></tr>
                  ) : lines.map((l, i) => (
                    <tr key={l.id || i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-700">{l.product_name}（{l.product_code}）</td>
                      <td className="px-3 py-2 text-right text-sm text-gray-900">{fmt(l.qty_demand)}</td>
                      <td className="px-3 py-2 text-right text-sm text-gray-600">{fmt(l.qty_onhand)}</td>
                      <td className="px-3 py-2 text-right text-sm text-gray-600">{fmt(l.qty_wip)}</td>
                      <td className={`px-3 py-2 text-right text-sm font-medium ${Number(l.net_qty || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmt(l.net_qty)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${l.status === 'planned' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                          {l.status === 'planned' ? '已排产' : '待排产'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
