import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, Trash2, FileText, Printer, Ban } from 'lucide-react';
import { payableApi } from '@/api/finance';
import { APInvoice } from '@/types/finance';
import { format, toLocalDateISO } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PaginationParams } from '@/types';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { DateRangeFilter } from '@/components/DateRangeFilter';
export function PayableList() {
  const navigate = useNavigate();
  // [2026-09-18 权限细化] 新增=payable_create；登记/作废=payable_edit；删除=payable_delete
  const { has } = usePermission();
  const [invoices, setInvoices] = useState<APInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', start_date: '', end_date: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  // [2026-09-12] 日期区间筛选（U-02）：快捷区间 + 起止日期，条件写 URL
  const [dateRange, setDateRange] = useState({ start_date: urlFilters.start_date, end_date: urlFilters.end_date });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, start_date: dateRange.start_date, end_date: dateRange.end_date, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);

  // 开票弹窗
  const [issueTarget, setIssueTarget] = useState<APInvoice | null>(null);
  // 金额/税率输入以字符串保留小数中间态（type=text inputMode=decimal），提交前 Number() 化
  const [issueForm, setIssueForm] = useState({
    purchase_invoice_no: '', invoice_date: '',
    tax_rate: 0 as number | string, tax_amount: 0 as number | string, status: 'invoiced',
  });
  const [issuing, setIssuing] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchInvoices();
  }, [pagination.page, pagination.page_size, debouncedKeyword, dateRange.start_date, dateRange.end_date]);

  const fetchInvoices = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      // [2026-09-12] 日期区间（U-02）走后端筛选（end_date 含当天整天）
      const params: PaginationParams = {
        page: pagination.page,
        page_size: pagination.page_size,
        start_date: dateRange.start_date || undefined,
        end_date: dateRange.end_date || undefined,
      };
      const response = await payableApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        // 后端返回数组（无分页）；兼容分页结构
        const list = Array.isArray(response.data) ? response.data : response.data?.list || [];
        setInvoices(list);
        setPagination(prev => ({ ...prev, total: list.length }));
      }
    } catch (err) {
      console.error('Failed to fetch payables:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  // 后端不支持 keyword，前端客户端过滤（供应商名称/单据号）
  const filteredInvoices = keyword
    ? invoices.filter(i =>
        (i.supplier_name || (i as any).edges?.supplier?.name || '').toLowerCase().includes(keyword.toLowerCase()) ||
        (i.invoice_no || '').toLowerCase().includes(keyword.toLowerCase()))
    : invoices;
  const displayTotal = filteredInvoices.length;
  const pageItems = filteredInvoices.slice((pagination.page - 1) * pagination.page_size, pagination.page * pagination.page_size);

  const handleDelete = async (id: string, invoiceNo: string) => {
    if (!(await confirmAction({ title: `确定删除应付单 ${invoiceNo} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await payableApi.delete(id);
      if (response.code === 0) {
        message.success(`应付单 ${invoiceNo} 已删除`);
        fetchInvoices();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete payable:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const openIssue = (item: APInvoice) => {
    setIssueTarget(item);
    setIssueForm({
      purchase_invoice_no: item.purchase_invoice_no || '',
      invoice_date: (item.invoiced_at || '').slice(0, 10) || format.today(),
      tax_rate: Number(item.tax_rate) || 0,
      tax_amount: Number(item.tax_amount) || 0,
      status: item.invoice_status === 'partial' ? 'partial' : 'invoiced',
    });
  };

  const submitIssue = async () => {
    if (!issueTarget) return;
    if (!issueForm.purchase_invoice_no.trim()) { message.warning('请填写发票号'); return; }
    setIssuing(true);
    try {
      const res = await payableApi.issue(issueTarget.id, {
        purchase_invoice_no: issueForm.purchase_invoice_no.trim(),
        invoice_date: toLocalDateISO(issueForm.invoice_date),
        tax_rate: Number(issueForm.tax_rate) || 0,
        tax_amount: Number(issueForm.tax_amount) || 0,
        status: issueForm.status || 'invoiced',
      });
      if (res.code === 0) {
        message.success(`应付单 ${issueTarget.invoice_no} 进项发票登记成功`);
        setIssueTarget(null);
        fetchInvoices();
      } else {
        message.error(res.message || '登记失败');
      }
    } catch (err) {
message.error(err instanceof Error && err.message ? err.message : '登记失败，请稍后重试');
    } finally {
      setIssuing(false);
    }
  };

  const handleVoid = async (item: APInvoice) => {
    if (!(await confirmAction({ title: `确定作废 ${item.invoice_no} 的进项发票吗？`, content: '作废后该单据可重新开票登记', danger: true }))) return;
    try {
      const res = await payableApi.issue(item.id, {
        purchase_invoice_no: item.purchase_invoice_no || '',
        status: 'void',
      });
      if (res.code === 0) {
        message.success('发票已作废');
        fetchInvoices();
      } else {
        message.error(res.message || '作废失败');
      }
    } catch (err) {
message.error(err instanceof Error && err.message ? err.message : '作废失败，请稍后重试');
    }
  };

  const invoiceStatusBadge = (s?: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      uninvoiced: { text: '未开票', cls: 'bg-gray-100 text-gray-600' },
      issued: { text: '已开票', cls: 'bg-green-50 text-green-600' },
      invoiced: { text: '已开票', cls: 'bg-green-50 text-green-600' },
      partial: { text: '部分开票', cls: 'bg-yellow-50 text-yellow-700' },
      void: { text: '已作废', cls: 'bg-red-50 text-red-600' },
    };
    const m = map[s || 'uninvoiced'] || { text: s || '', cls: 'bg-gray-100 text-gray-600' };
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${m.cls}`}>{m.text}</span>;
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: APInvoice) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'invoice_no', header: '单据号', cell: (item) => <span className="font-medium text-gray-900">{item.invoice_no}</span> },
    { key: 'supplier_name', header: '供应商', cell: (item) => <span className="text-gray-900">{item.supplier_name || (item as any).edges?.supplier?.name || '-'}</span> },
    { key: 'invoice_date', header: '单据日期', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.invoice_date)}</span> },
    { key: 'due_date', header: '到期日期', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.due_date)}</span> },
    { key: 'total_amount', header: '总金额', cell: (item) => <span className="font-medium text-gray-900">¥{format.currency(item.total_amount)}</span> },
    { key: 'paid_amount', header: '已付金额', cell: (item) => <span className="text-gray-500 text-sm">¥{format.currency(item.paid_amount)}</span> },
    { key: 'unpaid_amount', header: '未付金额', cell: (item) => <span className="font-medium text-orange-600">¥{format.currency(item.total_amount - item.paid_amount)}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(item.status)}`}>{format.statusText(item.status)}</span>
      ),
    },
    {
      key: 'invoice',
      header: '发票',
      cell: (item) => (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-700">{item.purchase_invoice_no || '-'}</span>
          {invoiceStatusBadge(item.invoice_status)}
          {item.tax_amount ? <span className="text-xs text-gray-400">税额 ¥{format.currency(item.tax_amount)}</span> : null}
        </div>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (item) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/finance/payables/${item.id}`) },
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/ap_invoice/${item.id}`) },
            ...(item.invoice_status !== 'void' && has('payable_edit')
              ? [{ key: 'issue', label: '进项发票登记', icon: <FileText className="w-4 h-4" />, onClick: () => openIssue(item) }]
              : []),
            ...((item.invoice_status === 'invoiced' || item.invoice_status === 'partial') && has('payable_edit')
              ? [{ key: 'void', label: '作废发票', icon: <Ban className="w-4 h-4" />, danger: true, onClick: () => handleVoid(item) }]
              : []),
            ...(item.status === 'draft' && has('payable_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.invoice_no) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'payable-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="应付管理"
        subtitle="应付单列表"
        extra={
          has('payable_create') && (
            <button onClick={() => navigate('/finance/payables/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增应付单</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索供应商名称或单据号..."
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="form-input pl-10"
              />
            </div>
            <div className="ml-auto">{viewMenu}</div>
          </div>
          {/* [2026-09-12] 日期区间筛选（U-02）：快捷区间（本月/上月/本年）+ 起止日期，条件写 URL */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPagination(prev => ({ ...prev, page: 1 })); }} />
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
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无应付单数据" /></td></tr>
              ) : (
                pageItems.map((item) => (
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

        {!loading && invoices.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={displayTotal}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        )}
      </div>

      {/* 进项发票登记弹窗 */}
      <Modal
        title={issueTarget ? `进项发票登记 - ${issueTarget.invoice_no}` : '进项发票登记'}
        open={!!issueTarget}
        onCancel={() => setIssueTarget(null)}
        footer={null}
        width={480}
      >
        <div className="space-y-4 pt-4">
          {issueTarget && (
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="text-gray-600">供应商：<span className="text-gray-900 font-medium">{issueTarget.supplier_name || (issueTarget as any).edges?.supplier?.name || '-'}</span></p>
              <p className="text-gray-600 mt-1">应付金额：<span className="text-gray-900 font-medium">¥{format.currency(issueTarget.total_amount)}</span>　未付：<span className="text-orange-600 font-medium">¥{format.currency(issueTarget.total_amount - issueTarget.paid_amount)}</span></p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">进项发票号 *</label>
            <input type="text" value={issueForm.purchase_invoice_no} onChange={e => setIssueForm(prev => ({ ...prev, purchase_invoice_no: e.target.value }))} className="form-input" placeholder="请输入供应商发票号码"  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">开票日期</label>
              <input type="date" value={issueForm.invoice_date} onChange={e => setIssueForm(prev => ({ ...prev, invoice_date: e.target.value }))} className="form-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">税率（%）</label>
              <input type="text" inputMode="decimal" value={issueForm.tax_rate ?? ''} onChange={e => setIssueForm(prev => ({ ...prev, tax_rate: e.target.value }))} className="form-input" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">进项税额</label>
            <input type="text" inputMode="decimal" value={issueForm.tax_amount ?? ''} onChange={e => setIssueForm(prev => ({ ...prev, tax_amount: e.target.value }))} className="form-input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">发票状态</label>
            <select value={issueForm.status || 'invoiced'} onChange={e => setIssueForm(prev => ({ ...prev, status: e.target.value }))} className="form-select">
              <option value="invoiced">已开票</option>
              <option value="partial">部分开票</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setIssueTarget(null)} className="btn-secondary">取消</button>
            <button onClick={submitIssue} disabled={issuing} className="btn-primary">{issuing ? '提交中...' : '确认登记'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
