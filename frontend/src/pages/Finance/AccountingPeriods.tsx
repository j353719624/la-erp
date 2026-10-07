import { useCallback, useEffect, useState } from 'react';
import { Plus, Lock, Unlock, RefreshCw, PiggyBank } from 'lucide-react';
import { Modal, Input, Select, Button } from 'antd';
import { message } from '@/utils/appMessage';
import { periodApi, accountApi, taxAccrualApi } from '@/api/finance';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';
const STATUS_TEXT: Record<string, string> = { open: '开启', closing: '结账中', closed: '已结账' };
const STATUS_COLOR: Record<string, string> = {
  open: 'bg-green-50 text-green-600',
  closing: 'bg-yellow-50 text-yellow-600',
  closed: 'bg-gray-100 text-gray-500',
};

interface Period {
  id: string;
  period: string;
  start_date: string;
  end_date: string;
  status: string;
  remark?: string;
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
  category: string;
}

interface OpeningRow {
  account_id: string;
  begin_balance: string;
}

export function AccountingPeriods() {
  // [2026-09-18 权限细化] 新增期间=accounting_period_create；期初/月结/反结账=accounting_period_edit
  const { has } = usePermission();
  const [list, setList] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  // [B-06① 2026-09-14] 反结账中（行级 loading）
  const [reopening, setReopening] = useState<string | null>(null);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [status, setStatus] = useState('');
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [createOpen, setCreateOpen] = useState(false);
  const [periodInput, setPeriodInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [openingPeriod, setOpeningPeriod] = useState<Period | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [openingRows, setOpeningRows] = useState<OpeningRow[]>([]);
  const [savingOpening, setSavingOpening] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams = { page: pagination.page, page_size: pagination.page_size };
      const res = await periodApi.list({ ...params, period: debouncedKeyword || undefined, status: status || undefined });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, debouncedKeyword, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleCreate = async () => {
    const period = periodInput.trim();
    if (!/^\d{4}-\d{2}$/.test(period)) {
      message.warning('期间格式应为 YYYY-MM，如 2026-05');
      return;
    }
    setCreating(true);
    try {
      const res = await periodApi.create({ period });
      if (res.code === 0) {
        message.success(`会计期间 ${period} 已创建`);
        setCreateOpen(false);
        setPeriodInput('');
        fetchList();
      } else {
        message.error(res.message || '创建失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // [2026-09-11] 月结前置提示（不阻断，财务可自主判断）：
  //  ① 本期有利润但未计提企业所得税
  //  ② 本期还有未结转的增值税 —— 月结会锁定期间，之后再想补结转只能先反结账
  const checkPreClose = async (p: Period): Promise<string[]> => {
    const hints: string[] = [];
    try {
      const pv = await taxAccrualApi.preview(p.period);
      if (pv.code === 0 && pv.data) {
        const profit = Number(pv.data.profit_before_tax || 0);
        if (profit > 0) {
          const rec = await taxAccrualApi.list({ page: 1, page_size: 50, period: p.period, tax_type: 'income_tax' });
          const accCount = rec.code === 0 ? (rec.data?.total || 0) : 0;
          if (accCount === 0) hints.push(`本期利润总额 ${format.currency(profit)}，但尚未计提企业所得税；`);
        }
      }
    } catch {
      // 查询失败不阻断月结
    }
    try {
      const vb = await taxAccrualApi.vatBalance(p.period);
      if (vb.code === 0 && vb.data && !vb.data.transferred) {
        const out = Number(vb.data.output_net || 0);
        const inp = Number(vb.data.input_net || 0);
        if (out !== 0 || inp !== 0) {
          hints.push(`本期还有未结转的增值税（销项税额余额 ${format.currency(out)}／进项税额余额 ${format.currency(inp)}），结转后才进入「应交税费（待缴）」可缴；`);
        }
      }
    } catch {
      // 查询失败不阻断月结
    }
    return hints;
  };

  const handleClose = async (p: Period) => {
    // 先做税务完整性检查（有利润未计提所得税 / 未结转增值税 → 提示，不阻断）
    const hints = await checkPreClose(p);
    if (hints.length > 0) {
      const go = await confirmAction({
        title: `本期还有 ${hints.length} 项税务事项未处理（${p.period}）`,
        content: `${hints.map((h, i) => `${i + 1}. ${h}`).join('\n')}月结会锁定该期间（之后补做需先反结账），建议先去「财务 → 税金计提」处理。\n\n点「确定」仍然月结。`,
        okText: '仍然月结',
        cancelText: '先去处理',
        danger: true,
      });
      if (!go) {
        message.info('已取消月结：请先在「财务 → 税金计提」处理税务事项');
        return;
      }
    }
    if (!(await confirmAction({
      title: `确定对期间 ${p.period} 执行月结吗？`,
      content: '月结将自动结转本期损益到本年利润，并锁定该期间（期间内凭证将禁止新增/过账）。',
      danger: true,
    }))) return;
    setClosing(p.id);
    try {
      const res = await periodApi.close(p.id);
      if (res.code === 0) {
        message.success(`期间 ${p.period} 月结完成`);
        fetchList();
      } else {
        message.error(res.message || '月结失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '月结失败');
    } finally {
      setClosing(null);
    }
  };

  // [B-06① 2026-09-14] 反结账：红冲本期结转损益凭证并解锁期间。
  // 顺序回退：存在更晚的已结账期间时后端会返回中文拒绝（页面直接展示）。
  const handleReopen = async (p: Period) => {
    if (!(await confirmAction({
      title: `确定对期间 ${p.period} 执行反结账吗？`,
      content: '反结账将【红冲本期结转损益凭证】并解锁该期间，解锁后可继续补录/过账凭证，适合月末结账后才发现需要调整的场景。\n注意：需按期间倒序回退——若更晚的期间（如次月）已结账，请先反结账更晚的期间。',
      okText: '反结账',
      cancelText: '取消',
      danger: true,
    }))) return;
    setReopening(p.id);
    try {
      const res = await periodApi.reopen(p.id);
      if (res.code === 0) {
        message.success(`期间 ${p.period} 已反结账（结转凭证已红冲，可继续补录凭证）`);
        fetchList();
      } else {
        message.error(res.message || '反结账失败');
      }
    } catch (e: any) {
      message.error(e?.message || '反结账失败');
    } finally {
      setReopening(null);
    }
  };

  const handleOpenOpening = async (p: Period) => {
    setOpeningPeriod(p);
    setOpeningRows([{ account_id: '', begin_balance: '' }]);
    try {
      const res = await accountApi.all();
      if (res.code === 0) {
        const list = Array.isArray(res.data) ? res.data : (res.data?.list || []);
        setAccounts(list.map((a: any) => ({ id: a.id, code: a.code, name: a.name, category: a.category })));
      }
    } catch {
      setAccounts([]);
    }
  };

  const handleOpeningRowChange = (index: number, field: string, value: string) => {
    const rows = [...openingRows];
    rows[index] = { ...rows[index], [field]: value };
    setOpeningRows(rows);
  };

  const handleSaveOpening = async () => {
    if (!openingPeriod) return;
    const entries = openingRows
      .filter(r => r.account_id && parseFloat(r.begin_balance) > 0)
      .map(r => ({
        account_id: r.account_id,
        begin_balance: parseFloat(r.begin_balance),
      }));
    if (entries.length === 0) {
      message.warning('请至少填写一条科目期初余额');
      return;
    }
    setSavingOpening(true);
    try {
      const res = await periodApi.setOpeningBalances({ period: openingPeriod.period, entries });
      if (res.code === 0) {
        message.success(`期间 ${openingPeriod.period} 期初余额已保存`);
        setOpeningPeriod(null);
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '保存失败');
    } finally {
      setSavingOpening(false);
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Period) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'period', header: '期间', cell: (p) => <span className="font-medium text-gray-900">{p.period}</span> },
    { key: 'start_date', header: '开始日期', cell: (p) => <span className="text-gray-600">{format.date(p.start_date)}</span> },
    { key: 'end_date', header: '结束日期', cell: (p) => <span className="text-gray-600">{format.date(p.end_date)}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (p) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[p.status] || 'bg-gray-100 text-gray-500'}`}>
          {STATUS_TEXT[p.status] || p.status}
        </span>
      ),
    },
    { key: 'remark', header: '备注', cell: (p) => <span className="text-gray-500 text-sm">{p.remark}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (p) => (
        p.status === 'open' ? (
          <>
            {has('accounting_period_edit') && (
              <button
                onClick={() => handleOpenOpening(p)}
                className="btn-ghost text-blue-600 mr-2"
                title="录入期初余额"
              >
                <PiggyBank className="w-4 h-4" />
                <span className="hidden lg:inline ml-1 text-xs">期初</span>
              </button>
            )}
            {has('accounting_period_edit') && (
              <button
                onClick={() => handleClose(p)}
                disabled={closing === p.id}
                className="btn-ghost text-orange-600"
                title="月结"
              >
                {closing === p.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                <span className="hidden lg:inline ml-1 text-xs">月结</span>
              </button>
            )}
          </>
        ) : p.status === 'closed' ? (
          has('accounting_period_edit') && (
            <button
              onClick={() => handleReopen(p)}
              disabled={reopening === p.id}
              className="btn-ghost text-blue-600"
              title="反结账（红冲本期结转损益凭证并解锁期间）"
            >
              {reopening === p.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
              <span className="hidden lg:inline ml-1 text-xs">反结账</span>
            </button>
          )
        ) : (
          <span className="text-xs text-gray-400 inline-flex items-center gap-1">
            <RefreshCw className="w-4 h-4 animate-spin" /> 结账中
          </span>
        )
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'accounting-period-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="会计期间"
        subtitle="按月管理会计期间，月结自动结转损益并锁定期间；需补录调整时可反结账（红冲结转凭证并解锁）"
        extra={
          has('accounting_period_create') && (
            <button onClick={() => setCreateOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增期间</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <input
            type="text"
            placeholder="搜索期间，如 2026-05..."
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
            className="form-input md:max-w-xs"
          />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部状态</option>
            <option value="open">开启</option>
            <option value="closed">已结账</option>
          </select>
          <div className="ml-auto flex items-center">{viewMenu}</div>
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
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无会计期间" description="点击右上角「新增期间」创建当月期间" /></td></tr>
              ) : (
                list.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(p)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        </div>
      </div>

      <Modal
        title={`期初余额 · ${openingPeriod?.period ?? ''}`}
        open={!!openingPeriod}
        onCancel={() => setOpeningPeriod(null)}
        onOk={handleSaveOpening}
        confirmLoading={savingOpening}
        okText="保存"
        cancelText="取消"
        width={720}
      >
        <p className="text-xs text-gray-400 mb-3">录入启用系统前的期初余额，使资产负债表从该期间起数据正确。资产/成本类记借方，负债/权益/收入类记贷方。</p>
        <div className="space-y-2">
          {openingRows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Select
                className="flex-1"
                placeholder="请选择会计科目"
                showSearch
                optionFilterProp="label"
                value={row.account_id || undefined}
                onChange={(v) => handleOpeningRowChange(idx, 'account_id', v)}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: `${a.code} ${a.name}`,
                }))}
              />
              <Input
                type="number"
                placeholder="请输入期初余额"
                value={row.begin_balance}
                onChange={(e) => handleOpeningRowChange(idx, 'begin_balance', e.target.value)}
                style={{ width: 180 }}
              />
              {openingRows.length > 1 && (
                <Button danger size="small" onClick={() => setOpeningRows(openingRows.filter((_, i) => i !== idx))}>删除</Button>
              )}
            </div>
          ))}
        </div>
        <Button
          type="dashed"
          block
          className="mt-3"
          onClick={() => setOpeningRows([...openingRows, { account_id: '', begin_balance: '' }])}
        >
          + 添加科目
        </Button>
      </Modal>

      <Modal
        title="新增会计期间"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
      >
        <div className="py-2 space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">期间（YYYY-MM）</label>
            <Input
              placeholder="如：2026-05"
              value={periodInput}
              onChange={(e) => setPeriodInput(e.target.value)}
              onPressEnter={handleCreate}
            />
          </div>
          <p className="text-xs text-gray-400">系统将自动使用当月 1 日至月末作为期间起止日期。</p>
        </div>
      </Modal>
    </div>
  );
}
