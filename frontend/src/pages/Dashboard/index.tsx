import { useEffect, useState } from 'react';
import {
  ShoppingCart,
  Package,
  AlertTriangle,
  DollarSign,
  PlusCircle,
  ClipboardList,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  FileBarChart2,
  Wallet,
  ReceiptText,
  TrendingUp,
  BadgeDollarSign,
  AlarmClock,
  ListChecks,
  Trophy,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { reportApi, DashboardData } from '@/api/report';
import { format } from '@/utils/format';
import { useAppStore } from '@/store/app';
import { hiddenInPersonalMode } from '@/utils/menuPreview';
import { connectSSE } from '@/utils/sse';
import { storage } from '@/utils/storage';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { OnboardingCard } from '@/components/OnboardingCard';
import { bizTypeLabel } from '@/config/bizTypes';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const quickActions = [
  { label: '新建销售订单', path: '/sales-orders/create', color: 'bg-green-50 text-green-600', icon: PlusCircle },
  { label: '新建采购订单', path: '/purchase-orders/create', color: 'bg-blue-50 text-blue-600', icon: ClipboardList },
  { label: '新建入库单', path: '/stock-in/create', color: 'bg-purple-50 text-purple-600', icon: ArrowDownToLine },
  { label: '新建出库单', path: '/stock-out/create', color: 'bg-orange-50 text-orange-600', icon: ArrowUpFromLine },
  { label: '查看库存', path: '/inventory/balance', color: 'bg-gray-100 text-gray-600', icon: Boxes },
  { label: '查看报表', path: '/reports/sales', color: 'bg-pink-50 text-pink-600', icon: FileBarChart2 },
];

const tooltipStyle = {
  borderRadius: 10,
  border: '1px solid #f0f0f0',
  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
  fontSize: 12,
};

export function Dashboard() {
  const navigate = useNavigate();
  // 「个人模式」下审批入口统一隐藏（与侧栏/命令面板/快捷方式共用同一隐藏清单）
  const personalMode = useAppStore((s) => s.personalMode);
  const showApprovalEntry = !hiddenInPersonalMode('/system/approval-tasks', personalMode);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // 老板看板实时推送（SSE）：连接后立即收到一次，之后每 10s 刷新指标
  useEffect(() => {
    const disconnect = connectSSE('/api/v1/reports/dashboard/stream', storage.getToken() || '', {
      onMessage: (d: DashboardData) => {
        setLoading(false);
        setData(d);
      },
      onError: (err) => {
        console.warn('Dashboard SSE disconnected:', err);
      },
    });
    return disconnect;
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const response = await reportApi.dashboard();
      if (response.code === 0) {
        setData(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="仪表盘"
        subtitle="实时数据概览"
        extra={
          <div className="text-sm text-gray-500">
            {format.date(new Date().toISOString(), 'YYYY年MM月DD日 HH:mm')}
          </div>
        }
      />

      {/* 快捷操作（2026-09-13 用户要求：移到页面顶部，常用入口第一屏可见） */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">快捷操作</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.path}
                onClick={() => navigate(action.path)}
                className={`p-4 rounded-xl ${action.color} hover:opacity-85 hover:shadow-sm transition-all flex flex-col items-center gap-2 min-h-[76px]`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-sm font-medium">{action.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 新手上手清单（易用性 P1）：新客户首次登录时告知“先干什么”，全部完成/手动关闭后不再显示 */}
      <OnboardingCard />

      {/* KPI 卡片（真实数据） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatCard
          label="销售总额"
          value={`¥${format.currency(data?.total_sales_amount ?? 0)}`}
          icon={DollarSign}
          color="bg-gradient-to-br from-green-400 to-green-600"
          footer={
            data
              ? `今日销售 ¥${format.currency(data.today_sales_amount ?? 0)}`
              : undefined
          }
        />
        <StatCard
          label="采购总额"
          value={`¥${format.currency(data?.total_purchase_amount ?? 0)}`}
          icon={ShoppingCart}
          color="bg-gradient-to-br from-blue-400 to-blue-600"
          footer={
            data
              ? `今日采购 ¥${format.currency(data.today_purchase_amount ?? 0)}`
              : undefined
          }
        />
        <StatCard
          label="库存价值"
          value={`¥${format.currency(data?.total_stock_value ?? 0)}`}
          icon={Package}
          color="bg-gradient-to-br from-purple-400 to-purple-600"
          footer={data ? `低库存商品 ${data.low_stock_count ?? 0} 项` : undefined}
        />
        <StatCard
          label="待处理订单"
          value={`${data?.open_sales_orders ?? 0}`}
          icon={AlertTriangle}
          color="bg-gradient-to-br from-orange-400 to-orange-600"
          footer={data ? `进行中采购 ${data.open_purchase_orders ?? 0} 单` : undefined}
        />
      </div>

      {/* 待办工作台（C-1） */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-1 bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-blue-600" /> 待办工作台
            </h2>
            {showApprovalEntry && (
              <button onClick={() => navigate('/system/approval-tasks')} className="text-xs text-blue-600 hover:underline">
                全部待办 →
              </button>
            )}
          </div>
          <div className="space-y-2.5">
            {showApprovalEntry && (
              <button
                onClick={() => navigate('/system/approval-tasks')}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm text-gray-700"><ClipboardList className="w-4 h-4 text-blue-600" /> 待审批单据</span>
                <span className="text-sm font-bold text-blue-600">{data?.pending_approvals?.length ?? 0}</span>
              </button>
            )}
            <button
              onClick={() => navigate('/sales-orders')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-green-50 hover:bg-green-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-700"><ShoppingCart className="w-4 h-4 text-green-600" /> 草稿销售单</span>
              <span className="text-sm font-bold text-green-600">{data?.draft_sales_orders ?? 0}</span>
            </button>
            <button
              onClick={() => navigate('/purchase-orders')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-cyan-50 hover:bg-cyan-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-700"><Package className="w-4 h-4 text-cyan-600" /> 草稿采购单</span>
              <span className="text-sm font-bold text-cyan-600">{data?.draft_purchase_orders ?? 0}</span>
            </button>
            <button
              onClick={() => navigate('/reports/inventory')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-yellow-50 hover:bg-yellow-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-700"><AlertTriangle className="w-4 h-4 text-yellow-600" /> 低库存商品</span>
              <span className="text-sm font-bold text-yellow-600">{data?.low_stock_count ?? 0}</span>
            </button>
            <button
              onClick={() => navigate('/finance/aging')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-red-50 hover:bg-red-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-700"><AlarmClock className="w-4 h-4 text-red-600" /> 应收逾期</span>
              <span className="text-sm font-bold text-red-600">¥{format.currency(data?.overdue_receivable ?? 0)}</span>
            </button>
            <button
              onClick={() => navigate('/finance/aging')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-orange-50 hover:bg-orange-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-700"><Wallet className="w-4 h-4 text-orange-600" /> 应付逾期</span>
              <span className="text-sm font-bold text-orange-600">¥{format.currency(data?.overdue_payable ?? 0)}</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-800 mb-3">待审批单据</h2>
            {(data?.pending_approvals ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">暂无待审批单据</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {(data?.pending_approvals ?? []).slice(0, 6).map((p) => (
                  <li key={p.id} className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">{bizTypeLabel(p.biz_type)}</span>
                      <span className="text-sm text-gray-700 truncate">{p.biz_no}</span>
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap">{p.initiator_name || '-'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-800 mb-3">低库存预警</h2>
            {(data?.low_stock_items ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">暂无低库存商品</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {(data?.low_stock_items ?? []).slice(0, 6).map((p, i) => (
                  <li key={i} className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-gray-700 truncate">{p.product_name}</span>
                      <span className="text-xs text-gray-400">{p.product_code}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-500">在库 {p.qty_available} / 安全 {p.safety_stock}</span>
                      <span className="block text-xs font-medium text-red-600">缺 {p.shortage_qty}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* 趋势图 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">销售趋势</h2>
            <span className="text-xs text-gray-400 px-2 py-1 bg-gray-50 rounded-md">近 7 日</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.sales_trend || []}>
                <defs>
                  <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={48} />
                <Tooltip
                  formatter={(value: number) => [`¥${format.currency(value)}`, '销售额']}
                  contentStyle={tooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fill="url(#salesGradient)"
                  dot={false}
                  activeDot={{ fill: '#22c55e', r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">采购趋势</h2>
            <span className="text-xs text-gray-400 px-2 py-1 bg-gray-50 rounded-md">近 7 日</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.purchase_trend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={48} />
                <Tooltip
                  formatter={(value: number) => [`¥${format.currency(value)}`, '采购额']}
                  contentStyle={tooltipStyle}
                />
                <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 经营指标（v2） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatCard
          label="应收账款余额"
          value={`¥${format.currency(data?.ar_balance ?? 0)}`}
          icon={Wallet}
          color="bg-gradient-to-br from-amber-400 to-orange-500"
          footer="未结清应收合计"
        />
        <StatCard
          label="应付账款余额"
          value={`¥${format.currency(data?.ap_balance ?? 0)}`}
          icon={ReceiptText}
          color="bg-gradient-to-br from-cyan-400 to-sky-600"
          footer="未结清应付合计"
        />
        <StatCard
          label="本月净利润"
          value={`¥${format.currency(data?.monthly_profit ?? 0)}`}
          icon={TrendingUp}
          color="bg-gradient-to-br from-emerald-400 to-teal-600"
          footer={data ? `收入 ¥${format.currency(data.monthly_revenue ?? 0)} · 成本 ¥${format.currency(data.monthly_cost ?? 0)}` : undefined}
        />
        <StatCard
          label="本月期间费用"
          value={`¥${format.currency(data?.monthly_expense ?? 0)}`}
          icon={BadgeDollarSign}
          color="bg-gradient-to-br from-rose-400 to-red-500"
          footer="销售/管理/财务费用合计"
        />
      </div>

      {/* 经营明细（v2） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* 低库存预警 */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">库存预警</h2>
            <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded-md">
              <AlarmClock className="w-3.5 h-3.5" /> 低于安全库存 {data?.low_stock_count ?? 0} 项
            </span>
          </div>
          {(data?.low_stock_items?.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">库存状态良好，暂无预警</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">商品</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">可用</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">安全库存</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">缺口</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(data?.low_stock_items ?? []).map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 text-sm">{item.product_name}</div>
                        <div className="text-xs text-gray-400">{item.product_code}{item.warehouse_name ? ` · ${item.warehouse_name}` : ''}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-orange-600 font-medium">{format.qty(item.qty_available)}</td>
                      <td className="px-3 py-2 text-right text-sm text-gray-600">{format.qty(item.safety_stock)}</td>
                      <td className="px-3 py-2 text-right text-sm text-red-600 font-medium">{format.qty(item.shortage_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 待审批单据 */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">待审批单据</h2>
            <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
              <ListChecks className="w-3.5 h-3.5" /> {data?.pending_approvals?.length ?? 0} 条
            </span>
          </div>
          {(data?.pending_approvals?.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">暂无待审批单据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">类型</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">单号</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">发起人</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">提交时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(data?.pending_approvals ?? []).map((item, idx) => (
                    <tr key={item.id || idx} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-600">{bizTypeLabel(item.biz_type)}</td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900">{item.biz_no || '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-600">{item.initiator_name || '-'}</td>
                      <td className="px-3 py-2 text-right text-sm text-gray-500">{format.date(item.created_at, 'YYYY-MM-DD HH:mm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 销售 Top 商品 */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">销售 Top 商品</h2>
            <Trophy className="w-4 h-4 text-amber-500" />
          </div>
          {(data?.top_products?.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">暂无销售数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">#</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">商品</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">销量</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">销售额</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(data?.top_products ?? []).map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 text-sm">{item.product_name}</div>
                        <div className="text-xs text-gray-400">{item.product_code}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-gray-600">{format.qty(item.total_qty)}</td>
                      <td className="px-3 py-2 text-right text-sm font-medium text-green-600">¥{format.currency(item.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 应收账龄 */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">应收账龄</h2>
            <span className="text-xs text-gray-400">按到期日分桶</span>
          </div>
          {(data?.receivable_aging?.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">暂无应收数据</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.receivable_aging || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip formatter={(value: number) => [`¥${format.currency(value)}`, '金额']} contentStyle={tooltipStyle} />
                  <Bar dataKey="amount" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
