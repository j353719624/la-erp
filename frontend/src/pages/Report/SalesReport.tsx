import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Download } from 'lucide-react';
import dayjs from 'dayjs';
import { reportApi } from '@/api/report';
import { format } from '@/utils/format';
import { downloadCSV } from '@/utils/export';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { markReportSeen } from '@/utils/localKeys';
import { DeltaBadge } from '@/components/DeltaBadge';
import { QUICK_RANGES, buildCompareRanges, readReportPeriod, writeReportPeriod } from '@/utils/reportRange';
import { useTableView } from '@/hooks/useTableView';
import { loadOptions } from '@/utils/loadOptions';
import type { ReactNode } from 'react';

export function SalesReport() {
  const navigate = useNavigate();
  const [salesByProduct, setSalesByProduct] = useState<any[]>([]);
  const [salesByCustomer, setSalesByCustomer] = useState<any[]>([]);
  const [profitRows, setProfitRows] = useState<any[]>([]);
  const [profitSummary, setProfitSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // [易用性 P2] 默认本月（报表惯例，且只有选定区间才能算同比/环比）；可一键切本月/上月/本年
  // [2026-09-12] 记住上次查看的期间（按报表页分桶）；首次进入仍默认本月
  const [dateRange, setDateRange] = useState(() => {
    const saved = readReportPeriod('sales-report');
    return saved ?? {
      start_date: dayjs().startOf('month').format('YYYY-MM-DD'),
      end_date: dayjs().format('YYYY-MM-DD'),
    };
  });
  // 同比（去年同期）/ 环比（上一等长周期）汇总
  const [compare, setCompare] = useState<{ prev: any; yoy: any } | null>(null);
  // 请求竞态守卫：快速改日期/重复点查询时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    writeReportPeriod('sales-report', dateRange.start_date, dateRange.end_date); // [2026-09-12] 记忆本次期间
    fetchReports();
    // [易用性 P1] 标记“已看过经营报表”，用于仪表盘上手清单自动打勾（键名统一在 utils/localKeys）
    markReportSeen();
  }, [dateRange]);

  const fetchReports = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const params = {
        start_date: dateRange.start_date || undefined,
        end_date: dateRange.end_date || undefined,
      };
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它报表块（此前 Promise.all 一拒全空）
      const [productRes, customerRes, profitRes, summaryRes] = await loadOptions([
        reportApi.salesByProduct(params),
        reportApi.salesByCustomer(params),
        reportApi.profitByProduct(params),
        reportApi.profitSummary(params),
      ], '销售报表');
      if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
      if (productRes?.code === 0) setSalesByProduct(productRes.data || []);
      if (customerRes?.code === 0) setSalesByCustomer(customerRes.data || []);
      if (profitRes?.code === 0) setProfitRows(profitRes.data || []);
      if (summaryRes?.code === 0) setProfitSummary(summaryRes.data);

      // [易用性 P2] 同比/环比：上一等长周期（环比）与去年同期（同比）各查一次汇总（区间工具见 utils/reportRange）
      const ranges = buildCompareRanges(params.start_date, params.end_date);
      if (ranges) {
        const [prevRes, yoyRes] = await loadOptions([
          reportApi.profitSummary(ranges.prev),
          reportApi.profitSummary(ranges.yoy),
        ], '销售报表同比环比');
        if (isCurrent(seq)) {
          setCompare({
            prev: prevRes?.code === 0 ? prevRes.data : null,
            yoy: yoyRes?.code === 0 ? yoyRes.data : null,
          });
        }
      } else {
        setCompare(null);
      }
    } catch (err) {
      console.error('Failed to fetch sales reports:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const handleExport = () => {
    downloadCSV('销售报表_按产品.csv',
      ['产品编码', '产品名称', '销售数量', '销售金额'],
      salesByProduct.map((item: any) => [item.product_code, item.product_name, item.total_qty, Number(item.total_amount).toFixed(2)])
    );
    downloadCSV('销售报表_按客户.csv',
      ['客户编码', '客户名称', '销售数量', '销售金额'],
      salesByCustomer.map((item: any) => [item.customer_code, item.customer_name, item.total_qty, Number(item.total_amount).toFixed(2)])
    );
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: any) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const productCols: RowCol[] = [
    { key: 'product_code', header: '产品编码', cellCls: `${TD} whitespace-nowrap font-medium text-gray-900`, cell: (item) => <span>{item.product_code}</span> },
    { key: 'product_name', header: '产品名称', cellCls: `${TD} whitespace-nowrap text-gray-900`, cell: (item) => <span>{item.product_name}</span> },
    { key: 'total_qty', header: '销售数量', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-500`, cell: (item) => <span>{item.total_qty}</span> },
    { key: 'total_amount', header: '销售金额', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right font-medium text-gray-900`, cell: (item) => <span>¥{format.currency(item.total_amount)}</span> },
  ];
  const profitCols: RowCol[] = [
    { key: 'product_code', header: '产品编码', cellCls: `${TD} whitespace-nowrap font-medium text-gray-900`, cell: (item) => <span>{item.product_code}</span> },
    { key: 'product_name', header: '产品名称', cellCls: `${TD} whitespace-nowrap text-gray-900`, cell: (item) => <span>{item.product_name}</span> },
    { key: 'qty', header: '数量', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-500`, cell: (item) => <span>{item.qty}</span> },
    { key: 'revenue', header: '收入', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-700`, cell: (item) => <span>¥{format.currency(item.revenue)}</span> },
    { key: 'cost', header: '成本', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-700`, cell: (item) => <span>¥{format.currency(item.cost)}</span> },
    { key: 'profit', header: '毛利', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right font-medium text-gray-900`, cell: (item) => <span>¥{format.currency(item.profit)}</span> },
    { key: 'margin_rate', header: '毛利率', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-blue-600 font-medium`, cell: (item) => <span>{item.margin_rate}%</span> },
  ];
  // [2026-09-13] 两张表同页：主表用 ?cols=，次表用 ?cols.profit=（否则互相裁列）
  const { visibleColumns: productVisible, menu: productMenu } = useTableView({
    pageKey: 'sales-report-by-product',
    columns: productCols,
    locked: { leading: ['product_code'] },
  });
  const { visibleColumns: profitVisible, menu: profitMenu } = useTableView({
    pageKey: 'sales-report-profit',
    paramNs: 'profit',
    columns: profitCols,
    locked: { leading: ['product_code'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="销售报表"
        subtitle="销售数据分析"
        extra={
          <button onClick={handleExport} className="btn-primary flex items-center gap-2">
            <Download className="w-4 h-4" />
            <span className="hidden md:inline">导出 CSV</span>
          </button>
        }
      />

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-400" />
            <span className="text-sm text-gray-600">日期范围：</span>
          </div>
          <input
            type="date"
            value={dateRange.start_date}
            onChange={(e) => setDateRange(prev => ({ ...prev, start_date: e.target.value }))}
            className="form-input w-36"
          />
          <span className="text-gray-400">至</span>
          <input
            type="date"
            value={dateRange.end_date}
            onChange={(e) => setDateRange(prev => ({ ...prev, end_date: e.target.value }))}
            className="form-input w-36"
          />
          <button onClick={fetchReports} className="btn-primary">
            查询
          </button>
          {/* [易用性 P2] 快捷区间：一键切换本月/上月/本年（工具见 utils/reportRange） */}
          <div className="flex items-center gap-1.5 ml-auto">
            {QUICK_RANGES.map((q) => (
              <button
                key={q.label}
                type="button"
                className="btn-secondary px-2.5 py-1 text-xs"
                onClick={() => setDateRange({ start_date: q.start().format('YYYY-MM-DD'), end_date: q.end().format('YYYY-MM-DD') })}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">销售排行（按产品）</h2>
          {loading ? (
            <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesByProduct} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="product_name" width={100} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => [`¥${format.currency(value)}`, '金额']} />
                  <Bar dataKey="total_amount" fill="#22c55e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">销售排行（按客户）</h2>
          {loading ? (
            <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesByCustomer} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="customer_name" width={100} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => [`¥${format.currency(value)}`, '金额']} />
                  <Bar dataKey="total_amount" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">销售明细（按产品）</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">点击行可下钻查看该商品库存流水</span>
            {productMenu}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {productVisible.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {salesByProduct.length === 0 ? (
                <tr>
                  <td colSpan={productVisible.length} className="px-6">
                    <EmptyState
                      title="该时间范围无销售数据"
                      description="统计口径：已确认/已审核/已关闭的销售订单（草稿与已作废不计）；可调整上方日期范围，或先审核确认订单"
                    />
                  </td>
                </tr>
              ) : (
                salesByProduct.map((item) => (
                  <tr
                    key={item.product_id}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    title={`查看「${item.product_name}」的库存流水（含销售出库）`}
                    onClick={() => navigate(`/inventory/movement?keyword=${encodeURIComponent(item.product_code)}`)}
                  >
                    {productVisible.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-sm text-gray-500">销售收入</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">¥{format.currency(profitSummary?.total_revenue || 0)}</div>
          <div className="flex items-center gap-3 mt-1.5">
            <DeltaBadge label="同比" cur={profitSummary?.total_revenue} base={compare?.yoy?.total_revenue} />
            <DeltaBadge label="环比" cur={profitSummary?.total_revenue} base={compare?.prev?.total_revenue} />
          </div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-gray-500">销售成本</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">¥{format.currency(profitSummary?.total_cost || 0)}</div>
          <div className="flex items-center gap-3 mt-1.5">
            <DeltaBadge label="同比" cur={profitSummary?.total_cost} base={compare?.yoy?.total_cost} />
            <DeltaBadge label="环比" cur={profitSummary?.total_cost} base={compare?.prev?.total_cost} />
          </div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-gray-500">毛利</div>
          <div className="text-2xl font-semibold text-green-600 mt-1">¥{format.currency(profitSummary?.total_profit || 0)}</div>
          <div className="flex items-center gap-3 mt-1.5">
            <DeltaBadge label="同比" cur={profitSummary?.total_profit} base={compare?.yoy?.total_profit} />
            <DeltaBadge label="环比" cur={profitSummary?.total_profit} base={compare?.prev?.total_profit} />
          </div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-gray-500">毛利率</div>
          <div className="text-2xl font-semibold text-blue-600 mt-1">{profitSummary?.margin_rate || 0}%</div>
          <div className="flex items-center gap-3 mt-1.5">
            <DeltaBadge label="同比" cur={profitSummary?.margin_rate} base={compare?.yoy?.margin_rate} />
            <DeltaBadge label="环比" cur={profitSummary?.margin_rate} base={compare?.prev?.margin_rate} />
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">毛利分析（按商品）</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">点击行可下钻查看该商品库存流水</span>
            {profitMenu}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {profitVisible.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profitRows.length === 0 ? (
                <tr>
                  <td colSpan={profitVisible.length} className="px-6">
                    <EmptyState
                      title="暂无毛利分析数据"
                      description="毛利 = 销售收入 − 数量×加权平均成本；需已成交订单且商品已配置成本（采购价/期初成本）"
                    />
                  </td>
                </tr>
              ) : (
                profitRows.map((item) => (
                  <tr
                    key={item.product_id}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    title={`查看「${item.product_name}」的库存流水（含销售出库）`}
                    onClick={() => navigate(`/inventory/movement?keyword=${encodeURIComponent(item.product_code)}`)}
                  >
                    {profitVisible.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
