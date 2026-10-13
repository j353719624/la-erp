import { useCallback, useEffect, useState } from 'react';
import { PlayCircle, RefreshCw, Eye, Trash2, Factory } from 'lucide-react';
import { Drawer } from 'antd';
import { message } from '@/utils/appMessage';
import { productionApi } from '@/api/production';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';
const STATUS_TEXT: Record<string, string> = { draft: '草稿', computed: '已计算', closed: '已关闭' };
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500',
  computed: 'bg-blue-50 text-blue-600',
  closed: 'bg-green-50 text-green-600',
};
const TYPE_TEXT: Record<string, string> = { purchase: '采购', production: '自制' };

interface RequirementLine {
  id: string;
  product_code?: string;
  product_name?: string;
  requirement_type?: string;
  gross_demand?: string;
  available_qty?: string;
  on_order_qty?: string;
  wip_qty?: string;
  safety_stock?: string;
  net_requirement?: string;
  suggested_qty?: string;
  status?: string;
  source_no?: string;
}

interface Requirement {
  id: string;
  mrp_no: string;
  plan_date: string;
  status: string;
  demand_source_count: number;
  remark?: string;
  edges?: { lines?: RequirementLine[] };
}

export function MrpPlan() {
  // [2026-09-18 权限细化·批 2 生产] 运算=mrp_create；生成工单=mrp_edit；删除=mrp_delete
  const { has } = usePermission();
  const [list, setList] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [status, setStatus] = useState('');
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [detail, setDetail] = useState<Requirement | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams = { page: pagination.page, page_size: pagination.page_size };
      const res = await productionApi.requirementList({ ...params, mrp_no: debouncedKeyword || undefined, status: status || undefined });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, debouncedKeyword, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleRun = async () => {
    if (!(await confirmAction({
      title: '运行物料需求计划 (MRP)？',
      content: '将根据已确认销售订单与在制工单计算净需求，并生成采购建议单。',
    }))) return;
    setRunning(true);
    try {
      const res = await productionApi.mrpRun();
      if (res.code === 0) {
        message.success(`MRP 计算完成：${res.data?.mrp_no}`);
        fetchList();
      } else {
        message.error(res.message || 'MRP 计算失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : 'MRP 计算失败');
    } finally {
      setRunning(false);
    }
  };

  const handleView = async (r: Requirement) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await productionApi.getRequirement(r.id);
      if (res.code === 0) setDetail(res.data);
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (r: Requirement) => {
    if (!(await confirmAction({ title: `确定删除需求计划 ${r.mrp_no} 吗？`, danger: true }))) return;
    const res = await productionApi.deleteRequirement(r.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); }
    else message.error(res.message || '删除失败');
  };

  const handleGenerateWorkOrders = async () => {
    if (!detail) return;
    const prodLines = lines.filter(l => l.requirement_type === 'production' && parseFloat(l.suggested_qty || '0') > 0);
    if (!(await confirmAction({
      title: '生成生产工单？',
      content: `将为 ${prodLines.length} 条自制需求生成草稿生产工单（按建议量）。`,
    }))) return;
    setGenLoading(true);
    try {
      const res = await productionApi.generateWorkOrders(detail.id);
      if (res.code === 0) {
        const list = Array.isArray(res.data) ? res.data : [];
        message.success(`已生成 ${list.length} 张生产工单`);
      } else {
        message.error(res.message || '生成失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '生成失败');
    } finally {
      setGenLoading(false);
    }
  };

  const lines = detail?.edges?.lines ?? [];
  const hasProduction = lines.some(l => l.requirement_type === 'production' && parseFloat(l.suggested_qty || '0') > 0);
  const prodCount = lines.filter(l => l.requirement_type === 'production' && parseFloat(l.suggested_qty || '0') > 0).length;

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Requirement) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'mrp_no', header: 'MRP 单号', cellCls: `${TD} font-medium text-gray-900`, cell: (r) => <span>{r.mrp_no}</span> },
    { key: 'plan_date', header: '计划日期', cellCls: `${TD} text-gray-600`, cell: (r) => <span>{format.date(r.plan_date)}</span> },
    { key: 'demand_source', header: '需求源', cellCls: `${TD} text-gray-600`, cell: (r) => <span>{r.demand_source_count} 个</span> },
    {
      key: 'status',
      header: '状态',
      cell: (r) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[r.status] || 'bg-gray-100 text-gray-500'}`}>
          {STATUS_TEXT[r.status] || r.status}
        </span>
      ),
    },
    { key: 'remark', header: '备注', cellCls: `${TD} text-gray-500 text-sm max-w-xs truncate`, cell: (r) => <span>{r.remark}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (r) => (
        <>
          <button onClick={() => handleView(r)} className="btn-ghost mr-2" title="查看">
            <Eye className="w-4 h-4" />
          </button>
          {has('mrp_delete') && (
            <button onClick={() => handleDelete(r)} className="btn-ghost text-red-500" title="删除">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'mrp-plan-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="物料需求计划"
        subtitle="根据销售订单与在制工单自动计算物料净需求"
        extra={
          has('mrp_create') && (
            <button onClick={handleRun} disabled={running} className="btn-primary flex items-center gap-2">
              {running ? <RefreshCw className="w-5 h-5 animate-spin" /> : <PlayCircle className="w-5 h-5" />}
              <span className="hidden md:inline">{running ? '计算中...' : '运行 MRP'}</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <input
            type="text"
            placeholder="搜索 MRP 单号..."
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
            className="form-input md:max-w-xs"
          />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="computed">已计算</option>
            <option value="closed">已关闭</option>
          </select>
          <div className="md:ml-auto">{viewMenu}</div>
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
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无需求计划" description="点击右上角「运行 MRP」自动计算物料需求" /></td></tr>
              ) : (
                list.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(r)}
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
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        </div>
      </div>

      <Drawer
        title={detail ? `需求计划 ${detail.mrp_no}` : '需求计划详情'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        size={880}
      >
        {detailLoading ? (
          <TableSkeleton rows={6} />
        ) : (
          <div className="space-y-4">
            {hasProduction && has('mrp_edit') && (
              <button
                onClick={handleGenerateWorkOrders}
                disabled={genLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {genLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Factory className="w-4 h-4" />}
                {genLoading ? '生成中...' : `生成生产工单（${prodCount} 项自制需求）`}
              </button>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500">MRP 单号</div>
                <div className="font-medium text-gray-900">{detail?.mrp_no}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500">计划日期</div>
                <div className="font-medium text-gray-900">{detail ? format.date(detail.plan_date) : '-'}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500">需求源</div>
                <div className="font-medium text-gray-900">{detail?.demand_source_count ?? 0} 个</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500">状态</div>
                <div className="font-medium text-gray-900">{detail ? (STATUS_TEXT[detail.status] || detail.status) : '-'}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">物料</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">类型</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">毛需求</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">可用库存</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">在途</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">在制</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">安全库存</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">净需求</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">建议量</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">来源</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">无需求明细</td></tr>
                  ) : lines.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{l.product_name || '-'}</div>
                        <div className="text-xs text-gray-400">{l.product_code || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{TYPE_TEXT[l.requirement_type || ''] || l.requirement_type || '-'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{format.qty(l.gross_demand)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{format.qty(l.available_qty)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{format.qty(l.on_order_qty)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{format.qty(l.wip_qty)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{format.qty(l.safety_stock)}</td>
                      <td className="px-4 py-3 text-right font-medium text-orange-600">{format.qty(l.net_requirement)}</td>
                      <td className="px-4 py-3 text-right font-medium text-blue-600">{format.qty(l.suggested_qty)}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{l.source_no || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
