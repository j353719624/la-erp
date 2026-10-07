import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { RefreshCw, Users, TrendingDown, GraduationCap } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { format } from '@/utils/format';
import { hrReportApi, HeadcountReport, TurnoverReport, TrainingReport } from '@/api/hr';
import { departmentApi } from '@/api/system';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { usePermission } from '@/hooks/usePermission';

/**
 * 人事报表（2026-09-19 第五批②，权限 hr_report，只读）
 *
 * 三个页签：
 *  - 编制与人数：按部门「编制 vs 在职/试用」对比与缺口（含未分配部门行）+ 本月入职/离职
 *  - 离职率：逐月 期初/入职/离职/期末；离职率 = 当月离职 ÷ 期初 × 100%（可按部门过滤）
 *  - 培训统计：场次/参与人次/参训人数/学时合计/人均学时（可按期间 + 部门过滤）
 */
export function HrReportList() {
  usePermission(); // 页面级权限由路由守卫控制（hr_report）
  const [tab, setTab] = useState<'headcount' | 'turnover' | 'training'>('headcount');
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    departmentApi.listAll().then((res) => {
      if (res.code === 0) setDepts(res.data ?? []);
    }).catch((err) => console.warn('部门列表加载失败', err));
  }, []);

  // ── 编制与人数 ─────────────────────────────────────────────────────────────
  const [hc, setHc] = useState<HeadcountReport | null>(null);
  const [hcLoading, setHcLoading] = useState(false);
  const loadHeadcount = useCallback(async () => {
    setHcLoading(true);
    try {
      const res = await hrReportApi.headcount();
      if (res.code === 0) setHc(res.data ?? null);
      else message.error(res.message || '加载失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '加载失败'); } finally { setHcLoading(false); }
  }, []);

  // ── 离职率 ─────────────────────────────────────────────────────────────────
  const [year, setYear] = useState(new Date().getFullYear());
  const [tvDept, setTvDept] = useState('');
  const [tv, setTv] = useState<TurnoverReport | null>(null);
  const [tvLoading, setTvLoading] = useState(false);
  const loadTurnover = useCallback(async () => {
    setTvLoading(true);
    try {
      const res = await hrReportApi.turnover({ year, department_id: tvDept || undefined });
      if (res.code === 0) setTv(res.data ?? null);
      else message.error(res.message || '加载失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '加载失败'); } finally { setTvLoading(false); }
  }, [year, tvDept]);

  // ── 培训统计 ───────────────────────────────────────────────────────────────
  // 默认区间 = 本月 1 号 ~ 今天：必须用**本地日期**（`new Date(...).toISOString()` 在本地 00:00~08:00
  // 会取到前一天，导致默认区间首日错位；`format.today()` 已是本地口径，2026-09-22 审查修复）
  const [trStart, setTrStart] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [trEnd, setTrEnd] = useState(format.today());
  const [trDept, setTrDept] = useState('');
  const [tr, setTr] = useState<TrainingReport | null>(null);
  const [trLoading, setTrLoading] = useState(false);
  const loadTraining = useCallback(async () => {
    setTrLoading(true);
    try {
      const res = await hrReportApi.training({ start_date: trStart, end_date: trEnd, department_id: trDept || undefined });
      if (res.code === 0) setTr(res.data ?? null);
      else message.error(res.message || '加载失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '加载失败'); } finally { setTrLoading(false); }
  }, [trStart, trEnd, trDept]);

  useEffect(() => {
    if (tab === 'headcount') loadHeadcount();
    else if (tab === 'turnover') loadTurnover();
    else loadTraining();
  }, [tab, loadHeadcount, loadTurnover, loadTraining]);

  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

  const statCard = (label: string, value: string | number, extra?: string) => (
    <div className="card p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
      {extra && <div className="text-xs text-gray-400 mt-1">{extra}</div>}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="人事报表"
        subtitle="编制与人数（编制对比/缺口）· 离职率（逐月期初/入职/离职/期末）· 培训统计（人次/学时）"
        extra={
          <button
            onClick={() => { if (tab === 'headcount') loadHeadcount(); else if (tab === 'turnover') loadTurnover(); else loadTraining(); }}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />刷新
          </button>
        }
      />

      <div className="card">
        <div className="border-b border-gray-100 flex">
          <button onClick={() => setTab('headcount')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'headcount' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            <Users className="w-4 h-4" />编制与人数
          </button>
          <button onClick={() => setTab('turnover')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'turnover' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            <TrendingDown className="w-4 h-4" />离职率
          </button>
          <button onClick={() => setTab('training')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'training' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            <GraduationCap className="w-4 h-4" />培训统计
          </button>
        </div>

        {/* 编制与人数 */}
        {tab === 'headcount' && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {statCard('编制合计', hc?.total_headcount ?? '—', '未设置编制的部门不计入')}
              {statCard('在职人数', hc?.total_on_duty ?? '—', '含试用期，不含已离职')}
              {statCard('已离职（档案）', hc?.total_left ?? '—')}
              {statCard('本月入职', hc?.month_hires ?? '—')}
              {statCard('本月离职', hc?.month_leaves ?? '—')}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className={TH_L}>部门</th>
                    <th className={TH_R}>编制</th>
                    <th className={TH_R}>在职</th>
                    <th className={TH_R}>试用</th>
                    <th className={TH_R}>在职合计</th>
                    <th className={TH_R}>离职</th>
                    <th className={TH_R}>缺口</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {hcLoading ? (
                    <tr><td colSpan={7} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
                  ) : !hc || hc.rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-400">暂无部门数据</td></tr>
                  ) : hc.rows.map((r) => (
                    <tr key={r.department_id || 'unassigned'} className="hover:bg-gray-50">
                      <td className={`${TD} text-gray-900`}>{r.department_name}</td>
                      <td className={`${TD} text-right text-gray-700`}>{r.headcount ?? '—'}</td>
                      <td className={`${TD} text-right text-gray-700`}>{r.active}</td>
                      <td className={`${TD} text-right text-gray-700`}>{r.probation}</td>
                      <td className={`${TD} text-right font-medium text-gray-900`}>{r.on_duty}</td>
                      <td className={`${TD} text-right text-gray-500`}>{r.left}</td>
                      <td className={`${TD} text-right`}>
                        {r.gap == null ? <span className="text-gray-400">—</span>
                          : r.gap > 0 ? <span className="text-amber-600">{r.gap}（缺编）</span>
                          : r.gap < 0 ? <span className="text-red-600">{Math.abs(r.gap)}（超编）</span>
                          : <span className="text-green-600">已满编</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-500">编制在「系统管理 → 部门管理」编辑部门时设置「编制人数」；缺口 = 编制 − 在职合计。</div>
          </div>
        )}

        {/* 离职率 */}
        {tab === 'turnover' && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="form-input w-28">
                {years.map((y) => <option key={y} value={y}>{y} 年</option>)}
              </select>
              <select value={tvDept} onChange={(e) => setTvDept(e.target.value)} className="form-input w-44">
                <option value="">全部部门</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <span className="text-xs text-gray-500">离职率 = 当月离职 ÷ 期初 × 100%（期初为 0 时显示 0）</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {statCard('全年入职', tv?.total_hires ?? '—')}
              {statCard('全年离职', tv?.total_leaves ?? '—')}
              {statCard('平均离职率', tv ? `${tv.avg_rate.toFixed(2)}%` : '—', '离职合计 ÷ 期初合计')}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className={TH_L}>月份</th>
                    <th className={TH_R}>期初</th>
                    <th className={TH_R}>入职</th>
                    <th className={TH_R}>离职</th>
                    <th className={TH_R}>期末</th>
                    <th className={TH_R}>离职率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tvLoading ? (
                    <tr><td colSpan={6} className="px-6 py-4"><TableSkeleton rows={6} /></td></tr>
                  ) : !tv ? (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-400">暂无数据</td></tr>
                  ) : tv.rows.map((r) => (
                    <tr key={r.month} className="hover:bg-gray-50">
                      <td className={`${TD} text-gray-900`}>{year}-{String(r.month).padStart(2, '0')}</td>
                      <td className={`${TD} text-right text-gray-700`}>{r.begin}</td>
                      <td className={`${TD} text-right text-green-600`}>{r.hires > 0 ? `+${r.hires}` : 0}</td>
                      <td className={`${TD} text-right text-red-600`}>{r.leaves > 0 ? `-${r.leaves}` : 0}</td>
                      <td className={`${TD} text-right font-medium text-gray-900`}>{r.end}</td>
                      <td className={`${TD} text-right ${r.rate > 5 ? 'text-red-600' : r.rate > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{r.rate.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 培训统计 */}
        {tab === 'training' && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input type="date" value={trStart} onChange={(e) => setTrStart(e.target.value)} className="form-input w-40" />
              <span className="text-gray-400">至</span>
              <input type="date" value={trEnd} onChange={(e) => setTrEnd(e.target.value)} className="form-input w-40" />
              <select value={trDept} onChange={(e) => setTrDept(e.target.value)} className="form-input w-44">
                <option value="">全部部门</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <span className="text-xs text-gray-500">结束日期含当天整天；人次按「已参加」计。</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {statCard('培训场次', tr?.sessions ?? '—')}
              {statCard('参与人次', tr?.participants ?? '—')}
              {statCard('参训人数', tr?.people ?? '—', '按员工去重')}
              {statCard('学时合计', tr ? `${parseFloat(tr.total_hours || '0')} 小时` : '—', '人次口径')}
              {statCard('人均学时', tr ? `${parseFloat(tr.avg_hours || '0')} 小时` : '—', '÷ 参训人数')}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className={TH_L}>部门</th>
                    <th className={TH_R}>涉及场次</th>
                    <th className={TH_R}>参与人次</th>
                    <th className={TH_R}>参训人数</th>
                    <th className={TH_R}>学时合计</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {trLoading ? (
                    <tr><td colSpan={5} className="px-6 py-4"><TableSkeleton rows={4} /></td></tr>
                  ) : !tr || tr.rows.length === 0 ? (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-400">该期间没有培训记录</td></tr>
                  ) : tr.rows.map((r) => (
                    <tr key={r.department} className="hover:bg-gray-50">
                      <td className={`${TD} text-gray-900`}>{r.department}</td>
                      <td className={`${TD} text-right text-gray-700`}>{r.sessions}</td>
                      <td className={`${TD} text-right text-gray-700`}>{r.participants}</td>
                      <td className={`${TD} text-right text-gray-700`}>{r.people}</td>
                      <td className={`${TD} text-right font-medium text-gray-900`}>{parseFloat(r.hours || '0')} 小时</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
