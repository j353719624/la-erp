import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Check, CheckCircle2, XCircle, Play, CalendarDays, Layers } from 'lucide-react';
import { productionApi } from '@/api/production';
import { WorkOrder } from '@/types/production';
import { format } from '@/utils/format';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';

type BoardCol = {
  key: string;
  title: string;
  badge: string;
  dot: string;
  allow: string[];
};

const COLS: BoardCol[] = [
  { key: 'draft', title: '待确认', badge: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400', allow: ['confirm', 'cancel', 'edit'] },
  { key: 'confirmed', title: '待开工', badge: 'bg-blue-50 text-blue-600', dot: 'bg-blue-500', allow: ['approve', 'cancel'] },
  { key: 'in_progress', title: '生产中', badge: 'bg-amber-50 text-amber-600', dot: 'bg-amber-500', allow: ['complete'] },
  { key: 'completed', title: '已完成', badge: 'bg-green-50 text-green-600', dot: 'bg-green-500', allow: ['view'] },
  { key: 'cancelled', title: '已取消', badge: 'bg-red-50 text-red-600', dot: 'bg-red-400', allow: ['view'] },
];

const STATUS_TEXT: Record<string, string> = {
  draft: '草稿', confirmed: '待开工', in_progress: '生产中', completed: '已完成', cancelled: '已取消',
};

const fmtDate = (s?: string) => (s ? s.slice(0, 10) : '-');

export function WorkOrderBoard() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Record<string, WorkOrder[]>>({});
  const [loading, setLoading] = useState(true);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await productionApi.workOrderList({ page: 1, page_size: 500 });
      if (res.code === 0) {
        const g: Record<string, WorkOrder[]> = { draft: [], confirmed: [], in_progress: [], completed: [], cancelled: [] };
        (res.data?.list || []).forEach((w: any) => {
          const item: WorkOrder = {
            id: w.id,
            work_order_no: w.order_no,
            product_name: w.product_name,
            product_code: w.product_code,
            quantity: w.qty || 0,
            start_date: w.planned_start_date,
            end_date: w.planned_end_date,
            status: w.status,
            material_cost: w.material_cost,
            edges: w.edges,
            // [2026-09-14 完工引导] 后端 List 计算
            received_qty: Number(w.received_qty || 0),
            processes_done: Number(w.processes_done || 0),
            processes_total: Number(w.processes_total || 0),
            material_pending: Number(w.material_pending || 0),
            can_complete: !!w.can_complete,
          };
          const st = g[w.status] ? w.status : 'draft';
          g[st].push(item);
        });
        setGroups(g);
      }
    } catch (e) {
      console.error('Failed to fetch board:', e);
      message.error(e instanceof Error && e.message ? e.message : '加载看板失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const act = async (fn: () => Promise<any>, okMsg: string, title: string, danger = false) => {
    if (!(await confirmAction({ title, danger }))) return;
    try {
      const res = await fn();
      if (res.code === 0) {
        message.success(okMsg);
        fetchBoard();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '操作失败');
    }
  };

  const total = COLS.reduce((s, c) => s + (groups[c.key] || []).length, 0);
  const inProgress = (groups.in_progress || []).length;
  const overdue = COLS.filter(c => c.key === 'draft' || c.key === 'confirmed' || c.key === 'in_progress')
    .flatMap(c => groups[c.key] || [])
    .filter(w => w.end_date && new Date(w.end_date) < new Date()).length;

  // 工序进度
  const procProgress = (w: WorkOrder) => {
    const procs = w.edges?.processes || [];
    if (!procs.length) return null;
    const done = procs.filter((p: any) => p.status === 'completed').length;
    return { done, total: procs.length };
  };

  // 入库进度（2026-09-14 完工引导）：入库确认后工单仍留「生产中」，此处展示已入库 N/M 与可否完工
  const receiptProgress = (w: WorkOrder) => {
    const rec = Number(w.received_qty || 0);
    const q = Number(w.quantity || 0);
    return { rec, q, pct: q > 0 ? Math.min(100, (rec / q) * 100) : 0, full: q > 0 && rec >= q };
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="工单看板"
        subtitle="按状态可视化跟踪生产工单流转（拖拽式看板视图）"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={fetchBoard} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg">
              <RefreshCw className="w-4 h-4" /> 刷新
            </button>
            <button onClick={() => navigate('/production/work-orders/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建工单</span>
            </button>
          </div>
        }
      />

      {/* 统计条 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500">工单总数</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">{total}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">生产中</p>
          <p className="mt-1 text-xl font-semibold text-amber-600">{inProgress}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">逾期工单</p>
          <p className={`mt-1 text-xl font-semibold ${overdue > 0 ? 'text-red-600' : 'text-gray-900'}`}>{overdue}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">已完成</p>
          <p className="mt-1 text-xl font-semibold text-green-600">{(groups.completed || []).length}</p>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={4} />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
          {COLS.map(col => {
            const list = groups[col.key] || [];
            return (
              <div key={col.key} className="flex-none w-[280px] md:w-[300px] bg-gray-50 rounded-xl p-3 min-h-[300px]">
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    <h3 className="text-sm font-semibold text-gray-800">{col.title}</h3>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${col.badge}`}>{list.length}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {list.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-6">暂无工单</p>
                  )}
                  {list.map(w => {
                    const pp = procProgress(w);
                    const rp = receiptProgress(w);
                    const isOverdue = w.end_date && new Date(w.end_date) < new Date() && col.key !== 'completed' && col.key !== 'cancelled';
                    return (
                      <div key={w.id} className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/production/work-orders/${w.id}`)}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-900">{w.work_order_no}</span>
                          {isOverdue && <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded">逾期</span>}
                        </div>
                        <p className="mt-1 text-sm text-gray-700 truncate">{w.product_name}</p>
                        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                          <span className="inline-flex items-center gap-1"><Layers className="w-3 h-3" /> 数量 {w.quantity}</span>
                          <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {fmtDate(w.end_date)}</span>
                        </div>
                        {pp && (
                          <div className="mt-2">
                            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                              <span>工序进度</span><span>{pp.done}/{pp.total}</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pp.total ? (pp.done / pp.total) * 100 : 0}%` }} />
                            </div>
                          </div>
                        )}
                        {(col.key === 'in_progress' || rp.rec > 0) && (
                          <div className="mt-2">
                            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                              <span>入库进度</span><span>{rp.rec}/{rp.q}</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${rp.full ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${rp.pct}%` }} />
                            </div>
                          </div>
                        )}
                        {rp.full && col.key === 'in_progress' && (
                          w.can_complete
                            ? <p className="mt-1.5 text-[11px] text-green-600">✓ 已入齐，工序与物料已就绪，可完工</p>
                            : <p className="mt-1.5 text-[11px] text-amber-600">已入齐，待完成：{[ (Number(w.processes_total || 0) > Number(w.processes_done || 0)) ? `工序 ${w.processes_done}/${w.processes_total}` : '', (Number(w.material_pending || 0) > 0) ? `物料 ${w.material_pending} 项未领足` : '' ].filter(Boolean).join(' · ') || '请检查工序与物料'}</p>
                        )}
                        <div className="mt-3 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {col.allow.includes('confirm') && (
                            <button onClick={() => act(() => productionApi.confirmWorkOrder(w.id!), '已确认', `确定确认工单 ${w.work_order_no}？`)} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md">
                              <Check className="w-3.5 h-3.5" /> 确认
                            </button>
                          )}
                          {col.allow.includes('approve') && (
                            <button onClick={() => act(() => productionApi.approveWorkOrder(w.id!), '已开工', `确定开工工单 ${w.work_order_no}？`)} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md">
                              <Play className="w-3.5 h-3.5" /> 开工
                            </button>
                          )}
                          {col.allow.includes('complete') && (
                            <button
                              onClick={() => act(() => productionApi.completeWorkOrder(w.id!), '已完成', `确定完成工单 ${w.work_order_no}？（已入库 ${rp.rec}/${rp.q}）`)}
                              className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md ${
                                rp.full && w.can_complete
                                  ? 'text-white bg-green-600 hover:bg-green-700 font-medium'
                                  : 'text-green-600 bg-green-50 hover:bg-green-100'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> 完工
                            </button>
                          )}
                          {col.allow.includes('cancel') && (
                            <button onClick={() => act(() => productionApi.cancelWorkOrder(w.id!), '已取消', `确定取消工单 ${w.work_order_no}？`, true)} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-md">
                              <XCircle className="w-3.5 h-3.5" /> 取消
                            </button>
                          )}
                          {col.allow.includes('view') && (
                            <span className="flex-1 text-center text-xs text-gray-400">{STATUS_TEXT[w.status || ''] || w.status}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
