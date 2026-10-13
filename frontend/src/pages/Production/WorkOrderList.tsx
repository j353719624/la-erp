import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Check, Clock, Trash2, Printer } from 'lucide-react';
import { productionApi } from '@/api/production';
import { WorkOrder } from '@/types/production';
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
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
export function WorkOrderList() {
  // [2026-09-18 权限细化·批 2 生产] 新建=work_order_create；确认/编辑/完工/取消=work_order_edit；删除=work_order_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
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
    fetchWorkOrders();
  }, [pagination.page, pagination.page_size, debouncedKeyword, status]);

  const fetchWorkOrders = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        page_size: pagination.page_size,
        // 后端 work-orders List 读 order_no（不读 keyword）——此前搜索失效
        order_no: debouncedKeyword || undefined,
        status: status || undefined,
      };
      const response = await productionApi.workOrderList(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        const list = response.data?.list || [];
        const mappedList = list.map((item: any) => ({
          id: item.id,
          work_order_no: item.order_no,
          product_name: item.product_name,
          quantity: item.qty || 0,
          start_date: item.planned_start_date,
          end_date: item.planned_end_date,
          status: item.status,
          // [2026-09-14 完工引导] 已入库 N/M 与可完工提示（后端 List 计算）
          received_qty: Number(item.received_qty || 0),
          processes_done: Number(item.processes_done || 0),
          processes_total: Number(item.processes_total || 0),
          material_pending: Number(item.material_pending || 0),
          can_complete: !!item.can_complete,
        }));
        setWorkOrders(mappedList);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch work orders:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleConfirm = async (id: string, orderNo: string) => {
    if (!(await confirmAction({ title: `确定确认工单 ${orderNo} 吗？` }))) return;
    try {
      const response = await productionApi.confirmWorkOrder(id);
      if (response.code === 0) {
        message.success(`工单 ${orderNo} 已确认`);
        fetchWorkOrders();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to confirm work order:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleDelete = async (id: string, orderNo: string) => {
    if (!(await confirmAction({ title: `确定删除工单 ${orderNo} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await productionApi.deleteWorkOrder(id);
      if (response.code === 0) {
        message.success(`工单 ${orderNo} 已删除`);
        fetchWorkOrders();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete work order:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: WorkOrder) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'work_order_no', header: '工单号', cell: (item) => <span className="font-medium text-gray-900">{item.work_order_no}</span> },
    { key: 'product_name', header: '产品名称', cell: (item) => <span className="text-gray-900">{item.product_name}</span> },
    { key: 'quantity', header: '生产数量', cell: (item) => <span className="text-gray-500 text-sm">{item.quantity}</span> },
    {
      // [2026-09-14 完工引导] 已入库进度：入库确认后不再“看不出干了多少”；入齐且工序/物料就绪时提示可完工
      key: 'receipt_progress',
      header: '入库进度',
      cell: (item) => {
        const rec = Number(item.received_qty || 0);
        const q = Number(item.quantity || 0);
        const full = q > 0 && rec >= q;
        return (
          <span className="text-sm whitespace-nowrap">
            <span className={full ? 'text-green-600 font-medium' : 'text-gray-600'}>{rec}</span>
            <span className="text-gray-400"> / {q}</span>
            {full && item.status === 'in_progress' && item.can_complete && (
              <span className="ml-2 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">可完工</span>
            )}
          </span>
        );
      },
    },
    { key: 'start_date', header: '开工日期', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.start_date)}</span> },
    { key: 'end_date', header: '完工日期', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.end_date)}</span> },
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
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => navigate(`/production/work-orders/${item.id}`) },
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/work_order/${item.id}`) },
            ...(item.status === 'draft'
              ? [
                  ...(has('work_order_edit')
                    ? [{ key: 'confirm', label: '确认', icon: <Check className="w-4 h-4" />, onClick: () => handleConfirm(item.id, item.work_order_no) }]
                    : []),
                  ...(has('work_order_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.work_order_no) }]
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
    pageKey: 'work-order-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="生产管理"
        subtitle="生产工单列表"
        extra={
          has('work_order_create') && (
            <button onClick={() => navigate('/production/work-orders/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建工单</span>
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
                placeholder="搜索工单号..."
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
              <option value="in_progress">生产中</option>
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
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : workOrders.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无工单数据" /></td></tr>
              ) : (
                workOrders.map((item) => (
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

        {!loading && workOrders.length > 0 && (
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