import { useState, useEffect } from 'react';
import { RefreshCw, Gauge, Timer, Factory, AlertTriangle } from 'lucide-react';
import { productionApi } from '@/api/production';
import { CapacityLoadItem, CapacityLoadProcess, CapacityLoadResult } from '@/types/production';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { message } from '@/utils/appMessage';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

// 负载等级 → 颜色/文案
const LEVEL_META: Record<string, { bar: string; text: string; badge: string; label: string }> = {
  idle: { bar: 'bg-gray-300', text: 'text-gray-500', badge: 'bg-gray-100 text-gray-600', label: '空闲' },
  normal: { bar: 'bg-green-500', text: 'text-green-600', badge: 'bg-green-50 text-green-600', label: '正常' },
  busy: { bar: 'bg-amber-500', text: 'text-amber-600', badge: 'bg-amber-50 text-amber-600', label: '高负载' },
  overloaded: { bar: 'bg-red-500', text: 'text-red-600', badge: 'bg-red-50 text-red-600', label: '超载' },
};

const STATUS_TEXT: Record<string, string> = {
  pending: '待开工',
  in_progress: '生产中',
  completed: '已完成',
};

function fmtNum(v: string | number | undefined, digits = 1): string {
  if (v === undefined || v === null || v === '') return '0';
  return Number(v).toFixed(digits);
}

function fmtDate(s?: string): string {
  if (!s) return '-';
  return s.slice(0, 10);
}

export function CapacityLoad() {
  const [result, setResult] = useState<CapacityLoadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  // 请求竞态守卫：7/14/30 天快速切换时丢弃过期响应，防旧区间覆盖新区间
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchLoad = async (d: number) => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await productionApi.workCenterLoad({ days: d });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setResult(res.data || null);
      } else {
        message.error(res.message || '加载失败');
      }
    } catch (e) {
      console.error('Failed to fetch capacity load:', e);
      message.error(e instanceof Error && e.message ? e.message : '加载失败');
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  useEffect(() => {
    fetchLoad(days);
  }, [days]);

  const items = result?.items || [];
  const totalLoad = items.reduce((s, it) => s + Number(it.load_hours || 0), 0);
  const totalAvailable = items.reduce((s, it) => s + Number(it.available_hours || 0), 0);
  const overloadedCount = items.filter(it => it.level === 'overloaded').length;
  const busyCount = items.filter(it => it.level === 'busy').length;

  // [2026-09-12] 工序明细列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (p: CapacityLoadProcess) => ReactNode;
  }
  const TH_L = 'px-3 py-2 text-left text-xs font-medium text-gray-500';
  const TH_R = 'px-3 py-2 text-right text-xs font-medium text-gray-500';
  const TH_C = 'px-3 py-2 text-center text-xs font-medium text-gray-500';
  const TD = 'px-3 py-2 text-sm text-gray-700';
  const rowCols: RowCol[] = [
    { key: 'order_no', header: '工单', cell: (p) => <span>{p.order_no}</span> },
    { key: 'process', header: '工序', cell: (p) => <span>{p.process_name || p.process_code}</span> },
    { key: 'qty_planned', header: '计划数量', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (p) => <span>{fmtNum(p.qty_planned, 0)}</span> },
    {
      key: 'standard_time',
      header: '标准工时',
      headCls: TH_R,
      cellCls: `${TD} text-right text-gray-600`,
      cell: (p) => <span>{fmtNum(p.standard_time, 1)}{p.standard_time_unit === 'hour' ? 'h' : 'min'}</span>,
    },
    { key: 'load_hours', header: '负载工时', headCls: TH_R, cellCls: `${TD} text-right font-medium text-gray-900`, cell: (p) => <span>{fmtNum(p.load_hours)}h</span> },
    {
      key: 'status',
      header: '状态',
      headCls: TH_C,
      cellCls: 'px-3 py-2 text-center',
      cell: (p) => (
        <span className={`text-xs font-medium ${p.status === 'in_progress' ? 'text-blue-600 bg-blue-50' : 'text-gray-500 bg-gray-100'} px-2 py-0.5 rounded-md`}>
          {STATUS_TEXT[p.status || ''] || p.status}
        </span>
      ),
    },
    {
      key: 'planned_date',
      header: '计划日期',
      cellCls: `${TD} text-gray-500`,
      cell: (p) => <span>{fmtDate(p.planned_start_date)} ~ {fmtDate(p.planned_end_date)}</span>,
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；工单列为行身份列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'capacity-load',
    columns: rowCols,
    locked: { leading: ['order_no'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="产能负载"
        subtitle="按工作中心汇总在制工单工时 vs 可用产能（对标 MES/APS 排产视图）"
        extra={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {[7, 14, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1.5 text-sm transition-colors ${days === d ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  {d}天
                </button>
              ))}
            </div>
            <button
              onClick={() => fetchLoad(days)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg"
            >
              <RefreshCw className="w-4 h-4" /> 刷新
            </button>
            {viewMenu}
          </div>
        }
      />

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">总负载工时</span>
            <Timer className="w-4 h-4 text-blue-500" />
          </div>
          <p className="mt-1 text-xl font-semibold text-gray-900">{fmtNum(totalLoad)}h</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">可用产能（{days}天）</span>
            <Gauge className="w-4 h-4 text-green-500" />
          </div>
          <p className="mt-1 text-xl font-semibold text-gray-900">{fmtNum(totalAvailable)}h</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">工作中心</span>
            <Factory className="w-4 h-4 text-indigo-500" />
          </div>
          <p className="mt-1 text-xl font-semibold text-gray-900">{items.length}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">超载 / 高负载</span>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <p className="mt-1 text-xl font-semibold text-gray-900">
            <span className={overloadedCount > 0 ? 'text-red-600' : 'text-gray-900'}>{overloadedCount}</span>
            <span className="text-gray-400"> / </span>
            <span className={busyCount > 0 ? 'text-amber-600' : 'text-gray-900'}>{busyCount}</span>
          </p>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState title="暂无工作中心" description="请先在「工作中心」维护生产资源，并为工艺步骤关联工作中心" />
      ) : (
        <div className="space-y-4">
          {items.map(item => {
            const meta = LEVEL_META[item.level || 'idle'];
            const rate = Math.min(Number(item.load_rate || 0) * 100, 100);
            const processes = item.processes || [];
            return (
              <div key={item.id} className="card p-5">
                {/* 头部：名称 + 负载率 */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-base font-semibold text-gray-900">{item.name}</h3>
                    <span className="text-xs text-gray-400">{item.code}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-lg font-semibold ${meta.text}`}>{fmtNum(item.load_rate, 0)}%</span>
                    <span className="text-xs text-gray-400 ml-1">负载率</span>
                  </div>
                </div>
                {/* 负载条 */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>负载 {fmtNum(item.load_hours)}h / 可用 {fmtNum(item.available_hours)}h</span>
                    <span>在制 {item.wip_orders} 单 · {item.wip_processes} 工序</span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${Math.max(rate, 2)}%` }} />
                  </div>
                </div>
                {/* 明细 */}
                {processes.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2 text-center">当前无在制工序</p>
                ) : (
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
                        {processes.map((p, i) => (
                          <tr key={p.process_id || i} className="hover:bg-gray-50 transition-colors">
                            {visibleColumns.map((c) => (
                              <td key={c.key} className={c.cellCls || TD}>
                                {c.cell(p)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
