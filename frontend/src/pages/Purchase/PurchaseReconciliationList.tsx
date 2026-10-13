import { useCallback, useEffect, useState } from 'react';
import { Plus, Send, CheckCircle2, AlertTriangle, RotateCcw, Eye, Printer, Trash2 } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import {
  purchaseReconApi, PurchaseReconciliation, ReconLine, TripleMatchRow, supplierApi,
  RECON_STATUS_TEXT, RECON_STATUS_COLOR, RECON_KIND_TEXT, RECON_KIND_COLOR,
} from '@/api/order';
import { format } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

/**
 * 采购对账（2026-09-19 第六批②）
 *
 * 双页签：
 *  - 对账单：生成（供应商+期间，口径与供应商对账单报表一致）→ 发送 → 供应商确认 / 差异登记 → 锁定；
 *    明细行可录入供应商来单金额（行差异 = 供应商 − 我方）；台账支持重打印（浏览器打印）。
 *  - 三单匹配：采购订单 - 入库 - 进项发票 金额核对与异常标记。
 */
const lineDiff = (l: ReconLine): number | null => {
  if (l.supplier_amount == null || l.supplier_amount === '') return null;
  return parseFloat(l.supplier_amount) - parseFloat(l.amount || '0');
};

export function PurchaseReconciliationList() {
  // [权限] 查看=purchase_reconciliation；生成=*_create；发送/确认/差异=*_edit；删除=*_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ tab: 'recon', keyword: '', status: '', supplier_id: '', page: 1, page_size: 10 });
  const [tab, setTab] = useState<'recon' | 'match'>(urlFilters.tab === 'match' ? 'match' : 'recon');
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [supplierID, setSupplierID] = useState(String(urlFilters.supplier_id || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [list, setList] = useState<PurchaseReconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; code?: string }[]>([]);

  useEffect(() => {
    syncUrl({ tab, keyword, status, supplier_id: supplierID, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, keyword, status, supplierID, pagination.page, pagination.page_size]);

  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  // 供应商下拉（独立请求失败留痕，不阻断其他）
  useEffect(() => {
    if (suppliers.length > 0) return;
    supplierApi.list({ page: 1, page_size: 200 }).then((res) => {
      if (res.code === 0) setSuppliers(res.data?.list ?? []);
    }).catch((err) => console.warn('供应商列表加载失败', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers.length]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await purchaseReconApi.list({
        page: pagination.page, page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined, status: status || undefined, supplier_id: supplierID || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list ?? []);
        setPagination((prev) => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '加载失败');
    } finally { if (isCurrent(seq)) setLoading(false); }
  }, [pagination.page, pagination.page_size, debouncedKeyword, status, supplierID, nextSeq, isCurrent]);

  useEffect(() => { if (tab === 'recon') fetchList(); }, [tab, fetchList]);

  // ── 生成对账单 ────────────────────────────────────────────────────────────
  const [genOpen, setGenOpen] = useState(false);
  const [genForm, setGenForm] = useState({ supplier_id: '', period_start: '', period_end: '', remark: '' });
  const [genSaving, setGenSaving] = useState(false);
  const submitGenerate = async () => {
    if (!genForm.supplier_id) { message.warning('请选择供应商'); return; }
    if (!genForm.period_start || !genForm.period_end) { message.warning('请选择对账期间'); return; }
    setGenSaving(true);
    try {
      const res = await purchaseReconApi.generate({
        supplier_id: genForm.supplier_id, period_start: genForm.period_start, period_end: genForm.period_end, remark: genForm.remark,
      });
      if (res.code === 0 && res.data) {
        message.success('对账单已生成（草稿）');
        setGenOpen(false);
        fetchList();
        openDetail(res.data.id);
      } else message.error(res.message || '生成失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '生成失败'); } finally { setGenSaving(false); }
  };

  // ── 详情（含差异录入与动作）────────────────────────────────────────────────
  const [detail, setDetail] = useState<PurchaseReconciliation | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [supplierEndBalance, setSupplierEndBalance] = useState('');
  const [lineSupplierAmounts, setLineSupplierAmounts] = useState<Record<string, string>>({});
  const [savingAmt, setSavingAmt] = useState(false);
  const openDetail = async (id: string) => {
    try {
      const res = await purchaseReconApi.get(id);
      if (res.code === 0 && res.data) {
        const d = res.data;
        setDetail(d);
        setSupplierEndBalance(d.supplier_end_balance != null ? String(parseFloat(d.supplier_end_balance)) : '');
        const amts: Record<string, string> = {};
        (d.edges?.lines ?? []).forEach((l) => { amts[l.id] = l.supplier_amount != null ? String(parseFloat(l.supplier_amount)) : ''; });
        setLineSupplierAmounts(amts);
        setDetailOpen(true);
      } else message.error(res.message || '加载详情失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '加载详情失败'); }
  };
  const reloadDetail = async (id: string) => {
    const res = await purchaseReconApi.get(id);
    if (res.code === 0 && res.data) { setDetail(res.data); fetchList(); }
  };
  const saveSupplierAmounts = async () => {
    if (!detail) return;
    setSavingAmt(true);
    try {
      const res = await purchaseReconApi.updateSupplierAmounts(detail.id, {
        lines: Object.entries(lineSupplierAmounts).map(([line_id, v]) => ({
          line_id, supplier_amount: v.trim() === '' ? null : parseFloat(v),
        })),
        supplier_end_balance: supplierEndBalance.trim() === '' ? null : parseFloat(supplierEndBalance),
      });
      if (res.code === 0) { message.success('已保存供应商金额'); reloadDetail(detail.id); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setSavingAmt(false); }
  };
  const doAction = async (fn: () => Promise<{ code: number; message?: string }>, okMsg: string) => {
    try {
      const res = await fn();
      if (res.code === 0) { message.success(okMsg); if (detail) reloadDetail(detail.id); }
      else message.error(res.message || '操作失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '操作失败'); }
  };
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const handleDelete = async (r: PurchaseReconciliation) => {
    if (!(await confirmAction({ title: `删除对账单 ${r.code}？`, content: '只有草稿状态可删除。', danger: true }))) return;
    try {
      const res = await purchaseReconApi.remove(r.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };

  // ── 三单匹配 ──────────────────────────────────────────────────────────────
  const [matchSupplier, setMatchSupplier] = useState('');
  const [matchStart, setMatchStart] = useState(format.today().slice(0, 7) + '-01');
  const [matchEnd, setMatchEnd] = useState(format.today());
  const [matchRows, setMatchRows] = useState<TripleMatchRow[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchLoaded, setMatchLoaded] = useState(false);
  const loadMatch = useCallback(async () => {
    setMatchLoading(true);
    try {
      const res = await purchaseReconApi.tripleMatch({ start_date: matchStart, end_date: matchEnd, supplier_id: matchSupplier || undefined });
      if (res.code === 0) { setMatchRows(res.data ?? []); setMatchLoaded(true); }
      else message.error(res.message || '查询失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '查询失败'); } finally { setMatchLoading(false); }
  }, [matchStart, matchEnd, matchSupplier]);

  // ── 列 ────────────────────────────────────────────────────────────────────
  interface RowCol { key: string; header: ReactNode; headCls?: string; cellCls?: string; cell: (row: PurchaseReconciliation) => ReactNode; }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const statusBadge = (s: string) => (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${RECON_STATUS_COLOR[s] || 'bg-gray-100'}`}>{RECON_STATUS_TEXT[s] || s}</span>
  );
  const cols = [
    { key: 'code', header: '单号', cell: (r: PurchaseReconciliation) => <span className="font-medium text-gray-900">{r.code}</span> },
    { key: 'supplier', header: '供应商', cell: (r: PurchaseReconciliation) => <span className="text-gray-900">{r.supplier_name}</span> },
    { key: 'period', header: '对账期间', cell: (r: PurchaseReconciliation) => <span className="text-gray-500 text-sm">{format.date(r.period_start)} ~ {format.date(r.period_end)}</span> },
    { key: 'end_balance', header: '我方期末', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: PurchaseReconciliation) => <span className="text-gray-900">{format.currency(r.end_balance)}</span> },
    { key: 'supplier_end', header: '供应商期末', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: PurchaseReconciliation) => <span className="text-gray-700">{r.supplier_end_balance != null ? format.currency(r.supplier_end_balance) : '-'}</span> },
    {
      key: 'diff', header: '差异', headCls: TH_R, cellCls: `${TD} text-right`,
      cell: (r: PurchaseReconciliation) => {
        if (r.diff_amount == null) return <span className="text-gray-400">—</span>;
        const d = parseFloat(r.diff_amount);
        return <span className={Math.abs(d) < 0.005 ? 'text-green-600' : 'text-red-600'}>{format.currency(r.diff_amount)}</span>;
      },
    },
    { key: 'status', header: '状态', cell: (r: PurchaseReconciliation) => statusBadge(r.status) },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (r: PurchaseReconciliation) => (
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => openDetail(r.id) },
            ...(has('purchase_reconciliation_edit') && r.status === 'draft' ? [{ key: 'send', label: '发送', icon: <Send className="w-4 h-4" />, onClick: () => doAction(() => purchaseReconApi.send(r.id), '已发送') }] : []),
            ...(has('purchase_reconciliation_edit') && (r.status === 'sent' || r.status === 'disputed') ? [{ key: 'confirm', label: '确认', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => doAction(() => purchaseReconApi.confirm(r.id), '已确认并锁定') }] : []),
            ...(has('purchase_reconciliation_edit') && r.status === 'sent' ? [{ key: 'dispute', label: '标记差异', icon: <AlertTriangle className="w-4 h-4" />, onClick: () => { setDetail(r); setDisputeReason(''); setDisputeOpen(true); } }] : []),
            ...(has('purchase_reconciliation_edit') && r.status === 'disputed' ? [{ key: 'reopen', label: '重新对账', icon: <RotateCcw className="w-4 h-4" />, onClick: () => doAction(() => purchaseReconApi.reopen(r.id), '已回到草稿') }] : []),
            ...(has('purchase_reconciliation_delete') && r.status === 'draft' ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(r) }] : []),
          ]}
        />
      ),
    },
  ] as RowCol[];
  const { visibleColumns, menu: viewMenu } = useTableView({ pageKey: 'purchase-reconciliation', columns: cols, locked: { trailing: ['__actions'] } });

  const filterNote = [
    status && `状态「${RECON_STATUS_TEXT[status] || status}」`,
    supplierID && `供应商「${suppliers.find((s) => s.id === supplierID)?.name || ''}」`,
  ].filter(Boolean).join(' + ') || undefined;

  const editable = detail ? detail.status !== 'confirmed' : false;

  return (
    <div className="space-y-6">
      <style>{`@media print { @page { margin: 0; } .recon-print { padding: 12mm 10mm; } .recon-print > * { break-inside: avoid; } }`}</style>
      <div className="recon-print space-y-6">
        <PageHeader
          title="采购对账"
          subtitle="对账单（生成 → 发送 → 供应商确认 / 差异登记 → 锁定）与三单匹配（订单 - 入库 - 发票核对）"
          extra={
            tab === 'recon' && has('purchase_reconciliation_create') && (
              <button onClick={() => { setGenForm({ supplier_id: '', period_start: '', period_end: '', remark: '' }); setGenOpen(true); }} className="btn-primary flex items-center gap-2 print:hidden">
                <Plus className="w-5 h-5" /><span className="hidden md:inline">生成对账单</span>
              </button>
            )
          }
        />

        <div className="card">
          <div className="border-b border-gray-100 flex print:hidden">
            <button onClick={() => setTab('recon')} className={`px-4 py-2 text-sm ${tab === 'recon' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>对账单</button>
            <button onClick={() => setTab('match')} className={`px-4 py-2 text-sm ${tab === 'match' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>三单匹配</button>
          </div>

          {tab === 'recon' ? (
            <>
              <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3 print:hidden">
                <input type="text" placeholder="搜索单号 / 供应商..." value={keyword} onChange={(e) => { setKeyword(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:max-w-xs" />
                <select value={supplierID} onChange={(e) => { setSupplierID(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-52">
                  <option value="">全部供应商</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-32">
                  <option value="">全部状态</option>
                  {Object.entries(RECON_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div className="ml-auto flex items-center">{viewMenu}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead><tr className="bg-gray-50">{visibleColumns.map((c) => <th key={c.key} className={c.headCls || TH_L}>{c.header}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
                    ) : list.length === 0 ? (
                      <tr><td colSpan={visibleColumns.length} className="px-6">
                        <ListEmpty
                          keyword={keyword}
                          filterNote={filterNote}
                          onClear={() => { setKeyword(''); setStatus(''); setSupplierID(''); setPagination((p) => ({ ...p, page: 1 })); }}
                          title="暂无对账单"
                          description="点击右上角「生成对账单」按供应商 + 期间汇总应付与付款"
                        />
                      </td></tr>
                    ) : list.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                        {visibleColumns.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(r)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-gray-100 print:hidden">
                <Pagination
                  page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
                  onPageChange={(page) => setPagination((p) => ({ ...p, page }))} loading={loading}
                  onPageSizeChange={(size) => setPagination((prev) => ({ ...prev, page: 1, page_size: size }))}
                />
              </div>
            </>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <select value={matchSupplier} onChange={(e) => setMatchSupplier(e.target.value)} className="form-input w-52">
                  <option value="">全部供应商</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input type="date" value={matchStart} onChange={(e) => setMatchStart(e.target.value)} className="form-input w-40" title="订单日期（起）" />
                <span className="text-gray-400">至</span>
                <input type="date" value={matchEnd} onChange={(e) => setMatchEnd(e.target.value)} className="form-input w-40" title="订单日期（止，含当天）" />
                <button onClick={loadMatch} className="btn-primary">查询</button>
                <span className="text-xs text-gray-500">按期间内已确认采购订单核对入库（已确认）与进项发票（未作废）金额</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className={TH_L}>订单号</th><th className={TH_L}>供应商</th><th className={TH_L}>订单日期</th>
                      <th className={TH_R}>订单金额</th><th className={TH_R}>入库金额</th><th className={TH_R}>开票金额</th>
                      <th className={TH_L}>异常标记</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {matchLoading ? (
                      <tr><td colSpan={7} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
                    ) : !matchLoaded ? (
                      <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-400">选择期间后点击「查询」开始核对</td></tr>
                    ) : matchRows.length === 0 ? (
                      <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-400">该期间没有已确认的采购订单</td></tr>
                    ) : matchRows.map((m) => (
                      <tr key={m.order_id} className="hover:bg-gray-50">
                        <td className={`${TD} font-medium text-gray-900`}>{m.order_no}</td>
                        <td className={`${TD} text-gray-700`}>{m.supplier_name || '-'}</td>
                        <td className={`${TD} text-gray-500 text-sm`}>{m.order_date}</td>
                        <td className={`${TD} text-right text-gray-900`}>{format.currency(m.order_amount)}</td>
                        <td className={`${TD} text-right text-gray-700`}>{format.currency(m.stock_in_amount)}</td>
                        <td className={`${TD} text-right text-gray-700`}>{format.currency(m.invoice_amount)}</td>
                        <td className={`${TD}`}>
                          {m.flags.length === 0
                            ? <span className="px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">已核对</span>
                            : m.flags.map((f) => <span key={f} className="px-2 py-0.5 mr-1 rounded text-xs bg-amber-50 text-amber-700">{f}</span>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 生成对账单 */}
      <Modal title="生成对账单" open={genOpen} onCancel={() => setGenOpen(false)} onOk={submitGenerate} confirmLoading={genSaving} okText="生成" cancelText="取消" width={520}>
        <div className="space-y-3 py-2">
          <div><label className="block text-sm text-gray-600 mb-1">供应商 *</label>
            <select value={genForm.supplier_id} onChange={(e) => setGenForm({ ...genForm, supplier_id: e.target.value })} className="form-input w-full">
              <option value="">请选择供应商</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">期间开始 *</label>
              <Input type="date" value={genForm.period_start} onChange={(e) => setGenForm({ ...genForm, period_start: e.target.value })} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">期间结束 *（含当天）</label>
              <Input type="date" value={genForm.period_end} onChange={(e) => setGenForm({ ...genForm, period_end: e.target.value })} /></div>
          </div>
          <div><label className="block text-sm text-gray-600 mb-1">备注</label>
            <Input value={genForm.remark} onChange={(e) => setGenForm({ ...genForm, remark: e.target.value })} placeholder="请输入备注" /></div>
          <div className="text-xs text-gray-400">口径：应付发票（未作废）与已确认付款单；期初 = 期间前未付余额；同供应商同期间已有对账单时将被拒绝。</div>
        </div>
      </Modal>

      {/* 对账单详情（含差异录入 / 动作 / 打印） */}
      <Modal title={detail ? `对账单 ${detail.code}` : '对账单'} open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={920}>
        {detail && (
          <div className="space-y-3 py-2">
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <span>供应商 <b className="text-gray-900">{detail.supplier_name}</b></span>
              <span>期间 {format.date(detail.period_start)} ~ {format.date(detail.period_end)}</span>
              {statusBadge(detail.status)}
              <span className="ml-auto flex gap-2 print:hidden">
                {editable && has('purchase_reconciliation_edit') && (
                  <button onClick={saveSupplierAmounts} disabled={savingAmt} className="btn-secondary text-sm">{savingAmt ? '保存中…' : '保存供应商金额'}</button>
                )}
                {has('purchase_reconciliation_edit') && detail.status === 'draft' && (
                  <button onClick={() => doAction(() => purchaseReconApi.send(detail.id), '已发送')} className="btn-secondary text-sm">发送</button>
                )}
                {has('purchase_reconciliation_edit') && (detail.status === 'sent' || detail.status === 'disputed') && (
                  <button onClick={() => doAction(() => purchaseReconApi.confirm(detail.id), '已确认并锁定')} className="btn-primary text-sm">确认</button>
                )}
                {has('purchase_reconciliation_edit') && detail.status === 'sent' && (
                  <button onClick={() => { setDisputeReason(''); setDisputeOpen(true); }} className="btn-secondary text-sm">标记差异</button>
                )}
                {has('purchase_reconciliation_edit') && detail.status === 'disputed' && (
                  <button onClick={() => doAction(() => purchaseReconApi.reopen(detail.id), '已回到草稿')} className="btn-secondary text-sm">重新对账</button>
                )}
                <button onClick={() => window.print()} className="btn-secondary text-sm flex items-center gap-1"><Printer className="w-4 h-4" />打印</button>
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[['期初未付', detail.begin_balance], ['期间应付', detail.period_in], ['期间付款', detail.period_out], ['我方期末', detail.end_balance],
                ['差异', detail.diff_amount]].map(([k, v]) => (
                <div key={String(k)} className="border border-gray-100 rounded-lg p-3">
                  <div className="text-xs text-gray-500">{k}</div>
                  <div className="text-base font-semibold text-gray-900 mt-1">{v != null ? format.currency(String(v)) : '—'}</div>
                </div>
              ))}
            </div>
            {detail.status !== 'confirmed' && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600 shrink-0">供应商来单期末金额：</span>
                <Input type="number" value={supplierEndBalance} onChange={(e) => setSupplierEndBalance(e.target.value)} placeholder="如：1150.00" style={{ width: 180 }} />
                <span className="text-xs text-gray-400">确认前必须录入；差异 = 我方期末 − 供应商期末</span>
              </div>
            )}
            {detail.dispute_reason && <div className="text-sm text-amber-700">差异说明：{detail.dispute_reason}</div>}
            <div className="overflow-x-auto border border-gray-100 rounded-lg max-h-80">
              <table className="w-full min-w-max">
                <thead className="sticky top-0">
                  <tr className="bg-gray-50">
                    {['日期', '类型', '来源单号', '金额', '供应商金额', '行差异'].map((h) => <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(detail.edges?.lines ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-400">期间内无应付/付款记录</td></tr>
                  ) : (detail.edges?.lines ?? []).map((l) => {
                    const diff = lineDiff(l);
                    return (
                      <tr key={l.id}>
                        <td className="px-3 py-2 text-sm text-gray-600">{format.date(l.line_date)}</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${RECON_KIND_COLOR[l.kind] || 'bg-gray-100'}`}>{RECON_KIND_TEXT[l.kind] || l.kind}</span></td>
                        <td className="px-3 py-2 text-sm text-gray-700">{l.source_no || '-'}</td>
                        <td className="px-3 py-2 text-right text-gray-900">{format.currency(l.amount)}</td>
                        <td className="px-3 py-2 text-right">
                          {editable ? (
                            <Input type="number" value={lineSupplierAmounts[l.id] ?? ''} onChange={(e) => setLineSupplierAmounts((prev) => ({ ...prev, [l.id]: e.target.value }))} placeholder="—" style={{ width: 120 }} />
                          ) : <span className="text-gray-700">{l.supplier_amount != null ? format.currency(l.supplier_amount) : '—'}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {diff == null ? <span className="text-gray-400">—</span> : <span className={Math.abs(diff) < 0.005 ? 'text-green-600' : 'text-red-600'}>{format.currency(diff)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-400">本对账单依据业务单据自动生成（口径与供应商对账单报表一致）；已确认后锁定只读。</div>
          </div>
        )}
      </Modal>

      {/* 标记差异 */}
      <Modal title="标记差异" open={disputeOpen} onCancel={() => setDisputeOpen(false)} onOk={() => { if (!disputeReason.trim()) { message.warning('请填写差异说明'); return; } if (detail) doAction(() => purchaseReconApi.dispute(detail.id, { supplier_end_balance: supplierEndBalance.trim() === '' ? null : parseFloat(supplierEndBalance), reason: disputeReason }), '已标记差异'); setDisputeOpen(false); }} okText="标记差异" cancelText="取消" width={480}>
        <div className="space-y-3 py-2">
          <div><label className="block text-sm text-gray-600 mb-1">差异说明 *</label>
            <Input value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="如：供应商少记一笔运费" /></div>
        </div>
      </Modal>
    </div>
  );
}
