import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, FileText, RefreshCw, Landmark, Save } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { taxAccrualApi, TaxPreview, TaxAccrual, TaxPayable, TAX_TYPE_TEXT, shareholderApi, Shareholder, HOLDER_TYPE_TEXT, VatBalance } from '@/api/finance';
import { format, toLocalDateISO } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';
import { confirmAction } from '@/utils/confirm';
import { useNavigate } from 'react-router-dom';
import { useRequestGuard } from '@/hooks/useRequestGuard';

/**
 * 税金计提（2026-09-11）
 *
 * 客户反馈"只看到增值税，月末印花税/企业所得税/分红没有入口，影响净利润统计"。
 * 本页按税种一键计提 → 生成凭证（默认草稿，可勾选直接过账）→ 利润表"期间费用"自动增加，
 * 净利润变为税后口径。
 *
 * 口径说明：
 *  - 附加税：基数 = 本期应交增值税（销项税额 − 进项税额）；城建 7% + 教育费附加 3% + 地方教育附加 2%（可改）
 *  - 印花税：基数自填（如购销合同金额），默认 0.03%
 *  - 企业所得税：基数 = 本期利润总额（**不含**所得税费用本身），默认 25%（小微可改）
 *  - 分红：借 利润分配（全额）/ 贷 应付股利（净额）+ 应交个人所得税（默认 20%）
 */
const n = (v: string | number | undefined) => Number(v ?? 0);
const money = (v: string | number | undefined) => format.currency(n(v));
const pct = (v: string | number | undefined) => (n(v) * 100).toFixed(4).replace(/\.?0+$/, '');

type TabKey = 'surcharge' | 'stamp' | 'income_tax' | 'dividend' | 'vat_transfer';

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'vat_transfer', label: '增值税结转', hint: '月末结转：借销项税额 / 贷进项税额，差额转「应交增值税」→ 结转后在下方「待缴」区缴纳（进项大于销项时挂留抵待抵扣）' },
  { key: 'surcharge', label: '附加税', hint: '城建税 + 教育费附加 + 地方教育附加（基数=应交增值税）' },
  { key: 'stamp', label: '印花税', hint: '购销合同等按金额 × 税率（默认 0.03%）' },
  { key: 'income_tax', label: '企业所得税', hint: '基数=本期利润总额，税率默认 25%（小微可改）' },
  { key: 'dividend', label: '分红', hint: '宣告分红 + 代扣个人所得税（自然人 20%）；维护了股东档案可一键按持股比例拆分' },
];

/** 分红明细行（金额留空 = 后端按持股比例分摊剩余额） */
type DivRow = { shareholder_id: string; name: string; type: string; ratio: string; amount: string };

export function TaxAccrualPage() {
  // [2026-09-18 权限细化] 计提/结转=tax_accrual_create；缴纳/存默认=tax_accrual_edit；删除记录=tax_accrual_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [preview, setPreview] = useState<TaxPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<TabKey>('vat_transfer');
  const [acting, setActing] = useState(false);
  // 增值税结转预览（截至期末未结转余额）
  const [vatBal, setVatBal] = useState<VatBalance | null>(null);

  // 各税种表单
  const [surcharge, setSurcharge] = useState({ base: '', city: '', edu: '', local: '' });
  const [stamp, setStamp] = useState({ base: '', rate: '', amount: '' });
  const [income, setIncome] = useState({ base: '', rate: '', amount: '' });
  const [dividend, setDividend] = useState({ total: '', tax_rate: '' });
  // 分红股东明细（2026-09-11）：按股东拆分后逐个计税
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  const [divRows, setDivRows] = useState<DivRow[]>([]);
  const [postVoucher, setPostVoucher] = useState(false);
  const [remark, setRemark] = useState('');

  // 记录列表
  const [list, setList] = useState<TaxAccrual[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // 税费缴纳（2026-09-11）：应交税费余额 + 缴纳弹窗
  const [payables, setPayables] = useState<TaxPayable[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<TaxPayable | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', date: format.today(), bank: '1002', remark: '' });
  const [payActing, setPayActing] = useState(false);

  // [2026-09-13 审查修复] 请求竞态守卫：快速切换期间时旧响应可能覆盖新期间的数据
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchPreview = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await taxAccrualApi.preview(period);
      if (!isCurrent(seq)) return; // 已有更新的期间请求，丢弃过期响应
      if (res.code === 0 && res.data) {
        const p = res.data;
        setPreview(p);
        // 用建议值初始化表单（保留用户已改的？简单策略：切换期间时刷新）
        setSurcharge({
          base: String(n(p.vat_payable)),
          city: String(n(p.defaults.city_rate)),
          edu: String(n(p.defaults.edu_rate)),
          local: String(n(p.defaults.local_edu_rate)),
        });
        setStamp({ base: '', rate: String(n(p.defaults.stamp_rate)), amount: '' });
        setIncome({ base: String(n(p.profit_before_tax)), rate: String(n(p.defaults.income_tax_rate)), amount: '' });
        setDividend({ total: '', tax_rate: String(n(p.defaults.dividend_tax_rate)) });
      }
    } catch (e: any) {
      if (isCurrent(seq)) message.error(e?.message || '加载计提建议值失败');
    } finally {
      if (isCurrent(seq)) setLoading(false);
    }
  }, [period]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setListLoading(true);
    try {
      const res = await taxAccrualApi.list({ page: 1, page_size: 50, period });
      if (res.code === 0 && isCurrent(seq)) setList(res.data?.list || []);
    } catch { /* 静默 */ } finally {
      if (isCurrent(seq)) setListLoading(false);
    }
  }, [period]);

  const fetchPayables = useCallback(async () => {
    try {
      const res = await taxAccrualApi.payables();
      if (res.code === 0) setPayables(res.data || []);
    } catch { /* 静默 */ }
  }, []);

  const fetchShareholders = useCallback(async () => {
    try {
      const res = await shareholderApi.list({ page: 1, page_size: 200 });
      if (res.code === 0) setShareholders(res.data?.list || []);
    } catch { /* 静默 */ }
  }, []);

  const fetchVatBalance = useCallback(async () => {
    const seq = nextSeq();
    try {
      const res = await taxAccrualApi.vatBalance(period);
      if (res.code === 0 && isCurrent(seq)) setVatBal(res.data || null);
    } catch { /* 静默：无增值税发生额时不影响其它页签 */ }
  }, [period]);

  /** 存为默认税率（2026-09-12，B-02）：把当前各页签税率写入系统设置，下次打开自动带出 */
  const saveTaxDefaults = async () => {
    setActing(true);
    try {
      const res = await taxAccrualApi.saveRateDefaults({
        city_rate: n(surcharge.city),
        edu_rate: n(surcharge.edu),
        local_edu_rate: n(surcharge.local),
        stamp_rate: n(stamp.rate),
        income_tax_rate: n(income.rate),
        dividend_tax_rate: n(dividend.tax_rate),
      });
      if (res.code === 0) {
        message.success('已存为默认税率：下次打开本页自动带出');
        fetchPreview();
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setActing(false);
    }
  };

  useEffect(() => { fetchPreview(); }, [fetchPreview]);
  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { fetchPayables(); }, [fetchPayables]);
  useEffect(() => { fetchShareholders(); }, [fetchShareholders]);
  useEffect(() => { fetchVatBalance(); }, [fetchVatBalance]);

  /** 按持股比例拆分分红总额到各股东（最后一位吃舍入尾差，合计恒等于总额） */
  const splitByRatio = () => {
    const total = Number(dividend.total || 0);
    if (!(total > 0)) { message.warning('请先填写分红总额'); return; }
    const actives = shareholders.filter((s) => s.is_active !== false);
    if (actives.length === 0) {
      message.warning('还没有股东档案：请先到「财务 → 股东档案」维护股东与持股比例');
      return;
    }
    const ratioSum = actives.reduce((s, x) => s + Number(x.share_ratio || 0), 0);
    const round2 = (v: number) => Math.round(v * 100) / 100;
    let acc = 0;
    setDivRows(
      actives.map((s, i) => {
        const last = i === actives.length - 1;
        const amt = last
          ? round2(total - acc)
          : ratioSum > 0
            ? round2((total * Number(s.share_ratio || 0)) / ratioSum)
            : round2(total / actives.length);
        acc = round2(acc + amt);
        return {
          shareholder_id: s.id,
          name: s.name,
          type: s.holder_type,
          ratio: String(Number(s.share_ratio || 0)),
          amount: String(amt),
        };
      }),
    );
    message.success(`已按持股比例拆分到 ${actives.length} 位股东，可逐行微调金额`);
  };

  const openPay = (p: TaxPayable) => {
    setPayTarget(p);
      setPayForm({ amount: String(n(p.balance)), date: format.today(), bank: '1002', remark: '' });
    setPayOpen(true);
  };

  const submitPay = async (post: boolean) => {
    if (!payTarget) return;
    const amount = Number(payForm.amount || 0);
    if (!(amount > 0)) { message.warning('请填写缴纳金额'); return; }
    setPayActing(true);
    try {
      const res = await taxAccrualApi.pay({
        items: [{ account_code: payTarget.account_code, amount }],
        // Go time.Time 反序列化要求 RFC3339（带时区）；统一走 toLocalDateISO（本地零点）避免日期偏移
        pay_date: payForm.date ? toLocalDateISO(payForm.date) : undefined,
        bank_code: payForm.bank.trim() || undefined,
        remark: payForm.remark.trim() || undefined,
        post_voucher: post,
      });
      if (res.code === 0) {
        message.success(`已生成缴纳凭证 ${(res.data as any)?.voucher_no || ''}（${post ? '已过账' : '草稿'}）`);
        setPayOpen(false);
        fetchPayables();
      } else {
        message.error(res.message || '缴纳失败');
      }
    } catch (e: any) {
      message.error(e?.message || '缴纳失败');
    } finally {
      setPayActing(false);
    }
  };

  // 各税种计算结果（即时预览，与后端同口径）
  const surchargeAmount = useMemo(() => {
    const base = Number(surcharge.base || 0);
    return base * ((Number(surcharge.city || 0) + Number(surcharge.edu || 0) + Number(surcharge.local || 0)) || 0);
  }, [surcharge]);

  const stampAmount = useMemo(() => {
    if (stamp.amount.trim() !== '') return Number(stamp.amount || 0);
    return Number(stamp.base || 0) * Number(stamp.rate || 0);
  }, [stamp]);

  const incomeAmount = useMemo(() => {
    if (income.amount.trim() !== '') return Number(income.amount || 0);
    return Math.max(0, Number(income.base || 0)) * Number(income.rate || 0);
  }, [income]);

  const dividendCalc = useMemo(() => {
    const total = Number(dividend.total || 0);
    const tax = total * Number(dividend.tax_rate || 0);
    return { total, tax, net: total - tax };
  }, [dividend]);

  // 按股东明细的计算（与后端同口径：自然人扣税、法人免税；尾差归最后一行）
  const divSplit = useMemo(() => {
    const taxRate = Number(dividend.tax_rate || 0);
    const round2 = (v: number) => Math.round(v * 100) / 100;
    let amount = 0;
    let tax = 0;
    const lines = divRows.map((r) => {
      const a = Number(r.amount || 0);
      const t = r.type === 'natural' ? round2(a * taxRate) : 0;
      amount = round2(amount + a);
      tax = round2(tax + t);
      return { ...r, taxAmt: t, net: round2(a - t) };
    });
    const total = Number(dividend.total || 0);
    return { lines, amount, tax, net: round2(amount - tax), diff: round2(total - amount), total };
  }, [divRows, dividend.tax_rate, dividend.total]);

  const submit = async () => {
    if (preview?.period_closed) {
      message.warning('该期间已结账，不能计提（需先反结账）');
      return;
    }
    const payload: any = { period, tax_type: tab, post_voucher: postVoucher, remark: remark.trim() || undefined };
    if (tab === 'surcharge') {
      if (!(surchargeAmount > 0)) { message.warning('附加税金额必须大于 0（请填写计税基数与税率）'); return; }
      Object.assign(payload, {
        base_amount: Number(surcharge.base || 0),
        city_rate: Number(surcharge.city || 0),
        edu_rate: Number(surcharge.edu || 0),
        local_edu_rate: Number(surcharge.local || 0),
      });
    } else if (tab === 'stamp') {
      if (!(stampAmount > 0)) { message.warning('印花税金额必须大于 0（填写计税基数或直接填金额）'); return; }
      Object.assign(payload, {
        base_amount: Number(stamp.base || 0),
        rate: Number(stamp.rate || 0),
        amount: stamp.amount.trim() !== '' ? Number(stamp.amount) : undefined,
      });
    } else if (tab === 'income_tax') {
      if (!(incomeAmount > 0)) { message.warning('企业所得税金额必须大于 0（本期利润为负时可不计提）'); return; }
      Object.assign(payload, {
        base_amount: Number(income.base || 0),
        rate: Number(income.rate || 0),
        amount: income.amount.trim() !== '' ? Number(income.amount) : undefined,
      });
    } else if (tab === 'dividend') {
      if (!(dividendCalc.total > 0)) { message.warning('请填写分红金额'); return; }
      Object.assign(payload, { dividend_amount: dividendCalc.total, dividend_tax_rate: Number(dividend.tax_rate || 0) });
      if (divRows.length > 0) {
        // 金额留空的行不传 amount → 后端按持股比例分摊剩余额
        payload.dividends = divRows.map((r) => ({
          shareholder_id: r.shareholder_id,
          amount: r.amount.trim() !== '' ? Number(r.amount) : undefined,
        }));
      }
    } else if (tab === 'vat_transfer') {
      // 增值税结转：金额由后端按余额计算，前端不传基数/金额
      if (!vatBal || vatBal.transferred) {
        message.warning('截至该期间没有可结转的进项/销项税额（可能已结转，或本期无含税购销业务）');
        return;
      }
    }

    setActing(true);
    try {
      const res = await taxAccrualApi.create(payload);
      if (res.code === 0) {
        message.success(`已计提${TAX_TYPE_TEXT[tab]}，凭证 ${res.data?.voucher_no || ''}（${postVoucher ? '已过账' : '草稿'}）`);
        setRemark('');
        setDivRows([]); // 分红明细随计提一起清空，避免残留旧明细与已重置的总额不符
        fetchList();
        fetchPayables(); // 计提过账后应交税费余额变化 → 同步「待缴」区块
        fetchVatBalance(); // 结转后余额归零 → 刷新预览
        if (postVoucher) fetchPreview(); // 过账后基数变化，刷新建议值
      } else {
        message.error(res.message || '计提失败');
      }
    } catch (e: any) {
      message.error(e?.message || '计提失败');
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async (rec: TaxAccrual) => {
    const ok = await confirmAction({
      title: `确定删除计提记录 ${rec.code} 吗？`,
      content: rec.voucher_no ? `将同时删除未过账的凭证 ${rec.voucher_no}` : '',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await taxAccrualApi.remove(rec.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); }
      else message.error(res.message || '删除失败');
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const openVoucher = (rec: TaxAccrual) => {
    if (rec.voucher_id) navigate(`/finance/vouchers/${rec.voucher_id}`);
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40';
  const labelCls = 'block text-sm text-gray-600 mb-1';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol<T> {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: T) => ReactNode;
  }
  const TH_L = 'px-4 py-3 text-left text-xs font-medium text-gray-500';
  const TH_R = 'px-4 py-3 text-right text-xs font-medium text-gray-500';
  const TD = 'px-4 py-3';
  const rowCols: RowCol<TaxAccrual>[] = [
    { key: 'code', header: '单号', cell: (r) => <span className="font-mono text-sm text-gray-900">{r.code}</span> },
    {
      key: 'tax_type',
      header: '税种',
      cell: (r) => (
        <>
          <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{TAX_TYPE_TEXT[r.tax_type] || r.tax_type}</span>
          {r.details && r.details.length > 0 && (
            <div className="text-xs text-gray-400 mt-0.5">
              {r.details.map((d) => `${d.name || ''} ${money(d.amount)}`).join(' · ')}
            </div>
          )}
        </>
      ),
    },
    { key: 'base_amount', header: '计税基数', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-700`, cell: (r) => <span>{money(r.base_amount)}</span> },
    { key: 'rate', header: '税率', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-500`, cell: (r) => <span>{pct(r.rate)}%</span> },
    { key: 'amount', header: '计提金额', headCls: TH_R, cellCls: `${TD} text-right text-sm font-medium text-gray-900`, cell: (r) => <span>{money(r.amount)}</span> },
    {
      key: 'voucher_no',
      header: '凭证',
      cellCls: `${TD} text-sm`,
      cell: (r) => (
        r.voucher_no ? (
          <button onClick={() => openVoucher(r)} className="text-blue-600 hover:underline inline-flex items-center gap-1">
            <FileText className="w-3.5 h-3.5" />{r.voucher_no}
          </button>
        ) : <span className="text-gray-400">-</span>
      ),
    },
    { key: 'created_at', header: '时间', cellCls: `${TD} text-xs text-gray-500`, cell: (r) => <span>{r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) : '-'}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (r) => (
        has('tax_accrual_delete') ? (
          <button onClick={() => handleDelete(r)} title="删除" className="text-red-400 hover:text-red-600">
            <Trash2 className="w-4 h-4" />
          </button>
        ) : <span className="text-gray-300">-</span>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'tax-accrual-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });
  const payableCols: RowCol<TaxPayable>[] = [
    { key: 'account_code', header: '科目', cell: (p) => <span className="font-mono text-sm text-gray-900">{p.account_code}</span> },
    { key: 'account_name', header: '名称', cellCls: `${TD} text-sm text-gray-700`, cell: (p) => <span>{p.account_name}</span> },
    { key: 'balance', header: '应交未交', headCls: TH_R, cellCls: `${TD} text-right text-sm font-medium text-gray-900`, cell: (p) => <span>{money(p.balance)}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (p) => (
        <button onClick={() => openPay(p)} className="text-blue-600 hover:underline text-sm">缴纳</button>
      ),
    },
  ];
  // [2026-09-13] 同页第二张表：URL 参数用命名空间（?cols.payables=），否则刷新/分享后会被主表列清单裁掉
  const { visibleColumns: payableVisible, menu: payableMenu } = useTableView({
    pageKey: 'tax-accrual-payables',
    paramNs: 'payables',
    columns: payableCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="税金计提"
        subtitle="月末计提印花税/附加税/企业所得税/分红 → 生成凭证，利润表净利润自动变税后口径"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="form-input w-40"
              aria-label="计提期间"
            />
            <button onClick={() => navigate('/finance/tax-report')} className="btn-secondary flex items-center gap-1.5">
              <Landmark className="w-4 h-4" />
              <span className="hidden md:inline">税务报表</span>
            </button>
            {has('tax_accrual_edit') && (
              <button
                onClick={saveTaxDefaults}
                disabled={acting}
                className="btn-secondary flex items-center gap-1.5"
                title="把当前各页签税率存为默认：下次打开自动带出（不必每次手改）"
              >
                <Save className="w-4 h-4" />
                <span className="hidden md:inline">存为默认</span>
              </button>
            )}
            <button onClick={() => { fetchPreview(); fetchList(); }} className="btn-secondary flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">刷新</span>
            </button>
          </div>
        }
      />

      {/* 建议值面板 */}
      <div className="card p-4">
        {preview?.period_closed && (
          <div className="mb-3 text-sm bg-amber-50 text-amber-700 rounded-lg px-3 py-2">
            该期间已结账：不能计提（如确需调整，请先在「会计期间」反结账）
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><div className="text-xs text-gray-400">本期销项税额</div><div className="text-gray-800 font-medium">{money(preview?.output_vat)}</div></div>
          <div><div className="text-xs text-gray-400">本期进项税额</div><div className="text-gray-800 font-medium">{money(preview?.input_vat)}</div></div>
          <div><div className="text-xs text-gray-400">本期应交增值税（销项−进项）</div><div className="text-gray-900 font-medium">{money(preview?.vat_payable)}</div></div>
          <div><div className="text-xs text-gray-400">本期利润总额（不含所得税费用）</div><div className="text-gray-900 font-medium">{money(preview?.profit_before_tax)}</div></div>
        </div>
      </div>

      {/* 计提表单 */}
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${tab === t.key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          <div className="text-xs text-gray-500">{TABS.find((t) => t.key === tab)?.hint}</div>

          {tab === 'vat_transfer' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-gray-400">销项税额余额（待结转）</div>
                  <div className="text-gray-900 font-medium">{money(vatBal?.output_net)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">进项税额余额（待抵扣）</div>
                  <div className="text-gray-900 font-medium">{money(vatBal?.input_net)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">{n(vatBal?.vat_payable) < 0 ? '留抵税额（结转后待抵扣）' : '应交增值税（结转后入待缴）'}</div>
                  <div className={`font-semibold ${n(vatBal?.vat_payable) > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                    {money(Math.abs(n(vatBal?.vat_payable)))}
                  </div>
                </div>
              </div>
              {vatBal?.transferred ? (
                <div className="text-xs bg-gray-50 text-gray-500 rounded-lg px-3 py-2">
                  截至 {period} 没有待结转的进项/销项税额（已结转或本期无含税购销业务）。进项/销项税额随采购、销售发生即记账，月末结转后才进入「应交增值税」。
                </div>
              ) : (
                <div className="text-xs bg-blue-50 text-blue-700 rounded-lg px-3 py-2">
                  结转分录：借 <b>2221.01.02 销项税额</b>（余额）/ 贷 <b>2221.01.01 进项税额</b>（余额）；
                  {n(vatBal?.vat_payable) >= 0
                    ? '差额贷 2221.01 应交增值税，结转后可在下方「待缴」区缴纳。'
                    : '进项大于销项时差额借 2221.01 挂留抵（待抵扣），下期继续抵扣，无需缴款。'}
                  {' '}历史期间未结转的部分会一并结转到本期。
                  <div className="mt-1 text-blue-600/80">下方金额为本期<b>尚未结转</b>的余额（已结转部分已转入「待缴」区，不在此重复显示）；上方「本期应交增值税」是本期发生额口径，不受结转影响。</div>
                </div>
              )}
            </div>
          )}

          {tab === 'surcharge' && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className={labelCls}>计税基数（应交增值税）</label>
                <input type="text" inputMode="decimal" value={surcharge.base} onChange={(e) => setSurcharge((p) => ({ ...p, base: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>城建税率（如 0.07）</label>
                <input type="text" inputMode="decimal" value={surcharge.city} onChange={(e) => setSurcharge((p) => ({ ...p, city: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>教育费附加（如 0.03）</label>
                <input type="text" inputMode="decimal" value={surcharge.edu} onChange={(e) => setSurcharge((p) => ({ ...p, edu: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>地方教育附加（如 0.02）</label>
                <input type="text" inputMode="decimal" value={surcharge.local} onChange={(e) => setSurcharge((p) => ({ ...p, local: e.target.value }))} className={inputCls} />
              </div>
            </div>
          )}

          {tab === 'stamp' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>计税基数（合同金额等）</label>
                <input type="text" inputMode="decimal" value={stamp.base} onChange={(e) => setStamp((p) => ({ ...p, base: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>税率（默认 0.0003 = 万分之三）</label>
                <input type="text" inputMode="decimal" value={stamp.rate} onChange={(e) => setStamp((p) => ({ ...p, rate: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>直接指定金额（可空）</label>
                <input type="text" inputMode="decimal" value={stamp.amount} onChange={(e) => setStamp((p) => ({ ...p, amount: e.target.value }))} className={inputCls} placeholder="填写后忽略基数×税率" />
              </div>
            </div>
          )}

          {tab === 'income_tax' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>计税基数（利润总额）</label>
                <input type="text" inputMode="decimal" value={income.base} onChange={(e) => setIncome((p) => ({ ...p, base: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>税率（一般 0.25 / 小微 0.05）</label>
                <input type="text" inputMode="decimal" value={income.rate} onChange={(e) => setIncome((p) => ({ ...p, rate: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>直接指定金额（可空）</label>
                <input type="text" inputMode="decimal" value={income.amount} onChange={(e) => setIncome((p) => ({ ...p, amount: e.target.value }))} className={inputCls} placeholder="填写后忽略基数×税率" />
              </div>
            </div>
          )}

          {tab === 'dividend' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}>分红总额</label>
                  <input type="text" inputMode="decimal" value={dividend.total} onChange={(e) => setDividend((p) => ({ ...p, total: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>代扣个税率（自然人股东 0.2）</label>
                  <input type="text" inputMode="decimal" value={dividend.tax_rate} onChange={(e) => setDividend((p) => ({ ...p, tax_rate: e.target.value }))} className={inputCls} />
                </div>
                <div className="self-end flex flex-wrap items-center gap-2">
                  <button type="button" onClick={splitByRatio} className="btn-secondary">按持股比例拆分</button>
                  {divRows.length > 0 && (
                    <button type="button" onClick={() => setDivRows([])} className="btn-secondary">清空明细</button>
                  )}
                  <button type="button" onClick={() => navigate('/finance/shareholders')} className="btn-secondary">股东档案</button>
                  <span className="text-xs text-gray-400">
                    {shareholders.filter((s) => s.is_active !== false).length} 位启用股东
                  </span>
                </div>
                <div className="text-sm self-end">
                  <div className="text-xs text-gray-400">个税 / 应付股利（合计）</div>
                  <div className="text-gray-900 font-medium">
                    {divRows.length > 0 ? `${money(divSplit.tax)} / ${money(divSplit.net)}` : `${money(dividendCalc.tax)} / ${money(dividendCalc.net)}`}
                  </div>
                </div>
              </div>

              {divRows.length > 0 && (
                <div className="overflow-x-auto border border-gray-100 rounded-lg">
                  <table className="w-full min-w-max">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-3 py-2 text-xs font-medium text-gray-500">股东</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-500">持股比例</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-500">本次分红金额</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-500">代扣个税</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-500">实付金额</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-500">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {divSplit.lines.map((r, idx) => (
                        <tr key={r.shareholder_id}>
                          <td className="px-3 py-2 text-gray-900">
                            {r.name}
                            <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] ${r.type === 'corporate' ? 'bg-indigo-50 text-indigo-600' : 'bg-teal-50 text-teal-600'}`}>
                              {HOLDER_TYPE_TEXT[r.type] || r.type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600">{r.ratio}%</td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={r.amount}
                              onChange={(e) => {
                                const v = e.target.value;
                                setDivRows((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: v } : x)));
                              }}
                              className={`${inputCls} w-24 md:w-28`}
                              aria-label={`${r.name} 分红金额`}
                            />
                          </td>
                          <td className="px-3 py-2 text-amber-700">{r.type === 'natural' ? money(r.taxAmt) : <span className="text-gray-400 text-xs">免税</span>}</td>
                          <td className="px-3 py-2 font-medium text-gray-900">{money(r.net)}</td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setDivRows((prev) => prev.filter((_, i) => i !== idx))}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                              title="移除该股东"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-medium text-gray-800">
                        <td className="px-3 py-2" colSpan={2}>合计</td>
                        <td className="px-3 py-2">{money(divSplit.amount)}</td>
                        <td className="px-3 py-2">{money(divSplit.tax)}</td>
                        <td className="px-3 py-2">{money(divSplit.net)}</td>
                        <td className="px-3 py-2"></td>
                      </tr>
                    </tbody>
                  </table>
                  {divSplit.diff !== 0 && (
                    <div className="px-3 py-2 text-xs bg-amber-50 text-amber-700">
                      明细合计 {money(divSplit.amount)} 与分红总额 {money(divSplit.total)} 相差 {money(divSplit.diff)}：
                      未填金额的行会由后端按持股比例分摊剩余额；若全部填了金额，请调整到与总额一致（分录必须借贷平衡）。
                    </div>
                  )}
                </div>
              )}

              {divRows.length === 0 && (
                <div className="text-xs text-gray-400">
                  未维护股东档案或未拆分时，按总额 + 个税率一次性计提（借 利润分配 / 贷 应付股利 + 应交个人所得税）；
                  需要"谁拿多少"就点「按持股比例拆分」，或用「股东档案」维护比例后回来拆分。
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="text-gray-700">
              计提金额：<span className="text-lg font-semibold text-blue-600">
                {tab === 'surcharge' ? money(surchargeAmount) : tab === 'stamp' ? money(stampAmount) : tab === 'income_tax' ? money(incomeAmount) : tab === 'dividend' ? money(dividendCalc.total) : money(Math.abs(n(vatBal?.vat_payable)))}
              </span>
              {tab !== 'dividend' && tab !== 'vat_transfer' && (
                <span className="text-xs text-gray-400 ml-2">
                  （合计税率 {tab === 'surcharge'
                    ? pct(Number(surcharge.city || 0) + Number(surcharge.edu || 0) + Number(surcharge.local || 0))
                    : tab === 'stamp' ? pct(stamp.rate) : pct(income.rate)}%）
                </span>
              )}
            </div>
            <label className="flex items-center gap-2 text-gray-600">
              <input type="checkbox" checked={postVoucher} onChange={(e) => setPostVoucher(e.target.checked)} className="w-4 h-4 accent-blue-600" />
              生成后直接过账（不勾选则生成草稿凭证，可在凭证管理中复核）
            </label>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} className={`${inputCls} max-w-xs`} placeholder="备注（可选）" />
            {has('tax_accrual_create') && (
              <button onClick={submit} disabled={acting || preview?.period_closed} className="btn-primary flex items-center gap-1.5 ml-auto">
                <Plus className="w-4 h-4" />
                {acting ? '计提中...' : `计提${TAX_TYPE_TEXT[tab]}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 计提记录 */}
      <div className="card">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <span className="font-medium text-gray-800 text-sm">{period} 计提记录</span>
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
              {listLoading ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-4"><TableSkeleton rows={3} /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-8"><ListEmpty title="本期还没有计提记录" description="选择上方税种填写后点「计提」" /></td></tr>
              ) : list.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  {visibleColumns.map((c) => (
                    <td key={c.key} className={c.cellCls || TD}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 税费缴纳：应交税费科目余额 → 一键生成缴纳凭证（借 应交税费 / 贷 银行存款） */}
      <div className="card">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="font-medium text-gray-800 text-sm flex items-center gap-1.5">
            <Landmark className="w-4 h-4" />应交税费（待缴）
            <span className="text-xs font-normal text-gray-400">只含已过账/已审核凭证；增值税进项/销项税额为过程科目不计入</span>
          </span>
          <button onClick={fetchPayables} className="text-xs text-gray-500 hover:text-gray-700">刷新</button>
          <div className="ml-2">{payableMenu}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {payableVisible.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payables.length === 0 ? (
                <tr><td colSpan={payableVisible.length} className="px-4 py-6 text-center text-sm text-gray-400">当前没有待缴税费（计提后的应交税费会显示在这里）</td></tr>
              ) : payables.map((p) => (
                <tr key={p.account_code} className="hover:bg-gray-50 transition-colors">
                  {payableVisible.map((c) => (
                    <td key={c.key} className={c.cellCls || TD}>
                      {c.cell(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={payOpen}
        onCancel={() => setPayOpen(false)}
        title={`税费缴纳${payTarget ? ` · ${payTarget.account_code} ${payTarget.account_name}` : ''}`}
        width={520}
        footer={null}
      >
        {payTarget && (
          <div className="space-y-4 pt-1">
            <div className="text-sm bg-blue-50 text-blue-700 rounded-lg p-3">
              应交未交：<b>{money(payTarget.balance)}</b>　
              <span className="text-xs">（缴纳后生成凭证：借 {payTarget.account_code} / 贷 银行存款）</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>缴纳金额 *</label>
                <input type="text" inputMode="decimal" value={payForm.amount}
                  onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>缴纳日期</label>
                <input type="date" value={payForm.date}
                  onChange={(e) => setPayForm((p) => ({ ...p, date: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>银行/现金科目</label>
                <input type="text" value={payForm.bank}
                  onChange={(e) => setPayForm((p) => ({ ...p, bank: e.target.value }))} className={inputCls} placeholder="默认 1002 银行存款" />
              </div>
              <div>
                <label className={labelCls}>备注</label>
                <input type="text" value={payForm.remark}
                  onChange={(e) => setPayForm((p) => ({ ...p, remark: e.target.value }))} className={inputCls} placeholder="请输入备注" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setPayOpen(false)} className="btn-secondary">取消</button>
              {has('tax_accrual_edit') && (
                <>
                  <button onClick={() => submitPay(false)} disabled={payActing} className="btn-secondary">生成草稿凭证</button>
                  <button onClick={() => submitPay(true)} disabled={payActing} className="btn-primary">
                    {payActing ? '处理中...' : '缴纳并过账'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
