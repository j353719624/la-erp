import { useState, useEffect } from 'react';
import { Plus, Trash2, Calculator, RefreshCw, FileCheck2, CheckCircle2 } from 'lucide-react';
import { Modal, InputNumber } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { commissionApi, CommissionConfig, CommissionResult, CommissionSettlement } from '@/api/order';
import { userApi } from '@/api/system';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

export function SalesCommission() {
  // [2026-09-18 权限细化·第3批] 销售佣金独立码：生成结算（新增）/配置与标记付款（编辑）/删除
  const { has } = usePermission();
  const [configs, setConfigs] = useState<CommissionConfig[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [results, setResults] = useState<CommissionResult[]>([]);
  const [base, setBase] = useState('revenue');
  const [dateRange, setDateRange] = useState({ start_date: '', end_date: '' });
  const [loadingCfg, setLoadingCfg] = useState(true);
  const [loadingCalc, setLoadingCalc] = useState(false);

  // 结算单（P2 佣金结算）
  const [settlements, setSettlements] = useState<CommissionSettlement[]>([]);
  const [stPeriod, setStPeriod] = useState(format.today().slice(0, 7));
  const [stStatus, setStStatus] = useState('');
  const [loadingSt, setLoadingSt] = useState(false);
  const [generating, setGenerating] = useState(false);

  // 新增配置弹窗
  const [cfgModal, setCfgModal] = useState(false);
  const [cfgData, setCfgData] = useState({ salesperson_id: '', rate: '', remark: '' });

  useEffect(() => {
    fetchConfigs();
    userApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
      if (res.code === 0) setUsers(res.data?.list || []);
    }).catch((err: any) => console.warn('业务员列表加载失败（可能缺 sales_order_list 权限）:', err?.message || err));
    fetchCalculate();
    fetchSettlements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSettlements = async () => {
    setLoadingSt(true);
    try {
      const res = await commissionApi.listSettlements({ period: stPeriod || undefined, status: stStatus || undefined, page: 1, page_size: 50 });
      if (res.code === 0) setSettlements(res.data?.list || []);
      else message.error(res.message || '加载结算单失败');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '加载结算单失败');
    } finally {
      setLoadingSt(false);
    }
  };

  const handleGenerate = async () => {
    if (!stPeriod) {
      message.warning('请选择结算期间');
      return;
    }
    setGenerating(true);
    try {
      const res = await commissionApi.generateSettlements({ period: stPeriod, base });
      if (res.code === 0) {
        message.success(`已生成 ${res.data?.created || 0} 张结算单`);
        fetchSettlements();
      } else {
        message.error(res.message || '生成失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleMarkPaid = async (st: CommissionSettlement) => {
    if (!(await confirmAction({
      title: '标记付款',
      content: `确定将结算单 ${st.settlement_no} 标记为已付款吗？请确认款项已实际支付给业务员。`,
      okText: '确认付款',
    }))) return;
    const res = await commissionApi.markSettlementPaid(st.id);
    if (res.code === 0) {
      message.success('已标记付款');
      fetchSettlements();
    } else {
      message.error(res.message || '操作失败');
    }
  };

  const handleDeleteSettlement = async (st: CommissionSettlement) => {
    if (!(await confirmAction({
      title: '删除结算单',
      content: `确定删除结算单 ${st.settlement_no} 吗？`,
      okText: '删除',
      danger: true,
    }))) return;
    const res = await commissionApi.deleteSettlement(st.id);
    if (res.code === 0) {
      message.success('已删除');
      fetchSettlements();
    } else {
      message.error(res.message || '删除失败');
    }
  };

  const fetchConfigs = async () => {
    setLoadingCfg(true);
    try {
      const res = await commissionApi.listConfigs();
      if (res.code === 0) setConfigs(res.data || []);
      else message.error(res.message || '加载失败');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '加载配置失败');
    } finally {
      setLoadingCfg(false);
    }
  };

  const fetchCalculate = async () => {
    setLoadingCalc(true);
    try {
      const res = await commissionApi.calculate({
        base,
        start_date: dateRange.start_date || undefined,
        end_date: dateRange.end_date || undefined,
      });
      if (res.code === 0) setResults(res.data || []);
      else message.error(res.message || '计算失败');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '计算失败');
    } finally {
      setLoadingCalc(false);
    }
  };

  const handleUpsert = async () => {
    const rate = parseFloat(cfgData.rate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      message.warning('佣金率须在 0~100 之间');
      return;
    }
    const payload: any = {
      rate,
      status: 'active',
      remark: cfgData.remark || '',
    };
    if (cfgData.salesperson_id) {
      const u = users.find((x: any) => x.id === cfgData.salesperson_id);
      payload.salesperson_id = cfgData.salesperson_id;
      payload.salesperson_name = u ? u.name || u.username : '';
    }
    try {
      const res = await commissionApi.upsertConfig(payload);
      if (res.code === 0) {
        message.success('佣金配置已保存');
        setCfgModal(false);
        setCfgData({ salesperson_id: '', rate: '', remark: '' });
        fetchConfigs();
        fetchCalculate();
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '保存失败');
    }
  };

  const handleDelete = async (cfg: CommissionConfig) => {
    if (!(await confirmAction({
      title: '删除佣金配置',
      content: `确定删除${cfg.salesperson_name ? `「${cfg.salesperson_name}」` : '全局默认'}佣金配置吗？`,
      okText: '删除',
      danger: true,
    }))) return;
    const res = await commissionApi.deleteConfig(cfg.id);
    if (res.code === 0) {
      message.success('已删除');
      fetchConfigs();
      fetchCalculate();
    } else {
      message.error(res.message || '删除失败');
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
  // data-table 自带样式（全局已居中），故默认不额外加 class
  const TH = '';
  const TD = '';
  const cfgCols: RowCol[] = [
    { key: 'salesperson_name', header: '业务员', cell: (cfg) => <span>{cfg.salesperson_name || '（全局默认）'}</span> },
    { key: 'rate', header: '佣金率 %', cellCls: 'font-semibold', cell: (cfg) => <span>{format.qty(cfg.rate, 2)}%</span> },
    {
      key: 'status',
      header: '状态',
      cell: (cfg) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs ${cfg.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
          {cfg.status === 'active' ? '启用' : '停用'}
        </span>
      ),
    },
    { key: 'remark', header: '备注', cell: (cfg) => <span>{cfg.remark || '-'}</span> },
    {
      key: '__actions',
      header: '操作',
      cell: (cfg) => (
        has('sales_commission_delete') && (
          <button onClick={() => handleDelete(cfg)} className="icon-btn delete sm" title="删除">
            <Trash2 className="w-4 h-4" />
          </button>
        )
      ),
    },
  ];
  const resultCols: RowCol[] = [
    { key: 'salesperson_name', header: '业务员', cell: (r) => <span>{r.salesperson_name}</span> },
    { key: 'order_count', header: '订单数', cell: (r) => <span>{r.order_count}</span> },
    { key: 'sales_amount', header: '销售额', cell: (r) => <span>{format.currency(parseFloat(r.sales_amount || '0'))}</span> },
    // 毛利列仅“按毛利计佣”口径才有意义 → 不满足时整列不出现（避免空表头）
    ...(base === 'profit'
      ? [{ key: 'profit_amount', header: '毛利', cell: (r: any) => <span>{format.currency(parseFloat(r.profit_amount || '0'))}</span> }]
      : []),
    { key: 'rate', header: '佣金率 %', cell: (r) => <span>{format.qty(r.rate, 2)}%</span> },
    { key: 'commission', header: '应发佣金', cellCls: 'font-semibold text-blue-600', cell: (r) => <span>{format.currency(parseFloat(r.commission || '0'))}</span> },
  ];
  const settlementCols: RowCol[] = [
    { key: 'settlement_no', header: '结算单号', cellCls: 'font-medium', cell: (st) => <span>{st.settlement_no}</span> },
    { key: 'period', header: '期间', cell: (st) => <span>{st.period}</span> },
    { key: 'salesperson_name', header: '业务员', cell: (st) => <span>{st.salesperson_name || '未分配业务员'}</span> },
    { key: 'base', header: '计佣口径', cell: (st) => <span>{st.base === 'profit' ? '按毛利' : '按销售额'}</span> },
    { key: 'amount', header: '结算金额', cellCls: 'font-semibold text-blue-600', cell: (st) => <span>{format.currency(parseFloat(st.amount || '0'))}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (st) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs ${st.status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
          {st.status === 'paid' ? `已付（${st.paid_at ? format.date(st.paid_at) : ''}）` : '未付'}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      cell: (st) => (
        <div className="flex items-center justify-center gap-1">
          {st.status === 'unpaid' && has('sales_commission_edit') && (
            <button onClick={() => handleMarkPaid(st)} className="icon-btn" title="标记付款">
              <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
          {st.status === 'unpaid' && has('sales_commission_delete') && (
            <button onClick={() => handleDeleteSettlement(st)} className="icon-btn delete sm" title="删除">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];
  // [2026-09-13] 同页 3 张表：主表用 ?cols=，其余用 ?cols.results= / ?cols.settlements=（否则互相裁列）
  const { visibleColumns: cfgVisible, menu: cfgMenu } = useTableView({
    pageKey: 'sales-commission-configs',
    columns: cfgCols,
    locked: { trailing: ['__actions'] },
  });
  const { visibleColumns: resultVisible, menu: resultMenu } = useTableView({
    pageKey: 'sales-commission-results',
    paramNs: 'results',
    columns: resultCols,
  });
  const { visibleColumns: settlementVisible, menu: settlementMenu } = useTableView({
    pageKey: 'sales-commission-settlements',
    paramNs: 'settlements',
    columns: settlementCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="销售佣金"
        subtitle="按业务员配置佣金率，基于已审核销售订单自动计算"
        extra={
          has('sales_commission_edit') && (
            <button onClick={() => setCfgModal(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              新增佣金配置
            </button>
          )
        }
      />

      {/* 佣金配置 */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">佣金率配置</h3>
          {cfgMenu}
        </div>
        {loadingCfg ? (
          <TableSkeleton rows={2} />
        ) : configs.length === 0 ? (
          <EmptyState description="暂无佣金配置（未配置时按全局 0% 计佣）" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {cfgVisible.map((c) => <th key={c.key} className={c.headCls || TH}>{c.header}</th>)}
                </tr>
              </thead>
              <tbody>
                {configs.map((cfg) => (
                  <tr key={cfg.id}>
                    {cfgVisible.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(cfg)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 佣金计算 */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-blue-500" />
            佣金计算结果（已审核销售订单）
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select value={base} onChange={(e) => setBase(e.target.value)} className="form-input w-40">
              <option value="revenue">按销售额计佣</option>
              <option value="profit">按毛利计佣</option>
            </select>
            <input type="date" value={dateRange.start_date} onChange={(e) => setDateRange((p) => ({ ...p, start_date: e.target.value }))} className="form-input w-36" />
            <span className="text-gray-400">至</span>
            <input type="date" value={dateRange.end_date} onChange={(e) => setDateRange((p) => ({ ...p, end_date: e.target.value }))} className="form-input w-36" />
            <button onClick={fetchCalculate} disabled={loadingCalc} className="btn-primary text-sm flex items-center gap-1">
              <RefreshCw className="w-4 h-4" />
              {loadingCalc ? '计算中...' : '计算'}
            </button>
            {resultMenu}
          </div>
        </div>

        {loadingCalc ? (
          <TableSkeleton rows={3} />
        ) : results.length === 0 ? (
          <EmptyState description="暂无佣金计算结果（需有已审核销售订单且关联业务员）" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {resultVisible.map((c) => <th key={c.key} className={c.headCls || TH}>{c.header}</th>)}
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.salesperson_id}>
                    {resultVisible.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 佣金结算单（P2 结算与付款联动） */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-green-500" />
            佣金结算单（按期间生成，标记付款）
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <input type="month" value={stPeriod} onChange={(e) => setStPeriod(e.target.value)} className="form-input w-40" />
            <select value={stStatus} onChange={(e) => { setStStatus(e.target.value); }} className="form-input w-32">
              <option value="">全部状态</option>
              <option value="unpaid">未付</option>
              <option value="paid">已付</option>
            </select>
            <button onClick={() => { fetchSettlements(); }} className="btn-secondary text-sm flex items-center gap-1">
              <RefreshCw className="w-4 h-4" />
              查询
            </button>
            {has('sales_commission_create') && (
              <button onClick={handleGenerate} disabled={generating} className="btn-primary text-sm flex items-center gap-1">
                <FileCheck2 className="w-4 h-4" />
                {generating ? '生成中...' : '生成结算单'}
              </button>
            )}
            {settlementMenu}
          </div>
        </div>

        {loadingSt ? (
          <TableSkeleton rows={3} />
        ) : settlements.length === 0 ? (
          <EmptyState description="暂无佣金结算单，选择期间后点击「生成结算单」" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {settlementVisible.map((c) => <th key={c.key} className={c.headCls || TH}>{c.header}</th>)}
                </tr>
              </thead>
              <tbody>
                {settlements.map((st) => (
                  <tr key={st.id}>
                    {settlementVisible.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(st)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增配置弹窗 */}
      <Modal
        open={cfgModal}
        onCancel={() => setCfgModal(false)}
        title="新增/更新佣金配置"
        okText="保存"
        cancelText="取消"
        onOk={handleUpsert}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">业务员（留空 = 全局默认）</label>
            <SearchSelect
              value={cfgData.salesperson_id}
              onChange={(v) => setCfgData((p) => ({ ...p, salesperson_id: v ?? '' }))}
              placeholder="全局默认（适用于所有未单独配置的业务员）"
              allowClear
              options={users.map((u: any) => ({ value: u.id, label: u.name || u.username }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">佣金率（%） *</label>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              max={100}
              precision={2}
              value={cfgData.rate ? parseFloat(cfgData.rate) : undefined}
              onChange={(v) => setCfgData((p) => ({ ...p, rate: v != null ? String(v) : '' }))}
              placeholder="如：2 表示 2%"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">备注</label>
            <input type="text" value={cfgData.remark} onChange={(e) => setCfgData((p) => ({ ...p, remark: e.target.value }))} className="form-input w-full" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
