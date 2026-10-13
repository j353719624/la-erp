import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Trash2, Printer, Play, CheckCircle2, X, Download } from 'lucide-react';
import { inventoryCheckApi } from '@/api/inventory';
import { InventoryCheck } from '@/types/inventory';
import { format } from '@/utils/format';
import { exportCsv } from '@/utils/exportCsv';
import { PaginationParams } from '@/types';
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
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';
export function InventoryCheckPage() {
  const navigate = useNavigate();
  const [checks, setChecks] = useState<InventoryCheck[]>([]);
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

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchChecks();
  }, [pagination.page, pagination.page_size, debouncedKeyword]);

  const fetchChecks = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        page_size: pagination.page_size,
        // 后端 inventory-checks List 读 check_no（不读 keyword）——此前搜索失效
        check_no: debouncedKeyword || undefined,
      };
      const response = await inventoryCheckApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setChecks(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch inventory checks:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, checkNo: string) => {
    if (!(await confirmAction({ title: `确定删除盘点单 ${checkNo} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await inventoryCheckApi.delete(id);
      if (response.code === 0) {
        message.success(`盘点单 ${checkNo} 已删除`);
        fetchChecks();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete inventory check:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const handleStart = async (id: string, checkNo: string) => {
    if (!(await confirmAction({ title: `确定开始盘点 ${checkNo} 吗？`, content: '将自动加载账面库存数量' }))) return;
    try {
      const response = await inventoryCheckApi.start(id);
      if (response.code === 0) {
        message.success(`盘点单 ${checkNo} 已开始，可录入实盘数量`);
        fetchChecks();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to start inventory check:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleComplete = async (id: string, checkNo: string) => {
    if (!(await confirmAction({ title: `确定完成盘点 ${checkNo} 吗？`, content: '将按实盘与账面差异生成库存调整流水', danger: true }))) return;
    try {
      const response = await inventoryCheckApi.complete(id);
      if (response.code === 0) {
        message.success(`盘点单 ${checkNo} 已完成`);
        fetchChecks();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to complete inventory check:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleCancel = async (id: string, checkNo: string) => {
    if (!(await confirmAction({ title: `确定取消盘点单 ${checkNo} 吗？`, danger: true }))) return;
    try {
      const response = await inventoryCheckApi.cancel(id);
      if (response.code === 0) {
        message.success(`盘点单 ${checkNo} 已取消`);
        fetchChecks();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to cancel inventory check:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: InventoryCheck) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  // [2026-09-18 权限细化] 开始/完成/取消=inventory_check_edit；新增=inventory_check_create；删除=inventory_check_delete
  const { has } = usePermission();
  // [2026-09-13 U-05] 批量操作：勾选列（锁定首列）+ 批量开始/完成盘点 + 导出选中
  const sel = useRowSelection({ rows: checks, getKey: (d) => d.id! });
  const batch = useBatchAction({
    selection: sel,
    label: (d) => d.check_no || d.id!,
    onDone: fetchChecks,
    actions: [
      {
        key: 'start',
        label: '批量开始盘点',
        icon: <Play className="w-4 h-4" />,
        eligible: (d) => d.status === 'draft' && has('inventory_check_edit'),
        confirm: (rows) => ({ title: `开始选中的 ${rows.length} 张盘点单？`, content: '开始后进入盘点中，可录入实盘数量' }),
        run: (d) => inventoryCheckApi.start(d.id!),
      },
      {
        key: 'complete',
        label: '批量完成盘点',
        icon: <CheckCircle2 className="w-4 h-4" />,
        eligible: (d) => d.status === 'checking' && has('inventory_check_edit'),
        confirm: (rows) => ({ title: `完成选中的 ${rows.length} 张盘点单？`, content: '完成将按差异生成库存调整（含凭证），不可撤销', danger: true }),
        run: (d) => inventoryCheckApi.complete(d.id!),
      },
    ],
    exportSpec: {
      filename: `库存盘点_选中_${format.today()}.csv`,
      headers: ['盘点单号', '仓库', '盘点日期', '状态'],
      row: (d) => [d.check_no, d.warehouse_name || d.edges?.warehouse?.name || '', format.date(d.check_date), format.statusText(d.status)],
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
    { key: 'check_no', header: '盘点单号', cell: (item) => <span className="font-medium text-gray-900">{item.check_no}</span> },
    { key: 'warehouse', header: '仓库', cell: (item) => <span className="text-gray-900">{item.warehouse_name || item.edges?.warehouse?.name || '-'}</span> },
    { key: 'check_date', header: '盘点日期', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.check_date)}</span> },
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
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => navigate(`/inventory/check/${item.id}`) },
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/inventory_check/${item.id}`) },
            ...(item.status === 'draft'
              ? [
                  ...(has('inventory_check_edit')
                    ? [{ key: 'start', label: '开始盘点', icon: <Play className="w-4 h-4" />, onClick: () => handleStart(item.id, item.check_no) }]
                    : []),
                  ...(has('inventory_check_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.check_no) }]
                    : []),
                ]
              : []),
            ...(item.status === 'checking' && has('inventory_check_edit')
              ? [
                  { key: 'complete', label: '完成盘点', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => handleComplete(item.id, item.check_no) },
                  { key: 'cancel', label: '取消盘点', icon: <X className="w-4 h-4" />, onClick: () => handleCancel(item.id, item.check_no) },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'inventory-check-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存盘点"
        subtitle="库存盘点单列表"
        extra={
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCsv(`库存盘点_${format.today()}.csv`,
                ['盘点单号', '仓库', '盘点日期', '状态'],
                checks.map((item: any) => [item.check_no, item.warehouse_name || item.edges?.warehouse?.name || '', format.date(item.check_date), format.statusText(item.status)]))}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出 CSV</span>
            </button>
            {has('inventory_check_create') && (
              <button
                onClick={() => navigate('/inventory/check/create')}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新建盘点单</span>
              </button>
            )}
          </div>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索盘点单号或仓库名称..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
          </div>
          <div className="ml-auto">{viewMenu}</div>
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
              ) : checks.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无库存盘点数据" /></td></tr>
              ) : (
                checks.map((item) => (
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
          {!loading && checks.length > 0 && (
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
    </div>
  );
}