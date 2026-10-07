import { useState, useEffect } from 'react';
import { Search, TrendingUp } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { reportApi, SalesForecastResult } from '@/api/report';
import { productApi } from '@/api/product';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';

const METHODS = [
  { value: 'sma', label: '简单移动平均（近 N 月均值）' },
  { value: 'wma', label: '加权移动平均（近月权重高）' },
  { value: 'trend', label: '线性趋势外推' },
];

export function SalesForecast() {
  const [products, setProducts] = useState<any[]>([]);
  const [productId, setProductId] = useState('');
  const [method, setMethod] = useState('sma');
  const [periods, setPeriods] = useState(3);
  const [lookback, setLookback] = useState(6);
  const [results, setResults] = useState<SalesForecastResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    productApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setProducts(res.data?.list || []);
    }).catch((err: any) => console.warn('商品列表加载失败（可能缺 product_list 权限）:', err?.message || err));
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);
    try {
      const res = await reportApi.salesForecast({
        product_id: productId || undefined,
        periods,
        method,
        lookback,
      });
      if (res.code === 0) {
        setResults(res.data || []);
        if ((res.data || []).length === 0) message.info('暂无有销售记录的商品');
      } else {
        message.error(res.message || '查询失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '查询失败');
    } finally {
      setLoading(false);
    }
  };

  // 图表数据：选单个商品时展示折线
  const selected = results.find((r) => r.product_id === productId) || results[0];
  const chartData = selected
    ? selected.points.map((p) => ({
        month: p.month,
        '历史销量': p.is_forecast ? null : Number(p.actual),
        '预测销量': p.is_forecast ? Number(p.forecast) : null,
      }))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="销售预测"
        subtitle="基于历史销售订单自动预测未来需求量"
        extra={
          <button onClick={handleSearch} disabled={loading} className="btn-primary flex items-center gap-2">
            <Search className="w-4 h-4" />
            {loading ? '计算中...' : '生成预测'}
          </button>
        }
      />

      {/* 筛选 */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchSelect
            value={productId}
            onChange={(v) => setProductId(v ?? '')}
            placeholder="全部商品"
            allowClear
            options={products.map((p: any) => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) }))}
            className="w-56"
          />
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="form-input w-64">
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>预测期数：</span>
            <input
              type="number"
              value={periods}
              min={1}
              max={12}
              onChange={(e) => setPeriods(parseInt(e.target.value) || 3)}
              className="form-input w-20"
            />
            <span>回看月数：</span>
            <input
              type="number"
              value={lookback}
              min={1}
              max={24}
              onChange={(e) => setLookback(parseInt(e.target.value) || 6)}
              className="form-input w-20"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card p-4"><TableSkeleton rows={5} /></div>
      ) : !searched ? (
        <div className="card p-10"><EmptyState description="选择商品与预测方法后点击「生成预测」" /></div>
      ) : results.length === 0 ? (
        <div className="card p-10"><EmptyState description="暂无有销售记录的商品可预测" /></div>
      ) : (
        <>
          {/* 图表（选单商品或默认第一个） */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                预测曲线{selected ? `：${selected.product_name}（${selected.method_name}）` : ''}
              </h3>
              {results.length > 1 && (
                <span className="text-xs text-gray-400">共 {results.length} 个商品，表格可查看全部预测</span>
              )}
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  {selected && (
                    <ReferenceLine
                      x={selected.points[selected.points.length - 1 - selected.periods]?.month}
                      stroke="#f59e0b"
                      strokeDasharray="4 4"
                      label={{ value: '预测起点', fontSize: 11, fill: '#f59e0b' }}
                    />
                  )}
                  <Line type="monotone" dataKey="历史销量" stroke="#3b82f6" strokeWidth={2} connectNulls dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="预测销量" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" connectNulls dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 预测汇总表 */}
          <div className="card p-4">
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'center' }}>商品编码</th>
                    <th style={{ textAlign: 'center' }}>商品名称</th>
                    <th style={{ textAlign: 'center' }}>预测方法</th>
                    <th style={{ textAlign: 'center' }}>历史月均</th>
                    {selected && selected.points.filter((p) => p.is_forecast).map((p) => (
                      <th key={p.month} style={{ textAlign: 'center' }}>{p.month} 预测</th>
                    ))}
                    <th style={{ textAlign: 'center' }}>预测合计</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const forecasts = r.points.filter((p) => p.is_forecast);
                    return (
                      <tr key={r.product_id}>
                        <td style={{ textAlign: 'center' }}>{r.product_code}</td>
                        <td style={{ textAlign: 'center' }}>{r.product_name}</td>
                        <td style={{ textAlign: 'center' }}>{r.method_name}</td>
                        <td style={{ textAlign: 'center' }}>{format.qty(r.avg_monthly)}</td>
                        {forecasts.map((p) => (
                          <td key={p.month} style={{ textAlign: 'center' }}>{format.qty(p.forecast)}</td>
                        ))}
                        <td style={{ textAlign: 'center' }} className="font-semibold text-blue-600">{format.qty(r.total_forecast)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-3">预测基于已审核销售订单（approved/closed）按月销量；无销售记录的商品不参与预测。</p>
          </div>
        </>
      )}
    </div>
  );
}
