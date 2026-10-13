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
import { QUICK_RANGES, readReportPeriod, writeReportPeriod } from '@/utils/reportRange';
import { useTableView } from '@/hooks/useTableView';
import { loadOptions } from '@/utils/loadOptions';
import type { ReactNode } from 'react';

export function PurchaseReport() {
  const navigate = useNavigate();
  const [purchaseByProduct, setPurchaseByProduct] = useState<any[]>([]);
  const [purchaseBySupplier, setPurchaseBySupplier] = useState<any[]>([]);
  const [priceTrendData, setPriceTrendData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P2] 默认本月（报表惯例）；可一键切本月/上月/本年
  // [2026-09-12] 记住上次查看的期间（按报表页分桶）；首次进入仍默认本月
  const [dateRange, setDateRange] = useState(() => {
    const saved = readReportPeriod('purchase-report');
    return saved ?? {
      start_date: dayjs().startOf('month').format('YYYY-MM-DD'),
      end_date: dayjs().format('YYYY-MM-DD'),
    };
  });
  // 请求竞态守卫：快速改日期/重复点查询时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    writeReportPeriod('purchase-report', dateRange.start_date, dateRange.end_date); // [2026-09-12] 记忆本次期间
    fetchReports();
    // [易用性 P1] 看过任一经营报表即打勾仪表盘上手清单的“查看经营报表”
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
      const [productRes, supplierRes, trendRes] = await loadOptions([
        reportApi.purchaseByProduct(params),
        reportApi.purchaseBySupplier(params),
        reportApi.purchasePriceTrend(params),
      ], '采购报表');
      if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
      if (productRes?.code === 0) setPurchaseByProduct(productRes.data || []);
      if (supplierRes?.code === 0) setPurchaseBySupplier(supplierRes.data || []);
      if (trendRes?.code === 0) setPriceTrendData(trendRes.data || []);
    } catch (err) {
      console.error('Failed to fetch purchase reports:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const handleExport = () => {
    downloadCSV('采购报表_按产品.csv',
      ['产品编码', '产品名称', '采购数量', '采购金额'],
      purchaseByProduct.map((item: any) => [item.product_code, item.product_name, item.total_qty, Number(item.total_amount).toFixed(2)])
    );
    downloadCSV('采购报表_按供应商.csv',
      ['供应商编码', '供应商名称', '采购数量', '采购金额'],
      purchaseBySupplier.map((item: any) => [item.supplier_code, item.supplier_name, item.total_qty, Number(item.total_amount).toFixed(2)])
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
    { key: 'total_qty', header: '采购数量', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-500`, cell: (item) => <span>{item.total_qty}</span> },
    { key: 'total_amount', header: '采购金额', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right font-medium text-gray-900`, cell: (item) => <span>¥{format.currency(item.total_amount)}</span> },
  ];
  const trendCols: RowCol[] = [
    { key: 'product_code', header: '产品编码', cellCls: `${TD} whitespace-nowrap font-medium text-gray-900`, cell: (item) => <span>{item.product_code}</span> },
    { key: 'product_name', header: '产品名称', cellCls: `${TD} whitespace-nowrap text-gray-900`, cell: (item) => <span>{item.product_name}</span> },
    { key: 'period', header: '月份', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-500`, cell: (item) => <span>{item.period}</span> },
    { key: 'avg_price', header: '均价', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right font-medium text-gray-900`, cell: (item) => <span>¥{format.currency(item.avg_price)}</span> },
    { key: 'min_price', header: '最低价', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-500`, cell: (item) => <span>¥{format.currency(item.min_price)}</span> },
    { key: 'max_price', header: '最高价', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-500`, cell: (item) => <span>¥{format.currency(item.max_price)}</span> },
    { key: 'total_qty', header: '数量', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-500`, cell: (item) => <span>{item.total_qty}</span> },
  ];
  // [2026-09-13] 两张表同页：主表用 ?cols=，次表用 ?cols.trend=（否则互相裁列）
  const { visibleColumns: productVisible, menu: productMenu } = useTableView({
    pageKey: 'purchase-report-by-product',
    columns: productCols,
    locked: { leading: ['product_code'] },
  });
  const { visibleColumns: trendVisible, menu: trendMenu } = useTableView({
    pageKey: 'purchase-report-price-trend',
    paramNs: 'trend',
    columns: trendCols,
    locked: { leading: ['product_code'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="采购报表"
        subtitle="采购数据分析"
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
          {/* [易用性 P2] 快捷区间（与销售报表同源，utils/reportRange） */}
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
          <h2 className="text-lg font-semibold text-gray-800 mb-4">采购排行（按产品）</h2>
          {loading ? (
            <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={purchaseByProduct} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="product_name" width={100} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => [`¥${format.currency(value)}`, '金额']} />
                  <Bar dataKey="total_amount" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">采购排行（按供应商）</h2>
          {loading ? (
            <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={purchaseBySupplier} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="supplier_name" width={100} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => [`¥${format.currency(value)}`, '金额']} />
                  <Bar dataKey="total_amount" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">采购明细（按产品）</h2>
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
              {purchaseByProduct.length === 0 ? (
                <tr>
                  <td colSpan={productVisible.length} className="px-6">
                    <EmptyState
                      title="该时间范围无采购数据"
                      description="统计口径：已确认/已审核/已关闭的采购订单（草稿与已作废不计）；可调整上方日期范围，或先审核确认订单"
                    />
                  </td>
                </tr>
              ) : (
                purchaseByProduct.map((item) => (
                  <tr
                    key={item.product_id}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    title={`查看「${item.product_name}」的库存流水（含采购入库）`}
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

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">采购价格趋势（按商品·月度均价）</h2>
          {trendMenu}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {trendVisible.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {priceTrendData.length === 0 ? (
                <tr><td colSpan={trendVisible.length} className="px-6"><EmptyState title="暂无采购价格数据" description="需已成交采购订单且含有效单价；季度均价低波动商品可能不展示" /></td></tr>
              ) : priceTrendData.flatMap((item) => (
                // 同商品的月度点位合并为行：编码/名称只在首行显示（原行为保持一致）
                item.points.map((p: any, i: number) => (
                  <tr key={`${item.product_id}-${p.period}`} className="hover:bg-gray-50 transition-colors">
                    {trendVisible.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell({ ...p, product_code: i === 0 ? item.product_code : '', product_name: i === 0 ? item.product_name : '' })}
                      </td>
                    ))}
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
