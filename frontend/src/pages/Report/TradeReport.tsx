import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { reportApi } from '@/api/report';
import { format } from '@/utils/format';
import { downloadCSV } from '@/utils/export';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { TableSkeleton } from '@/components/TableSkeleton';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

const ORDER_TYPE_TEXT: Record<string, string> = { sale: '销售待交', purchase: '采购待收' };

export function TradeReport() {
  const [overdueData, setOverdueData] = useState<any[]>([]);
  const [summaryData, setSummaryData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overdue' | 'summary'>('overdue');

  useEffect(() => {
    fetchOverdue();
    fetchSummary();
  }, []);

  const fetchOverdue = async () => {
    setLoading(true);
    try {
      const res = await reportApi.overdueOrderLines({ days: 365 });
      if (res.code === 0) setOverdueData(res.data || []);
    } catch (err) {
      console.error('Failed to fetch overdue lines:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await reportApi.customerFulfillment();
      if (res.code === 0) setSummaryData(res.data || []);
    } catch (err) {
      console.error('Failed to fetch fulfillment summary:', err);
    }
  };

  const handleExport = () => {
    if (tab === 'overdue') {
      downloadCSV('逾期未交未收清单.csv', ['订单号', '类型', '往来单位', '商品', '数量', '已交/已收', '未交/未收', '单价', '订单日期', '期望日期', '逾期天数'],
        overdueData.map(r => [r.order_no, ORDER_TYPE_TEXT[r.order_type] || r.order_type, r.party_name, r.product_name, r.qty, r.delivered_qty, r.remaining_qty, Number(r.price).toFixed(2), r.order_date ? format.date(r.order_date) : '', r.expected_date ? format.date(r.expected_date) : '', r.overdue_days]));
    } else {
      downloadCSV('客户履行率.csv', ['客户', '订单数', '总数量', '已交数量', '履行率%', '逾期订单数', '逾期金额'],
        summaryData.map(r => [r.customer_name, r.order_count, r.total_qty, r.delivered_qty, r.fulfillment_rate, r.overdue_order_count, Number(r.overdue_amount).toFixed(2)]));
    }
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: any) => ReactNode;
  }
  const TH_C = 'px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-3';
  // 页签一：逾期未交/未收明细（9 列，订单号锁定）
  const overdueCols: RowCol[] = [
    { key: 'order_no', header: '订单号', cellCls: `${TD} text-center text-sm font-medium text-gray-900`, cell: (r) => <span>{r.order_no}</span> },
    {
      key: 'order_type',
      header: '类型',
      headCls: TH_C,
      cellCls: 'px-4 py-3 text-center',
      cell: (r) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${r.order_type === 'sale' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
          {ORDER_TYPE_TEXT[r.order_type] || r.order_type}
        </span>
      ),
    },
    { key: 'party_name', header: '往来单位', headCls: TH_C, cellCls: `${TD} text-center text-sm text-gray-700`, cell: (r) => <span>{r.party_name}</span> },
    {
      key: 'product',
      header: '商品',
      headCls: TH_C,
      cellCls: `${TD} text-center text-sm text-gray-700`,
      cell: (r) => <>{r.product_name} <span className="text-gray-400 text-xs">({r.product_code})</span></>,
    },
    { key: 'qty', header: '数量', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-700`, cell: (r) => <span>{r.qty}</span> },
    { key: 'delivered_qty', header: '已交/已收', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-700`, cell: (r) => <span>{r.delivered_qty}</span> },
    { key: 'remaining_qty', header: '未交/未收', headCls: TH_R, cellCls: `${TD} text-right text-sm font-medium text-red-600`, cell: (r) => <span>{r.remaining_qty}</span> },
    { key: 'expected_date', header: '期望日期', headCls: TH_C, cellCls: `${TD} text-center text-sm text-gray-600`, cell: (r) => <span>{r.expected_date ? format.date(r.expected_date) : '-'}</span> },
    {
      key: 'overdue_days',
      header: '逾期天数',
      headCls: TH_C,
      cellCls: 'px-4 py-3 text-center',
      cell: (r) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${r.overdue_days > 30 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'}`}>
          {r.overdue_days} 天
        </span>
      ),
    },
  ];
  // 页签二：客户履行率（7 列，客户列锁定）
  const summaryCols: RowCol[] = [
    { key: 'customer_name', header: '客户', cellCls: `${TD} text-center text-sm font-medium text-gray-900`, cell: (r) => <span>{r.customer_name}</span> },
    { key: 'order_count', header: '订单数', headCls: TH_C, cellCls: `${TD} text-center text-sm text-gray-700`, cell: (r) => <span>{r.order_count}</span> },
    { key: 'total_qty', header: '总数量', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-700`, cell: (r) => <span>{r.total_qty}</span> },
    { key: 'delivered_qty', header: '已交数量', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-700`, cell: (r) => <span>{r.delivered_qty}</span> },
    {
      key: 'fulfillment_rate',
      header: '履行率',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (r) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${Number(r.fulfillment_rate) >= 100 ? 'bg-green-100 text-green-600' : Number(r.fulfillment_rate) >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
          {Number(r.fulfillment_rate).toFixed(1)}%
        </span>
      ),
    },
    { key: 'overdue_order_count', header: '逾期订单数', headCls: TH_C, cellCls: `${TD} text-center text-sm text-gray-700`, cell: (r) => <span>{r.overdue_order_count}</span> },
    { key: 'overdue_amount', header: '逾期金额', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-700`, cell: (r) => <span>{(Number(r.overdue_amount) || 0).toFixed(2)}</span> },
  ];
  // [2026-09-13] 两张表同页：主表用 ?cols=，次表用 ?cols.summary=（否则互相裁列）
  const { visibleColumns: overdueVisible, menu: overdueMenu } = useTableView({
    pageKey: 'trade-report-overdue',
    columns: overdueCols,
    locked: { leading: ['order_no'] },
  });
  const { visibleColumns: summaryVisible, menu: summaryMenu } = useTableView({
    pageKey: 'trade-report-summary',
    paramNs: 'summary',
    columns: summaryCols,
    locked: { leading: ['customer_name'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="订单履行报表"
        subtitle="逾期未交/未收清单 + 客户订单履行率"
        extra={
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" /> 导出 CSV
          </button>
        }
      />

      <div className="card">
        <div className="p-3 border-b border-gray-100 flex flex-wrap items-center gap-1">
          {(['overdue', 'summary'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {t === 'overdue' ? '逾期未交/未收' : '客户履行率'}
            </button>
          ))}
          {tab === 'overdue' && (
            <span className="ml-auto text-xs text-gray-500">共 {overdueData.length} 条逾期明细</span>
          )}
          {tab === 'overdue' ? overdueMenu : summaryMenu}
        </div>

        <div className="overflow-x-auto">
          {tab === 'overdue' ? (
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {overdueVisible.map((c) => (
                    <th key={c.key} className={c.headCls || TH_C}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={overdueVisible.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
                ) : overdueData.length === 0 ? (
                  <tr><td colSpan={overdueVisible.length} className="px-4 py-8"><EmptyState title="暂无逾期明细" description="所有未关闭订单均在期望交货期内" /></td></tr>
                ) : (
                  overdueData.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      {overdueVisible.map((c) => (
                        <td key={c.key} className={c.cellCls || TD}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {summaryVisible.map((c) => (
                    <th key={c.key} className={c.headCls || TH_C}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summaryData.length === 0 ? (
                  <tr><td colSpan={summaryVisible.length} className="px-4 py-8"><EmptyState title="暂无履行数据" /></td></tr>
                ) : (
                  summaryData.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      {summaryVisible.map((c) => (
                        <td key={c.key} className={c.cellCls || TD}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
