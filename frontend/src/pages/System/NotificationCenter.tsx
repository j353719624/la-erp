import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, BellRing, CheckCheck, PackageCheck, ChevronRight, Wallet, BadgeCheck, RotateCcw, TriangleAlert, ClipboardCheck, CheckCircle2, XCircle, CalendarClock } from 'lucide-react';
import { Button } from 'antd';
import { message } from '@/utils/appMessage';
import { notificationApi } from '@/api/system';
import { NotificationItem } from '@/types/notification';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';

/** 通知类型 → 跳转路由 */
const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  sales_order: (id) => `/sales-orders/${id}`,
  payment_receipt: (id) => `/finance/receipts/${id}`,
  ar_invoice: (id) => `/finance/receivables/${id}`,
  purchase_order: (id) => `/purchase-orders/${id}`,
  sales_return: (id) => `/sales-returns/${id}`,
  purchase_return: (id) => `/purchase-returns/${id}`,
  payment: (id) => `/finance/payments/${id}`,
  stock_out: (id) => `/stock-out/${id}`,
};

/** 通知类型图标与文案 */
function notificationMeta(type: string): { icon: React.ReactNode; cls: string; label: string } {
  switch (type) {
    case 'sales_to_finance':
      return { icon: <BellRing className="w-4 h-4" />, cls: 'bg-amber-100 text-amber-600', label: '待财务收款开票' };
    case 'receipt_to_warehouse':
      return { icon: <PackageCheck className="w-4 h-4" />, cls: 'bg-blue-100 text-blue-600', label: '已收款可出库' };
    case 'purchase_to_finance':
      return { icon: <Wallet className="w-4 h-4" />, cls: 'bg-amber-100 text-amber-600', label: '待财务付款' };
    case 'payment_to_boss':
      return { icon: <BadgeCheck className="w-4 h-4" />, cls: 'bg-purple-100 text-purple-600', label: '待老板审批打款' };
    case 'sales_return_to_warehouse':
      return { icon: <RotateCcw className="w-4 h-4" />, cls: 'bg-blue-100 text-blue-600', label: '退货待入库' };
    case 'purchase_return_to_warehouse':
      return { icon: <RotateCcw className="w-4 h-4" />, cls: 'bg-blue-100 text-blue-600', label: '退货待出库' };
    case 'low_stock':
      return { icon: <TriangleAlert className="w-4 h-4" />, cls: 'bg-red-100 text-red-600', label: '库存预警' };
    case 'approval_submit':
    case 'approval_next':
      return { icon: <ClipboardCheck className="w-4 h-4" />, cls: 'bg-orange-100 text-orange-600', label: '待审批' };
    case 'approval_approved':
      return { icon: <CheckCircle2 className="w-4 h-4" />, cls: 'bg-green-100 text-green-600', label: '审批已通过' };
    case 'approval_rejected':
      return { icon: <XCircle className="w-4 h-4" />, cls: 'bg-red-100 text-red-600', label: '审批被驳回' };
    case 'ar_overdue':
      return { icon: <CalendarClock className="w-4 h-4" />, cls: 'bg-red-100 text-red-600', label: '应收到期' };
    case 'ap_overdue':
      return { icon: <CalendarClock className="w-4 h-4" />, cls: 'bg-red-100 text-red-600', label: '应付到期' };
    default:
      return { icon: <Bell className="w-4 h-4" />, cls: 'bg-gray-100 text-gray-500', label: '系统通知' };
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今天 ${hm}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
}

export function NotificationCenter() {
  const navigate = useNavigate();
  const location = useLocation();
  // [2026-09-16] 顶栏铃铛入口来自任意页面：有导航历史原路返回；直接打开 /notifications 时回仪表盘
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/dashboard'));
  const [list, setList] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  // [U-03 扫尾 2026-09-13] 「只看未读」+ 页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ filter: 'all', page: 1, page_size: 10 });
  const [filter, setFilter] = useState<'all' | 'unread'>(urlFilters.filter === 'unread' ? 'unread' : 'all');
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  // 请求竞态守卫：全部/未读筛选与翻页快速切换时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchUnread = useCallback(async () => {
    try {
      const res = await notificationApi.unreadCount();
      if (res.code === 0) {
        setUnreadCount(res.data?.count ?? 0);
      }
    } catch { /* 静默 */ }
  }, []);

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await notificationApi.list({
        page: pagination.page,
        page_size: pagination.page_size,
        unread_only: filter === 'unread',
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, filter, nextSeq, isCurrent]);

  useEffect(() => {
    fetchList();
    fetchUnread();
  }, [fetchList, fetchUnread]);

  // [U-03 扫尾] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ filter, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, pagination.page, pagination.page_size]);

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.is_read) {
      try {
        await notificationApi.markRead(item.id);
        setList(prev => prev.map(n => (n.id === item.id ? { ...n, is_read: true } : n)));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch { /* 静默 */ }
    }
    const route = item.entity_type ? ENTITY_ROUTES[item.entity_type] : undefined;
    if (route && item.entity_id) {
      navigate(route(item.entity_id));
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await notificationApi.markAllRead();
      if (res.code === 0) {
        setList(prev => prev.map(n => ({ ...n, is_read: true })));
        setUnreadCount(0);
        message.success('已全部标记为已读');
      }
    } catch (err) {
message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="通知中心"
        subtitle="跨部门协作通知"
        onBack={goBack}
        extra={
          unreadCount > 0 ? (
            <Button icon={<CheckCheck className="w-4 h-4" />} onClick={handleMarkAllRead}>
              全部已读
            </Button>
          ) : undefined
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center gap-2">
          {(['all', 'unread'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPagination(prev => ({ ...prev, page: 1 })); }}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === f ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {f === 'all' ? '全部' : '未读'}
              {f === 'unread' && unreadCount > 0 && <span className="ml-1 text-xs text-red-500">{unreadCount}</span>}
            </button>
          ))}
        </div>

        <div>
          {loading ? (
            <div className="p-6"><TableSkeleton rows={5} /></div>
          ) : list.length === 0 ? (
            <div className="py-16"><EmptyState title="暂无通知" description="跨部门协作事件将在这里通知你" /></div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {list.map(item => {
                const meta = notificationMeta(item.type);
                const route = item.entity_type ? ENTITY_ROUTES[item.entity_type] : undefined;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => handleItemClick(item)}
                      className={`w-full flex items-start gap-3 px-4 md:px-6 py-4 text-left hover:bg-gray-50 transition-colors ${item.is_read ? 'opacity-60' : ''}`}
                    >
                      <span className={`mt-0.5 w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 ${meta.cls}`}>
                        {meta.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{item.title}</span>
                          {!item.is_read && <span className="px-1.5 py-0.5 bg-red-50 text-red-500 text-xs rounded">未读</span>}
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">{meta.label}</span>
                        </span>
                        <span className="block text-sm text-gray-600 mt-1 break-all">{item.content}</span>
                        <span className="block text-xs text-gray-400 mt-1">{formatTime(item.created_at)}</span>
                      </span>
                      {route && <ChevronRight className="w-4 h-4 text-gray-300 mt-2 flex-shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!loading && list.length > 0 && (
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
