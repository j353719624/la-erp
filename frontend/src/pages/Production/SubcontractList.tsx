import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Edit, Trash2, Play, PackageCheck, CheckCircle2, XCircle, Send, Undo2, PackagePlus, Printer } from 'lucide-react';
import { productionApi } from '@/api/production';
import { supplierApi } from '@/api/order';
import { productApi } from '@/api/product';
import { http } from '@/utils/request';
import { SubcontractOrder, SubcontractMaterialLine } from '@/types/production';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { useTableView } from '@/hooks/useTableView';
import { loadOptions } from '@/utils/loadOptions';
import type { ReactNode } from 'react';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';

const STATUS: Record<string, { text: string; cls: string }> = {
  draft: { text: '草稿', cls: 'bg-gray-100 text-gray-600' },
  confirmed: { text: '已确认', cls: 'bg-blue-50 text-blue-600' },
  // 分批收货中（2026-09-11）：已收一部分，后续还有货回来
  receiving: { text: '部分收货', cls: 'bg-cyan-50 text-cyan-600' },
  received: { text: '已收货', cls: 'bg-amber-50 text-amber-600' },
  completed: { text: '已完成', cls: 'bg-green-50 text-green-600' },
  cancelled: { text: '已取消', cls: 'bg-red-50 text-red-600' },
};

// 数量文本：最多 3 位小数（外协增重/损耗常带小数，如电镀 209.3 → 214.3；旧的 0 位会把 209.3 显示成 209）
const fmt = (v: string | number | undefined, d = 3) => {
  if (v === undefined || v === null || v === '') return '0';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return Number(n.toFixed(d)).toLocaleString('zh-CN', { maximumFractionDigits: d });
};

/** 带符号差异文本（+5 / -3.2） */
const signed = (v: string | number | undefined) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n === 0) return fmt(v);
  return (n > 0 ? '+' : '') + fmt(v);
};

const MODE_TEXT: Record<string, { text: string; cls: string }> = {
  pure: { text: '纯外协', cls: 'bg-gray-100 text-gray-500' },
  with_material: { text: '带料外协', cls: 'bg-violet-50 text-violet-600' },
};

// 材料行编辑器行类型（含前端临时 key）
interface MaterialRow {
  _key: string;
  product_id: string;
  product_name: string;
  product_code: string;
  spec: string;
  qty: string;
  remark: string;
  // [2026-09-16] 商品自定义字段（行内小字展示）
  ext_fields?: Record<string, unknown>;
}

const blankRow = (): MaterialRow => ({
  _key: `m${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  product_id: '', product_name: '', product_code: '', spec: '',
  qty: '1', remark: '',
});

const toMaterialRows = (lines?: SubcontractMaterialLine[]): MaterialRow[] =>
  (lines || []).map(l => ({
    _key: `m${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    product_id: l.product_id || '', product_name: l.product_name || '',
    product_code: l.product_code || '', spec: l.spec || '',
    qty: String(Number(l.qty || 0)), remark: l.remark || '',
    // [2026-09-16] 商品自定义字段（商品边带出，行内小字展示）
    ext_fields: l.edges?.product?.ext_fields,
  }));

const MODE_LABEL: Record<string, string> = { pure: '纯外协', with_material: '带料外协' };

export function SubcontractList() {
  // [2026-09-18 权限细化·批 2 生产] 新建=subcontract_create；编辑/确认/发料/退料/收货/完收/完成/取消=subcontract_edit；删除=subcontract_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  // [2026-09-16] 商品自定义字段中文名（材料行/发料行内小字展示用）
  const productLabels = useProductFieldLabels();
  const [items, setItems] = useState<SubcontractOrder[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [status, setStatus] = useState('');

  // 弹窗表单
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SubcontractOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    mode: 'pure', supplier_id: '', warehouse_id: '', product_id: '', product_name: '',
    process_name: '', qty: 1, unit_price: 0, remark: '', material_lines: [] as MaterialRow[],
  });

  // 发料/退料弹窗（同一弹窗复用；issueAction 区分用途）
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueAction, setIssueAction] = useState<'issue' | 'return'>('issue');
  const [issueTarget, setIssueTarget] = useState<SubcontractOrder | null>(null);
  const [issueForm, setIssueForm] = useState<Record<string, string>>({});
  const [acting, setActing] = useState(false);

  // 明细查看
  const [detail, setDetail] = useState<SubcontractOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // [2026-09-11] 收货弹窗：分批收货 + 实收数量（镀层增重 / 酸洗损耗）
  const [recvOpen, setRecvOpen] = useState(false);
  const [recvTarget, setRecvTarget] = useState<SubcontractOrder | null>(null);
  const [recvQty, setRecvQty] = useState('');
  const [recvBatch, setRecvBatch] = useState(false);
  const [recvReason, setRecvReason] = useState('');
  const [recvRemark, setRecvRemark] = useState('');
  const [recvActing, setRecvActing] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => { setPagination(prev => ({ ...prev, page: 1 })); }, [keyword, status]);
  useEffect(() => { fetchList(); }, [pagination.page, debouncedKeyword, status]);

  const fetchList = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { status?: string; keyword?: string } = {
        page: pagination.page, page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined, status: status || undefined,
      };
      const res = await productionApi.subcontractOrderList(params);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setItems(res.data?.list || []);
        setPagination(prev => ({ ...prev, total: res.data?.total || 0 }));
      }
    } catch (e) { console.error('Failed to fetch subcontract orders:', e); }
    finally { if (isCurrent(seq)) setLoading(false); } // [FIX-Rev] 仅最新请求结束才收起 loading
  };

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [s, w, p] = await loadOptions([
        supplierApi.list({ page: 1, page_size: 1000 }),
        http.get('/v1/warehouses', { page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
      ], '外协单');
      setSuppliers((s as any)?.data?.list || []);
      setWarehouses((w as any)?.data?.list || []);
      setProducts((p as any)?.data?.list || []);
    } catch { /* 静默 */ }
  };

  const baseForm = () => ({
    mode: 'pure', supplier_id: '', warehouse_id: '', product_id: '', product_name: '',
    process_name: '', qty: 1, unit_price: 0, remark: '', material_lines: [] as MaterialRow[],
  });

  const openCreate = () => {
    fetchOptions();
    setEditing(null);
    setForm(baseForm());
    setModalOpen(true);
  };

  const openEdit = (it: SubcontractOrder) => {
    fetchOptions();
    setEditing(it);
    const mode = it.mode || 'pure';
    setForm({
      mode,
      supplier_id: it.supplier_id || '', warehouse_id: it.warehouse_id || '',
      product_id: it.product_id || '', product_name: it.product_name || '',
      process_name: it.process_name || '', qty: Number(it.qty || 0), unit_price: Number(it.unit_price || 0),
      remark: it.remark || '',
      material_lines: mode === 'with_material' ? toMaterialRows(it.edges?.material_lines || it.material_lines) : [],
    });
    setModalOpen(true);
  };

  // 材料行编辑器
  const setMatLine = (key: string, patch: Partial<MaterialRow>) => {
    setForm((prev: any) => ({
      ...prev,
      material_lines: (prev.material_lines as MaterialRow[]).map(r => (r._key === key ? { ...r, ...patch } : r)),
    }));
  };
  const addMatLine = () => setForm((prev: any) => ({ ...prev, material_lines: [...(prev.material_lines as MaterialRow[]), blankRow()] }));
  const removeMatLine = (key: string) => setForm((prev: any) => ({ ...prev, material_lines: (prev.material_lines as MaterialRow[]).filter(r => r._key !== key) }));

  const handleSave = async () => {
    if (!form.supplier_id) { message.warning('请选择外协供应商'); return; }
    if (Number(form.qty) <= 0) { message.warning('外协数量必须大于0'); return; }
    if (form.mode === 'with_material') {
      const matRows = form.material_lines as MaterialRow[];
      if (matRows.length === 0) { message.warning('带料外协必须至少指定一种发料材料'); return; }
      for (let i = 0; i < matRows.length; i++) {
        if (!matRows[i].product_id) { message.warning(`第${i + 1}行材料未选择商品`); return; }
        if (Number(matRows[i].qty) <= 0) { message.warning(`第${i + 1}行材料应发数量必须大于0`); return; }
      }
    }
    setSaving(true);
    try {
      const sup = suppliers.find(x => x.id === form.supplier_id);
      const wh = warehouses.find(x => x.id === form.warehouse_id);
      const prod = products.find(x => x.id === form.product_id);
      const payload: any = {
        supplier_id: form.supplier_id || null, supplier_name: sup?.name || '',
        warehouse_id: form.warehouse_id || null, warehouse_name: wh?.name || '',
        product_id: form.product_id || null, product_name: prod?.name || form.product_name, product_code: prod?.code || '',
        process_name: form.process_name, qty: Number(form.qty), unit_price: Number(form.unit_price || 0),
        remark: form.remark, mode: form.mode || 'pure',
        material_lines: form.mode === 'with_material'
          ? (form.material_lines as MaterialRow[]).filter(r => r.product_id).map(r => ({
              product_id: r.product_id, product_name: r.product_name, product_code: r.product_code,
              spec: r.spec, qty: Number(r.qty), remark: r.remark,
            }))
          : [],
      };
      const res = editing
        ? await productionApi.updateSubcontractOrder(editing.id!, payload)
        : await productionApi.createSubcontractOrder(payload);
      if (res.code === 0) {
        message.success('保存成功');
        setModalOpen(false);
        fetchList();
      } else { message.error(res.message || '保存失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); }
    finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<any>, okMsg: string, title: string, danger = false) => {
    if (!(await confirmAction({ title, danger }))) return;
    try {
      const res = await fn();
      if (res.code === 0) { message.success(okMsg); fetchList(); }
      else { message.error(res.message || '操作失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '操作失败'); }
  };

  const modeOf = (it: SubcontractOrder) => it.mode || 'pure';
  const isWithMaterial = (it: SubcontractOrder) => modeOf(it) === 'with_material';
  const linesOf = (so: SubcontractOrder | null | undefined): SubcontractMaterialLine[] =>
    so?.edges?.material_lines || so?.material_lines || [];
  const receiveLogsOf = (so: SubcontractOrder | null | undefined) => so?.edges?.receive_logs || [];

  // ---- 收货（分批 / 增重损耗）----
  const expectedOf = (it: SubcontractOrder) => Number(it.qty || 0);
  const receivedOf = (it: SubcontractOrder) => Number(it.received_qty || 0);
  const remainOf = (it: SubcontractOrder) => Math.max(0, expectedOf(it) - receivedOf(it));

  const openReceive = (it: SubcontractOrder) => {
    setRecvTarget(it);
    setRecvQty(fmt(remainOf(it) || expectedOf(it)));   // 默认=剩余应收，可改成实际回货数量
    setRecvBatch(false);
    setRecvReason(it.diff_reason || '');
    setRecvRemark('');
    setRecvOpen(true);
  };

  // 收货预览：本次/累计/差异/是否超容差（UI 即时提示，与后端同口径）
  const recvPreview = (() => {
    if (!recvTarget) return null;
    const qty = Number(recvQty || 0);
    const expected = expectedOf(recvTarget);
    const received = receivedOf(recvTarget);
    const newTotal = received + qty;
    const diff = newTotal - expected;
    const rate = expected > 0 ? Math.abs(diff) / expected : 0;
    const isFinal = !recvBatch || newTotal >= expected;
    return { qty, expected, received, newTotal, diff, rate, isFinal, overTolerance: isFinal && rate > 0.1 };
  })();

  const submitReceive = async () => {
    if (!recvTarget?.id) return;
    const p = recvPreview;
    if (!p || !Number.isFinite(p.qty) || p.qty <= 0) { message.warning('请填写本次实收数量（大于 0）'); return; }
    if (p.overTolerance && !recvReason.trim()) {
      message.warning(`累计实收与应收差异 ${(p.rate * 100).toFixed(1)}% 超出 ±10% 容差，请填写差异原因`);
      return;
    }
    setRecvActing(true);
    try {
      const res = await productionApi.receiveSubcontractOrder(recvTarget.id, {
        qty: p.qty,
        batch: recvBatch,
        diff_reason: recvReason.trim() || undefined,
        remark: recvRemark.trim() || undefined,
      });
      if (res.code === 0) {
        message.success(recvBatch && p.newTotal < p.expected
          ? '已登记本批收货（单据置为“部分收货”，可继续收货）'
          : '已收货（外协件入库）');
        setRecvOpen(false);
        fetchList();
      } else { message.error(res.message || '收货失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '收货失败'); }
    finally { setRecvActing(false); }
  };

  // 结束收货：剩余不再回来（如已确认损耗），不产生入库流水
  const submitFinishReceive = async () => {
    if (!recvTarget?.id) return;
    const p = recvPreview;
    if (p && p.rate > 0.1 && !recvReason.trim() && !recvTarget.diff_reason) {
      message.warning(`累计实收与应收差异 ${(p.rate * 100).toFixed(1)}% 超出 ±10% 容差，请填写差异原因`);
      return;
    }
    setRecvActing(true);
    try {
      const res = await productionApi.finishReceiveSubcontractOrder(recvTarget.id, recvReason.trim());
      if (res.code === 0) {
        message.success('已结束收货（剩余数量不再入库）');
        setRecvOpen(false);
        fetchList();
      } else { message.error(res.message || '结束收货失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '结束收货失败'); }
    finally { setRecvActing(false); }
  };

  // 明细
  const openDetail = async (it: SubcontractOrder) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(it);
    try {
      const res = await productionApi.getSubcontractOrder(it.id!);
      if (res.code === 0) setDetail(res.data);
    } catch { /* 静默 */ }
    finally { setDetailLoading(false); }
  };

  // 发料/退料：先取详情拿材料行，再弹数量输入
  const openIssueOrReturn = async (it: SubcontractOrder, action: 'issue' | 'return') => {
    const res = await productionApi.getSubcontractOrder(it.id!);
    if (res.code !== 0 || !res.data) { message.error('获取外协单详情失败'); return; }
    const so = res.data;
    const rows = linesOf(so);
    if (rows.length === 0) { message.warning('外协单没有材料行'); return; }
    const qtyMap: Record<string, string> = {};
    rows.forEach((l) => {
      const issued = Number(l.issued_qty || 0);
      const plan = Number(l.qty || 0);
      const remaining = action === 'issue'
        ? Math.max(0, plan - issued)
        : Math.max(0, issued - Number(l.consumed_qty || 0) - Number(l.returned_qty || 0));
      qtyMap[l.id!] = remaining > 0 ? String(remaining) : '';
    });
    if (action === 'issue' && rows.every(l => Number(l.issued_qty || 0) >= Number(l.qty || 0))) {
      message.warning('材料已全部发料完成'); return;
    }
    if (action === 'return' && rows.every(l => Number(l.issued_qty || 0) - Number(l.consumed_qty || 0) - Number(l.returned_qty || 0) <= 0)) {
      message.warning('没有可退回的材料'); return;
    }
    setIssueTarget(so);
    setIssueAction(action);
    setIssueForm(qtyMap);
    setIssueOpen(true);
  };

  const submitIssue = async () => {
    if (!issueTarget) return;
    const lines = Object.entries(issueForm)
      .filter(([, q]) => Number(q) > 0)
      .map(([id, q]) => ({ material_line_id: id, qty: Number(q) }));
    if (lines.length === 0) { message.warning('请至少填写一种材料的发料数量'); return; }
    setActing(true);
    try {
      const res = await productionApi.issueSubcontractOrder(issueTarget.id!, lines);
      if (res.code === 0) { message.success('发料成功（材料已出库）'); setIssueOpen(false); fetchList(); }
      else { message.error(res.message || '发料失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '发料失败'); }
    finally { setActing(false); }
  };

  const submitReturn = async () => {
    if (!issueTarget) return;
    const lines = Object.entries(issueForm)
      .filter(([, q]) => Number(q) > 0)
      .map(([id, q]) => ({ material_line_id: id, qty: Number(q) }));
    if (lines.length === 0) { message.warning('请至少填写一种材料的退回数量'); return; }
    setActing(true);
    try {
      const res = await productionApi.returnSubcontractMaterial(issueTarget.id!, lines);
      if (res.code === 0) { message.success('退料成功（材料已退回入库）'); setIssueOpen(false); fetchList(); }
      else { message.error(res.message || '退料失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '退料失败'); }
    finally { setActing(false); }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40';

  // [2026-09-12] 发料/核销与可操作性统计（表格单元与行操作共用）
  const matState = (item: SubcontractOrder) => {
    const withMat = isWithMaterial(item);
    const issued = Number(item.material_issued_qty || 0);
    const returned = Number(item.material_returned_qty || 0);
    const consumed = Number(item.material_consumed_qty || 0);
    const planSum = linesOf(item).reduce((a, l) => a + Number(l.qty || 0), 0);
    // 列表接口不预载材料行：planSum=0 时无法判断剩余，仍显示发料按钮（点击后按详情校验）
    const canIssue = withMat && (item.status === 'confirmed' || item.status === 'receiving')
      && (planSum > 0 ? issued < planSum : true);
    const canReturn = withMat && (item.status === 'confirmed' || item.status === 'receiving' || item.status === 'received')
      && issued - consumed - returned > 0;
    return { withMat, issued, returned, consumed, planSum, canIssue, canReturn };
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: SubcontractOrder) => ReactNode;
  }
  const TH_L = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_C = 'px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-3';
  const rowCols: RowCol[] = [
    {
      key: 'code',
      header: '外协单号',
      cell: (item) => (
        <button onClick={() => openDetail(item)} title="查看明细" className="font-medium text-gray-900 hover:text-blue-600">{item.code}</button>
      ),
    },
    {
      key: 'mode',
      header: '类型',
      headCls: TH_C,
      cellCls: 'px-4 py-3 text-center',
      cell: (item) => {
        const mt = MODE_TEXT[modeOf(item)] || MODE_TEXT.pure;
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${mt.cls}`}>{mt.text}</span>;
      },
    },
    { key: 'supplier', header: '供应商', cellCls: `${TD} text-sm text-gray-700`, cell: (item) => <span>{item.supplier_name || (item as any).edges?.supplier?.name || '-'}</span> },
    {
      key: 'product_process',
      header: '产品/工序',
      cellCls: `${TD} text-sm text-gray-700`,
      cell: (item) => (
        <>
          <div className="text-gray-900">{item.product_name || '-'}</div>
          {item.process_name && <div className="text-xs text-gray-400">{item.process_name}</div>}
        </>
      ),
    },
    {
      key: 'qty',
      header: '数量',
      headCls: TH_R,
      cellCls: `${TD} text-right text-sm text-gray-900`,
      cell: (item) => (
        <>
          <div>{fmt(item.qty)}</div>
          {receivedOf(item) > 0 && (
            <div className="text-xs text-gray-400">
              已收 <span className={Number(item.diff_qty || 0) !== 0 ? 'text-amber-600 font-medium' : 'text-gray-600'}>{fmt(item.received_qty)}</span>
              {Number(item.diff_qty || 0) !== 0 && (
                <span className={`ml-1 ${Number(item.diff_qty) > 0 ? 'text-amber-600' : 'text-rose-500'}`}
                  title={item.diff_reason || '数量差异（增重/损耗）'}>
                  {signed(item.diff_qty)}
                  {expectedOf(item) > 0 ? ` (${(Math.abs(Number(item.diff_qty)) / expectedOf(item) * 100).toFixed(1)}%)` : ''}
                </span>
              )}
            </div>
          )}
        </>
      ),
    },
    { key: 'amount', header: '加工费', headCls: TH_R, cellCls: `${TD} text-right text-sm text-gray-600`, cell: (item) => <span>{format.currency(Number(item.amount || 0))}</span> },
    {
      key: 'material',
      header: '发料/核销',
      headCls: TH_C,
      cellCls: 'px-4 py-3 text-center text-xs',
      cell: (item) => {
        const m = matState(item);
        if (!m.withMat) return <span className="text-gray-300">—</span>;
        return (
          <div>
            <div>实发 <span className="text-gray-900 font-medium">{fmt(item.material_issued_qty)}</span>
              {m.planSum > 0 && <span className="text-gray-400">/{m.planSum.toFixed(0)}</span>}
            </div>
            <div className="text-gray-400">核销 <span className="text-amber-600">{fmt(item.material_consumed_qty)}</span>
              {m.returned > 0 && <span className="text-teal-600 ml-1">退{fmt(item.material_returned_qty)}</span>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: '状态',
      headCls: TH_C,
      cellCls: 'px-4 py-3 text-center',
      cell: (item) => {
        const st = STATUS[item.status || 'draft'] || STATUS.draft;
        return <span className={`px-2 py-1 rounded-full text-xs font-medium ${st.cls}`}>{st.text}</span>;
      },
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      // [易用性] 行操作统一折叠（外协单按钮最多，横屏下主操作 + ⋮ 更多）；确认文案仍在 act() 内
      cell: (item) => {
        const m = matState(item);
        return (
          <RowActions
            actions={[
              { key: 'detail', label: '明细', icon: <Eye className="w-4 h-4" />, onClick: () => openDetail(item) },
              { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/subcontract_order/${item.id}`) },
              ...(item.status === 'draft'
                ? [
                    ...(has('subcontract_edit')
                      ? [
                          { key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, onClick: () => openEdit(item) },
                          { key: 'confirm', label: '确认', icon: <Play className="w-4 h-4" />, onClick: () => act(() => productionApi.confirmSubcontractOrder(item.id!), '已确认', `确定确认外协单 ${item.code}？`) },
                        ]
                      : []),
                    ...(has('subcontract_delete')
                      ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => act(() => productionApi.deleteSubcontractOrder(item.id!), '已删除', `确定删除外协单 ${item.code}？`, true) }]
                      : []),
                  ]
                : []),
              ...(item.status === 'confirmed' && has('subcontract_edit')
                ? [
                    ...(m.canIssue ? [{ key: 'issue', label: '发料（材料出库）', icon: <Send className="w-4 h-4" />, onClick: () => openIssueOrReturn(item, 'issue') }] : []),
                    ...(m.canReturn ? [{ key: 'return', label: '退料（多余材料退回）', icon: <Undo2 className="w-4 h-4" />, onClick: () => openIssueOrReturn(item, 'return') }] : []),
                    { key: 'receive', label: '收货（外协件入库）', icon: <PackageCheck className="w-4 h-4" />, onClick: () => openReceive(item) },
                    { key: 'cancel', label: '取消', icon: <XCircle className="w-4 h-4" />, danger: true, onClick: () => act(() => productionApi.cancelSubcontractOrder(item.id!), '已取消', `确定取消外协单 ${item.code}？`, true) },
                  ]
                : []),
              ...(item.status === 'receiving' && has('subcontract_edit')
                ? [
                    ...(m.canReturn ? [{ key: 'return', label: '退料（多余材料退回）', icon: <Undo2 className="w-4 h-4" />, onClick: () => openIssueOrReturn(item, 'return') }] : []),
                    { key: 'receive', label: `继续收货（已收 ${fmt(item.received_qty)}）`, icon: <PackageCheck className="w-4 h-4" />, onClick: () => openReceive(item) },
                    { key: 'finish', label: '结束收货', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => openReceive(item) },
                    { key: 'complete', label: '完成', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => act(() => productionApi.completeSubcontractOrder(item.id!), '已完成', `确定完成外协单 ${item.code}？`) },
                  ]
                : []),
              ...(item.status === 'received' && has('subcontract_edit')
                ? [
                    ...(m.canReturn ? [{ key: 'return', label: '退料（多余材料退回）', icon: <Undo2 className="w-4 h-4" />, onClick: () => openIssueOrReturn(item, 'return') }] : []),
                    { key: 'complete', label: '完成', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => act(() => productionApi.completeSubcontractOrder(item.id!), '已完成', `确定完成外协单 ${item.code}？`) },
                    { key: 'cancel', label: '取消', icon: <XCircle className="w-4 h-4" />, danger: true, onClick: () => act(() => productionApi.cancelSubcontractOrder(item.id!), '已取消', `确定取消外协单 ${item.code}？`, true) },
                  ]
                : []),
            ]}
          />
        );
      },
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'subcontract-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="外协加工"
        subtitle="工序委托外部供应商加工（草稿→确认→收货→完成）。带料外协先发料出库再收货，收货按材料成本+加工费结转入库"
        extra={
          has('subcontract_create') && (
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /><span className="hidden md:inline">新建外协单</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" placeholder="搜索外协单号/供应商/工序..." value={keyword}
                onChange={(e) => setKeyword(e.target.value)} className="form-input pl-10" />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="form-select w-28">
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="confirmed">已确认</option>
              <option value="receiving">部分收货</option>
              <option value="received">已收货</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
            <div className="ml-auto">{viewMenu}</div>
          </div>
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
                <tr><td colSpan={visibleColumns.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-8"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无外协单" /></td></tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && items.length > 0 && (
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        )}
      </div>

      {/* 新建/编辑弹窗 */}
      <Modal open={modalOpen} onCancel={() => setModalOpen(false)} title={editing ? `编辑外协单 ${editing.code}` : '新建外协单'} width={720} onOk={handleSave} okText={saving ? '保存中...' : '保存'} confirmLoading={saving}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">业务模式</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm((prev: any) => ({ ...prev, mode: 'pure', material_lines: [] }))}
                className={`rounded-lg border px-3 py-2 text-sm text-left ${form.mode !== 'with_material' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                <div className="font-medium">纯外协</div>
                <div className="text-xs opacity-70">供应商自备料加工，只收货入库</div>
              </button>
              <button type="button" onClick={() => setForm((prev: any) => ({ ...prev, mode: 'with_material', material_lines: (prev.material_lines?.length ? prev.material_lines : [blankRow()]) }))}
                className={`rounded-lg border px-3 py-2 text-sm text-left ${form.mode === 'with_material' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                <div className="font-medium">带料外协</div>
                <div className="text-xs opacity-70">我方发料加工，发料出库→收货核销结转成本</div>
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">外协供应商 *</label>
            <SearchSelect
              required
              value={form.supplier_id}
              onChange={(v) => setForm(prev => ({ ...prev, supplier_id: v ?? '' }))}
              placeholder="请选择供应商"
              options={suppliers.map(x => ({ value: x.id, label: x.name }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">收货仓库</label>
            <SearchSelect
              value={form.warehouse_id}
              onChange={(v) => setForm(prev => ({ ...prev, warehouse_id: v ?? '' }))}
              placeholder="请选择仓库（发料默认同此仓）"
              options={warehouses.map(x => ({ value: x.id, label: x.name }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">外协产品</label>
            <SearchSelect
              value={form.product_id}
              onChange={(v) => {
                const p = products.find(x => x.id === v);
                setForm(prev => ({ ...prev, product_id: v ?? '', product_name: p?.name || '' }));
              }}
              placeholder="请选择产品"
              options={products.map(x => ({ value: x.id, label: productOptionLabel(x), search: productOptionSearch(x) }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">外协工序</label>
            <input value={form.process_name} onChange={(e) => setForm(prev => ({ ...prev, process_name: e.target.value }))} placeholder="如：电镀、热处理..." className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">外协数量 *</label>
            <input type="text" inputMode="decimal" value={form.qty ?? ''} onChange={(e) => setForm(prev => ({ ...prev, qty: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">加工单价</label>
            <input type="text" inputMode="decimal" value={form.unit_price ?? ''} onChange={(e) => setForm(prev => ({ ...prev, unit_price: e.target.value }))} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">备注</label>
            <textarea value={form.remark} onChange={(e) => setForm(prev => ({ ...prev, remark: e.target.value }))} rows={1} className={inputCls} />
          </div>
        </div>

        {/* 带料外协：发料材料行编辑器 */}
        {form.mode === 'with_material' && (
          <div className="mt-4 border border-violet-100 rounded-lg p-3 bg-violet-50/40">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-violet-700 flex items-center gap-1.5">
                <PackagePlus className="w-4 h-4" />发料材料（确认后按此发料出库，收货时核销结转成本）
              </div>
              <button type="button" onClick={addMatLine} className="text-xs text-violet-600 hover:text-violet-800 flex items-center gap-0.5">
                <Plus className="w-3.5 h-3.5" />添加材料
              </button>
            </div>
            <div className="space-y-2">
              {(form.material_lines as MaterialRow[]).map((row) => {
                const prod = products.find(x => x.id === row.product_id);
                return (
                  <div key={row._key} className="flex items-center gap-2">
                    <div className="flex-1">
                      <SearchSelect
                        value={row.product_id}
                        onChange={(v) => {
                          const p = products.find(x => x.id === v);
                          setMatLine(row._key, { product_id: v ?? '', product_name: p?.name || '', product_code: p?.code || '', spec: p?.spec || '', ext_fields: p?.ext_fields });
                        }}
                        placeholder="请选择发料材料"
                        options={products.map(x => ({ value: x.id, label: productOptionLabel(x), search: productOptionSearch(x) }))}
                      />
                      <LineProductExt line={row} labels={productLabels} />
                    </div>
                    <div className="w-24 shrink-0">
                      <input type="text" inputMode="decimal" value={row.qty} onChange={(e) => setMatLine(row._key, { qty: e.target.value })} placeholder="应发" title="应发数量" className={`${inputCls} text-center`} />
                    </div>
                    <button type="button" onClick={() => removeMatLine(row._key)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg shrink-0" title="删除材料行"><Trash2 className="w-4 h-4" /></button>
                  </div>
                );
              })}
              {(form.material_lines as MaterialRow[]).length === 0 && (
                <button type="button" onClick={addMatLine} className="w-full border border-dashed border-violet-200 rounded-lg py-2 text-sm text-violet-500 hover:bg-violet-50">
                  + 添加发料材料
                </button>
              )}
              <div className="text-xs text-gray-400">提示：发料成本按发料时点该仓加权平均成本计算；收货时外协件入库成本 = 核销材料成本 + 加工费。</div>
            </div>
          </div>
        )}
      </Modal>

      {/* 发料/退料弹窗 */}
      <Modal open={issueOpen} onCancel={() => setIssueOpen(false)} title={issueAction === 'return' ? '外协退料' : '外协发料'} width={640} footer={null}>
        {issueTarget && (
          <div className="space-y-4 pt-1">
            <div className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-gray-600">
                {issueAction === 'return' ? '退回多余材料' : '发料给外协厂'} · 外协单 <span className="text-gray-900 font-medium">{issueTarget.code}</span>
                {issueTarget.product_name ? ` · ${issueTarget.product_name}` : ''}
              </span>
              <span className="text-xs text-gray-400">{issueAction === 'return' ? '退回后材料重新入库' : '确认后材料出库，收货时核销'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left py-1.5">材料</th>
                    <th className="text-right py-1.5">应发/实发</th>
                    <th className="text-right py-1.5 w-28">本次数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {linesOf(issueTarget).map((l) => {
                    const id = l.id!;
                    const plan = Number(l.qty || 0);
                    const issued = Number(l.issued_qty || 0);
                    const remaining = issueAction === 'issue'
                      ? Math.max(0, plan - issued)
                      : Math.max(0, issued - Number(l.consumed_qty || 0) - Number(l.returned_qty || 0));
                    return (
                      <tr key={id}>
                        <td className="py-1.5">
                          <div className="text-gray-900">{l.product_name || l.product_code || '-'}</div>
                          {l.product_code && <div className="text-xs text-gray-400">{l.product_code}</div>}
                          <LineProductExt line={l} labels={productLabels} />
                        </td>
                        <td className="py-1.5 text-right text-gray-500">
                          {issueAction === 'issue'
                            ? `${fmt(l.qty)}/${fmt(l.issued_qty)}`
                            : `实发 ${fmt(l.issued_qty)} · 退 ${fmt(l.returned_qty)} · 核 ${fmt(l.consumed_qty)}`}
                        </td>
                        <td className="py-1.5">
                          <input type="text" inputMode="decimal" value={issueForm[id] ?? ''}
                            onChange={(e) => setIssueForm(prev => ({ ...prev, [id]: e.target.value }))}
                            className={`${inputCls} text-center`} placeholder={`最多 ${remaining}`} title={`本次数量（最多 ${remaining}）`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setIssueOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 border border-gray-200">取消</button>
              <button onClick={issueAction === 'return' ? submitReturn : submitIssue} disabled={acting}
                className="btn-primary flex items-center gap-1.5 text-sm">
                {issueAction === 'return' ? <Undo2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                {acting ? '处理中...' : issueAction === 'return' ? '确认退料' : '确认发料'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* [2026-09-11] 收货弹窗：分批 + 实收数量（镀层增重 / 酸洗损耗） */}
      <Modal
        open={recvOpen}
        onCancel={() => setRecvOpen(false)}
        title={`外协收货${recvTarget ? ` ${recvTarget.code}` : ''}`}
        width={560}
        footer={null}
      >
        {recvTarget && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-3 gap-3 text-sm bg-gray-50 rounded-lg p-3">
              <div><div className="text-xs text-gray-400">应收</div><div className="text-gray-800 font-medium">{fmt(recvTarget.qty)}</div></div>
              <div><div className="text-xs text-gray-400">已收</div><div className="text-gray-800 font-medium">{fmt(recvTarget.received_qty)}</div></div>
              <div><div className="text-xs text-gray-400">剩余应收</div><div className="text-gray-800 font-medium">{fmt(remainOf(recvTarget))}</div></div>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">本次实收数量 *</label>
              <input
                type="text" inputMode="decimal" value={recvQty}
                onChange={(e) => setRecvQty(e.target.value)}
                className={inputCls}
                placeholder="实际回来的数量（可与应收不同）"
              />
              <div className="text-xs text-gray-400 mt-1">
                镀层/浸塑会增重（如电镀 209.3 → 214.3）、酸洗/切削会损耗，按实际称重填写；分批回来就分多次登记
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={recvBatch} onChange={(e) => setRecvBatch(e.target.checked)} className="w-4 h-4 accent-blue-600" />
              分批收货（后续还有货回来，本次只收一部分）
            </label>

            {recvPreview && (
              <div className={`text-sm rounded-lg p-3 ${recvPreview.overTolerance ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'}`}>
                累计实收 <b>{fmt(recvPreview.newTotal)}</b> · 差异 <b>{signed(recvPreview.diff)}</b>
                {recvPreview.expected > 0 ? `（${(recvPreview.rate * 100).toFixed(2)}%）` : ''}
                {recvPreview.overTolerance && <div className="mt-1">超出 ±10% 容差，必须填写差异原因</div>}
                {!recvPreview.isFinal && <div className="mt-1">本次为分批收货，差异待到齐后再校验</div>}
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-600 mb-1">差异原因{recvPreview?.overTolerance ? ' *' : '（可选）'}</label>
              <input value={recvReason} onChange={(e) => setRecvReason(e.target.value)} className={inputCls} placeholder="如：镀层增重 / 酸洗损耗 / 工艺说明" />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">备注</label>
              <input value={recvRemark} onChange={(e) => setRecvRemark(e.target.value)} className={inputCls} placeholder="可选" />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setRecvOpen(false)} className="btn-secondary">取消</button>
              <button onClick={submitFinishReceive} disabled={recvActing} className="btn-secondary">
                结束收货（剩余不回来）
              </button>
              <button onClick={submitReceive} disabled={recvActing} className="btn-primary">
                {recvActing ? '处理中...' : '确认收货'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 明细弹窗 */}
      <Modal open={detailOpen} onCancel={() => setDetailOpen(false)} title={`外协单明细${detail ? ` ${detail.code}` : ''}`} width={680} footer={null}>
        {detailLoading ? <div className="py-8 text-center text-gray-400">加载中...</div> : detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-gray-400">供应商</div><div className="text-gray-800">{detail.supplier_name || (detail as any).edges?.supplier?.name || '-'}</div></div>
              <div><div className="text-xs text-gray-400">产品</div><div className="text-gray-800">{detail.product_name || '-'}</div></div>
              <div><div className="text-xs text-gray-400">工序</div><div className="text-gray-800">{detail.process_name || '-'}</div></div>
              <div><div className="text-xs text-gray-400">业务模式</div><div className="text-gray-800">{MODE_LABEL[modeOf(detail)] || modeOf(detail)}</div></div>
              <div><div className="text-xs text-gray-400">收货仓库</div><div className="text-gray-800">{detail.warehouse_name || '-'}</div></div>
              <div><div className="text-xs text-gray-400">状态</div><div className="text-gray-800">{STATUS[detail.status || 'draft']?.text || '-'}</div></div>
              <div><div className="text-xs text-gray-400">应收数量</div><div className="text-gray-800">{fmt(detail.qty)}</div></div>
              <div>
                <div className="text-xs text-gray-400">已收数量 / 差异</div>
                <div className="text-gray-800">
                  {fmt(detail.received_qty)}
                  {Number(detail.diff_qty || 0) !== 0 && (
                    <span className={`ml-1 ${Number(detail.diff_qty) > 0 ? 'text-amber-600' : 'text-rose-500'}`}>{signed(detail.diff_qty)}</span>
                  )}
                </div>
              </div>
              <div><div className="text-xs text-gray-400">加工费合计</div><div className="text-gray-800">{format.currency(Number(detail.amount || 0))}</div></div>
              <div><div className="text-xs text-gray-400">单号</div><div className="text-gray-800">{detail.code || '-'}</div></div>
              <div><div className="text-xs text-gray-400">确认日期</div><div className="text-gray-800">{detail.confirm_date ? detail.confirm_date.slice(0, 10) : '-'}</div></div>
              <div><div className="text-xs text-gray-400">收货日期</div><div className="text-gray-800">{detail.receive_date ? detail.receive_date.slice(0, 10) : '-'}</div></div>
              <div><div className="text-xs text-gray-400">完成日期</div><div className="text-gray-800">{detail.complete_date ? detail.complete_date.slice(0, 10) : '-'}</div></div>
            </div>

            {isWithMaterial(detail) && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm bg-violet-50/60 rounded-lg p-3">
                  <div><div className="text-xs text-gray-500">实发材料</div><div className="text-gray-800 font-medium">{fmt(detail.material_issued_qty)} / {format.currency(Number(detail.material_issued_cost || 0))}</div></div>
                  <div><div className="text-xs text-gray-500">收货核销材料</div><div className="text-gray-800 font-medium text-amber-700">{fmt(detail.material_consumed_qty)} / {format.currency(Number(detail.material_consumed_cost || 0))}</div></div>
                  <div><div className="text-xs text-gray-500">退回材料</div><div className="text-gray-800 font-medium text-teal-700">{fmt(detail.material_returned_qty)} / {format.currency(Number(detail.material_returned_cost || 0))}</div></div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1.5">发料明细（应发 / 实发 / 核销 / 退回）</div>
                  <div className="overflow-x-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-sm min-w-max">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500">
                          <th className="px-3 py-2 text-left">材料</th>
                          <th className="px-3 py-2 text-right">应发</th>
                          <th className="px-3 py-2 text-right">实发</th>
                          <th className="px-3 py-2 text-right">核销</th>
                          <th className="px-3 py-2 text-right">退回</th>
                          <th className="px-3 py-2 text-right">发料成本</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {linesOf(detail).map((l) => (
                          <tr key={l.id}>
                            <td className="px-3 py-2">
                              <div className="text-gray-900">{l.product_name || '-'}</div>
                              {l.product_code && <div className="text-xs text-gray-400">{l.product_code}</div>}
                              <LineProductExt line={l} labels={productLabels} />
                            </td>
                            <td className="px-3 py-2 text-right text-gray-600">{fmt(l.qty)}</td>
                            <td className="px-3 py-2 text-right text-gray-900">{fmt(l.issued_qty)}</td>
                            <td className="px-3 py-2 text-right text-amber-600">{fmt(l.consumed_qty)}</td>
                            <td className="px-3 py-2 text-right text-teal-600">{fmt(l.returned_qty)}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{format.currency(Number(l.amount || 0))}</td>
                          </tr>
                        ))}
                        {linesOf(detail).length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">暂无材料行</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            {detail.diff_reason && (
              <div className="text-sm bg-amber-50 text-amber-700 rounded-lg px-3 py-2">
                数量差异原因：{detail.diff_reason}
              </div>
            )}

            {receiveLogsOf(detail).length > 0 && (
              <div>
                <div className="text-sm font-medium text-gray-700 mb-1.5">收货记录（分批 / 增重损耗留痕）</div>
                <div className="overflow-x-auto border border-gray-100 rounded-lg">
                  <table className="w-full text-sm min-w-max">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500">
                        <th className="px-3 py-2 text-center">批次</th>
                        <th className="px-3 py-2 text-right">本次实收</th>
                        <th className="px-3 py-2 text-right">累计差异</th>
                        <th className="px-3 py-2 text-right">入库单价</th>
                        <th className="px-3 py-2 text-left">日期</th>
                        <th className="px-3 py-2 text-left">原因 / 备注</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {receiveLogsOf(detail).map((lg, i) => (
                        <tr key={lg.id || i}>
                          <td className="px-3 py-2 text-center text-gray-500">{lg.seq ?? i + 1}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{fmt(lg.qty)}</td>
                          <td className={`px-3 py-2 text-right ${Number(lg.diff_qty || 0) > 0 ? 'text-amber-600' : Number(lg.diff_qty || 0) < 0 ? 'text-rose-500' : 'text-gray-400'}`}>
                            {signed(lg.diff_qty)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{format.currency(Number(lg.unit_cost || 0))}</td>
                          <td className="px-3 py-2 text-gray-500 text-xs">{lg.receive_date ? String(lg.receive_date).slice(0, 10) : '-'}</td>
                          <td className="px-3 py-2 text-gray-500 text-xs">{[lg.diff_reason, lg.remark].filter(Boolean).join(' · ') || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {detail.remark && (
              <div><div className="text-xs text-gray-400">备注</div><div className="text-gray-800">{detail.remark}</div></div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
