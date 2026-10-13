import { useEffect, useMemo, useState } from 'react';
import { Printer, Search, Calendar } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { reportApi, StatementLine, CustomerStatementResult, SupplierStatementResult } from '@/api/report';
import { customerApi, supplierApi } from '@/api/order';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { EmptyState } from '@/components/EmptyState';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

type PartyTab = 'customer' | 'supplier';

interface PartyOption {
  id: string;
  name: string;
}

const TYPE_TEXT: Record<string, string> = {
  invoice: '应收/应付',
  receipt: '收款',
  payment: '付款',
};

export function Statement() {
  const [tab, setTab] = useState<PartyTab>('customer');
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [partyId, setPartyId] = useState('');
  const [dateRange, setDateRange] = useState({ start_date: '', end_date: '' });
  const [result, setResult] = useState<CustomerStatementResult | SupplierStatementResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    customerApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setCustomers((res.data?.list || []).map((c: any) => ({ id: c.id, name: c.name })));
    }).catch((err: any) => console.warn('客户列表加载失败（可能缺 customer_list 权限）:', err?.message || err));
    supplierApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setSuppliers((res.data?.list || []).map((s: any) => ({ id: s.id, name: s.name })));
    }).catch((err: any) => console.warn('供应商列表加载失败（可能缺 supplier_list 权限）:', err?.message || err));
  }, []);

  const parties = tab === 'customer' ? customers : suppliers;

  const handleSearch = async () => {
    if (!partyId) {
      message.warning('请先选择客户/供应商');
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const params = {
        ...(tab === 'customer' ? { customer_id: partyId } : { supplier_id: partyId }),
        start_date: dateRange.start_date || undefined,
        end_date: dateRange.end_date || undefined,
      };
      const res =
        tab === 'customer'
          ? await reportApi.customerStatement(params as any)
          : await reportApi.supplierStatement(params as any);
      if (res.code === 0) {
        const list = (res.data || []) as any[];
        setResult(list.length > 0 ? list[0] : null);
        if (list.length === 0) message.info('该往来单位在当前期间无发生额与余额');
      } else {
        message.error(res.message || '查询失败');
      }
    } catch (err) {
      console.error('statement fetch failed:', err);
      message.error(err instanceof Error && err.message ? err.message : '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const lines: StatementLine[] = useMemo(() => (result ? result.lines || [] : []), [result]);

  const summary = useMemo(() => {
    if (!result) return null;
    return {
      begin: Number((result as any).begin_balance ?? 0),
      end: Number((result as any).end_balance ?? 0),
      periodIn: Number((result as any).period_in ?? 0),
      periodOut: Number((result as any).period_out ?? 0),
    };
  }, [result]);

  const partyName = result
    ? (result as CustomerStatementResult).customer_name || (result as SupplierStatementResult).supplier_name || ''
    : '';

  const handlePrint = () => {
    window.print();
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: StatementLine) => ReactNode;
  }
  const TH_C = 'px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-4 text-center';
  const rowCols: RowCol[] = [
    { key: 'date', header: '日期', cell: (line) => <span>{format.date(line.date)}</span> },
    { key: 'no', header: '单据号', cell: (line) => <span>{line.no}</span> },
    { key: 'source_no', header: '来源单号', cell: (line) => <span>{line.source_no || '-'}</span> },
    {
      key: 'type',
      header: '类型',
      cell: (line) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs ${
          line.type === 'invoice'
            ? 'bg-blue-50 text-blue-600'
            : line.type === 'receipt'
              ? 'bg-green-50 text-green-600'
              : 'bg-orange-50 text-orange-600'
        }`}>
          {TYPE_TEXT[line.type] || line.type}
        </span>
      ),
    },
    {
      key: 'amount',
      header: '发生金额',
      cellCls: TD,
      cell: (line) => <span className={line.type === 'invoice' ? 'text-blue-600' : 'text-green-600'}>{format.currency(Number(line.amount))}</span>,
    },
    { key: 'balance', header: '单据余额', cell: (line) => <span>{format.currency(Number(line.balance))}</span> },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'statement',
    columns: rowCols,
  });

  return (
    <div className="space-y-6 statement-print">
      {/* 2026-09-12：打印时消除浏览器自带页眉/页脚（@page 边距归零，页边距改由容器内边距承载） */}
      <style>{`@media print { @page { margin: 0; } .statement-print { padding: 12mm 10mm; } .statement-print > * { break-inside: avoid; } }`}</style>
      <PageHeader
        title="对账函"
        subtitle="客户/供应商往来对账单"
        extra={
          <button onClick={handlePrint} disabled={!result} className="btn-primary flex items-center gap-2 print:hidden">
            <Printer className="w-4 h-4" />
            <span className="hidden md:inline">打印对账单</span>
          </button>
        }
      />

      {/* 筛选区 */}
      <div className="card p-4 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => { setTab('customer'); setPartyId(''); setResult(null); setSearched(false); }}
              className={`px-4 py-2 text-sm ${tab === 'customer' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
            >
              客户对账
            </button>
            <button
              onClick={() => { setTab('supplier'); setPartyId(''); setResult(null); setSearched(false); }}
              className={`px-4 py-2 text-sm ${tab === 'supplier' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
            >
              供应商对账
            </button>
          </div>

          <SearchSelect
            value={partyId}
            onChange={(v) => setPartyId(v ?? '')}
            placeholder={`请选择${tab === 'customer' ? '客户' : '供应商'}`}
            style={{ width: 240 }}
            options={parties.map((p) => ({ value: p.id, label: p.name }))}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={dateRange.start_date}
              onChange={(e) => setDateRange((prev) => ({ ...prev, start_date: e.target.value }))}
              className="form-input w-36"
            />
            <span className="text-gray-400">至</span>
            <input
              type="date"
              value={dateRange.end_date}
              onChange={(e) => setDateRange((prev) => ({ ...prev, end_date: e.target.value }))}
              className="form-input w-36"
            />
          </div>

          <button onClick={handleSearch} disabled={loading} className="btn-primary flex items-center gap-2">
            <Search className="w-4 h-4" />
            {loading ? '查询中...' : '查询'}
          </button>
          <div className="ml-auto">{viewMenu}</div>
        </div>
      </div>

      {/* 结果区 */}
      {result ? (
        <div className="card p-6">
          {/* 抬头 */}
          <div className="border-b border-gray-200 pb-4 mb-4">
            <h2 className="text-xl font-bold text-gray-800 text-center">{tab === 'customer' ? '客户对账单' : '供应商对账单'}</h2>
            <p className="text-center text-gray-500 text-sm mt-1">
              往来单位：{partyName}
              {'　'}{dateRange.start_date && `期间：${dateRange.start_date} ~ ${dateRange.end_date || '至今'}`}
            </p>
          </div>

          {/* 汇总卡 */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 text-center">
                <div className="text-sm text-gray-500">期初余额</div>
                <div className="text-xl font-semibold text-gray-800 mt-1">{format.currency(summary.begin)}</div>
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-center">
                <div className="text-sm text-blue-500">{tab === 'customer' ? '期间应收' : '期间应付'}</div>
                <div className="text-xl font-semibold text-blue-600 mt-1">{format.currency(summary.periodIn)}</div>
              </div>
              <div className="rounded-lg bg-green-50 border border-green-100 p-4 text-center">
                <div className="text-sm text-green-500">{tab === 'customer' ? '期间收款' : '期间付款'}</div>
                <div className="text-xl font-semibold text-green-600 mt-1">{format.currency(summary.periodOut)}</div>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-100 p-4 text-center">
                <div className="text-sm text-amber-600">期末余额</div>
                <div className="text-xl font-semibold text-amber-700 mt-1">{format.currency(summary.end)}</div>
              </div>
            </div>
          )}

          {/* 明细表 */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {visibleColumns.map((c) => (
                    <th key={c.key} className={c.headCls || TH_C}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length} style={{ textAlign: 'center' }}>
                      <div className="py-8"><EmptyState description="期间内无发生额" /></div>
                    </td>
                  </tr>
                )}
                {lines.map((line, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD} onClick={undefined}>
                        {c.cell(line)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between text-sm text-gray-400 print:hidden">
            <span>打印日期：{new Date().toLocaleDateString('zh-CN')}</span>
            <span>本对账单依据业务单据自动生成</span>
          </div>
        </div>
      ) : (
        <div className="card p-10">
          {searched ? (
            <EmptyState description="该往来单位在当前期间无发生额与余额" />
          ) : (
            <EmptyState description="选择客户/供应商与期间后点击「查询」生成对账单" />
          )}
        </div>
      )}
    </div>
  );
}
