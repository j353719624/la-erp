import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, FileText, ArrowRight, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { message } from '@/utils/appMessage';
import { taxAccrualApi, TaxSummaryResult } from '@/api/finance';
import { format } from '@/utils/format';
import { downloadCSV } from '@/utils/export';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

/**
 * 应交税费明细表（税务报表，2026-09-11）
 *
 * 客户问"税这个月计提了多少、缴了多少、还欠多少"——本页一屏说清：
 *  期初（上月结转应收未交）+ 本期计提（贷方发生）− 本期缴纳（借方发生）= 期末应交未交
 *
 * 口径与税金计提、利润表一致：只统计已过账/已审核凭证（posted + approved），
 * 按法人层面汇总（不按部门隔离——税务申报是法人主体的口径）。
 */
const n = (v: string | number | undefined) => Number(v ?? 0);
const money = (v: string | number | undefined) => `¥${format.currency(n(v))}`;

export function TaxReport() {
  const navigate = useNavigate();
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [data, setData] = useState<TaxSummaryResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await taxAccrualApi.summary(period);
      if (res.code === 0) setData(res.data || null);
    } catch (e: any) {
      message.error(e?.message || '加载税务报表失败');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const rows = data?.rows || [];

  // 导出（与「财务报表」页一致：报税/存档习惯——拿走 CSV）
  const handleExport = () => {
    if (rows.length === 0) {
      message.warning('当前期间没有可导出的数据');
      return;
    }
    downloadCSV(
      `应交税费明细表_${period}.csv`,
      ['科目编码', '科目名称', '期初应交未交', '本期计提', '本期缴纳', '期末应交未交'],
      [
        ...rows.map((r) => [
          r.account_code,
          r.account_name,
          Number(r.open_balance || 0).toFixed(2),
          Number(r.accrued || 0).toFixed(2),
          Number(r.paid || 0).toFixed(2),
          Number(r.close_balance || 0).toFixed(2),
        ]),
        ['合计', '', Number(data?.total_open || 0).toFixed(2), Number(data?.total_accrued || 0).toFixed(2), Number(data?.total_paid || 0).toFixed(2), Number(data?.total_close || 0).toFixed(2)],
      ],
    );
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: any) => ReactNode;
  }
  const TH_C = 'px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    {
      key: 'account',
      header: '税种（科目）',
      headCls: TH_C,
      cell: (r) => (
        <>
          <span className="font-mono text-xs text-gray-500 mr-2">{r.account_code}</span>
          <span className="text-gray-900">{r.account_name}</span>
        </>
      ),
    },
    { key: 'open_balance', header: '期初应交未交', headCls: TH_C, cellCls: TD, cell: (r) => <span className="text-gray-700">{n(r.open_balance) ? money(r.open_balance) : '-'}</span> },
    { key: 'accrued', header: '本期计提', headCls: TH_C, cellCls: TD, cell: (r) => <span className="text-indigo-700">{n(r.accrued) ? money(r.accrued) : '-'}</span> },
    { key: 'paid', header: '本期缴纳', headCls: TH_C, cellCls: TD, cell: (r) => <span className="text-green-700">{n(r.paid) ? money(r.paid) : '-'}</span> },
    {
      key: 'close_balance',
      header: '期末应交未交',
      headCls: TH_C,
      cellCls: TD,
      cell: (r) => (
        <span className={n(r.close_balance) > 0 ? 'font-medium text-amber-700' : 'font-medium text-gray-900'}>{money(r.close_balance)}</span>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'tax-report',
    columns: rowCols,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="应交税费明细表"
        subtitle="各税种期初 / 本期计提 / 本期缴纳 / 期末应交未交（只含已过账凭证，与利润表同口径）"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="form-input w-40"
              aria-label="报表期间"
            />
            <button onClick={fetchData} className="btn-secondary flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">刷新</span>
            </button>
            <button onClick={handleExport} className="btn-secondary flex items-center gap-1.5">
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出</span>
            </button>
            <button onClick={() => navigate('/finance/tax-accruals')} className="btn-secondary flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              <span className="hidden md:inline">去计提</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* 汇总 */}
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-400">期初应交未交</div>
            <div className="text-gray-800 font-medium">{money(data?.total_open)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">本期计提</div>
            <div className="text-indigo-700 font-medium">{money(data?.total_accrued)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">本期已缴</div>
            <div className="text-green-700 font-medium">{money(data?.total_paid)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">期末应交未交</div>
            <div className={`font-semibold ${n(data?.total_close) > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
              {money(data?.total_close)}
            </div>
          </div>
        </div>
        {n(data?.total_close) > 0 && (
          <div className="mt-3 text-xs bg-amber-50 text-amber-700 rounded-lg px-3 py-2">
            期末仍有 {money(data?.total_close)} 应交未交：如已实际缴纳，请在「税金计提」页点对应税种的「缴纳」生成缴税凭证（借 应交税费 / 贷 银行存款）。
            增值税需先在「增值税结转」页签结转后，才会作为「应交增值税」显示为应交未交。
          </div>
        )}
      </div>

      {/* 明细 */}
      <div className="card">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <span className="font-medium text-gray-800 text-sm">{period} 分税种明细</span>
          <div className="ml-auto">{viewMenu}</div>
        </div>
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
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={4} /></td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-6">
                    <ListEmpty
                      title="该期间没有应交税费发生额"
                      description="若尚未计提本月印花税/附加税/企业所得税，或未做增值税月末结转，请到「税金计提」页办理"
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.account_code} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {!loading && rows.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-medium text-gray-800">
                  <td className="px-6 py-3">合计</td>
                  <td className="px-6 py-3">{money(data?.total_open)}</td>
                  <td className="px-6 py-3">{money(data?.total_accrued)}</td>
                  <td className="px-6 py-3">{money(data?.total_paid)}</td>
                  <td className="px-6 py-3">{money(data?.total_close)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
          口径说明：计提 = 期间内「应交税费」科目贷方发生额（借费用/贷应交税费）；缴纳 = 借方发生额（借应交税费/贷银行存款）。
          增值税的「进项税额」（2221.01.01）与「销项税额」（2221.01.02）随采购/销售发生即记账，属过程科目，
          不是可计提/可缴纳的税种，因此不在此表展示；月末结转后的「应交增值税」（2221.01）会正常显示
          （结转操作：「税金计提 → 增值税结转」页签一键结转，再在下方「待缴」区缴纳）。
        </div>
      </div>
    </div>
  );
}
