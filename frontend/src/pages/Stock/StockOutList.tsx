import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Check, Trash2, Printer } from 'lucide-react';
import { stockOutApi } from '@/api/inventory';
import { StockOut } from '@/types/inventory';
import { format } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
// [2026-09-18 权限细化·第1批] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';
type DocLineLike = {
  product_name?: string;
  edges?: { product?: { name?: string } };
};
/** 单据行商品名（去重保序）：优先行快照名，回退商品关联名 */
const collectDocProductNames = (lines: DocLineLike[] | null | undefined): string[] => {
  const names: string[] = [];
  for (const ln of lines || []) {
    const n = (ln.product_name || ln.edges?.product?.name || '').trim();
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
};

export function StockOutList() {
  const navigate = useNavigate();
  const [stockOuts, setStockOuts] = useState<StockOut[]>([]);
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

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchStockOuts();
  }, [pagination.page, pagination.page_size, debouncedKeyword, status]);

  const fetchStockOuts = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        page_size: pagination.page_size,
        // 后端 stock-outs List 读 stock_out_no（不读 keyword）——此前搜索失效
        stock_out_no: debouncedKeyword || undefined,
        status: status || undefined,
      };
      const response = await stockOutApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setStockOuts(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch stock outs:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleConfirm = async (id: string, stockOutNo: string) => {
    if (!(await confirmAction({ title: `确定确认出库单 ${stockOutNo} 吗？`, content: '确认后不可修改' }))) return;
    try {
      const response = await stockOutApi.confirm(id);
      if (response.code === 0) {
        message.success(`出库单 ${stockOutNo} 已确认`);
        fetchStockOuts();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to confirm stock out:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleDelete = async (id: string, stockOutNo: string) => {
    if (!(await confirmAction({ title: `确定删除出库单 ${stockOutNo} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await stockOutApi.delete(id);
      if (response.code === 0) {
        message.success(`出库单 ${stockOutNo} 已删除`);
        fetchStockOuts();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete stock out:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: StockOut) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  // [2026-09-13 U-05] 批量确认出库单：逐条执行（每条都走完整状态机与库存扣减校验）+ 失败原因汇总 + 导出选中
  // [2026-09-18 权限细化] 按钮级权限：新增=stock_out_create；确认/删除见下方行操作
  const { has } = usePermission();
  const sel = useRowSelection({ rows: stockOuts, getKey: (d) => d.id });
  const batch = useBatchAction({
    selection: sel,
    label: (d) => d.stock_out_no || d.id,
    onDone: fetchStockOuts,
    actions: [
      {
        key: 'confirm',
        label: '批量确认',
        icon: <Check className="w-4 h-4" />,
        eligible: (d) => d.status === 'draft' && has('stock_out_edit'),
        confirm: (rows) => ({ title: `确定确认选中的 ${rows.length} 张出库单？`, content: '确认后库存出账且不可修改；逐条校验（含库存不足），失败的会列出单号与原因' }),
        run: (d) => stockOutApi.confirm(d.id),
      },
    ],
    exportSpec: {
      filename: `出库单_选中_${format.today()}.csv`,
      headers: ['出库单号', '仓库', '类型', '状态'],
      row: (d) => [d.stock_out_no, d.edges?.warehouse?.name || d.warehouse_name || '', d.type || '', format.statusText(d.status)],
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
          title="全选本页"
        />
      ),
      headCls: 'px-4 py-3 w-10',
      cellCls: 'px-4 py-4',
      cell: (item) => (
        <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={sel.isSelected(item)} onChange={() => sel.toggle(item)} />
      ),
    },
    { key: 'stock_out_no', header: '出库单号', cell: (item) => <span className="font-medium text-gray-900">{item.stock_out_no}</span> },
    { key: 'warehouse', header: '仓库', cell: (item) => <span className="text-gray-900">{item.edges?.warehouse?.name || item.warehouse_name || '-'}</span> },
    {
      key: 'products',
      header: '商品',
      cell: (item) => (
        <span className="text-gray-700 text-sm" title={(collectDocProductNames(item.edges?.lines || item.lines)).join('、')}>
          {(() => {
            const names = collectDocProductNames(item.edges?.lines || item.lines);
            if (names.length === 0) return <span className="text-gray-400">-</span>;
            return (
              <>
                {names.slice(0, 2).join('、')}
                {names.length > 2 ? `…等${names.length}种` : ''}
              </>
            );
          })()}
        </span>
      ),
    },
    { key: 'type', header: '来源类型', cell: (item) => <span className="text-gray-500 text-sm">{item.type === 'sales' ? '销售出库' : item.type === 'purchase_return' ? '采购退货' : item.type === 'production' ? '生产领料' : item.type === 'transfer' ? '调拨出库' : '其他出库'}</span> },
    { key: 'source_no', header: '来源单号', cell: (item) => <span className="text-gray-500 text-sm">{item.source_no || '-'}</span> },
    { key: 'total_amount', header: '总金额', cell: (item) => <span className="font-medium text-gray-900">¥{format.currency(item.total_amount)}</span> },
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
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => navigate(`/stock-out/${item.id}`) },
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/stock_out/${item.id}`) },
            ...(item.status === 'draft'
              ? [
                  ...(has('stock_out_edit')
                    ? [{ key: 'confirm', label: '确认', icon: <Check className="w-4 h-4" />, onClick: () => handleConfirm(item.id, item.stock_out_no) }]
                    : []),
                  ...(has('stock_out_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.stock_out_no) }]
                    : []),
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'stock-out-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="出库管理"
        subtitle="出库单列表"
        extra={
          has('stock_out_create') && (
            <button onClick={() => navigate('/stock-out/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建出库单</span>
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
                placeholder="搜索出库单号..."
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="form-input pl-10"
              />
            </div>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-select w-32"
            >
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="confirmed">已确认</option>
              <option value="cancelled">已取消</option>
            </select>
            <div className="ml-auto">{viewMenu}</div>
          </div>
        </div>

        {/* [2026-09-13 U-05] 批量工具条（勾选后出现；失败汇总弹窗必须独立渲染） */}
        {sel.count > 0 && <div className="px-4 pb-3">{batch.bar}</div>}
        {batch.failureModal}

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
              ) : stockOuts.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无出库单数据" /></td></tr>
              ) : (
                stockOuts.map((item) => (
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

          {!loading && stockOuts.length > 0 && (
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
