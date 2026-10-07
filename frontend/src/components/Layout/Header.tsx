import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, Menu, PackageCheck, User, Wallet, BadgeCheck, RotateCcw, TriangleAlert, ClipboardCheck, CheckCircle2, XCircle, Moon, Sun, CalendarClock, Search, Zap } from 'lucide-react';
import { Badge, Button, Empty, Popover, Spin } from 'antd';
import { useAuthStore } from '@/store/auth';
import { useAppStore } from '@/store/app';
import { useNotificationStore } from '@/store/notification';
import { NotificationItem } from '@/types/notification';
import { openCommandPalette } from '@/components/CommandPalette';
import { readQuickLinks, QUICK_LINKS_EVENT, type QuickLink } from '@/utils/quickLinks';
import { LS } from '@/utils/localKeys';

interface HeaderProps {
  /** 移动/平板：显示汉堡按钮、隐藏大搜索框、精简用户区 */
  isMobile?: boolean;
}

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

/** 相对时间 */
function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

/** 通知类型图标与配色 */
function notificationMeta(type: string): { icon: React.ReactNode; cls: string } {
  switch (type) {
    case 'sales_to_finance':
      return { icon: <BellRing className="w-4 h-4" />, cls: 'bg-amber-100 text-amber-600' };
    case 'receipt_to_warehouse':
      return { icon: <PackageCheck className="w-4 h-4" />, cls: 'bg-blue-100 text-blue-600' };
    case 'purchase_to_finance':
      return { icon: <Wallet className="w-4 h-4" />, cls: 'bg-amber-100 text-amber-600' };
    case 'payment_to_boss':
      return { icon: <BadgeCheck className="w-4 h-4" />, cls: 'bg-purple-100 text-purple-600' };
    case 'sales_return_to_warehouse':
    case 'purchase_return_to_warehouse':
      return { icon: <RotateCcw className="w-4 h-4" />, cls: 'bg-blue-100 text-blue-600' };
    case 'low_stock':
      return { icon: <TriangleAlert className="w-4 h-4" />, cls: 'bg-red-100 text-red-600' };
    case 'approval_submit':
    case 'approval_next':
      return { icon: <ClipboardCheck className="w-4 h-4" />, cls: 'bg-orange-100 text-orange-600' };
    case 'approval_approved':
      return { icon: <CheckCircle2 className="w-4 h-4" />, cls: 'bg-green-100 text-green-600' };
    case 'approval_rejected':
      return { icon: <XCircle className="w-4 h-4" />, cls: 'bg-red-100 text-red-600' };
    case 'ar_overdue':
    case 'ap_overdue':
      return { icon: <CalendarClock className="w-4 h-4" />, cls: 'bg-red-100 text-red-600' };
    default:
      return { icon: <Bell className="w-4 h-4" />, cls: 'bg-gray-100 text-gray-500' };
  }
}

export function Header({ isMobile = false }: HeaderProps) {
  const { user } = useAuthStore();
  const { sidebarCollapsed, breadcrumb, setMobileMenuOpen, theme, resolvedTheme, toggleTheme } = useAppStore();
  const navigate = useNavigate();
  const { unreadCount, list, loading, refreshUnread, fetchList, markRead, markAllRead } = useNotificationStore();
  const [open, setOpen] = useState(false);

  // [P-05 2026-09-14] 我的快捷方式：顶栏个人自定义入口（个人中心配置；本机存储，保存即时刷新）
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>(() => readQuickLinks());
  // [P-05b 2026-09-14] 手机/窄屏：快捷方式收进 ⚡ 下拉（用户反馈手机看不到——此前仅 lg 以上平铺）
  const [quickOpen, setQuickOpen] = useState(false);
  useEffect(() => {
    const onChange = () => setQuickLinks(readQuickLinks());
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS.quickLinks) setQuickLinks(readQuickLinks());
    };
    window.addEventListener(QUICK_LINKS_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(QUICK_LINKS_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // 打开面板时刷新未读数 + 列表
  useEffect(() => {
    if (open) {
      fetchList({ page: 1, page_size: 8 });
    }
  }, [open, fetchList]);

  // 轮询未读数（30s）+ 窗口聚焦刷新
  useEffect(() => {
    refreshUnread();
    const timer = setInterval(() => refreshUnread(), 30000);
    const onFocus = () => refreshUnread();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshUnread]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      refreshUnread();
    }
  }, [refreshUnread]);

  const handleItemClick = useCallback((item: NotificationItem) => {
    if (!item.is_read) {
      markRead(item.id);
    }
    setOpen(false);
    const route = item.entity_type ? ENTITY_ROUTES[item.entity_type] : undefined;
    if (route && item.entity_id) {
      navigate(route(item.entity_id));
    }
  }, [markRead, navigate]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
    refreshUnread();
  }, [markAllRead, refreshUnread]);

  const notificationPanel = (
    <div className="w-80 md:w-96">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">
          通知中心
          {unreadCount > 0 && <span className="ml-2 text-xs font-normal text-blue-600">{unreadCount} 条未读</span>}
        </span>
        {unreadCount > 0 && (
          <Button type="link" size="small" className="!text-blue-600" onClick={handleMarkAllRead}>
            全部已读
          </Button>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {loading && list.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spin size="small" />
          </div>
        ) : list.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span className="text-xs text-gray-400">暂无通知</span>}
            className="!py-10"
          />
        ) : (
          list.map((item) => {
            const meta = notificationMeta(item.type);
            const route = item.entity_type ? ENTITY_ROUTES[item.entity_type] : undefined;
            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`w-full text-left px-3 py-3 flex gap-3 hover:bg-gray-50 transition-colors border-b border-gray-50 ${
                  item.is_read ? 'opacity-60' : ''
                }`}
              >
                <span className={`mt-0.5 w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 ${meta.cls}`}>
                  {meta.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-800 truncate">{item.title}</span>
                    {!item.is_read && <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2 break-all">{item.content}</span>
                  <span className="block text-xs text-gray-400 mt-1">{formatRelativeTime(item.created_at)}</span>
                </span>
                {route && (
                  <span className="self-center text-xs text-blue-600 flex-shrink-0">查看 ›</span>
                )}
              </button>
            );
          })
        )}
      </div>
      {list.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-100 text-center">
          <Button type="link" size="small" className="!text-gray-500" onClick={() => { setOpen(false); navigate('/notifications'); }}>
            查看全部通知
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <header 
      className={`fixed top-0 right-0 h-16 bg-white border-b border-gray-200 flex items-center justify-between px-3 md:px-6 z-40 transition-all duration-300 ${
        !isMobile ? (sidebarCollapsed ? 'left-20' : 'left-64') : 'left-0'
      }`}
    >
      <div className="flex items-center gap-3 md:gap-6 min-w-0">
        {isMobile && (
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 -ml-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="打开菜单"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <nav className="flex items-center gap-2 text-sm overflow-hidden">
          <span className="text-gray-400 flex-shrink-0">首页</span>
          {breadcrumb.slice(0, isMobile ? 1 : breadcrumb.length).map((item, index) => (
            <span key={index} className="flex items-center gap-2 min-w-0">
              <span className="text-gray-400 flex-shrink-0">/</span>
              <span className="text-gray-600 truncate">{item}</span>
            </span>
          ))}
        </nav>
        {/* [P-05 2026-09-14] 我的快捷方式：面包屑右侧个人自定义入口（个人中心配置；大屏平铺） */}
        {quickLinks.length > 0 && (
          // [P2-1 2026-09-15 → 2026-09-19 修正] 窄宽屏防溢出：限宽用 **45vw（视口相对）**——
          // 此前的 max-w-[45%] 相对「内容撑开的父容器」计算（自我限制），1440px 大屏容器也只剩 ~120px
          // → 3 个按钮即溢出 93px：滚动条可见 + 标签被裁（用户实测截图）；滚轮/触控仍可滚，仅隐藏滚动条视觉。
          <div className="hidden lg:flex items-center gap-0.5 pl-3 ml-1 border-l border-gray-200 min-w-0 max-w-[45vw] overflow-x-auto scrollbar-none">
            {quickLinks.map((q) => (
              <button
                key={q.path}
                type="button"
                onClick={() => navigate(q.path)}
                className="px-2 py-1 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors whitespace-nowrap flex-shrink-0"
                title={q.path}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        {/* [P-05b 2026-09-14] 手机/窄屏：⚡ 下拉（顶栏空间有限，点击展开快捷方式列表） */}
        {quickLinks.length > 0 && (
          <Popover
            open={quickOpen}
            onOpenChange={setQuickOpen}
            trigger="click"
            placement="bottomLeft"
            content={
              <div className="py-1 min-w-[150px] max-w-[240px]">
                {quickLinks.map((q) => (
                  <button
                    key={q.path}
                    type="button"
                    onClick={() => {
                      setQuickOpen(false);
                      navigate(q.path);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors text-left"
                    title={q.path}
                  >
                    <Zap className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
                    <span className="truncate">{q.label}</span>
                  </button>
                ))}
              </div>
            }
          >
            <button
              type="button"
              aria-label="我的快捷方式"
              className="lg:hidden p-2 -ml-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
            >
              <Zap className="w-5 h-5" />
            </button>
          </Popover>
        )}
      </div>

      <div className="flex items-center gap-3 md:gap-4">
        {/* 全局搜索/跳转入口（易用性 P1）：点击或 Ctrl/⌘+K 唤起命令面板 */}
        {/* [2026-09-19 设计升级] 胶囊搜索框风格；md~lg 收缩为图标钮——此前窄宽屏被 flex 压缩成竖排两行（用户实测截图） */}
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="全局搜索与跳转（Ctrl K）"
          className="group hidden md:flex items-center gap-2 h-9 px-2.5 lg:pl-3 lg:pr-1.5 text-sm text-gray-400 bg-gray-50 hover:bg-white hover:text-gray-600 hover:border-gray-300 hover:shadow-sm rounded-full border border-gray-200 transition-all whitespace-nowrap flex-shrink-0"
        >
          <Search className="w-4 h-4 flex-shrink-0 transition-colors group-hover:text-blue-500" />
          <span className="hidden lg:inline">搜索 / 跳转</span>
          <kbd className="hidden lg:inline-flex items-center h-6 px-2 text-[10px] font-medium text-gray-400 bg-white border border-gray-200 rounded-full transition-colors group-hover:border-gray-300">
            Ctrl K
          </kbd>
        </button>

        <Popover
          content={notificationPanel}
          trigger="click"
          open={open}
          onOpenChange={handleOpenChange}
          placement="bottomRight"
          arrow={false}
          styles={{ container: { padding: 0, borderRadius: 12, overflow: 'hidden' } }}
        >
          <button
            className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="通知中心"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-red-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        </Popover>

        <button
          onClick={toggleTheme}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title={resolvedTheme === 'dark' ? '切换浅色' : '切换暗色'}
        >
          {resolvedTheme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        <button
          onClick={() => navigate('/profile')}
          className="flex items-center gap-3 pl-3 md:pl-4 border-l border-gray-200 hover:bg-gray-50 -mr-2 p-2 rounded-lg transition-colors"
          title="个人中心"
        >
          <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-blue-600" />
          </div>
          <div className={`text-sm min-w-0 ${isMobile ? 'hidden' : 'block'}`}>
            <p className="font-medium text-gray-700 truncate">{user?.name || user?.username}</p>
            <p className="text-xs text-gray-400 truncate">{user?.role?.name}</p>
          </div>
        </button>
      </div>
    </header>
  );
}
