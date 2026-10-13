import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { agingApi } from '@/api/finance';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

const BUCKET_ORDER = ['未到期', '0-30天', '31-60天', '61-90天', '90天以上'];
const BUCKET_COLOR: Record<string, string> = {
  '未到期': 'bg-green-50 text-green-600',
  '0-30天': 'bg-blue-50 text-blue-600',
  '31-60天': 'bg-yellow-50 text-yellow-600',
  '61-90天': 'bg-orange-50 text-orange-600',
  '90天以上': 'bg-red-50 text-red-600',
};

interface AgingDetail {
  party_id: string;
  party_name: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  balance: string;
  days_overdue: number;
  bucket: string;
}

interface AgingResult {
  type: 'ar' | 'ap';
  as_of: string;
  total: string;
  buckets: { label: string; amount: string; count: number }[];
  details: AgingDetail[];
  party_count: number;
}

export function AgingAnalysis() {
  const [tab, setTab] = useState<'ar' | 'ap'>('ar');
  const [data, setData] = useState<AgingResult | null>(null);
  const [loading, setLoading] = useState(true);
  // 请求竞态守卫：AR/AP 快速切换时丢弃过期响应，防止应收数据挂到应付标签下
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchData = useCallback(async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await agingApi.analysis(tab);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setData(res.data);
      }
      else message.error(res.message || '加载失败');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '加载账龄分析失败');
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [tab, nextSeq, isCurrent]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const bucketAmount = (label: string) => {
    const b = data?.buckets?.find(x => x.label === label);
    return b ? parseFloat(b.amount) : 0;
  };

  const bucketCount = (label: string) => {
    const b = data?.buckets?.find(x => x.label === label);
    return b?.count ?? 0;
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: AgingDetail) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-3';
  const rowCols: RowCol[] = [
    { key: 'party_name', header: tab === 'ar' ? '客户' : '供应商', cell: (d) => <span className="font-medium text-gray-900">{d.party_name || '-'}</span> },
    { key: 'invoice_no', header: '单据号', cell: (d) => <span className="text-gray-600">{d.invoice_no}</span> },
    { key: 'invoice_date', header: '开票日期', cell: (d) => <span className="text-gray-600">{d.invoice_date || '-'}</span> },
    { key: 'due_date', header: '到期日', cell: (d) => <span className="text-gray-600">{d.due_date || '-'}</span> },
    { key: 'balance', header: '余额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (d) => <span className="font-medium text-gray-900">{format.currency(parseFloat(d.balance))}</span> },
    {
      key: 'days_overdue',
      header: '逾期天数',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (d) => (
        d.days_overdue > 0 ? (
          <span className={`font-medium ${d.days_overdue > 90 ? 'text-red-600' : d.days_overdue > 60 ? 'text-orange-600' : 'text-yellow-600'}`}>
            {d.days_overdue} 天
          </span>
        ) : (
          <span className="text-gray-400">未到期</span>
        )
      ),
    },
    {
      key: 'bucket',
      header: '账龄',
      cell: (d) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${BUCKET_COLOR[d.bucket] || 'bg-gray-100 text-gray-500'}`}>
          {d.bucket}
        </span>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'aging-analysis',
    columns: rowCols,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="应收/应付账龄分析"
        subtitle="按到期日统计应收应付余额账龄分布，识别逾期风险"
        extra={
          <button onClick={fetchData} className="btn-ghost flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            <span className="hidden md:inline">刷新</span>
          </button>
        }
      />

      <div className="flex gap-2">
        {(['ar', 'ap'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t === 'ar' ? '应收账款' : '应付账款'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><TableSkeleton rows={6} /></div>
      ) : !data ? (
        <div className="card"><EmptyState title="暂无数据" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-4 bg-white rounded-xl border border-gray-100 shadow-sm">
              <div className="text-xs text-gray-500">应收/应付总额</div>
              <div className="mt-1 text-xl font-bold text-gray-900">{format.currency(parseFloat(data.total))}</div>
              <div className="text-xs text-gray-400 mt-1">{data.party_count} 个往来单位</div>
            </div>
            {BUCKET_ORDER.map(label => (
              <div key={label} className="p-4 bg-white rounded-xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{label}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${BUCKET_COLOR[label] || 'bg-gray-100 text-gray-500'}`}>
                    {bucketCount(label)} 笔
                  </span>
                </div>
                <div className="mt-1 text-lg font-semibold text-gray-800">{format.currency(bucketAmount(label))}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">明细（按逾期天数倒序）</span>
              <span className="text-xs text-gray-400">截至 {data.as_of}</span>              <div className="ml-auto pl-3">{viewMenu}</div>            </div>
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
                  {data.details.length === 0 ? (
                    <tr><td colSpan={visibleColumns.length} className="px-6 py-10 text-center text-gray-400">暂无未结清的{tab === 'ar' ? '应收' : '应付'}单据</td></tr>
                  ) : data.details.map((d, idx) => (
                    <tr key={`${d.invoice_no}-${idx}`} className="hover:bg-gray-50 transition-colors">
                      {visibleColumns.map((c) => (
                        <td key={c.key} className={c.cellCls || TD}>
                          {c.cell(d)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
