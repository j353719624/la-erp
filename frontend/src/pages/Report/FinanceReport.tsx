import { useState, useEffect } from 'react';
import { Calendar, Download } from 'lucide-react';
import { reportApi, TrialBalanceRow, GeneralLedgerRow, CashFlowResult } from '@/api/report';
import { accountApi } from '@/api/finance';
import { format } from '@/utils/format';
import { downloadCSV } from '@/utils/export';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { EmptyState } from '@/components/EmptyState';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { markReportSeen } from '@/utils/localKeys';
import { QUICK_RANGES, readReportPeriod, writeReportPeriod } from '@/utils/reportRange';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import dayjs from 'dayjs';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

type TabKey = 'profit' | 'balance' | 'trial' | 'ledger' | 'cashflow';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profit', label: '利润表' },
  { key: 'balance', label: '资产负债表' },
  { key: 'trial', label: '科目余额表' },
  { key: 'ledger', label: '明细账' },
  { key: 'cashflow', label: '现金流量表' },
];

export function FinanceReport() {
  const [tab, setTab] = useState<TabKey>('profit');
  const [profitLoss, setProfitLoss] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [trialRows, setTrialRows] = useState<TrialBalanceRow[]>([]);
  const [trialTotal, setTrialTotal] = useState<{ debit: number; credit: number }>({ debit: 0, credit: 0 });
  const [ledgerRows, setLedgerRows] = useState<GeneralLedgerRow[]>([]);
  const [cashFlow, setCashFlow] = useState<CashFlowResult | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [ledgerAccount, setLedgerAccount] = useState('');
  const [loading, setLoading] = useState(true);
  // [易用性 P2] 默认当前月（与销售/采购报表口径一致），避免“不选日期→报表一打开是空的”
  // [2026-09-12] 记住上次查看的期间（按报表页分桶）；首次进入仍默认本月
  const [dateRange, setDateRange] = useState(() => {
    const saved = readReportPeriod('finance-report');
    return saved ?? {
      start_date: dayjs().startOf('month').format('YYYY-MM-DD'),
      end_date: dayjs().format('YYYY-MM-DD'),
    };
  });
  // 请求竞态守卫：快速切换报表页签/日期/科目时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    // 全量科目：报表筛选需覆盖全部科目
    accountApi.all().then((res: any) => {
      if (res.code === 0) setAccounts(res.data?.list || []);
    }).catch((err: any) => console.warn('科目列表加载失败（可能缺 voucher 权限）:', err?.message || err));
  }, []);

  useEffect(() => {
    writeReportPeriod('finance-report', dateRange.start_date, dateRange.end_date); // [2026-09-12] 记忆本次期间
    fetchReports();
    // [易用性 P1] 看过任一经营报表即打勾仪表盘上手清单的“查看经营报表”
    markReportSeen();
  }, [dateRange, tab, ledgerAccount]);

  const fetchReports = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    const params = {
      start_date: dateRange.start_date || undefined,
      end_date: dateRange.end_date || undefined,
    };
    try {
      if (tab === 'profit') {
        const r = await reportApi.profitLoss(params);
        if (r.code === 0) {
          if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
          setProfitLoss(r.data || null);
        }
      } else if (tab === 'balance') {
        const r = await reportApi.balanceSheet(params);
        if (r.code === 0) {
          if (!isCurrent(seq)) return;
          setBalanceSheet(r.data || null);
        }
      } else if (tab === 'trial') {
        const r = await reportApi.trialBalance(params);
        if (r.code === 0) {
          if (!isCurrent(seq)) return;
          setTrialRows(r.data?.rows || []);
          setTrialTotal({ debit: r.data?.total_debit || 0, credit: r.data?.total_credit || 0 });
        }
      } else if (tab === 'ledger') {
        if (ledgerAccount) {
          const r = await reportApi.generalLedger({ ...params, account_code: ledgerAccount });
          if (r.code === 0) {
            if (!isCurrent(seq)) return;
            setLedgerRows(r.data || []);
          }
        }
      } else if (tab === 'cashflow') {
        const r = await reportApi.cashFlow(params);
        if (r.code === 0) {
          if (!isCurrent(seq)) return;
          setCashFlow(r.data || null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch finance reports:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#f59e0b'];

  const pieData = balanceSheet ? [
    { name: '资产', value: balanceSheet.assets || 0 },
    { name: '负债', value: balanceSheet.liabilities || 0 },
    { name: '权益', value: balanceSheet.equity || 0 },
  ] : [];

  const liabilityData = balanceSheet ? [
    { name: '资产', value: balanceSheet.assets || 0 },
    { name: '负债', value: balanceSheet.liabilities || 0 },
    { name: '权益', value: balanceSheet.equity || 0 },
  ] : [];

  const CATEGORY_TEXT: Record<string, string> = {
    asset: '资产', liability: '负债', equity: '权益', cost: '成本', income: '收入',
  };

  const handleExport = () => {
    if (tab === 'profit' && profitLoss) {
      downloadCSV('利润表.csv',
        ['项目', '金额'],
        [
          ['营业收入', Number(profitLoss.revenue || 0).toFixed(2)],
          ['营业成本', Number(profitLoss.cost || 0).toFixed(2)],
          ['毛利润', Number(profitLoss.gross_profit || 0).toFixed(2)],
          ['净利润', Number(profitLoss.net_profit || 0).toFixed(2)],
        ]
      );
    } else if (tab === 'balance' && balanceSheet) {
      downloadCSV('资产负债表.csv',
        ['项目', '金额'],
        [
          ['资产', Number(balanceSheet.assets || 0).toFixed(2)],
          ['负债', Number(balanceSheet.liabilities || 0).toFixed(2)],
          ['权益', Number(balanceSheet.equity || 0).toFixed(2)],
        ]
      );
    } else if (tab === 'trial') {
      downloadCSV('科目余额表.csv',
        ['科目编码', '科目名称', '类别', '期初', '借方', '贷方', '期末', '方向'],
        trialRows.map(r => [r.account_code, r.account_name, CATEGORY_TEXT[r.category] || r.category, Number(r.begin_balance).toFixed(2), Number(r.debit_amount).toFixed(2), Number(r.credit_amount).toFixed(2), Number(r.end_balance).toFixed(2), r.end_direction === 'debit' ? '借' : '贷'])
      );
    } else if (tab === 'ledger') {
      downloadCSV('明细账.csv',
        ['日期', '凭证号', '摘要', '方向', '金额', '累计余额'],
        ledgerRows.map(r => [r.entry_date, r.voucher_no, r.remark, r.direction === 'debit' ? '借' : '贷', Number(r.amount).toFixed(2), Number(r.balance).toFixed(2)])
      );
    } else if (tab === 'cashflow' && cashFlow) {
      downloadCSV('现金流量表.csv',
        ['项目', '流入', '流出', '净额'],
        [...cashFlow.items.map(i => [i.label, Number(i.inflow).toFixed(2), Number(i.outflow).toFixed(2), Number(i.net).toFixed(2)]), ['现金净增加额', '', '', Number(cashFlow.net_increase).toFixed(2)]]
      );
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
  const TH_L = 'px-4 py-2 text-left text-xs font-medium text-gray-500';
  const TH_R = 'px-4 py-2 text-right text-xs font-medium text-gray-500';
  const TH_C = 'px-4 py-2 text-center text-xs font-medium text-gray-500';
  const TD = 'px-4 py-2';
  // 科目余额表（8 列，含合计行）
  const trialCols: RowCol[] = [
    { key: 'account_code', header: '科目编码', cellCls: `${TD} text-sm font-medium text-gray-900`, cell: (r) => <span>{r.account_code}</span> },
    { key: 'account_name', header: '科目名称', cellCls: `${TD} text-sm text-gray-700`, cell: (r) => <span>{r.account_name}</span> },
    { key: 'category', header: '类别', cellCls: `${TD} text-sm text-gray-500`, cell: (r) => <span>{CATEGORY_TEXT[r.category] || r.category}</span> },
    { key: 'begin_balance', header: '期初余额', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-600`, cell: (r) => <span>{format.currency(r.begin_balance)}</span> },
    { key: 'debit_amount', header: '本期借方', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-600`, cell: (r) => <span>{format.currency(r.debit_amount)}</span> },
    { key: 'credit_amount', header: '本期贷方', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-600`, cell: (r) => <span>{format.currency(r.credit_amount)}</span> },
    { key: 'end_balance', header: '期末余额', headCls: TH_R, cellCls: `${TD} text-right text-sm font-medium text-gray-900`, cell: (r) => <span>{format.currency(r.end_balance)}</span> },
    {
      key: 'end_direction',
      header: '方向',
      headCls: TH_C,
      cellCls: 'px-4 py-2 text-center text-sm',
      cell: (r) => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${r.end_direction === 'debit' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
          {r.end_direction === 'debit' ? '借' : '贷'}
        </span>
      ),
    },
  ];
  // 明细账（6 列）
  const ledgerCols: RowCol[] = [
    { key: 'entry_date', header: '日期', cellCls: `${TD} text-sm text-gray-600`, cell: (r) => <span>{format.date(r.entry_date)}</span> },
    { key: 'voucher_no', header: '凭证号', cellCls: `${TD} text-sm font-medium text-gray-900`, cell: (r) => <span>{r.voucher_no}</span> },
    { key: 'remark', header: '摘要', cellCls: `${TD} text-sm text-gray-700`, cell: (r) => <span>{r.remark || '-'}</span> },
    { key: 'direction', header: '方向', headCls: TH_C, cellCls: 'px-4 py-2 text-center text-sm', cell: (r) => <span>{r.direction === 'debit' ? '借' : '贷'}</span> },
    { key: 'amount', header: '金额', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-600`, cell: (r) => <span>{format.currency(r.amount)}</span> },
    { key: 'balance', header: '累计余额', headCls: TH_R, cellCls: `${TD} text-right text-sm font-medium text-gray-900`, cell: (r) => <span>{format.currency(r.balance)}</span> },
  ];
  // [2026-09-13] 两张表同页：主表用 ?cols=，次表用 ?cols.ledger=（否则互相裁列）
  const { visibleColumns: trialVisible, menu: trialMenu } = useTableView({
    pageKey: 'finance-report-trial',
    columns: trialCols,
    locked: { leading: ['account_code'] },
  });
  const { visibleColumns: ledgerVisible, menu: ledgerMenu } = useTableView({
    pageKey: 'finance-report-ledger',
    paramNs: 'ledger',
    columns: ledgerCols,
    locked: { leading: ['voucher_no'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="财务报表"
        subtitle="利润表 / 资产负债表 / 科目余额表 / 明细账 / 现金流量表"
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
            {/* [2026-09-13] 仅试算/明细账两个页签有表格，视图菜单跟随页签 */}
            {tab === 'trial' ? trialMenu : tab === 'ledger' ? ledgerMenu : null}
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
        <div className="flex flex-wrap gap-1 lg:ml-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'profit' && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">利润表</h2>
          {loading ? (
            <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : profitLoss ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">营业收入</p>
                <p className="text-xl font-bold text-green-600 mt-1">¥{format.currency(profitLoss.revenue)}</p>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">营业成本</p>
                <p className="text-xl font-bold text-red-600 mt-1">¥{format.currency(profitLoss.cost)}</p>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">毛利润</p>
                <p className="text-xl font-bold text-blue-600 mt-1">¥{format.currency(profitLoss.gross_profit)}</p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">净利润</p>
                <p className="text-xl font-bold text-purple-600 mt-1">¥{format.currency(profitLoss.net_profit)}</p>
              </div>
            </div>
          ) : (
            <EmptyState title="暂无利润表数据" />
          )}
        </div>
      )}

      {tab === 'balance' && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">资产负债表</h2>
          {loading ? (
            <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : balanceSheet ? (
            <>
              {/* 数字汇总（2026-09-11）：此前只有图形，用户无法核对“资产=负债+权益”；
                  未做期末损益结转时权益已含「未结转损益」，差额为 0 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 mb-1">资产合计</p>
                  <p className="text-xl font-semibold text-gray-900">¥{format.currency(balanceSheet.assets || 0)}</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 mb-1">负债合计</p>
                  <p className="text-xl font-semibold text-gray-900">¥{format.currency(balanceSheet.liabilities || 0)}</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 mb-1">权益合计</p>
                  <p className="text-xl font-semibold text-gray-900">¥{format.currency(balanceSheet.equity || 0)}</p>
                  {Number(balanceSheet.unclosed_profit || 0) !== 0 && (
                    <p className="text-xs text-amber-600 mt-1">含未结转损益 ¥{format.currency(balanceSheet.unclosed_profit)}</p>
                  )}
                </div>
                <div className={`rounded-lg border p-4 ${Math.abs(Number(balanceSheet.assets || 0) - (Number(balanceSheet.liabilities || 0) + Number(balanceSheet.equity || 0))) < 0.01 ? 'border-green-100 bg-green-50' : 'border-red-100 bg-red-50'}`}>
                  <p className="text-xs text-gray-500 mb-1">平衡校验</p>
                  {Math.abs(Number(balanceSheet.assets || 0) - (Number(balanceSheet.liabilities || 0) + Number(balanceSheet.equity || 0))) < 0.01 ? (
                    <p className="text-sm font-medium text-green-700">✓ 资产 = 负债 + 权益</p>
                  ) : (
                    <p className="text-sm font-medium text-red-700">
                      ✗ 差额 ¥{format.currency(Number(balanceSheet.assets || 0) - (Number(balanceSheet.liabilities || 0) + Number(balanceSheet.equity || 0)))}
                    </p>
                  )}
                </div>
              </div>
              {Number(balanceSheet.unclosed_profit || 0) !== 0 && (
                <p className="text-xs text-gray-500 mb-6">
                  说明：本期损益尚未结转到「本年利润」，报表已按「权益含未结转损益」口径展示；完成期末损益结转（会计期间 → 月末结转）后本提示消失。
                </p>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-md font-medium text-gray-700 mb-4">资产分布</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => [`¥${format.currency(value)}`, '金额']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <h3 className="text-md font-medium text-gray-700 mb-4">负债与权益</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={liabilityData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value: number) => [`¥${format.currency(value)}`, '金额']} />
                      <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              </div>
            </>
          ) : (
            <EmptyState title="暂无资产负债表数据" />
          )}
        </div>
      )}

      {tab === 'trial' && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">科目余额表</h2>
          <p className="text-sm text-gray-500 mb-4">按期间汇总凭证分录，期初余额需完成期初初始化后生效</p>
          {loading ? (
            <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : trialRows.length === 0 ? (
            <EmptyState title="暂无科目余额数据" description="业务单据确认后自动生成凭证" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    {trialVisible.map((c) => (
                      <th key={c.key} className={c.headCls || TH_L}>
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {trialRows.map(r => (
                    <tr key={r.account_code} className="hover:bg-gray-50 transition-colors">
                      {trialVisible.map((c) => (
                        <td key={c.key} className={c.cellCls || TD}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {/* [2026-09-13] 合计行按可见列动态生成（隐藏列时不会错位） */}
                  <tr className="bg-gray-50 font-semibold">
                    {trialVisible.map((c, i) => {
                      if (i === 0) return <td key={c.key} className="px-4 py-2 text-sm text-gray-700">合计</td>;
                      if (c.key === 'debit_amount') return <td key={c.key} className="px-4 py-2 text-right text-sm text-gray-900">{format.currency(trialTotal.debit)}</td>;
                      if (c.key === 'credit_amount') return <td key={c.key} className="px-4 py-2 text-right text-sm text-gray-900">{format.currency(trialTotal.credit)}</td>;
                      return <td key={c.key} className="px-4 py-2" />;
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'ledger' && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">明细账</h2>
          <div className="mb-4 flex items-center gap-3">
            <label className="text-sm text-gray-600">科目：</label>
            <SearchSelect
              value={ledgerAccount}
              onChange={(v) => setLedgerAccount(v ?? '')}
              placeholder="请选择科目"
              allowClear
              options={accounts.map((a: any) => ({ value: a.code, label: `${a.code} ${a.name}` }))}
              className="md:w-64"
            />
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : !ledgerAccount ? (
            <EmptyState title="请选择科目" />
          ) : ledgerRows.length === 0 ? (
            <EmptyState title="该科目暂无明细" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    {ledgerVisible.map((c) => (
                      <th key={c.key} className={c.headCls || TH_L}>
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ledgerRows.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      {ledgerVisible.map((c) => (
                        <td key={c.key} className={c.cellCls || TD}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'cashflow' && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">现金流量表</h2>
          {loading ? (
            <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : cashFlow ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {cashFlow.items.map(item => (
                  <div key={item.category} className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-600">{item.label}</p>
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-gray-500">流入</span><span className="text-green-600 font-medium">¥{format.currency(item.inflow)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">流出</span><span className="text-red-600 font-medium">¥{format.currency(item.outflow)}</span></div>
                      <div className="flex justify-between border-t border-gray-200 pt-1"><span className="text-gray-600">净额</span><span className="font-semibold text-gray-900">¥{format.currency(item.net)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-blue-50 rounded-lg p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-blue-700">现金及现金等价物净增加额</span>
                <span className="text-lg font-bold text-blue-700">¥{format.currency(cashFlow.net_increase)}</span>
              </div>
            </div>
          ) : (
            <EmptyState title="暂无现金流量表数据" description="收款/付款确认后自动生成凭证" />
          )}
        </div>
      )}
    </div>
  );
}