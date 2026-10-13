import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw, Hammer } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import {
  workReportApi, WorkReportProcess, WorkReportStats,
  WORK_REPORT_STATUS_TEXT, WORK_REPORT_STATUS_COLOR,
} from '@/api/production';
import { BarcodeInput } from '@/components/BarcodeInput';
import { format } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';
import { useRowSelection } from '@/hooks/useRowSelection';
import { loadOptions } from '@/utils/loadOptions';
import type { ReactNode } from 'react';

/**
 * 报工中心（2026-09-19 第六批①）
 *
 * 双页签：
 *  - 待报工：仅「生产中」工单的未完成工序（pending/in_progress）；支持扫码/搜索定位、
 *    单条报工与**批量报工**（逐条校验、失败不阻断其余并逐条给出中文原因）
 *  - 报工记录：全部工序报工明细（关键词/操作工/期间/状态筛选 + 统计卡片）；
 *    已报工记录可**撤销**（退回进行中 + 清零数量/工时 + 重算工单人工成本）
 *
 * 报工提交复用后端 CompleteProcess（工单表单内报工同源）；撤销不联动删除计件登记（页面已提示）。
 */
interface FlatLine { process_id: string; work_order_no: string; process_name: string; qty_good: string; qty_bad: string; actual_time: string; operator_name: string; }

export function WorkReportList() {
  // [权限] 查看=production_report（或 work_order）；报工=production_report_create（或 work_order_edit）；撤销=production_report_revert
  const { has } = usePermission();
  const canReport = has('production_report_create') || has('work_order_edit');
  const canRevert = has('production_report_revert');

  const { initial: urlFilters, syncUrl } = useListFiltersUrl({
    tab: 'pending', keyword: '', status: '', operator: '', start_date: '', end_date: '', page: 1, page_size: 10,
  });
  const [tab, setTab] = useState<'pending' | 'records'>(urlFilters.tab === 'records' ? 'records' : 'pending');
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [operator, setOperator] = useState(String(urlFilters.operator || ''));
  const [startDate, setStartDate] = useState(String(urlFilters.start_date || ''));
  const [endDate, setEndDate] = useState(String(urlFilters.end_date || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [list, setList] = useState<WorkReportProcess[]>([]);
  const [stats, setStats] = useState<WorkReportStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    syncUrl({ tab, keyword, status, operator, start_date: startDate, end_date: endDate, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, keyword, status, operator, startDate, endDate, pagination.page, pagination.page_size]);

  const switchTab = (t: 'pending' | 'records') => { setTab(t); setStatus(''); setPagination((p) => ({ ...p, page: 1 })); };
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      if (tab === 'pending') {
        const res = await workReportApi.pending({
          page: pagination.page, page_size: pagination.page_size,
          keyword: debouncedKeyword || undefined, status: status || undefined,
        });
        if (res.code === 0) {
          if (!isCurrent(seq)) return;
          setList(res.data?.list ?? []);
          setPagination((prev) => ({ ...prev, total: res.data?.total ?? 0 }));
        }
      } else {
        const params = {
          page: pagination.page, page_size: pagination.page_size,
          keyword: debouncedKeyword || undefined, status: status || undefined, operator: operator || undefined,
          start_date: startDate || undefined, end_date: endDate || undefined,
        };
        const [res, st] = await loadOptions([workReportApi.list(params), workReportApi.stats(params)], '报工记录');
        if (res?.code === 0) {
          if (!isCurrent(seq)) return;
          setList(res.data?.list ?? []);
          setPagination((prev) => ({ ...prev, total: res.data?.total ?? 0 }));
        }
        if (st?.code === 0) setStats(st.data ?? null);
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '加载失败');
    } finally { if (isCurrent(seq)) setLoading(false); }
  }, [tab, pagination.page, pagination.page_size, debouncedKeyword, status, operator, startDate, endDate, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // 勾选（只对当前页有效，随列表变化自动裁剪）
  const sel = useRowSelection({ rows: list, getKey: (r) => r.id });

  // ── 单条报工 ──────────────────────────────────────────────────────────────
  const [single, setSingle] = useState<WorkReportProcess | null>(null);
  const [singleForm, setSingleForm] = useState({ qty_good: '', qty_bad: '0', actual_time: '0', operator_name: '', labor_rate: '' });
  const [saving, setSaving] = useState(false);
  const openSingle = (r: WorkReportProcess) => {
    setSingle(r);
    setSingleForm({
      qty_good: r.qty_planned && parseFloat(r.qty_planned) > 0 ? String(parseFloat(r.qty_planned)) : '',
      qty_bad: '0', actual_time: '0', operator_name: r.operator_name || '', labor_rate: '',
    });
  };
  const submitSingle = async () => {
    if (!single) return;
    const good = parseFloat(singleForm.qty_good) || 0;
    const bad = parseFloat(singleForm.qty_bad) || 0;
    if (good <= 0 && bad <= 0) { message.warning('请填写报工数量（良品或不良至少一项大于 0）'); return; }
    if ((parseFloat(singleForm.actual_time) || 0) < 0) { message.warning('实际工时不能为负数'); return; }
    setSaving(true);
    try {
      const res = await workReportApi.report(single.id, {
        operator_name: singleForm.operator_name,
        qty_good: good, qty_bad: bad,
        actual_time: parseFloat(singleForm.actual_time) || 0,
        labor_rate: parseFloat(singleForm.labor_rate) || 0,
      });
      if (res.code === 0) { message.success('已报工'); setSingle(null); fetchList(); }
      else message.error(res.message || '报工失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '报工失败'); } finally { setSaving(false); }
  };

  // ── 批量报工 ──────────────────────────────────────────────────────────────
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchLines, setBatchLines] = useState<FlatLine[]>([]);
  const [batchSaving, setBatchSaving] = useState(false);
  const [failures, setFailures] = useState<{ work_order_no?: string; process_name?: string; reason: string }[]>([]);
  const [failOpen, setFailOpen] = useState(false);
  const openBatch = () => {
    setBatchLines(sel.selectedRows.map((r) => ({
      process_id: r.id,
      work_order_no: r.edges?.work_order?.order_no || '-',
      process_name: r.process_name,
      qty_good: parseFloat(r.qty_planned) > 0 ? String(parseFloat(r.qty_planned)) : '',
      qty_bad: '0', actual_time: '0', operator_name: r.operator_name || '',
    })));
    setFailures([]);
    setBatchOpen(true);
  };
  const submitBatch = async () => {
    if (batchLines.length === 0) { message.warning('请选择要报工的工序'); return; }
    for (const l of batchLines) {
      const good = parseFloat(l.qty_good) || 0;
      const bad = parseFloat(l.qty_bad) || 0;
      if (good <= 0 && bad <= 0) { message.warning(`「${l.process_name}」报工数量不能为空`); return; }
    }
    setBatchSaving(true);
    try {
      const res = await workReportApi.bulkReport(batchLines.map((l) => ({
        process_id: l.process_id,
        operator_name: l.operator_name,
        qty_good: parseFloat(l.qty_good) || 0,
        qty_bad: parseFloat(l.qty_bad) || 0,
        actual_time: parseFloat(l.actual_time) || 0,
      })));
      if (res.code === 0) {
        const done = res.data?.completed ?? 0;
        const fails = res.data?.failed ?? [];
        if (fails.length > 0) {
          // 有失败：保留勾选便于重试；失败弹窗独立渲染（不随勾选清空被卸载）
          setFailures(fails);
          setFailOpen(true);
          message.warning(`已报工 ${done} 条，${fails.length} 条失败`);
        } else {
          setBatchOpen(false);
          sel.clear();
          message.success(`已报工 ${done} 条`);
        }
        fetchList();
      } else message.error(res.message || '批量报工失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '批量报工失败'); } finally { setBatchSaving(false); }
  };

  // ── 撤销 ──────────────────────────────────────────────────────────────────
  const handleRevert = async (r: WorkReportProcess) => {
    if (!(await confirmAction({
      title: `撤销「${r.process_name}」的报工？`,
      content: '撤销后工序回到「进行中」可重新报工；已从该工序导入的计件登记不会自动删除。',
      danger: true,
    }))) return;
    try {
      const res = await workReportApi.revert(r.id);
      if (res.code === 0) { message.success('已撤销'); fetchList(); }
      else message.error(res.message || '撤销失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '撤销失败'); }
  };

  // ── 列定义（两份，paramNs 隔离）────────────────────────────────────────────
  interface RowCol { key: string; header: ReactNode; headCls?: string; cellCls?: string; cell: (row: WorkReportProcess) => ReactNode; }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const statusBadge = (s: string) => (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${WORK_REPORT_STATUS_COLOR[s] || 'bg-gray-100'}`}>{WORK_REPORT_STATUS_TEXT[s] || s}</span>
  );
  const orderNo = (r: WorkReportProcess) => <span className="font-medium text-gray-900">{r.edges?.work_order?.order_no || '-'}</span>;

  const pendingCols = [
    { key: '__sel', header: <input type="checkbox" checked={sel.state === 'all'} ref={(el) => { if (el) el.indeterminate = sel.state === 'some'; }} onChange={() => sel.toggleAll()} />, cell: (r: WorkReportProcess) => <input type="checkbox" checked={sel.isSelected(r)} onChange={() => sel.toggle(r)} /> },
    { key: 'order_no', header: '工单号', cell: orderNo },
    { key: 'product', header: '产品', cell: (r: WorkReportProcess) => <span className="text-gray-700">{r.edges?.work_order?.product_name || '-'}</span> },
    { key: 'process', header: '工序', cell: (r: WorkReportProcess) => <span className="text-gray-900">{r.process_code ? `${r.process_code} · ` : ''}{r.process_name}</span> },
    { key: 'work_center', header: '工作中心', cell: (r: WorkReportProcess) => <span className="text-gray-500 text-sm">{r.work_center_name || '-'}</span> },
    { key: 'status', header: '状态', cell: (r: WorkReportProcess) => statusBadge(r.status) },
    { key: 'qty_planned', header: '计划数量', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: WorkReportProcess) => <span className="text-gray-700">{parseFloat(r.qty_planned || '0')}</span> },
    { key: 'operator', header: '操作工', cell: (r: WorkReportProcess) => <span className="text-gray-600 text-sm">{r.operator_name || '-'}</span> },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (r: WorkReportProcess) => canReport ? (
        <RowActions actions={[{ key: 'report', label: '报工', icon: <Hammer className="w-4 h-4" />, onClick: () => openSingle(r) }]} />
      ) : <span className="text-gray-300">-</span>,
    },
  ] as RowCol[];

  const recordCols = [
    { key: 'order_no', header: '工单号', cell: orderNo },
    { key: 'product', header: '产品', cell: (r: WorkReportProcess) => <span className="text-gray-700">{r.edges?.work_order?.product_name || '-'}</span> },
    { key: 'process', header: '工序', cell: (r: WorkReportProcess) => <span className="text-gray-900">{r.process_name}</span> },
    { key: 'operator', header: '操作工', cell: (r: WorkReportProcess) => <span className="text-gray-600 text-sm">{r.operator_name || '-'}</span> },
    { key: 'qty_good', header: '良品', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: WorkReportProcess) => <span className="text-gray-900">{parseFloat(r.qty_good || '0')}</span> },
    { key: 'qty_bad', header: '不良', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: WorkReportProcess) => <span className={parseFloat(r.qty_bad || '0') > 0 ? 'text-red-600' : 'text-gray-400'}>{parseFloat(r.qty_bad || '0')}</span> },
    { key: 'actual_time', header: '工时(时)', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: WorkReportProcess) => <span className="text-gray-600">{r.actual_time || 0}</span> },
    { key: 'completed_at', header: '完成时间', cell: (r: WorkReportProcess) => <span className="text-gray-500 text-sm">{r.completed_at ? format.date(r.completed_at, 'YYYY-MM-DD HH:mm') : '-'}</span> },
    { key: 'status', header: '状态', cell: (r: WorkReportProcess) => statusBadge(r.status) },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (r: WorkReportProcess) => (
        r.status === 'completed' && canRevert ? (
          <RowActions actions={[{ key: 'revert', label: '撤销', icon: <RotateCcw className="w-4 h-4" />, danger: true, onClick: () => handleRevert(r) }]} />
        ) : <span className="text-gray-300">-</span>
      ),
    },
  ] as RowCol[];

  // [0.47] 同页两张表：次表必须传 paramNs（否则 ?cols= 互相裁列）
  const pendView = useTableView({ pageKey: 'work-report-pending', columns: pendingCols, paramNs: 'pending', locked: { leading: ['__sel'], trailing: ['__actions'] } });
  const recView = useTableView({ pageKey: 'work-report-records', columns: recordCols, paramNs: 'records', locked: { trailing: ['__actions'] } });
  const activeView = tab === 'pending' ? pendView : recView;

  const filterNote = [
    status && `状态「${WORK_REPORT_STATUS_TEXT[status] || status}」`,
    operator && `操作工「${operator}」`,
    (startDate || endDate) && `期间「${startDate || '不限'} ~ ${endDate || '不限'}」`,
  ].filter(Boolean).join(' + ') || undefined;

  const statCard = (label: string, value: string | number) => (
    <div className="card p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
    </div>
  );

  // 批量工具条与失败弹窗（失败弹窗独立渲染在页面根——不能挂在 count>0 条件里，
  // 否则报工后清空勾选时弹窗同帧被卸载，用户看不到失败原因）
  const batch = {
    bar: sel.count > 0 && tab === 'pending' && canReport ? (
      <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-3 bg-blue-50/40">
        <span className="text-sm text-gray-600">已选 <b className="text-gray-900">{sel.count}</b> 条工序</span>
        <button onClick={openBatch} className="btn-primary text-sm flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" />批量报工
        </button>
        <button onClick={sel.clear} className="text-sm text-gray-500 hover:text-gray-700">取消选择</button>
      </div>
    ) : null,
    failureModal: (
      <Modal title={`部分报工失败（${failures.length} 条）`} open={failOpen} onCancel={() => setFailOpen(false)} footer={<button onClick={() => setFailOpen(false)} className="btn-primary">知道了</button>} width={560}>
        <div className="max-h-64 overflow-y-auto text-sm space-y-1 py-1">
          {failures.map((f, i) => (
            <div key={i} className="text-amber-700">· {f.work_order_no ? `${f.work_order_no} ` : ''}{f.process_name || ''}：{f.reason}</div>
          ))}
        </div>
      </Modal>
    ),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="报工中心"
        subtitle="车间快速报工（扫码定位工单 · 单条 / 批量）与报工记录（筛选统计 · 撤销重报）；报工后自动重算工单人工成本"
      />

      <div className="card">
        <div className="border-b border-gray-100 flex">
          <button onClick={() => switchTab('pending')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'pending' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            <Hammer className="w-4 h-4" />待报工
          </button>
          <button onClick={() => switchTab('records')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'records' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            <RotateCcw className="w-4 h-4" />报工记录
          </button>
        </div>

        {batch.bar}

        {tab === 'records' && (
          <div className="p-4 pb-0 grid grid-cols-2 md:grid-cols-4 gap-3">
            {statCard('报工件数', stats?.total ?? '—')}
            {statCard('良品合计', stats ? parseFloat(stats.qty_good || '0') : '—')}
            {statCard('不良合计', stats ? parseFloat(stats.qty_bad || '0') : '—')}
            {statCard('工时合计（时）', stats ? parseFloat(stats.actual_time || '0') : '—')}
          </div>
        )}

        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          {tab === 'pending' ? (
            <>
              <BarcodeInput
                value={keyword}
                onChange={(v) => { setKeyword(v); setPagination((p) => ({ ...p, page: 1 })); }}
                onDetect={(code) => { setKeyword(code); setPagination((p) => ({ ...p, page: 1 })); }}
                placeholder="搜索工单号 / 产品 / 工序，或扫码"
                className="md:max-w-xs"
              />
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-32">
                <option value="">全部状态</option>
                <option value="pending">待开工</option>
                <option value="in_progress">进行中</option>
              </select>
            </>
          ) : (
            <>
              <input type="text" placeholder="搜索工单号 / 产品 / 工序 / 操作工..." value={keyword} onChange={(e) => { setKeyword(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:max-w-xs" />
              <input type="text" placeholder="操作工" value={operator} onChange={(e) => { setOperator(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-32" />
              <DateRangeFilter
                value={{ start_date: startDate, end_date: endDate }}
                onChange={(v) => { setStartDate(v.start_date); setEndDate(v.end_date); setPagination((p) => ({ ...p, page: 1 })); }}
              />
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-32">
                <option value="">全部状态</option>
                {Object.entries(WORK_REPORT_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </>
          )}
          <div className="ml-auto flex items-center">{activeView.menu}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {activeView.visibleColumns.map((c) => <th key={c.key} className={c.headCls || TH_L}>{c.header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={activeView.visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={activeView.visibleColumns.length} className="px-6">
                  <ListEmpty
                    keyword={keyword}
                    filterNote={filterNote}
                    onClear={() => { setKeyword(''); setStatus(''); setOperator(''); setStartDate(''); setEndDate(''); setPagination((p) => ({ ...p, page: 1 })); }}
                    title={tab === 'pending' ? '暂无待报工工序' : '暂无报工记录'}
                    description={tab === 'pending' ? '只有「生产中」工单的未完成工序才可报工；请先在工单页开工生产' : '报工后在此查询明细、统计与撤销'}
                  />
                </td></tr>
              ) : list.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  {activeView.visibleColumns.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination
            page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))} loading={loading}
            onPageSizeChange={(size) => setPagination((prev) => ({ ...prev, page: 1, page_size: size }))}
          />
        </div>
      </div>

      {/* 单条报工 */}
      <Modal
        title={single ? `报工 - ${single.process_name}` : '报工'}
        open={!!single} onCancel={() => setSingle(null)} onOk={submitSingle} confirmLoading={saving} okText="确认报工" cancelText="取消" width={560}
      >
        {single && (
          <div className="space-y-3 py-2">
            <div className="text-sm text-gray-500">
              工单 <b className="text-gray-800">{single.edges?.work_order?.order_no}</b> · {single.edges?.work_order?.product_name || ''} · 计划 {parseFloat(single.qty_planned || '0')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm text-gray-600 mb-1">良品数量 *</label>
                <Input type="number" value={singleForm.qty_good} onChange={(e) => setSingleForm({ ...singleForm, qty_good: e.target.value })} placeholder="如：100" /></div>
              <div><label className="block text-sm text-gray-600 mb-1">不良数量</label>
                <Input type="number" value={singleForm.qty_bad} onChange={(e) => setSingleForm({ ...singleForm, qty_bad: e.target.value })} placeholder="如：0" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="block text-sm text-gray-600 mb-1">实际工时（小时）</label>
                <Input type="number" value={singleForm.actual_time} onChange={(e) => setSingleForm({ ...singleForm, actual_time: e.target.value })} placeholder="如：1.5" /></div>
              <div><label className="block text-sm text-gray-600 mb-1">操作工</label>
                <Input value={singleForm.operator_name} onChange={(e) => setSingleForm({ ...singleForm, operator_name: e.target.value })} placeholder="如：张三" /></div>
              <div><label className="block text-sm text-gray-600 mb-1">工时费率（元/时）</label>
                <Input type="number" value={singleForm.labor_rate} onChange={(e) => setSingleForm({ ...singleForm, labor_rate: e.target.value })} placeholder="如：60" /></div>
            </div>
            <div className="text-xs text-gray-400">良品+不良不能超过计划数量；保存后自动重算工单人工成本（实际工时 × 费率）。</div>
          </div>
        )}
      </Modal>

      {/* 批量报工 */}
      <Modal title={`批量报工（${batchLines.length} 条）`} open={batchOpen} onCancel={() => setBatchOpen(false)} onOk={submitBatch} confirmLoading={batchSaving} okText="提交报工" cancelText="取消" width={860}>
        <div className="space-y-3 py-2">
          <div className="overflow-x-auto border border-gray-100 rounded-lg max-h-96">
            <table className="w-full min-w-max">
              <thead className="sticky top-0">
                <tr className="bg-gray-50">
                  {['工单号', '工序', '良品数量', '不良数量', '工时(时)', '操作工'].map((h) => <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batchLines.map((l, idx) => (
                  <tr key={l.process_id}>
                    <td className="px-3 py-2 text-sm text-gray-700">{l.work_order_no}</td>
                    <td className="px-3 py-2 text-sm text-gray-900">{l.process_name}</td>
                    <td className="px-3 py-2"><Input type="number" value={l.qty_good} onChange={(e) => setBatchLines((prev) => prev.map((x, i) => i === idx ? { ...x, qty_good: e.target.value } : x))} style={{ width: 100 }} /></td>
                    <td className="px-3 py-2"><Input type="number" value={l.qty_bad} onChange={(e) => setBatchLines((prev) => prev.map((x, i) => i === idx ? { ...x, qty_bad: e.target.value } : x))} style={{ width: 100 }} /></td>
                    <td className="px-3 py-2"><Input type="number" value={l.actual_time} onChange={(e) => setBatchLines((prev) => prev.map((x, i) => i === idx ? { ...x, actual_time: e.target.value } : x))} style={{ width: 90 }} /></td>
                    <td className="px-3 py-2"><Input value={l.operator_name} onChange={(e) => setBatchLines((prev) => prev.map((x, i) => i === idx ? { ...x, operator_name: e.target.value } : x))} placeholder="如：张三" style={{ width: 120 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-400">逐条校验：任一工序失败不影响其余（失败原因提交后单独列出）；全部成功才会清空勾选。</div>
        </div>
      </Modal>

      {/* 失败原因（独立渲染：不随勾选清空被卸载） */}
      {batch.failureModal}
    </div>
  );
}
