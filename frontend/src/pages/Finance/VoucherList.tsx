import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, Check, Send, X, Trash2 } from 'lucide-react';
import { voucherApi } from '@/api/finance';
import { Voucher } from '@/types/finance';
import { useAuthStore } from '@/store/auth';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
// [2026-09-18 权限细化·第1批] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import type { ReactNode } from 'react';
import { DateRangeFilter } from '@/components/DateRangeFilter';

// 筛选条件中文文案（空态 filterNote 用；选项值 → 显示名）
const VOUCHER_TYPE_LABEL: Record<string, string> = { general: '记账凭证', receipt: '收款凭证', payment: '付款凭证', transfer: '转账凭证', closing: '结转凭证', closing_reverse: '反结账冲回' };
const VOUCHER_STATUS_LABEL: Record<string, string> = { draft: '草稿', posted: '已过账', approved: '已审核', cancelled: '已作废' };

export function VoucherList() {
  const navigate = useNavigate();
  const currentUser = useAuthStore(s => s.user);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', type: '', status: '', start_date: '', end_date: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  // [2026-09-12] 日期区间筛选（U-02）：快捷区间 + 起止日期，条件写 URL（刷新/返回不丢）
  const [dateRange, setDateRange] = useState({ start_date: urlFilters.start_date, end_date: urlFilters.end_date });
  // [2026-09-13 审查修复] 类型/状态筛选并入 URL——此前是独立 state，刷新/分享后条件静默丢失
  const [typeFilter, setTypeFilter] = useState(urlFilters.type);
  const [statusFilter, setStatusFilter] = useState(urlFilters.status);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, type: typeFilter, status: statusFilter, start_date: dateRange.start_date, end_date: dateRange.end_date, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, typeFilter, statusFilter, dateRange.start_date, dateRange.end_date, pagination.page, pagination.page_size]);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchVouchers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.page_size, debouncedKeyword, typeFilter, statusFilter, dateRange.start_date, dateRange.end_date]);

  const fetchVouchers = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { voucher_no?: string; type?: string; status?: string; start_date?: string; end_date?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        voucher_no: debouncedKeyword || undefined,
        type: typeFilter || undefined,
        status: statusFilter || undefined,
        start_date: dateRange.start_date || undefined,
        end_date: dateRange.end_date || undefined,
      };
      const response = await voucherApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setVouchers(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch vouchers:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleApprove = async (id: string, voucherNo: string) => {
    if (!(await confirmAction({ title: `确定审核凭证 ${voucherNo} 吗？` }))) return;
    const approverId = currentUser?.id;
    if (!approverId) {
      message.error('无法获取当前用户，请重新登录后再试');
      return;
    }
    try {
      const response = await voucherApi.approve(id, approverId);
      if (response.code === 0) {
        message.success(`凭证 ${voucherNo} 已审核`);
        fetchVouchers();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to approve voucher:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handlePost = async (id: string, voucherNo: string) => {
    if (!(await confirmAction({ title: `确定过账凭证 ${voucherNo} 吗？` }))) return;
    try {
      const response = await voucherApi.post(id);
      if (response.code === 0) {
        message.success(`凭证 ${voucherNo} 已过账`);
        fetchVouchers();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to post voucher:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleCancel = async (id: string, voucherNo: string) => {
    if (!(await confirmAction({ title: `确定取消凭证 ${voucherNo} 吗？`, danger: true }))) return;
    try {
      const response = await voucherApi.cancel(id);
      if (response.code === 0) {
        message.success(`凭证 ${voucherNo} 已取消`);
        fetchVouchers();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to cancel voucher:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleDelete = async (id: string, voucherNo: string) => {
    if (!(await confirmAction({ title: `确定删除凭证 ${voucherNo} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await voucherApi.delete(id);
      if (response.code === 0) {
        message.success(`凭证 ${voucherNo} 已删除`);
        fetchVouchers();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete voucher:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Voucher) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  // [2026-09-13 U-05] 批量操作：勾选列（锁定首列）+ 批量过账/审核 + 导出选中
  // ⚠ 审核需要当前用户 id（逐条取同一审核人）——未登录/取不到时按钮禁用并提示
  // [2026-09-18 权限细化] 按钮级权限：过账/审核/取消=voucher_edit；删除=voucher_delete
  const { has } = usePermission();
  const sel = useRowSelection({ rows: vouchers, getKey: (d) => d.id! });
  const batch = useBatchAction({
    selection: sel,
    label: (d) => d.voucher_no || d.id!,
    onDone: fetchVouchers,
    actions: [
      {
        key: 'post',
        label: '批量过账',
        icon: <Send className="w-4 h-4" />,
        eligible: (d) => d.status === 'draft' && has('voucher_edit'),
        confirm: (rows) => ({ title: `过账选中的 ${rows.length} 张凭证？`, content: '过账后进入已过账（不可直接修改）；逐条校验借贷平衡，失败的会列出凭证号与原因' }),
        run: (d) => voucherApi.post(d.id!),
      },
      {
        key: 'approve',
        label: '批量审核',
        icon: <Check className="w-4 h-4" />,
        eligible: (d) => d.status === 'posted' && !!currentUser?.id && has('voucher_edit'),
        confirm: (rows) => ({ title: `审核选中的 ${rows.length} 张凭证？`, content: '审核后计入报表；失败的会列出凭证号与原因' }),
        run: (d) => voucherApi.approve(d.id!, currentUser?.id || ''),
      },
    ],
    exportSpec: {
      filename: `凭证_选中_${format.today()}.csv`,
      headers: ['凭证号', '凭证日期', '借方金额', '贷方金额', '分录数', '状态'],
      row: (d: any) => [d.voucher_no, format.date(d.voucher_date), Number(d.total_debit ?? 0).toFixed(2), Number(d.total_credit ?? 0).toFixed(2), String(d.edges?.entries?.length ?? d.entries?.length ?? 0), format.statusText(d.status)],
    },
  });
  const rowCols: RowCol[] = [
    {
      key: '__sel',
      header: (
        <input
          type="checkbox"
          className="w-4 h-4 accent-blue-600"
          checked={sel.state === 'all'}
          ref={(el) => { if (el) el.indeterminate = sel.state === 'some'; }}
          onChange={sel.toggleAll}
        />
      ),
      headCls: 'px-4 py-3 w-10',
      cellCls: 'px-4 py-4',
      cell: (item) => (
        <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={sel.isSelected(item)} onChange={() => sel.toggle(item)} />
      ),
    },
    { key: 'voucher_no', header: '凭证号', cell: (item) => <span className="font-medium text-gray-900">{item.voucher_no}</span> },
    { key: 'voucher_date', header: '凭证日期', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.voucher_date)}</span> },
    { key: 'total_debit', header: '借方金额', cell: (item) => <span className="font-medium text-blue-600">¥{format.currency(item.total_debit)}</span> },
    { key: 'total_credit', header: '贷方金额', cell: (item) => <span className="font-medium text-green-600">¥{format.currency(item.total_credit)}</span> },
    { key: 'entries', header: '分录数', cell: (item) => <span className="text-gray-500 text-sm">{item.edges?.entries?.length ?? item.entries?.length ?? 0}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(item.status)}`}>{format.statusText(item.status)}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (item) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）；过账/取消/删除的确认在各 handler 内
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/finance/vouchers/${item.id}`) },
            ...(item.status === 'draft'
              ? [
                  ...(has('voucher_edit')
                    ? [
                        { key: 'post', label: '过账', icon: <Send className="w-4 h-4" />, onClick: () => handlePost(item.id, item.voucher_no) },
                        { key: 'cancel', label: '取消', icon: <X className="w-4 h-4" />, onClick: () => handleCancel(item.id, item.voucher_no) },
                      ]
                    : []),
                  ...(has('voucher_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.voucher_no) }]
                    : []),
                ]
              : []),
            ...(item.status === 'posted' && has('voucher_edit')
              ? [
                  { key: 'approve', label: '审核', icon: <Check className="w-4 h-4" />, onClick: () => handleApprove(item.id, item.voucher_no) },
                  { key: 'cancel', label: '取消', icon: <X className="w-4 h-4" />, onClick: () => handleCancel(item.id, item.voucher_no) },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'voucher-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="凭证管理"
        subtitle="记账凭证列表"
        extra={
          has('voucher_create') && (
            <button onClick={() => navigate('/finance/vouchers/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增凭证</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索凭证号..."
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="form-input pl-10"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-select md:w-40"
            >
              <option value="">全部类型</option>
              <option value="general">记账凭证</option>
              <option value="receipt">收款凭证</option>
              <option value="payment">付款凭证</option>
              <option value="transfer">转账凭证</option>
              <option value="closing">结转凭证</option>
              <option value="closing_reverse">反结账冲回</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-select md:w-40"
            >
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="posted">已过账</option>
              <option value="approved">已审核</option>
              <option value="cancelled">已取消</option>
            </select>
            <div className="ml-auto flex items-center">{viewMenu}</div>          </div>
          {/* [2026-09-12] 日期区间筛选（U-02）：快捷区间（本月/上月/本年）+ 起止日期，条件写 URL */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPagination(prev => ({ ...prev, page: 1 })); }} />
          </div>
        </div>

        {batch.failureModal}
        {sel.count > 0 && <div className="px-4 pb-3">{batch.bar}</div>}

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
              ) : vouchers.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6">
                  <ListEmpty
                    keyword={keyword}
                    filterNote={[
                      typeFilter ? `类型「${VOUCHER_TYPE_LABEL[typeFilter] || typeFilter}」` : '',
                      statusFilter ? `状态「${VOUCHER_STATUS_LABEL[statusFilter] || statusFilter}」` : '',
                      dateRange.start_date || dateRange.end_date ? `日期 ${dateRange.start_date || '不限'} ~ ${dateRange.end_date || '不限'}` : '',
                    ].filter(Boolean).join(' + ')}
                    onClear={() => { setKeyword(''); setTypeFilter(''); setStatusFilter(''); setDateRange({ start_date: '', end_date: '' }); setPagination(prev => ({ ...prev, page: 1 })); }}
                    title="暂无凭证数据"
                  />
                </td></tr>
              ) : (
                vouchers.map((item) => (
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

        {!loading && vouchers.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        )}
      </div>
    </div>
  );
}
