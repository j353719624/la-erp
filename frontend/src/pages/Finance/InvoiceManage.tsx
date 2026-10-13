import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { receivableApi, payableApi } from '@/api/finance';
import { ARInvoice, APInvoice } from '@/types/finance';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { TableSkeleton } from '@/components/TableSkeleton';
import { useTableView } from '@/hooks/useTableView';
import { loadOptions } from '@/utils/loadOptions';
import type { ReactNode } from 'react';

type TabKey = 'sales' | 'purchase';

export function InvoiceManage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('sales');
  const [arList, setArList] = useState<ARInvoice[]>([]);
  const [apList, setApList] = useState<APInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ sales: { count: 0, amount: 0, tax: 0 }, purchase: { count: 0, amount: 0, tax: 0 } });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响另一项（此前 Promise.all 一拒全空）
      const [arRes, apRes] = await loadOptions([
        // 台账需含 invoiced/partial/void；不按单状态过滤，前端只保留已登记发票（invoice_status 非空）
        receivableApi.list({ page: 1, page_size: 1000 }),
        payableApi.list({ page: 1, page_size: 1000 }),
      ], '发票台账');
      // 后端 List 返回数组（无分页）
      const ar = (arRes?.code === 0 ? (Array.isArray(arRes.data) ? arRes.data : arRes.data?.list || []) : [])
        .filter((r: any) => r.invoice_status) as ARInvoice[];
      const ap = (apRes?.code === 0 ? (Array.isArray(apRes.data) ? apRes.data : apRes.data?.list || []) : [])
        .filter((r: any) => r.invoice_status) as APInvoice[];
      setArList(ar);
      setApList(ap);
      const month = format.today().slice(0, 7);
      const sum = (rows: any[], key: string) => rows
        .filter(r => (r.invoiced_at || '').startsWith(month))
        .reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
      const count = (rows: any[]) => rows.filter(r => (r.invoiced_at || '').startsWith(month)).length;
      setStats({
        sales: { count: count(ar), amount: sum(ar, 'total_amount'), tax: sum(ar, 'tax_amount') },
        purchase: { count: count(ap), amount: sum(ap, 'total_amount'), tax: sum(ap, 'tax_amount') },
      });
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const current = tab === 'sales' ? arList : apList;
  const currentStats = tab === 'sales' ? stats.sales : stats.purchase;

  const StatCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900 mt-1">{value}</p>
      {sub ? <p className="text-xs text-gray-400 mt-0.5">{sub}</p> : null}
    </div>
  );

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: any) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_C = 'px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    {
      key: 'invoice_no',
      header: '发票号',
      cell: (item) => <span className="font-medium text-gray-900">{tab === 'sales' ? item.sales_invoice_no : item.purchase_invoice_no}</span>,
    },
    {
      key: 'party',
      header: tab === 'sales' ? '客户' : '供应商',
      cell: (item) => (
        <span className="text-gray-700">
          {tab === 'sales' ? (item.customer_name || item.edges?.customer?.name || '-') : (item.supplier_name || item.edges?.supplier?.name || '-')}
        </span>
      ),
    },
    { key: 'source_no', header: '关联单据', cell: (item) => <span className="text-gray-500 text-sm">{item.invoice_no}</span> },
    { key: 'invoiced_at', header: '开票日期', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.invoiced_at)}</span> },
    { key: 'total_amount', header: '价税合计', headCls: TH_R, cellCls: `${TD} text-right`, cell: (item) => <span className="font-medium text-gray-900">¥{format.currency(item.total_amount)}</span> },
    { key: 'tax_amount', header: '税额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (item) => <span className="text-gray-600 text-sm">¥{format.currency(item.tax_amount)}</span> },
    { key: 'tax_rate', header: '税率', headCls: TH_R, cellCls: `${TD} text-right`, cell: (item) => <span className="text-gray-600 text-sm">{item.tax_rate ? `${item.tax_rate}%` : '-'}</span> },
    {
      key: 'invoice_status',
      header: '状态',
      headCls: TH_C,
      cellCls: `${TD} text-center`,
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.invoice_status === 'void' ? 'bg-red-50 text-red-600' : item.invoice_status === 'partial' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
          {item.invoice_status === 'void' ? '已作废' : item.invoice_status === 'partial' ? '部分开票' : '已开票'}
        </span>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；本页无操作列
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'invoice-manage',
    columns: rowCols,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="发票管理"
        subtitle="销项发票与进项发票开票登记台账"
        extra={
          <div className="flex gap-1">
            <button
              onClick={() => setTab('sales')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'sales' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              销项发票
            </button>
            <button
              onClick={() => setTab('purchase')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'purchase' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              进项发票
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label={`本月${tab === 'sales' ? '销项' : '进项'}开票（张）`} value={String(currentStats.count)} />
        <StatCard label={`本月开票金额`} value={`¥${format.currency(currentStats.amount)}`} />
        <StatCard label={`本月${tab === 'sales' ? '销项' : '进项'}税额`} value={`¥${format.currency(currentStats.tax)}`} />
      </div>

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          <span className="text-sm font-medium text-gray-700">{tab === 'sales' ? '销项发票台账' : '进项发票台账'}</span>
          <span className="text-xs text-gray-400 ml-2">在应收/应付管理中完成开票登记</span>
          <div className="ml-auto">{viewMenu}</div>
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
              ) : current.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty title="暂无已开票记录" description="在应收/应付管理中点击开票图标进行开票登记" /></td></tr>
              ) : (
                current.map((item: any) => (
                  <tr key={item.id} className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => navigate(tab === 'sales' ? `/finance/receivables/${item.id}` : `/finance/payables/${item.id}`)}>
                    {visibleColumns.map((c) => (
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
