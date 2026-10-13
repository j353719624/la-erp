import { useState, useEffect } from 'react';
import { Plus, Search, Eye, Send, CheckCircle2, XCircle, Timer, Trash2, FileOutput, RefreshCw, Pencil, Printer, LayoutGrid } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { quotationApi } from '@/api/order';
import { productApi } from '@/api/product';
import { customerApi } from '@/api/order';
import { format } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PaginationParams } from '@/types';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { usePermission } from '@/hooks/usePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { loadOptions } from '@/utils/loadOptions';
import type { ReactNode } from 'react';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { mergeAddsIntoLines } from '@/utils/docLines';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

const STATUS_TEXT: Record<string, string> = {
  draft: '草稿', sent: '已发送', accepted: '客户已接受',
  converted: '已转订单', rejected: '已拒绝', expired: '已过期',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500',
  sent: 'bg-blue-50 text-blue-600',
  accepted: 'bg-green-50 text-green-600',
  converted: 'bg-purple-50 text-purple-600',
  rejected: 'bg-red-50 text-red-600',
  expired: 'bg-gray-100 text-gray-500',
};

interface QuoteLine {
  product_id: string;
  product_name: string;
  product_code: string;
  qty: number;
  price: number;
  discount: number;
  tax_rate: number;
  /** [2026-09-16] 商品自定义字段（行内「商品信息」小字展示；随行带出，不参与提交语义） */
  ext_fields?: Record<string, unknown>;
}

interface Quotation {
  id: string;
  quotation_no: string;
  customer_id?: string;
  customer_name?: string;
  quotation_date: string;
  valid_until?: string;
  total_amount: number;
  tax_amount: number;
  status: string;
  remark?: string;
  edges?: { lines?: (QuoteLine & { product?: any })[] };
}

export function SalesQuotationList() {
  const navigate = useNavigate();
  // [2026-09-18 权限细化·第3批] 报价单独立四件套（报价/退货/合同/佣金不再共用销售订单码）
  const { has } = usePermission();
  const [list, setList] = useState<Quotation[]>([]);
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
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Quotation | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  // [2026-09-16] 商品自定义字段中文名（行内「商品信息」小字展示用）
  const productLabels = useProductFieldLabels();
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState({
    customer_id: '',
    customer_name: '',
    quotation_date: format.today(),
    valid_until: '',
    remark: '',
    lines: [] as QuoteLine[],
  });
  // W-01：扫码快录输入框 + 「按规格批量添加」弹窗（弹窗内建流程与其它单据一致）
  const [scanValue, setScanValue] = useState('');
  const [specPickerOpen, setSpecPickerOpen] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { status?: string; quotation_no?: string } = {
        page: pagination.page, page_size: pagination.page_size,
        status: status || undefined, quotation_no: debouncedKeyword || undefined,
      };
      const res = await quotationApi.list(params);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch { /* 静默 */ } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [p, c] = await loadOptions([
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        customerApi.list({ page: 1, page_size: 1000 }),
      ], '销售报价');
      if (p?.code === 0) setProducts(p.data?.list ?? []);
      if (c?.code === 0) setCustomers(c.data?.list ?? []);
    } catch { /* 静默 */ }
  };

  useEffect(() => { fetchList(); }, [pagination.page, pagination.page_size, debouncedKeyword, status]);
  useEffect(() => { fetchOptions(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({
      customer_id: '', customer_name: '', quotation_date: format.today(),
      valid_until: '', remark: '', lines: [],
    });
    setModalOpen(true);
  };

  const openEdit = async (q: Quotation) => {
    const res = await quotationApi.get(q.id);
    const data = (res.code === 0 ? res.data : q) as any;
    const lineList: QuoteLine[] = (data?.edges?.lines || data?.lines || []).map((l: any) => ({
      product_id: l.product_id,
      product_name: l.product_name || l.edges?.product?.name || '',
      product_code: l.product_code || l.edges?.product?.code || '',
      qty: Number(l.qty) || 0,
      price: Number(l.price) || 0,
      discount: Number(l.discount) || 0,
      tax_rate: Number(l.tax_rate) || 0,
      // [2026-09-16] 编辑回填时带出商品自定义字段（行内「商品信息」小字）
      ext_fields: l.edges?.product?.ext_fields,
    }));
    setEditing(q);
    setForm({
      customer_id: data.customer_id || q.customer_id || '',
      customer_name: data.customer_name || q.customer_name || '',
      quotation_date: (data.quotation_date || q.quotation_date || '').slice(0, 10),
      valid_until: (data.valid_until || q.valid_until || '').slice(0, 10),
      remark: data.remark || q.remark || '',
      lines: lineList,
    });
    setModalOpen(true);
  };

  const addLine = () => {
    setForm(prev => ({ ...prev, lines: [...prev.lines, { product_id: '', product_name: '', product_code: '', qty: 1, price: 0, discount: 0, tax_rate: 0 }] }));
  };

  const updateLine = (idx: number, field: string, value: any) => {
    const lines = [...form.lines];
    if (field === 'product_id') {
      const prod = products.find(p => p.id === value);
      lines[idx] = { ...lines[idx], product_id: value, product_name: prod?.name || '', product_code: prod?.code || '', price: prod?.sale_price || 0, ext_fields: prod?.ext_fields };
    } else {
      lines[idx] = { ...lines[idx], [field]: value };
    }
    setForm(prev => ({ ...prev, lines }));
  };

  const removeLine = (idx: number) => {
    setForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }));
  };

  // W-01：批量添加（规格矩阵 / 扫码共用）——同商品已在明细则数量累加（本单数量字段是 qty）
  const handleBatchAdd = (adds: SpecBatchItem[]) => {
    if (!adds.length) return;
    const productOf = new Map(adds.map((a) => [a.product.id, a.product]));
    const { lines, merged } = mergeAddsIntoLines(
      form.lines,
      adds.map((a) => ({ productId: a.product.id, qty: a.qty })),
      (add) => {
        const p = productOf.get(add.productId)!;
        return {
          product_id: p.id,
          product_name: p.name,
          product_code: p.code,
          qty: add.qty,
          price: Number(p.sale_price) || 0,
          discount: 0,
          tax_rate: 0,
          // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字）
          ext_fields: p.ext_fields,
        };
      },
      (line, addQty) => ({ ...line, qty: (Number(line.qty) || 0) + addQty }),
    );
    setForm((prev) => ({ ...prev, lines }));
    message.success(`已添加 ${adds.length} 个商品${merged ? `，其中 ${merged} 个累加到已有明细行` : ''}`);
  };

  // W-01：扫码/输码快速添加——条码/编码精确优先；连续扫同一商品自动累加数量
  const handleScanDetect = async (code: string) => {
    const raw = code.trim();
    setScanValue('');
    if (!raw) return;
    let match = matchProductByScan(products, raw);
    if (!match.hit && match.count === 0) {
      // 本地列表（1000 上限）未命中：按关键词回源查一次，支持大目录扫码
      try {
        const res = await productApi.list({ page: 1, page_size: 20, keyword: raw, status: 'active' });
        if (res.code === 0) match = matchProductByScan(res.data?.list || [], raw);
      } catch {
        /* 回源失败按未找到提示 */
      }
    }
    if (!match.hit) {
      message.warning(match.count > 1 ? `「${raw}」匹配到 ${match.count} 个商品，请扫条码或用编码精确录入` : `未找到商品：${raw}`);
      return;
    }
    handleBatchAdd([{ product: match.hit, qty: 1 }]);
  };

  const handleSave = async () => {
    if (!form.customer_id) { message.warning('请选择客户'); return; }
    if (form.lines.length === 0 || !form.lines.some(l => l.product_id)) { message.warning('请至少添加一行有效明细'); return; }
    setSaving(true);
    try {
      const payload = {
        customer_id: form.customer_id,
        customer_name: form.customer_name,
        quotation_date: form.quotation_date,
        valid_until: form.valid_until || undefined,
        remark: form.remark,
        lines: form.lines.map(l => ({
          product_id: l.product_id, product_name: l.product_name, product_code: l.product_code,
          qty: Number(l.qty) || 0, price: Number(l.price) || 0, discount: Number(l.discount) || 0, tax_rate: Number(l.tax_rate) || 0,
        })),
      };
      const res = editing
        ? await quotationApi.update(editing.id, payload)
        : await quotationApi.create(payload);
      if (res.code === 0) {
        message.success(editing ? '报价单已更新' : `报价单 ${res.data?.quotation_no} 已创建`);
        setModalOpen(false);
        setEditing(null);
        fetchList();
      } else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败，请稍后重试'); } finally { setSaving(false); }
  };

  const handleView = async (q: Quotation) => {
    setDetailOpen(true);
    const res = await quotationApi.get(q.id);
    if (res.code === 0) setDetail(res.data);
  };

  const handleAction = async (q: Quotation, action: 'send' | 'accept' | 'reject' | 'expire' | 'delete' | 'convert') => {
    const labels: Record<string, string> = { send: '发送', accept: '确认接受', reject: '拒绝', expire: '标记过期', delete: '删除', convert: '转销售订单' };
    if (!(await confirmAction({
      title: `确定${labels[action]}报价单 ${q.quotation_no} 吗？`,
      content: action === 'convert' ? '将按报价明细生成一张草稿销售订单' : undefined,
      danger: action === 'delete' || action === 'reject',
    }))) return;
    try {
      let res: any;
      switch (action) {
        case 'send': res = await quotationApi.send(q.id); break;
        case 'accept': res = await quotationApi.accept(q.id); break;
        case 'reject': res = await quotationApi.reject(q.id); break;
        case 'expire': res = await quotationApi.expire(q.id); break;
        case 'delete': res = await quotationApi.delete(q.id); break;
        case 'convert': res = await quotationApi.convert(q.id); break;
      }
      if (res.code === 0) {
        if (action === 'convert') message.success(`已生成销售订单 ${res.data?.order_no}`);
        else message.success('操作成功');
        fetchList();
      } else message.error(res.message || '操作失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试'); }
  };

  const lines = detail?.edges?.lines ?? [];
  const totalAmount = form.lines.reduce((s, l) => s + (l.qty || 0) * (l.price || 0) * (1 - (l.discount || 0) / 100) * (1 + (l.tax_rate || 0) / 100), 0);

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Quotation) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'quotation_no', header: '报价单号', cell: (q) => <span className="font-medium text-gray-900">{q.quotation_no}</span> },
    { key: 'customer_name', header: '客户', cell: (q) => <span className="text-gray-600">{q.customer_name || (q as any).edges?.customer?.name || '-'}</span> },
    { key: 'quotation_date', header: '报价日期', cell: (q) => <span className="text-gray-600">{format.date(q.quotation_date)}</span> },
    { key: 'valid_until', header: '有效期至', cell: (q) => <span className="text-gray-600">{q.valid_until ? format.date(q.valid_until) : '-'}</span> },
    { key: 'total_amount', header: '金额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (q) => <span className="text-gray-900">¥{format.currency(q.total_amount)}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (q) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[q.status] || 'bg-gray-100 text-gray-500'}`}>
          {STATUS_TEXT[q.status] || q.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (q) => (
        // [易用性] 行操作统一折叠（销售报价按钮较多，横屏下主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'print', label: '打印报价单', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/sales_quotation/${q.id}`) },
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => handleView(q) },
            ...(q.status === 'draft' && has('sales_quotation_edit')
              ? [
                  { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(q) },
                  { key: 'send', label: '发送给客户', icon: <Send className="w-4 h-4" />, onClick: () => handleAction(q, 'send') },
                  { key: 'expire', label: '标记过期', icon: <Timer className="w-4 h-4" />, onClick: () => handleAction(q, 'expire') },
                ]
              : []),
            ...(q.status === 'sent' && has('sales_quotation_edit')
              ? [
                  { key: 'accept', label: '客户接受', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => handleAction(q, 'accept') },
                  { key: 'reject', label: '客户拒绝', icon: <XCircle className="w-4 h-4" />, danger: true, onClick: () => handleAction(q, 'reject') },
                ]
              : []),
            ...(q.status === 'accepted' && has('sales_order_create')
              ? [{ key: 'convert', label: '转销售订单', icon: <FileOutput className="w-4 h-4" />, onClick: () => handleAction(q, 'convert') }]
              : []),
            ...((q.status === 'draft' || q.status === 'rejected' || q.status === 'expired') && has('sales_quotation_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleAction(q, 'delete') }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'sales-quotation-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="销售报价"
        subtitle="销售流程入口：报价 → 客户确认 → 转销售订单"
        extra={
          has('sales_quotation_create') && (
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建报价</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" placeholder="搜索报价单号..." value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-select md:w-44">
            <option value="">全部状态</option>
            {Object.entries(STATUS_TEXT).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
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
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无报价单" description="点击右上角「新建报价」创建报价" /></td></tr>
              ) : list.map(q => (
                <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                  {visibleColumns.map((c) => (
                    <td key={c.key} className={c.cellCls || TD}>
                      {c.cell(q)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        </div>
      </div>

      {/* 新建报价 */}
      <Modal title={editing ? '编辑销售报价' : '新建销售报价'} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} width={760}>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">客户 *</label>
              <SearchSelect
                required
                value={form.customer_id}
                onChange={(v) => {
                  const c = customers.find(x => x.id === v);
                  setForm(prev => ({ ...prev, customer_id: v ?? '', customer_name: c?.name || '' }));
                }}
                placeholder="请选择客户"
                options={customers.map(c => ({ value: c.id, label: c.name }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">报价日期</label>
              <input type="date" value={form.quotation_date} onChange={(e) => setForm(prev => ({ ...prev, quotation_date: e.target.value }))} className="form-input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">有效期至</label>
              <input type="date" value={form.valid_until} onChange={(e) => setForm(prev => ({ ...prev, valid_until: e.target.value }))} className="form-input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
              <input type="text" value={form.remark} onChange={(e) => setForm(prev => ({ ...prev, remark: e.target.value }))} className="form-input" />
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm text-gray-700 whitespace-nowrap">报价明细</h3>
              <div className="w-full sm:max-w-[220px]">
                <BarcodeInput
                  value={scanValue}
                  onChange={setScanValue}
                  onDetect={handleScanDetect}
                  placeholder="扫码/输码快速添加：条码 / 编码，回车"
                />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSpecPickerOpen(true)}
                  className="btn-secondary text-xs flex items-center gap-1"
                  title="多规格商品：选款后在「颜色×尺码」网格里直接填数量，一次生成多条明细"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />按规格批量添加
                </button>
                <button type="button" onClick={addLine} className="btn-secondary text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" />添加</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">商品</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">数量</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">单价</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">折扣%</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">税率%</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {form.lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">
                        <SearchSelect
                          value={l.product_id}
                          onChange={(v) => updateLine(idx, 'product_id', v ?? '')}
                          placeholder="请选择商品"
                          options={[
                            // 编辑态保留已删除/不在列表中的商品（原样展示，不可再改选别的值）
                            ...(!products.some((p) => p.id === l.product_id) && l.product_id
                              ? [{ value: l.product_id, label: `${l.product_code} - ${l.product_name || '已删除商品'}` }]
                              : []),
                            ...productSelectGroups(products),
                          ]}
                        />
                        <LineProductExt line={l} labels={productLabels} />
                      </td>
                      <td className="px-3 py-2 text-right"><input type="text" inputMode="decimal" value={l.qty ?? ''} onChange={(e) => updateLine(idx, 'qty', e.target.value)} className="form-input text-right w-20" /></td>
                      <td className="px-3 py-2 text-right"><input type="text" inputMode="decimal" value={l.price ?? ''} onChange={(e) => updateLine(idx, 'price', e.target.value)} className="form-input text-right w-24" /></td>
                      <td className="px-3 py-2 text-right"><input type="text" inputMode="decimal" value={l.discount ?? ''} onChange={(e) => updateLine(idx, 'discount', e.target.value)} className="form-input text-right w-20" /></td>
                      <td className="px-3 py-2 text-right"><input type="text" inputMode="decimal" value={l.tax_rate ?? ''} onChange={(e) => updateLine(idx, 'tax_rate', e.target.value)} className="form-input text-right w-20" /></td>
                      <td className="px-3 py-2 text-right"><button type="button" onClick={() => removeLine(idx)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-right text-sm text-gray-600">报价金额（含税）：<span className="font-medium text-gray-900">¥{format.currency(totalAmount)}</span></div>
          <button onClick={handleSave} disabled={saving} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {saving ? '保存中...' : '保存报价'}
          </button>
        </div>
      </Modal>

      {/* W-01：多规格商品按款矩阵批量录入（销售报价：单价取商品售价） */}
      <MultiSpecPickerModal
        open={specPickerOpen}
        onClose={() => setSpecPickerOpen(false)}
        products={products}
        existingProductIds={form.lines.map((l) => l.product_id).filter(Boolean)}
        onConfirm={(items) => {
          handleBatchAdd(items);
          setSpecPickerOpen(false);
        }}
      />

      {/* 详情 */}
      <Modal title={detail ? `销售报价 ${detail.quotation_no}` : '详情'} open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={680}>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="p-3 bg-gray-50 rounded-lg"><div className="text-xs text-gray-500">客户</div><div className="font-medium">{detail?.customer_name || (detail as any)?.edges?.customer?.name || '-'}</div></div>
            <div className="p-3 bg-gray-50 rounded-lg"><div className="text-xs text-gray-500">报价日期</div><div className="font-medium">{detail ? format.date(detail.quotation_date) : '-'}</div></div>
            <div className="p-3 bg-gray-50 rounded-lg"><div className="text-xs text-gray-500">有效期至</div><div className="font-medium">{detail?.valid_until ? format.date(detail.valid_until) : '-'}</div></div>
            <div className="p-3 bg-gray-50 rounded-lg"><div className="text-xs text-gray-500">状态</div><div className="font-medium">{detail ? (STATUS_TEXT[detail.status] || detail.status) : '-'}</div></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">商品</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">数量</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">单价</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">折扣%</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">税率%</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">金额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">无明细</td></tr> : lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2"><div className="font-medium text-gray-900 text-sm">{l.product_name}</div><div className="text-xs text-gray-400">{l.product_code}</div><LineProductExt line={l} labels={productLabels} /></td>
                    <td className="px-3 py-2 text-right text-sm">{format.qty(l.qty)}</td>
                    <td className="px-3 py-2 text-right text-sm">¥{format.currency(l.price)}</td>
                    <td className="px-3 py-2 text-right text-sm">{l.discount}%</td>
                    <td className="px-3 py-2 text-right text-sm">{l.tax_rate}%</td>
                    <td className="px-3 py-2 text-right text-sm font-medium">¥{format.currency((l.qty || 0) * (l.price || 0) * (1 - (l.discount || 0) / 100) * (1 + (l.tax_rate || 0) / 100))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail?.remark && <div className="text-sm text-gray-600">备注：{detail.remark}</div>}
        </div>
      </Modal>
    </div>
  );
}
