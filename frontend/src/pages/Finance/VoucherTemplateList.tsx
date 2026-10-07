import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Select } from 'antd';
import { Pencil, RotateCcw, Plus, Trash2, RefreshCw, Info } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { accountApi, voucherTemplateApi, VoucherTemplate, VoucherTemplateEntry } from '@/api/finance';
import type { Account } from '@/types/finance';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import { RowActions } from '@/components/RowActions';
import type { ReactNode } from 'react';
import { confirmAction } from '@/utils/confirm';

/**
 * 凭证模板管理（2026-09-12，B-01b 设置便利性改进）
 *
 * 背景：业务单据的自动过账分录来自凭证模板（采购入库/销售出库/退货/应收开票）。
 * 此前模板定义只能在代码里——客户想调整科目（如用 1403 明细科目、换应付科目）只能提工单；
 * B-01a 又让 seed 不再覆盖模板（防升级冲掉客户手改）——本页是配套出口：
 *   ① 直接编辑分录（科目/方向/金额表达式）② 改坏可一键「恢复默认」（对照官方定义）。
 *
 * 金额表达式（与后端 auto_post.EvalAmountExpr 求值域一致）：
 *   line.amount     含税金额
 *   line.tax_amount 税额
 *   line.cost       成本（出库行）
 *   支持 + - 组合，如 {{line.amount - line.tax_amount}}
 */
const SOURCE_TYPE_TEXT: Record<string, string> = {
  purchase_inbound: '采购入库',
  sales_outbound: '销售出库',
  purchase_return: '采购退货',
  sales_return: '销售退货',
  ar_invoice: '应收开票',
};

export function VoucherTemplateList() {
  // [2026-09-18 权限细化] 编辑分录/恢复默认=voucher_template_edit（无新增/删除：模板由系统内置）
  const { has } = usePermission();
  const [list, setList] = useState<VoucherTemplate[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<VoucherTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    remark: string;
    is_active: boolean;
    entries: VoucherTemplateEntry[];
  }>({ name: '', remark: '', is_active: true, entries: [] });

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await voucherTemplateApi.list();
      if (res.code === 0) {
        const data: any = res.data;
        setList(Array.isArray(data) ? data : (data?.list ?? []));
      }
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // [2026-09-13] B-01b 收尾：科目改为下拉选择（此前是全站唯一的自由文本科目输入，
  // 写错要到业务单据过账时才 fail-fast）；加载全量科目供选择与名称回填。
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await accountApi.all();
      if (res.code === 0) {
        setAccounts(res.data?.list || []);
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '科目表加载失败，科目下拉可能不完整');
    }
  }, []);
  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // 科目下拉项：叶子科目 + 树形缩进（与「科目映射」「会计科目」页同序）
  const accountOptions = useMemo(() => {
    const childrenOf = (parentId: string | null) =>
      accounts
        .filter((a) => (a.parent_id || null) === parentId)
        .sort((a, b) => a.code.localeCompare(b.code));
    const out: { value: string; label: string }[] = [];
    const walk = (parentId: string | null, level: number) => {
      for (const acc of childrenOf(parentId)) {
        if (acc.is_leaf) out.push({ value: acc.code, label: `${'\u3000'.repeat(level)}${acc.code} - ${acc.name}` });
        walk(acc.id, acc.is_leaf ? level : level + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [accounts]);

  const accountNameByCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of accounts) map[a.code] = a.name;
    return map;
  }, [accounts]);

  // 选项兔底：模板引用的科目不在科目表（已删/历史值）时补一行提示，避免选择器显示空白让人以为值丢了
  const optionsForCode = (code: string) =>
    !code || accountOptions.some((o) => o.value === code)
      ? accountOptions
      : [...accountOptions, { value: code, label: `${code}（不在科目表，请重选）` }];

  const openEdit = (tpl: VoucherTemplate) => {
    setEditTarget(tpl);
    setForm({
      name: tpl.name || '',
      remark: tpl.remark || '',
      is_active: tpl.is_active !== false,
      entries: (tpl.entries || []).map((e) => ({
        account_code: e.account_code || '',
        account_name: e.account_name || '',
        direction: e.direction === 'credit' ? 'credit' : 'debit',
        amount_expr: e.amount_expr || '',
      })),
    });
  };

  const updateRow = (i: number, patch: Partial<VoucherTemplateEntry>) => {
    setForm((prev) => ({
      ...prev,
      entries: prev.entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)),
    }));
  };
  const addRow = () =>
    setForm((prev) => ({
      ...prev,
      entries: [...prev.entries, { account_code: '', account_name: '', direction: 'debit', amount_expr: '{{line.amount}}' }],
    }));
  const removeRow = (i: number) =>
    setForm((prev) => ({ ...prev, entries: prev.entries.filter((_, idx) => idx !== i) }));

  const save = async () => {
    if (!editTarget) return;
    // 前端轻校验（严格校验在服务端：变量白名单 / 方向 / 必填）
    if (!form.name.trim()) {
      message.warning('模板名称不能为空');
      return;
    }
    if (form.entries.length === 0) {
      message.warning('至少需要一条分录');
      return;
    }
    for (let i = 0; i < form.entries.length; i += 1) {
      const e = form.entries[i];
      if (!e.account_code.trim()) {
        message.warning(`第 ${i + 1} 行：科目编码不能为空`);
        return;
      }
      if (!e.amount_expr.trim()) {
        message.warning(`第 ${i + 1} 行：金额表达式不能为空`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await voucherTemplateApi.update(editTarget.id, {
        name: form.name.trim(),
        remark: form.remark,
        is_active: form.is_active,
        entries: form.entries,
      });
      if (res.code === 0) {
        message.success('模板已保存（之后的自动过账按新分录生成）');
        setEditTarget(null);
        fetchList();
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const resetTemplate = async (tpl: VoucherTemplate) => {
    if (
      !(await confirmAction({
        title: `恢复「${tpl.name}」为默认？`,
        content: '将放弃你对该模板的全部修改（名称与分录都恢复为官方版本）',
        danger: true,
      }))
    )
      return;
    try {
      const res = await voucherTemplateApi.reset(tpl.id);
      if (res.code === 0) {
        message.success('已恢复默认模板');
        fetchList();
      } else {
        message.error(res.message || '恢复失败');
      }
    } catch (e: any) {
      message.error(e?.message || '恢复失败');
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: VoucherTemplate) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-3 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'code', header: '模板编码', cell: (tpl) => <span className="text-sm text-gray-500 font-mono">{tpl.code}</span> },
    { key: 'name', header: '名称', cell: (tpl) => <span className="text-sm text-gray-800">{tpl.name}</span> },
    { key: 'source_type', header: '适用单据', cell: (tpl) => <span className="text-sm text-gray-600">{SOURCE_TYPE_TEXT[tpl.source_type] || tpl.source_type}</span> },
    { key: 'entries', header: '分录数', cell: (tpl) => <span className="text-sm text-gray-600">{(tpl.entries || []).length} 条</span> },
    {
      key: 'is_active',
      header: '状态',
      cell: (tpl) => (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            tpl.is_active !== false ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {tpl.is_active !== false ? '启用' : '停用'}
        </span>
      ),
    },
    { key: 'remark', header: '备注', cellCls: `${TD} text-sm text-gray-500 max-w-xs truncate`, cell: (tpl) => <span>{tpl.remark || '-'}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      // [2026-09-14 统一操作列] 手写按钮迁移 RowActions：窄屏折叠「主操作 + ⋮」，操作列 ~88px
      cell: (tpl) => (
        <RowActions
          actions={[
            ...(has('voucher_template_edit')
              ? [
                  { key: 'edit', label: '编辑分录', icon: <Pencil className="w-4 h-4" />, primary: true, onClick: () => openEdit(tpl) },
                  { key: 'reset', label: '恢复默认（放弃自定义，回到官方分录）', icon: <RotateCcw className="w-4 h-4" />, onClick: () => resetTemplate(tpl) },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'voucher-template-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="凭证模板"
        subtitle="业务单据自动过账的分录模板：可调整科目/方向/金额表达式；改坏可一键恢复默认"
        extra={
          <button onClick={fetchList} className="btn-secondary flex items-center gap-1.5">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">刷新</span>
          </button>
        }
      />

      {/* 表达式与保存校验说明：避免客户写错变量/科目/方向导致生成金额错或过账失败 */}
      <div className="card p-4 text-sm text-gray-600 flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <div>
          <p>
            金额表达式可用变量：<b>line.amount</b>（含税金额）、<b>line.tax_amount</b>（税额）、<b>line.cost</b>（成本），支持{' '}
            <b>+ -</b> 串联运算（如 <code className="text-gray-600">{'{{line.amount + line.cost - line.tax_amount}}'}</code>，从左到右计算）。
          </p>
          <p className="text-gray-400 mt-0.5">
            例：<code className="text-gray-600">{'{{line.amount - line.tax_amount}}'}</code> = 不含税金额。保存时会校验：① 变量与运算符号拼写 ②
            科目必须存在于「财务 → 会计科目」 ③ 借贷表达式必须平衡（借方合计 = 贷方合计）；有问题立即提示，不会等到过账时才报错。
          </p>
          <p className="text-gray-400 mt-0.5">模板修改在系统升级时<b>不会被覆盖</b>；改坏可用「恢复默认」找回官方分录。</p>
        </div>
      </div>

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center justify-end">
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
                <tr>
                  <td colSpan={visibleColumns.length} className="px-6 py-4">
                    <TableSkeleton rows={5} />
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-6 py-4">
                    <ListEmpty title="暂无凭证模板" description="系统会在首次启动时自动创建内置模板" />
                  </td>
                </tr>
              ) : (
                list.map((tpl) => (
                  <tr key={tpl.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(tpl)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 编辑弹窗 */}
      <Modal
        open={!!editTarget}
        title={editTarget ? `编辑凭证模板：${editTarget.code}` : ''}
        onCancel={() => setEditTarget(null)}
        onOk={save}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={880}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">模板名称 *</label>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">备注</label>
              <input
                value={form.remark}
                onChange={(e) => setForm((p) => ({ ...p, remark: e.target.value }))}
                className={inputCls}
                placeholder="如：2026-09 起改用 XX 明细科目"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
              className="w-4 h-4 accent-blue-600"
            />
            启用该模板（停用后自动过账将跳过并记录告警日志）
          </label>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-gray-600">分录明细 *（借=debit / 贷=credit）</label>
              <button type="button" onClick={addRow} className="btn-secondary text-sm flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                添加行
              </button>
            </div>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-xs text-gray-500">#</th>
                    <th className="px-3 py-2 text-xs text-gray-500">科目编码</th>
                    <th className="px-3 py-2 text-xs text-gray-500">科目名称（可选）</th>
                    <th className="px-3 py-2 text-xs text-gray-500">方向</th>
                    <th className="px-3 py-2 text-xs text-gray-500">金额表达式</th>
                    <th className="px-3 py-2 text-xs text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {form.entries.map((e, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-sm text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <Select
                          showSearch
                          value={e.account_code || undefined}
                          placeholder="请选择科目"
                          className="w-56"
                          optionFilterProp="label"
                          options={optionsForCode(e.account_code)}
                          onChange={(v: string) => updateRow(i, { account_code: v, account_name: accountNameByCode[v] || e.account_name })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={e.account_name}
                          onChange={(ev) => updateRow(i, { account_name: ev.target.value })}
                          className={`${inputCls} w-36`}
                          placeholder="如：原材料"
                         autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={e.direction}
                          onChange={(ev) => updateRow(i, { direction: ev.target.value as 'debit' | 'credit' })}
                          className={`${inputCls} w-24`}
                        >
                          <option value="debit">借 debit</option>
                          <option value="credit">贷 credit</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={e.amount_expr}
                          onChange={(ev) => updateRow(i, { amount_expr: ev.target.value })}
                          className={`${inputCls} w-72 font-mono`}
                          placeholder="{{line.amount - line.tax_amount}}"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除该行"
                          aria-label="删除该行"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {form.entries.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-sm text-gray-400">
                        还没有分录，点「添加行」开始
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              提示：金额按实际单据行分别求值后按科目合计生成凭证。保存时会校验科目存在于科目表、借贷表达式折算平衡；过账时仍会做最终平衡断言（不平衡会让该笔业务失败并回滚，而不是"告警放过"）。
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
