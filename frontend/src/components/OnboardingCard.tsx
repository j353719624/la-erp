import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, CheckCircle2, Circle, ChevronRight, X } from 'lucide-react';
import { productApi, warehouseApi } from '@/api/product';
import { customerApi, salesOrderApi } from '@/api/order';
import { LS } from '@/utils/localKeys';

const DISMISS_KEY = LS.onboardingDismissed;
const REPORT_SEEN_KEY = LS.onboardingReportSeen;

interface Counts {
  product: number;
  warehouse: number;
  customer: number;
  order: number;
  reportSeen: boolean;
}

interface Step {
  key: string;
  title: string;
  hint: string;
  path: string;
  done: boolean;
  /** 无权限（接口 403/失败）时隐藏该步骤，避免引导用户去做没权限的事 */
  hidden?: boolean;
}

const totalOf = (res: unknown): number => {
  const r = res as { data?: { total?: number; list?: unknown[] } } | undefined;
  return r?.data?.total ?? (Array.isArray(r?.data?.list) ? (r.data!.list as unknown[]).length : 0);
};

/**
 * 新手上手清单（易用性 P1）。
 *
 * 目的：新客户第一次登录时，仪表盘只有一堆 0 的 KPI，不知道该干什么。
 * 用真实数据判定每一档是否已完成（不是假的进度条），全部完成或用户关闭后不再显示。
 */
export function OnboardingCard() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    if (dismissed) return;
    let alive = true;
    (async () => {
      const [p, w, c, o] = await Promise.allSettled([
        productApi.list({ page: 1, page_size: 1 }),
        warehouseApi.list({ page: 1, page_size: 1 }),
        customerApi.list({ page: 1, page_size: 1 }),
        salesOrderApi.list({ page: 1, page_size: 1 }),
      ]);
      if (!alive) return;
      setCounts({
        product: p.status === 'fulfilled' ? totalOf(p.value) : -1,
        warehouse: w.status === 'fulfilled' ? totalOf(w.value) : -1,
        customer: c.status === 'fulfilled' ? totalOf(c.value) : -1,
        order: o.status === 'fulfilled' ? totalOf(o.value) : -1,
        reportSeen: localStorage.getItem(REPORT_SEEN_KEY) === '1',
      });
    })();
    return () => { alive = false; };
  }, [dismissed]);

  if (dismissed || !counts) return null;

  const steps: Step[] = [
    { key: 'product', title: '录入商品档案', hint: '商品是库存/订单的基础，可先用「导入」批量录入', path: '/products/create', done: counts.product > 0, hidden: counts.product < 0 },
    { key: 'warehouse', title: '建立仓库', hint: '库存按仓库核算，库位/货架可稍后再细化', path: '/warehouses', done: counts.warehouse > 0, hidden: counts.warehouse < 0 },
    { key: 'customer', title: '录入客户', hint: '开销售订单前先建客户档案（也可在开单时快速新建）', path: '/customers/create', done: counts.customer > 0, hidden: counts.customer < 0 },
    { key: 'order', title: '开第一张销售订单', hint: '选客户→加商品→保存→提交审批→出库，走通全流程', path: '/sales-orders/create', done: counts.order > 0, hidden: counts.order < 0 },
    { key: 'report', title: '查看经营报表', hint: '销售/毛利/库存报表随单据实时更新', path: '/reports/sales', done: counts.reportSeen, hidden: false },
  ].filter((s) => !s.hidden);

  const doneCount = steps.filter((s) => s.done).length;
  // 全部完成 → 自动收起，不再打扰
  if (steps.length === 0 || doneCount === steps.length) return null;

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Rocket className="w-4 h-4 text-blue-600" /> 开始使用（{doneCount}/{steps.length}）
          </h2>
          <p className="text-xs text-gray-500 mt-1">按下面前 5 步走一遍，系统就能出报表了；已完成的步骤会自动打勾</p>
        </div>
        <button
          type="button"
          title="不再提示"
          aria-label="不再提示"
          onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setDismissed(true); }}
          className="text-gray-400 hover:text-gray-600 p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="w-full h-1.5 bg-white rounded-full mb-4 overflow-hidden">
        <div className="h-full bg-blue-500 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {steps.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate(s.path)}
            className={`text-left px-4 py-3 rounded-lg border transition-colors flex items-start gap-3 ${
              s.done ? 'bg-white/70 border-green-100' : 'bg-white border-blue-100 hover:border-blue-300 hover:bg-blue-50/50'
            }`}
          >
            {s.done
              ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              : <Circle className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-medium ${s.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{s.title}</span>
              <span className={`block text-xs text-gray-500 mt-0.5 onboarding-hint`}>{s.hint}</span>
            </span>
            {!s.done && <ChevronRight className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}
