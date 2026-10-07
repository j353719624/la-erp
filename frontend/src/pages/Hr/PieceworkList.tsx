import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Calculator, Download } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import {
  pieceRateApi, pieceworkApi, PieceRate, PieceworkRecord, ImportableProcess,
  PIECE_RATE_STATUS_TEXT, PIECE_RATE_STATUS_COLOR, PIECEWORK_SOURCE_TEXT,
} from '@/api/hr';
import { employeeApi, type Employee } from '@/api/hr';
import { departmentApi } from '@/api/system';
import { SearchSelect } from '@/components/SearchSelect';
import { format, toLocalDateISO } from '@/utils/format';
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
 * 计件薪酬（2026-09-19 第五批①）
 *
 * 双页签：
 *  - 计件登记（JJ 单号）：手工登记（选员工档案自动回填姓名/部门）或从「工序报工」导入
 *    （按工序名称匹配启用中的单价表；未匹配单价的工序跳过并给出中文原因，防重复计薪）
 *  - 计件单价：名称 + 元/件 + 启用状态（被登记引用后不可删，引导停用）
 *
 * 月度汇总弹窗：按员工聚合数量/金额/笔数；工资批次新建时可「从计件汇总带入」累计到奖金栏。
 */
export function PieceworkList() {
  // [权限] 查看=piecework；新建/导入=piecework_create；编辑=piecework_edit；删除=piecework_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ tab: 'records', keyword: '', period: '', status: '', page: 1, page_size: 10 });
  const [tab, setTab] = useState<'records' | 'rates'>(urlFilters.tab === 'rates' ? 'rates' : 'records');
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [period, setPeriod] = useState(String(urlFilters.period || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [list, setList] = useState<PieceworkRecord[]>([]);
  const [rates, setRates] = useState<PieceRate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    syncUrl({ tab, keyword, period, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, keyword, period, status, pagination.page, pagination.page_size]);

  const switchTab = (t: 'records' | 'rates') => { setTab(t); setPagination((p) => ({ ...p, page: 1 })); setStatus(''); };

  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      if (tab === 'records') {
        const res = await pieceworkApi.list({
          page: pagination.page, page_size: pagination.page_size,
          keyword: debouncedKeyword || undefined, period: period || undefined,
        });
        if (res.code === 0) {
          if (!isCurrent(seq)) return;
          setList(res.data?.list ?? []);
          setPagination((prev) => ({ ...prev, total: res.data?.total ?? 0 }));
        }
      } else {
        const res = await pieceRateApi.list({
          page: pagination.page, page_size: pagination.page_size,
          keyword: debouncedKeyword || undefined, status: status || undefined,
        });
        if (res.code === 0) {
          if (!isCurrent(seq)) return;
          setRates(res.data?.list ?? []);
          setPagination((prev) => ({ ...prev, total: res.data?.total ?? 0 }));
        }
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '加载失败');
    } finally { if (isCurrent(seq)) setLoading(false); }
  }, [tab, pagination.page, pagination.page_size, debouncedKeyword, period, status, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── 员工/单价下拉（打开弹窗时加载，独立失败留痕）────────────────────────────
  const [emps, setEmps] = useState<Employee[]>([]);
  const [rateOptions, setRateOptions] = useState<PieceRate[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  // [弹窗开关] importOpen 在下方「从工序报工导入」使用，这里先声明（下方 useEffect 依赖它）
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    if (!open && !importOpen) return;
    if (emps.length === 0) {
      employeeApi.list({ page: 1, page_size: 200 }).then((res) => {
        if (res.code === 0) setEmps((res.data?.list ?? []).filter((e) => e.status !== 'left'));
      }).catch((err) => console.warn('员工列表加载失败', err));
    }
    if (rateOptions.length === 0) {
      pieceRateApi.list({ page: 1, page_size: 200, status: 'active' }).then((res) => {
        if (res.code === 0) setRateOptions(res.data?.list ?? []);
      }).catch((err) => console.warn('单价表加载失败', err));
    }
    if (depts.length === 0) {
      departmentApi.listAll().then((res) => {
        if (res.code === 0) setDepts(res.data ?? []);
      }).catch((err) => console.warn('部门列表加载失败', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, importOpen, emps.length, rateOptions.length, depts.length]);
  // ── 计件登记新建/编辑 ──────────────────────────────────────────────────────
  const [editId, setEditId] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employee_id: '', employee_name: '', department: '', item_name: '', rate_id: '', qty: '', unit_price: '', work_date: format.today(), remark: '' });

  const openCreate = () => {
    setEditId('');
    setForm({ employee_id: '', employee_name: '', department: '', item_name: '', rate_id: '', qty: '', unit_price: '', work_date: format.today(), remark: '' });
    setOpen(true);
  };
  const openEdit = (r: PieceworkRecord) => {
    setEditId(r.id);
    setForm({
      employee_id: r.employee_id || '', employee_name: r.employee_name || '', department: r.department || '',
      item_name: r.item_name, rate_id: r.rate_id || '',
      qty: r.qty != null ? String(parseFloat(r.qty)) : '',
      unit_price: r.unit_price != null ? String(parseFloat(r.unit_price)) : '',
      work_date: r.work_date ? format.date(r.work_date) : format.today(),
      remark: r.remark || '',
    });
    setOpen(true);
  };
  const handleSave = async () => {
    if (!form.item_name.trim()) { message.warning('请填写/选择计件项'); return; }
    if (!form.qty || parseFloat(form.qty) <= 0) { message.warning('数量必须大于 0'); return; }
    if (!form.work_date) { message.warning('请选择作业日期'); return; }
    if (!form.employee_id && !form.employee_name.trim()) { message.warning('请选择员工或填写姓名'); return; }
    setSaving(true);
    try {
      const payload = {
        employee_id: form.employee_id || undefined,
        employee_name: form.employee_name.trim(),
        department: form.department,
        item_name: form.item_name.trim(),
        rate_id: form.rate_id || undefined,
        qty: parseFloat(form.qty),
        unit_price: form.unit_price ? parseFloat(form.unit_price) : 0,
        work_date: toLocalDateISO(form.work_date),
        remark: form.remark,
      };
      const res = editId ? await pieceworkApi.update(editId, payload) : await pieceworkApi.create(payload);
      if (res.code === 0) { message.success(editId ? '已更新' : '已登记'); setOpen(false); fetchList(); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setSaving(false); }
  };

  const handleDelete = async (r: PieceworkRecord) => {
    if (!(await confirmAction({ title: `删除计件登记 ${r.code}（${r.employee_name} · ${r.item_name}）？`, danger: true }))) return;
    try {
      const res = await pieceworkApi.remove(r.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };

  // ── 单价表新建/编辑 ────────────────────────────────────────────────────────
  const [rateOpen, setRateOpen] = useState(false);
  const [rateEditId, setRateEditId] = useState('');
  const [rateSaving, setRateSaving] = useState(false);
  const [rateForm, setRateForm] = useState({ name: '', unit_price: '', status: 'active', remark: '' });

  const openRateCreate = () => { setRateEditId(''); setRateForm({ name: '', unit_price: '', status: 'active', remark: '' }); setRateOpen(true); };
  const openRateEdit = (r: PieceRate) => {
    setRateEditId(r.id);
    setRateForm({ name: r.name, unit_price: r.unit_price != null ? String(parseFloat(r.unit_price)) : '', status: r.status, remark: r.remark || '' });
    setRateOpen(true);
  };
  const handleRateSave = async () => {
    if (!rateForm.name.trim()) { message.warning('请填写计件项名称'); return; }
    if (!rateForm.unit_price || parseFloat(rateForm.unit_price) < 0) { message.warning('请填写单价（不能为负数）'); return; }
    setRateSaving(true);
    try {
      const payload = { name: rateForm.name.trim(), unit_price: parseFloat(rateForm.unit_price), status: rateForm.status, remark: rateForm.remark };
      const res = rateEditId ? await pieceRateApi.update(rateEditId, payload) : await pieceRateApi.create(payload);
      if (res.code === 0) { message.success(rateEditId ? '已更新' : '已创建'); setRateOpen(false); fetchList(); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setRateSaving(false); }
  };
  const handleRateDelete = async (r: PieceRate) => {
    if (!(await confirmAction({ title: `删除计件项「${r.name}」？`, content: '已被计件登记引用的不可删除（可改为停用）。', danger: true }))) return;
    try {
      const res = await pieceRateApi.remove(r.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };

  // ── 月度汇总弹窗 ───────────────────────────────────────────────────────────
  const [sumOpen, setSumOpen] = useState(false);
  const [sumPeriod, setSumPeriod] = useState(format.today().slice(0, 7));
  const [sumRows, setSumRows] = useState<{ employee_name: string; department?: string | null; total_qty: string; total_amount: string; count: number }[]>([]);
  const [sumLoading, setSumLoading] = useState(false);
  const loadSummary = useCallback(async (p: string) => {
    if (!p) return;
    setSumLoading(true);
    try {
      const res = await pieceworkApi.summary(p);
      if (res.code === 0) setSumRows(res.data ?? []);
      else message.error(res.message || '加载汇总失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '加载汇总失败'); } finally { setSumLoading(false); }
  }, []);
  useEffect(() => { if (sumOpen) loadSummary(sumPeriod); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sumOpen, sumPeriod, loadSummary]);

  // ── 工序报工导入弹窗 ───────────────────────────────────────────────────────
  const [importPeriod, setImportPeriod] = useState(format.today().slice(0, 7));
  const [importRows, setImportRows] = useState<ImportableProcess[]>([]);
  const [importSel, setImportSel] = useState<Set<string>>(new Set());
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const loadImportable = useCallback(async (p: string) => {
    if (!p) return;
    setImportLoading(true);
    try {
      const res = await pieceworkApi.importableProcesses(p);
      if (res.code === 0) {
        const rows = res.data ?? [];
        setImportRows(rows);
        // 默认勾选：未导入过 且 已匹配单价 且 良品>0
        setImportSel(new Set(rows.filter((r) => !r.already_imported && parseFloat(r.matched_price) > 0 && parseFloat(r.qty_good) > 0).map((r) => r.process_id)));
      } else message.error(res.message || '加载可导入工序失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '加载可导入工序失败'); } finally { setImportLoading(false); }
  }, []);
  useEffect(() => { if (importOpen) loadImportable(importPeriod); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [importOpen, importPeriod, loadImportable]);
  const handleImport = async () => {
    if (importSel.size === 0) { message.warning('请勾选要导入的工序报工'); return; }
    setImporting(true);
    try {
      const res = await pieceworkApi.importProcesses([...importSel]);
      if (res.code === 0) {
        const created = res.data?.created ?? 0;
        const skipped = res.data?.skipped ?? [];
        if (skipped.length > 0) {
          Modal.info({
            title: `已导入 ${created} 条，跳过 ${skipped.length} 条`,
            content: (
              <div className="max-h-64 overflow-y-auto text-sm space-y-1">
                {skipped.map((s, i) => <div key={i} className="text-amber-700">· {s}</div>)}
              </div>
            ),
          });
        } else {
          message.success(`已导入 ${created} 条计件登记`);
        }
        setImportOpen(false);
        fetchList();
      } else message.error(res.message || '导入失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '导入失败'); } finally { setImporting(false); }
  };

  // ── 表格列 ─────────────────────────────────────────────────────────────────
  interface RowCol { key: string; header: ReactNode; headCls?: string; cellCls?: string; cell: (row: never) => ReactNode; }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';

  const recordCols = [
    { key: 'code', header: '单号', cell: (r: PieceworkRecord) => <span className="font-medium text-gray-900">{r.code}</span> },
    { key: 'work_date', header: '日期', cell: (r: PieceworkRecord) => <span className="text-gray-500 text-sm">{format.date(r.work_date)}</span> },
    { key: 'employee_name', header: '员工', cell: (r: PieceworkRecord) => <span className="text-gray-900">{r.employee_name}</span> },
    { key: 'department', header: '部门', cell: (r: PieceworkRecord) => <span className="text-gray-500 text-sm">{r.department || '-'}</span> },
    { key: 'item_name', header: '计件项', cell: (r: PieceworkRecord) => <span className="text-gray-700">{r.item_name}</span> },
    { key: 'qty', header: '数量', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: PieceworkRecord) => <span className="text-gray-700">{parseFloat(r.qty || '0')}</span> },
    { key: 'unit_price', header: '单价（元）', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: PieceworkRecord) => <span className="text-gray-500">{parseFloat(r.unit_price || '0').toFixed(2)}</span> },
    { key: 'amount', header: '金额（元）', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: PieceworkRecord) => <span className="font-medium text-gray-900">{parseFloat(r.amount || '0').toFixed(2)}</span> },
    {
      key: 'source', header: '来源',
      cell: (r: PieceworkRecord) => <span className="text-xs text-gray-500">{PIECEWORK_SOURCE_TEXT[r.source || 'manual'] || r.source}</span>,
    },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (r: PieceworkRecord) => (
        <RowActions
          actions={[
            ...(has('piecework_edit') ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(r) }] : []),
            ...(has('piecework_delete') ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(r) }] : []),
          ]}
        />
      ),
    },
  ] as RowCol[];

  const rateCols = [
    { key: 'name', header: '计件项名称', cell: (r: PieceRate) => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: 'unit_price', header: '单价（元/件）', headCls: TH_R, cellCls: `${TD} text-right`, cell: (r: PieceRate) => <span className="text-gray-900">{parseFloat(r.unit_price || '0').toFixed(2)}</span> },
    {
      key: 'status', header: '状态',
      cell: (r: PieceRate) => <span className={`px-2 py-0.5 rounded text-xs font-medium ${PIECE_RATE_STATUS_COLOR[r.status] || 'bg-gray-100'}`}>{PIECE_RATE_STATUS_TEXT[r.status] || r.status}</span>,
    },
    { key: 'remark', header: '备注', cell: (r: PieceRate) => <span className="text-gray-500 text-sm">{r.remark || '-'}</span> },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (r: PieceRate) => (
        <RowActions
          actions={[
            ...(has('piecework_edit') ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openRateEdit(r) }] : []),
            ...(has('piecework_delete') ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleRateDelete(r) }] : []),
          ]}
        />
      ),
    },
  ] as RowCol[];

  // [0.47] 同页两张表：次表必须传 paramNs（否则 ?cols= 互相裁列）
  const recView = useTableView({ pageKey: 'piecework-records', columns: recordCols, paramNs: 'records', locked: { trailing: ['__actions'] } });
  const rateView = useTableView({ pageKey: 'piecework-rates', columns: rateCols, paramNs: 'rates', locked: { trailing: ['__actions'] } });
  const activeView = tab === 'records' ? recView : rateView;
  const rows = tab === 'records' ? list : rates;

  const filterNote = tab === 'records'
    ? [period && `期间「${period}」`].filter(Boolean).join('') || undefined
    : [status && `状态「${PIECE_RATE_STATUS_TEXT[status] || status}」`].filter(Boolean).join('') || undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="计件薪酬"
        subtitle="计件单价按件计价；登记支持手工录入或从工序报工导入（同名匹配启用单价，防重复计薪）；工资批次可带入月度汇总"
        extra={
          has('piecework_create') && (
            <div className="flex items-center gap-2">
              {tab === 'records' && (
                <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-2">
                  <Download className="w-5 h-5" /><span className="hidden md:inline">从工序报工导入</span>
                </button>
              )}
              <button onClick={tab === 'records' ? openCreate : openRateCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" /><span className="hidden md:inline">{tab === 'records' ? '新建登记' : '新建单价'}</span>
              </button>
            </div>
          )
        }
      />

      <div className="card">
        <div className="border-b border-gray-100 flex">
          <button onClick={() => switchTab('records')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'records' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            <Calculator className="w-4 h-4" />计件登记
          </button>
          <button onClick={() => switchTab('rates')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'rates' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            计件单价
          </button>
        </div>
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <input
            type="text"
            placeholder={tab === 'records' ? '搜索单号 / 员工 / 计件项...' : '搜索计件项名称...'}
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }}
            className="form-input md:max-w-xs"
          />
          {tab === 'records' ? (
            <>
              <input type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-44" title="按期间筛选" />
              <button onClick={() => setSumOpen(true)} className="btn-secondary flex items-center gap-1.5">
                <Calculator className="w-4 h-4" />月度汇总
              </button>
            </>
          ) : (
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-32">
              <option value="">全部状态</option>
              {Object.entries(PIECE_RATE_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
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
              ) : rows.length === 0 ? (
                <tr><td colSpan={activeView.visibleColumns.length} className="px-6">
                  <ListEmpty
                    keyword={keyword}
                    filterNote={filterNote}
                    onClear={() => { setKeyword(''); setPeriod(''); setStatus(''); setPagination((p) => ({ ...p, page: 1 })); }}
                    title={tab === 'records' ? '暂无计件登记' : '暂无计件单价'}
                    description={tab === 'records' ? '点击右上角「新建登记」或「从工序报工导入」录入计件产量' : '先配置计件项与单价（如：装配 1.50 元/件），导入工序报工时按同名匹配'}
                  />
                </td></tr>
              ) : tab === 'records' ? (
                list.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    {activeView.visibleColumns.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(r as never)}</td>)}
                  </tr>
                ))
              ) : (
                rates.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    {activeView.visibleColumns.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(r as never)}</td>)}
                  </tr>
                ))
              )}
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

      {/* 计件登记 新建/编辑 */}
      <Modal title={editId ? '编辑计件登记' : '新建计件登记'} open={open} onCancel={() => setOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={680}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">员工</label>
              <SearchSelect
                value={form.employee_id || undefined}
                onChange={(v: unknown) => {
                  const id = typeof v === 'string' ? v : '';
                  const emp = emps.find((x) => x.id === id);
                  setForm((f) => ({
                    ...f, employee_id: id, employee_name: emp?.name || f.employee_name,
                    department: emp?.department_id ? (depts.find((d) => d.id === emp.department_id)?.name || f.department) : f.department,
                  }));
                }}
                options={emps.map((e) => ({ label: `${e.name}（${e.code}）`, value: e.id, search: `${e.name} ${e.code}` }))}
                placeholder="请选择员工"
                allowClear
              />
              {!form.employee_id && (
                <input value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} className="form-input w-full mt-1" placeholder="或手工输入姓名（未建档人员）" />
              )}
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">计件项 *</label>
              <SearchSelect
                value={form.rate_id || undefined}
                onChange={(v: unknown) => {
                  const id = typeof v === 'string' ? v : '';
                  const rate = rateOptions.find((x) => x.id === id);
                  setForm((f) => ({ ...f, rate_id: id, item_name: rate?.name || f.item_name, unit_price: rate ? String(parseFloat(rate.unit_price)) : f.unit_price }));
                }}
                options={rateOptions.map((r) => ({ label: `${r.name}（${parseFloat(r.unit_price).toFixed(2)} 元/件）`, value: r.id, search: r.name }))}
                placeholder="请选择单价表（自动带出单价）"
                allowClear
              />
              {!form.rate_id && (
                <input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className="form-input w-full mt-1" placeholder="或手工输入计件项名称" />
              )}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">数量 *</label>
              <Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="如：120" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">单价（元）</label>
              <Input type="number" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} placeholder="如：1.50" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">作业日期 *</label>
              <Input type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">部门</label>
              <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="如：生产部" /></div>
          </div>
          <div><label className="block text-sm text-gray-600 mb-1">备注</label>
            <Input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="请输入备注" /></div>
          <div className="text-xs text-gray-500">金额 = 数量 × 单价（保存时服务端计算）。选「计件项」会自动带出单价表单价。</div>
        </div>
      </Modal>

      {/* 单价表 新建/编辑 */}
      <Modal title={rateEditId ? '编辑计件单价' : '新建计件单价'} open={rateOpen} onCancel={() => setRateOpen(false)} onOk={handleRateSave} confirmLoading={rateSaving} okText="保存" cancelText="取消" width={520}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">计件项名称 *</label>
              <Input value={rateForm.name} onChange={(e) => setRateForm({ ...rateForm, name: e.target.value })} placeholder="如：装配（与工序名称一致才能自动匹配）" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">单价（元/件）*</label>
              <Input type="number" value={rateForm.unit_price} onChange={(e) => setRateForm({ ...rateForm, unit_price: e.target.value })} placeholder="如：1.50" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">状态</label>
              <select value={rateForm.status} onChange={(e) => setRateForm({ ...rateForm, status: e.target.value })} className="form-input w-full">
                {Object.entries(PIECE_RATE_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="block text-sm text-gray-600 mb-1">备注</label>
              <Input value={rateForm.remark} onChange={(e) => setRateForm({ ...rateForm, remark: e.target.value })} placeholder="请输入备注" /></div>
          </div>
          <div className="text-xs text-gray-500">停用后不参与「工序报工导入」的自动匹配，历史登记不受影响。</div>
        </div>
      </Modal>

      {/* 月度汇总 */}
      <Modal title="月度计件汇总（按员工）" open={sumOpen} onCancel={() => setSumOpen(false)} footer={null} width={680}>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3">
            <input type="month" value={sumPeriod} onChange={(e) => setSumPeriod(e.target.value)} className="form-input w-44" />
            <span className="text-xs text-gray-500">工资批次新建弹窗可「从计件汇总带入」到奖金栏</span>
          </div>
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {['员工', '部门', '数量合计', '金额合计（元）', '笔数'].map((h) => <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sumLoading ? (
                  <tr><td colSpan={5} className="px-3 py-4"><TableSkeleton rows={3} /></td></tr>
                ) : sumRows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">该期间暂无计件登记</td></tr>
                ) : sumRows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-gray-900">{r.employee_name}</td>
                    <td className="px-3 py-2 text-gray-500 text-sm">{r.department || '-'}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{parseFloat(r.total_qty || '0')}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">{parseFloat(r.total_amount || '0').toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {/* 工序报工导入 */}
      <Modal title="从工序报工导入计件登记" open={importOpen} onCancel={() => setImportOpen(false)} onOk={handleImport} confirmLoading={importing} okText={`导入（${importSel.size}）`} cancelText="取消" width={860}>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3">
            <input type="month" value={importPeriod} onChange={(e) => setImportPeriod(e.target.value)} className="form-input w-44" />
            <span className="text-xs text-gray-500">仅显示「已报工完成 + 有操作工 + 本月」的工序；按工序名称匹配启用中的单价表（同名），未匹配的会跳过并给出原因。</span>
          </div>
          <div className="overflow-x-auto border border-gray-100 rounded-lg max-h-80">
            <table className="w-full min-w-max">
              <thead className="sticky top-0">
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 w-10">
                    <input
                      type="checkbox"
                      checked={importSel.size > 0 && importSel.size === importRows.filter((r) => !r.already_imported && parseFloat(r.matched_price) > 0 && parseFloat(r.qty_good) > 0).length}
                      onChange={(e) => {
                        if (e.target.checked) setImportSel(new Set(importRows.filter((r) => !r.already_imported && parseFloat(r.matched_price) > 0 && parseFloat(r.qty_good) > 0).map((r) => r.process_id)));
                        else setImportSel(new Set());
                      }}
                    />
                  </th>
                  {['工单号', '工序', '操作工', '良品数量', '匹配单价', '完工时间', '状态'].map((h) => <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {importLoading ? (
                  <tr><td colSpan={8} className="px-3 py-4"><TableSkeleton rows={4} /></td></tr>
                ) : importRows.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">该期间没有可导入的工序报工（需工序报工完成且填写操作工）</td></tr>
                ) : importRows.map((r) => {
                  const disabled = r.already_imported || parseFloat(r.matched_price) <= 0 || parseFloat(r.qty_good) <= 0;
                  return (
                    <tr key={r.process_id} className={disabled ? 'opacity-60' : ''}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={importSel.has(r.process_id)}
                          onChange={(e) => {
                            setImportSel((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(r.process_id); else next.delete(r.process_id);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600">{r.work_order_no || '-'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.process_name}</td>
                      <td className="px-3 py-2 text-gray-700">{r.operator_name}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{parseFloat(r.qty_good || '0')}</td>
                      <td className="px-3 py-2 text-right">{parseFloat(r.matched_price) > 0 ? <span className="text-gray-900">{parseFloat(r.matched_price).toFixed(2)}</span> : <span className="text-amber-600 text-xs">未配置单价</span>}</td>
                      <td className="px-3 py-2 text-sm text-gray-500">{r.completed_at ? format.date(r.completed_at) : '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.already_imported ? <span className="text-gray-400">已导入</span> : disabled ? <span className="text-amber-600">不可导入</span> : <span className="text-green-600">可导入</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
