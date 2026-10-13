import { useCallback, useEffect, useState } from 'react';
import { Eye, Trash2, ShoppingCart, RefreshCw } from 'lucide-react';
import { Drawer } from 'antd';
import { message } from '@/utils/appMessage';
import { productionApi } from '@/api/production';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
const STATUS_TEXT: Record<string, string> = { draft: '草稿', ordered: '已转订单', closed: '已关闭' };
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-yellow-50 text-yellow-700',
  ordered: 'bg-green-50 text-green-600',
  closed: 'bg-gray-100 text-gray-500',
};
const LINE_STATUS_TEXT: Record<string, string> = { pending: '待下单', ordered: '已下单', closed: '已关闭' };

interface SuggestionLine {
  id: string;
  product_code?: string;
  product_name?: string;
  suggested_qty?: string;
  planned_date?: string;
  status?: string;
  remark?: string;
}

interface Suggestion {
  id: string;
  suggestion_no: string;
  mrp_no?: string;
  plan_date: string;
  status: string;
  remark?: string;
  edges?: { lines?: SuggestionLine[] };
}

export function PurchaseSuggestionList() {
  // [2026-09-18 权限细化·批 2 生产] 转采购=mrp_edit；删除=mrp_delete
  const { has } = usePermission();
  const [list, setList] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState<string | null>(null);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [status, setStatus] = useState('');
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [detail, setDetail] = useState<Suggestion | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams = { page: pagination.page, page_size: pagination.page_size };
      const res = await productionApi.suggestionList({ ...params, suggestion_no: debouncedKeyword || undefined, status: status || undefined });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, debouncedKeyword, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleView = async (s: Suggestion) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await productionApi.getSuggestion(s.id);
      if (res.code === 0) setDetail(res.data);
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleConvert = async (s: Suggestion) => {
    if (!(await confirmAction({
      title: `将采购建议单 ${s.suggestion_no} 转为采购订单？`,
      content: '将生成一张草稿状态的采购订单，可到采购模块继续完善供应商与价格。',
    }))) return;
    setConverting(s.id);
    try {
      const res = await productionApi.convertSuggestion(s.id);
      if (res.code === 0) {
        message.success(`已生成采购订单 ${res.data?.order_no}`);
        fetchList();
      } else {
        message.error(res.message || '转换失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '转换失败');
    } finally {
      setConverting(null);
    }
  };

  const handleDelete = async (s: Suggestion) => {
    if (!(await confirmAction({ title: `确定删除采购建议单 ${s.suggestion_no} 吗？`, danger: true }))) return;
    const res = await productionApi.deleteSuggestion(s.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); }
    else message.error(res.message || '删除失败');
  };

  const lines = detail?.edges?.lines ?? [];
  const totalQty = lines.reduce((acc, l) => acc + parseFloat(l.suggested_qty || '0'), 0);

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Suggestion) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'suggestion_no', header: '建议单号', cell: (s) => <span className="font-medium text-gray-900">{s.suggestion_no}</span> },
    { key: 'mrp_no', header: 'MRP 单号', cell: (s) => <span className="text-gray-600">{s.mrp_no || '-'}</span> },
    { key: 'plan_date', header: '计划日期', cell: (s) => <span className="text-gray-600">{format.date(s.plan_date)}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (s) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[s.status] || 'bg-gray-100 text-gray-500'}`}>
          {STATUS_TEXT[s.status] || s.status}
        </span>
      ),
    },
    { key: 'remark', header: '备注', cellCls: `${TD} text-gray-500 text-sm max-w-xs truncate`, cell: (s) => <span>{s.remark}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (s) => (
        // [易用性] 行操作统一折叠；转单中禁用主操作，避免重复提交
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => handleView(s) },
            ...(s.status === 'draft' && has('mrp_edit')
              ? [
                  {
                    key: 'convert',
                    label: converting === s.id ? '转单中…' : '转为采购订单',
                    icon: converting === s.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />,
                    disabled: converting === s.id,
                    onClick: () => handleConvert(s),
                  },
                ]
              : []),
            ...(has('mrp_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(s) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'purchase-suggestion-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="采购建议单"
        subtitle="MRP 计算后生成的物料采购建议，可一键转为采购订单"
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <input
            type="text"
            placeholder="搜索建议单号..."
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
            className="form-input md:max-w-xs"
          />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="ordered">已转订单</option>
            <option value="closed">已关闭</option>
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
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无采购建议" description="运行 MRP 后自动生成采购建议单" /></td></tr>
              ) : (
                list.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(s)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        </div>
      </div>

      <Drawer
        title={detail ? `采购建议单 ${detail.suggestion_no}` : '采购建议单详情'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        size={680}
      >
        {detailLoading ? (
          <TableSkeleton rows={6} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500">建议单号</div>
                <div className="font-medium text-gray-900">{detail?.suggestion_no}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500">MRP 单号</div>
                <div className="font-medium text-gray-900">{detail?.mrp_no || '-'}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500">计划日期</div>
                <div className="font-medium text-gray-900">{detail ? format.date(detail.plan_date) : '-'}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500">状态</div>
                <div className="font-medium text-gray-900">{detail ? (STATUS_TEXT[detail.status] || detail.status) : '-'}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">物料</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">建议数量</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">计划日期</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">状态</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">备注</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">无明细</td></tr>
                  ) : lines.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{l.product_name || '-'}</div>
                        <div className="text-xs text-gray-400">{l.product_code || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-blue-600">{format.qty(l.suggested_qty)}</td>
                      <td className="px-4 py-3 text-gray-600">{l.planned_date ? format.date(l.planned_date) : '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{LINE_STATUS_TEXT[l.status || ''] || l.status || '-'}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{l.remark || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center px-1">
              <span className="text-sm text-gray-500">共 {lines.length} 行</span>
              <span className="text-sm text-gray-700">
                建议总量：<span className="font-semibold text-blue-600">{format.qty(String(totalQty))}</span>
              </span>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
