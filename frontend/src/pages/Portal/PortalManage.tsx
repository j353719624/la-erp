import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Package, Copy, Check, Eye, Boxes } from 'lucide-react';
import { Switch, Tabs } from 'antd';
import { message } from '@/utils/appMessage';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { portalApi, PortalAdminOrder, PortalAdminCustomer } from '@/api/portal';
import { format } from '@/utils/format';
import { copyText } from '@/utils/clipboard';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useTableView } from '@/hooks/useTableView';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import type { ReactNode } from 'react';

// 客户可见全流程进度文本（与门户页一致）
const PROGRESS_TEXT: Record<string, string> = {
  submitted: '已提交',
  confirmed: '已确认',
  paid: '已支付',
  preparing: '备货中',
  shipped: '已出库',
  completed: '已完成',
};

export function PortalManage() {
  const navigate = useNavigate();
  // [U-03 扫尾 2026-09-13] 页签 + 两张表页码写入 URL（刷新/返回/发链接不丢位置；两表各自独立分页键）
  // [U-01 推广 2026-09-14] 两张表各自接入每页条数（page_size 走个人偏好；cpage_size 仅 URL 记忆）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ tab: 'orders', page: 1, page_size: 10, cpage: 1, cpage_size: 10 });
  const [enabled, setEnabled] = useState(true);
  const [showStock, setShowStock] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // 自助订单（source=portal）
  const [orders, setOrders] = useState<PortalAdminOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderPage, setOrderPage] = useState(urlFilters.page);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPageSize, setOrderPageSize] = useState(urlFilters.page_size);

  // 已开通客户（portal_enabled=true）
  const [customers, setCustomers] = useState<PortalAdminCustomer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerPage, setCustomerPage] = useState(urlFilters.cpage);
  const [customerTotal, setCustomerTotal] = useState(0);
  const [customerPageSize, setCustomerPageSize] = useState(urlFilters.cpage_size);
  // 请求竞态守卫（订单/客户两路独立）：快速翻页时丢弃过期响应，防旧页数据覆盖新页
  const { nextSeq: ordersNext, isCurrent: ordersCurrent } = useRequestGuard();
  const { nextSeq: custNext, isCurrent: custCurrent } = useRequestGuard();

  const portalUrl = `${window.location.origin}/portal`;

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await portalApi.getSettings();
      if (res.code === 0) {
        setEnabled(!!res.data?.enabled);
        setShowStock(!!res.data?.show_stock);
      }
    } catch {
      // 401 已由拦截器跳登录
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const fetchOrders = useCallback(async (page: number, size: number) => {
    const seq = ordersNext(); // [竞态守卫] 本次请求序号
    setOrdersLoading(true);
    try {
      const res = await portalApi.adminOrders({ page, page_size: size });
      if (res.code === 0) {
        if (!ordersCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setOrders(res.data?.list ?? []);
        setOrderTotal(res.data?.total ?? 0);
      }
    } catch {
      // 401 已由拦截器跳登录
    } finally {
      if (ordersCurrent(seq)) setOrdersLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [ordersNext, ordersCurrent]);

  const fetchCustomers = useCallback(async (page: number, size: number) => {
    const seq = custNext(); // [竞态守卫] 本次请求序号
    setCustomersLoading(true);
    try {
      const res = await portalApi.adminCustomers({ page, page_size: size });
      if (res.code === 0) {
        if (!custCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setCustomers(res.data?.list ?? []);
        setCustomerTotal(res.data?.total ?? 0);
      }
    } catch {
      // 401 已由拦截器跳登录
    } finally {
      if (custCurrent(seq)) setCustomersLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [custNext, custCurrent]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  useEffect(() => { fetchOrders(orderPage, orderPageSize); }, [orderPage, orderPageSize, fetchOrders]);
  useEffect(() => { fetchCustomers(customerPage, customerPageSize); }, [customerPage, customerPageSize, fetchCustomers]);

  const handleToggle = async (v: boolean) => {
    setSettingsLoading(true);
    try {
      const res = await portalApi.updateSettings({ enabled: v });
      if (res.code === 0) {
        setEnabled(!!res.data?.enabled);
        message.success(v ? '客户自助下单已开启' : '客户自助下单已暂停（客户将无法登录/下单）');
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err: any) {
      message.error(err.message || '操作失败，请稍后重试');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleToggleStock = async (v: boolean) => {
    setStockLoading(true);
    try {
      const res = await portalApi.updateSettings({ show_stock: v });
      if (res.code === 0) {
        setShowStock(!!res.data?.show_stock);
        message.success(v ? '客户可见库存已开启（门户将展示现货数量/缺货标记）' : '客户可见库存已关闭（门户不再展示库存）');
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err: any) {
      message.error(err.message || '操作失败，请稍后重试');
    } finally {
      setStockLoading(false);
    }
  };

  const copyUrl = async () => {
    const ok = await copyText(portalUrl);
    if (ok) {
      setCopied(true);
      message.success('门户链接已复制，可发给客户');
      setTimeout(() => setCopied(false), 2000);
    } else {
      message.error('复制失败，请手动复制链接');
    }
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: any) => ReactNode;
  }
  const TH_L = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-4 whitespace-nowrap';
  const orderCols: RowCol[] = [
    { key: 'order_no', header: '单号', cellCls: `${TD} font-medium text-gray-900`, cell: (o) => <span>{o.order_no}</span> },
    { key: 'customer_name', header: '客户', cellCls: `${TD} text-gray-700`, cell: (o) => <span>{o.customer_name || (o as any).edges?.customer?.name || '-'}</span> },
    { key: 'total_amount', header: '金额', headCls: TH_R, cellCls: `${TD} text-right text-gray-900`, cell: (o) => <span>{format.currency(o.total_amount)}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (o) => <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(o.status)}`}>{format.statusText(o.status)}</span>,
    },
    {
      key: 'customer_progress',
      header: '客户进度',
      cell: (o) => (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-teal-50 text-teal-700">{PROGRESS_TEXT[o.customer_progress] || o.customer_progress}</span>
      ),
    },
    { key: 'created_at', header: '下单时间', cellCls: `${TD} text-gray-500 text-sm`, cell: (o) => <span>{format.date(o.created_at, 'YYYY-MM-DD HH:mm')}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (o) => (
        <button onClick={() => navigate(`/sales-orders/${o.id}`)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="查看订单">
          <Eye className="w-4 h-4" />
        </button>
      ),
    },
  ];
  const customerCols: RowCol[] = [
    { key: 'code', header: '编码', cellCls: `${TD} font-medium text-gray-900`, cell: (c) => <span>{c.code}</span> },
    { key: 'name', header: '名称', cellCls: `${TD} text-gray-700`, cell: (c) => <span>{c.name}</span> },
    { key: 'login_account', header: '登录账号', cellCls: `${TD} text-gray-500 text-sm`, cell: (c) => <span>{c.login_account || '-'}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (c) => <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(c.status)}`}>{format.statusText(c.status)}</span>,
    },
    { key: 'last_login_at', header: '最近登录', cellCls: `${TD} text-gray-500 text-sm`, cell: (c) => <span>{c.last_login_at ? format.date(c.last_login_at, 'YYYY-MM-DD HH:mm') : '-'}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (c) => (
        <button onClick={() => navigate(`/customers/${c.id}/edit`)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="编辑客户">
          <Eye className="w-4 h-4" />
        </button>
      ),
    },
  ];
  // [2026-09-13] 两个页签两张表：主表用 ?cols=，次表用 ?cols.customers=（否则互相裁列）
  const { visibleColumns: orderVisible, menu: orderMenu } = useTableView({
    pageKey: 'portal-manage-orders',
    columns: orderCols,
    locked: { trailing: ['__actions'] },
  });
  const { visibleColumns: customerVisible, menu: customerMenu } = useTableView({
    pageKey: 'portal-manage-customers',
    paramNs: 'customers',
    columns: customerCols,
    locked: { trailing: ['__actions'] },
  });
  // [U-03 扫尾] 页签从 URL 恢复（默认自助订单页签）
  const [activeTab, setActiveTab] = useState(urlFilters.tab || 'orders');

  // [U-03 扫尾] 页签/页码变化 → 写回 URL（[U-01] 含两表各自每页条数）
  useEffect(() => {
    syncUrl({ tab: activeTab, page: orderPage, page_size: orderPageSize, cpage: customerPage, cpage_size: customerPageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, orderPage, orderPageSize, customerPage, customerPageSize]);

  const tabItems = [
    {
      key: 'orders',
      label: `自助订单 (${orderTotal})`,
      children: (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {orderVisible.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ordersLoading ? (
                <tr><td colSpan={orderVisible.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={orderVisible.length} className="px-4"><EmptyState title="暂无客户自助订单" /></td></tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                    {orderVisible.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(o)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {!ordersLoading && orders.length > 0 && (
            <div className="p-4 border-t border-gray-100">
              <Pagination page={orderPage} pageSize={orderPageSize} total={orderTotal} onPageChange={setOrderPage} onPageSizeChange={(s) => { setOrderPageSize(s); setOrderPage(1); }} loading={ordersLoading} />
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'customers',
      label: `已开通客户 (${customerTotal})`,
      children: (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {customerVisible.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customersLoading ? (
                <tr><td colSpan={customerVisible.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : customers.length === 0 ? (
                <tr><td colSpan={customerVisible.length} className="px-4"><EmptyState title="暂无已开通自助下单的客户" /></td></tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    {customerVisible.map((col) => (
                      <td key={col.key} className={col.cellCls || TD}>
                        {col.cell(c)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {!customersLoading && customers.length > 0 && (
            <div className="p-4 border-t border-gray-100">
              <Pagination page={customerPage} pageSize={customerPageSize} total={customerTotal} onPageChange={setCustomerPage} onPageSizeChange={(s) => { setCustomerPageSize(s); setCustomerPage(1); }} loading={customersLoading} />
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="门户管理" subtitle="客户自助下单统一管理" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <div className="flex items-center justify-between gap-4 pb-5">
            <div>
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Store className="w-5 h-5 text-teal-600" /> 门户总开关
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                关闭后所有客户无法登录门户浏览商品/下单（已产生的订单不受影响）
              </p>
            </div>
            <Switch
              checked={enabled}
              loading={settingsLoading}
              onChange={handleToggle}
              checkedChildren="开启"
              unCheckedChildren="关闭"
            />
          </div>
          <div className="border-t border-gray-100 flex items-center justify-between gap-4 pt-5">
            <div>
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Boxes className="w-5 h-5 text-teal-600" /> 客户可见库存
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                关闭后客户浏览商品时看不到现货库存/缺货标记（接口也不再返回库存数据）；不影响下单
              </p>
            </div>
            <Switch
              checked={showStock}
              loading={stockLoading}
              onChange={handleToggleStock}
              checkedChildren="展示"
              unCheckedChildren="隐藏"
            />
          </div>
        </div>

        <div className="card p-6">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-teal-600" /> 门户入口链接
          </h3>
          <p className="text-sm text-gray-500 mt-1 mb-3">
            发给客户，用开通的账号登录即可浏览商品并自助下单；下单后进入后台确认/审批流程
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 truncate">
              {portalUrl}
            </code>
            <button onClick={copyUrl} className="btn-secondary flex items-center gap-2 whitespace-nowrap">
              {copied ? <Check className="w-4 h-4 text-teal-600" /> : <Copy className="w-4 h-4" />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            商品上架：商品管理中「启用」状态的商品自动展示在门户；开通账号/资格在客户管理中操作
          </p>
        </div>
      </div>

      <div className="card">
        <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} tabBarExtraContent={activeTab === 'orders' ? orderMenu : customerMenu} />
      </div>
    </div>
  );
}
