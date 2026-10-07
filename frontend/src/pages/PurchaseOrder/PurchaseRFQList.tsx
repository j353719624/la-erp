import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, CheckCircle2, X, RefreshCw, Trash2 } from 'lucide-react';
import { rfqApi } from '@/api/order';
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
import { usePermission } from '@/hooks/usePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
const STATUS_TEXT: Record<string, string> = {
  draft: '草稿', confirmed: '已确认', converted: '已转订单', cancelled: '已取消',
};

export function PurchaseRFQList() {
  // [2026-09-18 权限细化·第3批] 询价单独立四件套（转订单仍需采购订单-新增）
  const { has } = usePermission();
  const navigate = useNavigate();
  const [rfqs, setRfqs] = useState<any[]>([]);
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
  const [detail, setDetail] = useState<any>(null);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchList();
  }, [pagination.page, pagination.page_size, debouncedKeyword]);

  const fetchList = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { rfq_no?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        rfq_no: debouncedKeyword || undefined,
      };
      const response = await rfqApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setRfqs(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch rfqs:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const doAction = async (fn: (id: string) => Promise<any>, id: string, title: string, successMsg: string, danger = false) => {
    if (!(await confirmAction({ title, danger }))) return;
    try {
      const response = await fn(id);
      if (response.code === 0) {
        message.success(successMsg);
        fetchList();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err: any) {
      console.error('RFQ action failed:', err);
      message.error(err?.message || '操作失败，请稍后重试');
    }
  };

  const openDetail = async (id: string) => {
    try {
      const response = await rfqApi.get(id);
      if (response.code === 0) setDetail(response.data);
    } catch (err) {
      console.error('Failed to fetch rfq detail:', err);
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: any) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'rfq_no', header: '询价单号', cell: (rfq) => <span className="text-sm font-medium text-gray-900">{rfq.rfq_no}</span> },
    { key: 'supplier_name', header: '供应商', cell: (rfq) => <span className="text-sm text-gray-600">{rfq.supplier_name || rfq.edges?.supplier?.name || '-'}</span> },
    { key: 'rfq_date', header: '询价日期', cell: (rfq) => <span className="text-sm text-gray-600">{rfq.rfq_date ? format.date(rfq.rfq_date) : '-'}</span> },
    { key: 'lines', header: '行数', headCls: TH_R, cellCls: `${TD} text-right`, cell: (rfq) => <span className="text-sm text-gray-600">{(rfq.edges?.lines || rfq.lines || []).length}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (rfq) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${
          rfq.status === 'converted' ? 'bg-green-100 text-green-600'
          : rfq.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
          : rfq.status === 'confirmed' ? 'bg-blue-100 text-blue-600'
          : 'bg-orange-100 text-orange-600'}`}>
          {STATUS_TEXT[rfq.status] || rfq.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (rfq) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）；确认文案仍在 doAction 内
        <RowActions
          actions={[
            { key: 'detail', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => openDetail(rfq.id) },
            ...(rfq.status === 'draft' && has('purchase_rfq_edit')
              ? [
                  { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/purchase-rfqs/${rfq.id}`) },
                  { key: 'confirm', label: '确认', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => doAction(rfqApi.confirm, rfq.id, `确定确认询价单 ${rfq.rfq_no} 吗？`, '询价单已确认') },
                  { key: 'cancel', label: '取消', icon: <X className="w-4 h-4" />, onClick: () => doAction(rfqApi.cancel, rfq.id, `确定取消询价单 ${rfq.rfq_no} 吗？`, '询价单已取消', true) },
                ]
              : []),
            ...(rfq.status === 'draft' && has('purchase_rfq_delete')
              ? [
                  { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => doAction(rfqApi.delete, rfq.id, `确定删除询价单 ${rfq.rfq_no} 吗？`, '询价单已删除', true) },
                ]
              : []),
            ...(rfq.status === 'confirmed' && has('purchase_order_create')
              ? [{ key: 'convert', label: '转采购订单', icon: <RefreshCw className="w-4 h-4" />, onClick: () => doAction(rfqApi.convert, rfq.id, `确定将询价单 ${rfq.rfq_no} 转为采购订单吗？`, '已生成采购订单') }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'purchase-rfq-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="采购询价"
        subtitle="供应商询价比价，确认后转采购订单"
        extra={
          has('purchase_rfq_create') && (
            <button onClick={() => navigate('/purchase-rfqs/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建询价单</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索询价单号..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
          </div>
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
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : rfqs.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无询价单" /></td></tr>
              ) : (
                rfqs.map((rfq) => (
                  <tr key={rfq.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(rfq)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={pagination.page}
          pageSize={pagination.page_size}
          total={pagination.total}
          onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
          loading={loading}
          onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
        />
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">询价单 {detail.rfq_no}</h3>
              <button onClick={() => setDetail(null)} className="icon-btn" title="关闭"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div><span className="text-gray-500">供应商：</span>{detail.supplier_name || detail.edges?.supplier?.name || '-'}</div>
                <div><span className="text-gray-500">状态：</span>{STATUS_TEXT[detail.status] || detail.status}</div>
                <div><span className="text-gray-500">询价日期：</span>{detail.rfq_date ? format.date(detail.rfq_date) : '-'}</div>
                {detail.converted_po_no && <div><span className="text-gray-500">转采购订单：</span>{detail.converted_po_no}</div>}
                {detail.remark && <div className="col-span-2"><span className="text-gray-500">备注：</span>{detail.remark}</div>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">商品</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">数量</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">报价</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">金额</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(detail.edges?.lines || detail.lines || []).map((line: any) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2 text-sm text-gray-700">{line.product_name}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-700">{line.qty}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-700">¥{format.currency(line.quoted_price)}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-700">¥{format.currency((line.qty || 0) * (line.quoted_price || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
