import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  Users, 
  Building2,
  ShoppingCart,
  ClipboardList,
  Warehouse,
  Factory,
  Briefcase,
  DollarSign,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  Layers,
  Database,
  MessageCircle
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { useAppStore } from '@/store/app';
// [2026-09-17 可视化] 导航频率排序收敛到 utils/menuPreview（角色「菜单预览」与侧栏必须同序）
import { hiddenInPersonalMode, navFreqRank } from '@/utils/menuPreview';

export interface MenuItem {
  icon: typeof LayoutDashboard;
  label: string;
  path: string;
  permission?: string;
  children?: { label: string; path: string; permission?: string }[];
}

// 导出供命令面板（Ctrl+K）复用：菜单来源单一，避免两处清单不同步
export const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: '仪表盘', path: '/dashboard', permission: 'dashboard' },
  {
    icon: Package,
    label: '商品管理',
    path: '/products',
    permission: 'product_list',
    children: [
      { label: '商品列表', path: '/products' },
      { label: '多规格商品', path: '/spus', permission: 'spu_list' },
      { label: '组装商品', path: '/combo-products' },
      { label: '商品分类', path: '/category/product' },
      { label: '计量单位', path: '/units' },
      { label: '价目表', path: '/price-lists' },
    ]
  },
  {
    icon: Users,
    label: '客户管理',
    path: '/customers',
    permission: 'customer_list',
    children: [
      { label: '客户列表', path: '/customers' },
      { label: '客户分类', path: '/category/customer' },
    ]
  },
  {
    icon: Building2,
    label: '供应商管理',
    path: '/suppliers',
    permission: 'supplier_list',
    children: [
      { label: '供应商列表', path: '/suppliers' },
      { label: '供应商分类', path: '/category/supplier' },
    ]
  },
  {
    icon: Briefcase,
    label: '人事管理',
    path: '/hr/employees',
    permission: 'employee',
    children: [
      { label: '员工档案', path: '/hr/employees' },
      { label: '劳动合同', path: '/hr/contracts', permission: 'labor_contract' },
      { label: '请假/加班', path: '/hr/attendance', permission: 'attendance' },
      { label: '人事异动', path: '/hr/changes', permission: 'employee_change' },
      { label: '招聘管理', path: '/hr/recruitment', permission: 'recruitment' },
      { label: '培训管理', path: '/hr/training', permission: 'training' },
      { label: '绩效考核', path: '/hr/performance', permission: 'perf' },
      { label: '计件工资', path: '/hr/piecework', permission: 'piecework' },
      { label: '人事报表', path: '/hr/reports', permission: 'hr_report' },
    ]
  },
  {
    icon: ShoppingCart,
    label: '销售订单',
    path: '/sales-orders',
    permission: 'sales_order_list',
    children: [
      { label: '销售报价', path: '/sales-quotations', permission: 'sales_quotation' },
      { label: '销售订单', path: '/sales-orders' },
      { label: '销售合同', path: '/sales-contracts', permission: 'sales_contract' },
      { label: '销售退货', path: '/sales-returns', permission: 'sales_return' },
      { label: '销售线索', path: '/sales/leads', permission: 'customer' },
      { label: 'CRM 商机', path: '/crm', permission: 'crm' },
      // [2026-09-14 三方对齐] 门户管理后端挂 customer_edit（客户门户域）——守卫同码，防「看得见摸不着」
      { label: '门户管理', path: '/portal/manage', permission: 'customer_edit' },
    ]
  },
  {
    icon: ClipboardList,
    label: '采购订单',
    path: '/purchase-orders',
    permission: 'purchase_order_list',
    children: [
      { label: '采购申请', path: '/purchase-requisitions', permission: 'purchase_requisition' },
      { label: '采购询价', path: '/purchase-rfqs', permission: 'purchase_rfq' },
      { label: '采购订单', path: '/purchase-orders' },
      { label: '采购合同', path: '/purchase-contracts', permission: 'purchase_contract' },
      { label: '采购对账', path: '/purchase-reconciliations', permission: 'purchase_reconciliation' },
      { label: '采购退货', path: '/purchase-returns', permission: 'purchase_return' },
    ]
  },
  {
    icon: Warehouse,
    label: '库存管理',
    path: '/inventory/balance',
    permission: 'inventory',
    children: [
      { label: '仓库管理', path: '/warehouses', permission: 'warehouse' },
      { label: '库位管理', path: '/inventory/locations', permission: 'location' },
      { label: '货架管理', path: '/inventory/racks', permission: 'rack' },
      { label: '库存余额', path: '/inventory/balance', permission: 'inventory_view' },
      { label: '库存流水', path: '/inventory/movement', permission: 'inventory_view' },
      { label: '入库管理', path: '/stock-in', permission: 'stock_in' },
      { label: '出库管理', path: '/stock-out', permission: 'stock_out' },
      { label: '库存盘点', path: '/inventory/check', permission: 'inventory_check' },
      { label: '库存调拨', path: '/inventory/transfer', permission: 'stock_transfer' },
      { label: '库存调整', path: '/inventory/adjust', permission: 'stock_adjust' },
      { label: '借出借入', path: '/inventory/loans', permission: 'loan_order' },
      { label: '寄售代销', path: '/inventory/consignments', permission: 'consignment' },
    ]
  },
  {
    icon: Factory,
    label: '生产管理',
    path: '/production/work-orders',
    permission: 'work_order',
    children: [
      { label: '生产工单', path: '/production/work-orders', permission: 'work_order' },
      { label: '报工中心', path: '/production/work-reports', permission: 'production_report' },
      { label: '组装/拆解', path: '/assemblies', permission: 'assembly' },
      { label: '工单看板', path: '/production/work-order-board', permission: 'work_order' },
      { label: 'BOM管理', path: '/production/bom', permission: 'bom' },
      { label: '工艺路线', path: '/production/routing', permission: 'routing' },
      { label: '工作中心', path: '/production/work-centers', permission: 'work_center' },
      { label: '生产设备', path: '/production/equipments', permission: 'equipment' },
      { label: '模具工装', path: '/production/toolings', permission: 'tooling' },
      { label: '班组与操作工', path: '/production/teams', permission: 'team' },
      { label: '技术资料', path: '/production/documents', permission: 'document' },
      { label: '产能负载', path: '/production/capacity-load', permission: 'work_center' },
      { label: '生产领料', path: '/production/pickings', permission: 'picking' },
      { label: '生产入库', path: '/production/receipts', permission: 'production_receipt' },
      { label: '生产退料', path: '/production-returns', permission: 'production_return' },
      { label: '返工单', path: '/production/rework-orders', permission: 'rework_order' },
      { label: '外协加工', path: '/production/subcontract', permission: 'subcontract' },
      { label: '序列号追踪', path: '/production/serial-numbers', permission: 'serial_number' },
      { label: '主生产计划', path: '/production/mps', permission: 'mps' },
      { label: '物料需求计划', path: '/mrp', permission: 'mrp' },
      { label: '采购建议单', path: '/purchase-suggestions', permission: 'mrp' },
      { label: '生产设置', path: '/production/settings', permission: 'setting' },
    ]
  },
  {
    icon: DollarSign,
    label: '财务模块',
    path: '/finance/receivables',
    permission: 'finance',
    children: [
      { label: '发票管理', path: '/finance/invoices', permission: 'receivable' },
      { label: '应收管理', path: '/finance/receivables', permission: 'receivable' },
      { label: '应付管理', path: '/finance/payables', permission: 'payable' },
      { label: '收款单', path: '/finance/receipts', permission: 'receipt' },
      { label: '付款单', path: '/finance/payments', permission: 'payment' },
      { label: '凭证管理', path: '/finance/vouchers', permission: 'voucher' },
      { label: '会计科目', path: '/finance/accounts', permission: 'account' },
      { label: '凭证模板', path: '/finance/voucher-templates', permission: 'voucher_template' },
      { label: '科目映射', path: '/finance/account-mappings', permission: 'account_mapping' },
      { label: '会计期间', path: '/finance/periods', permission: 'accounting_period' },
      { label: '税金计提', path: '/finance/tax-accruals', permission: 'tax_accrual' },
      { label: '应交税费明细表', path: '/finance/tax-report', permission: 'finance_report' },
      { label: '股东档案', path: '/finance/shareholders', permission: 'shareholder' },
      { label: '账龄分析', path: '/finance/aging', permission: 'finance_report' },
      { label: '对账函', path: '/finance/statement', permission: 'finance_report' },
      { label: '费用报销', path: '/finance/expenses', permission: 'expense' },
      { label: '固定资产', path: '/finance/assets', permission: 'fixed_asset' },
      { label: '银行对账', path: '/finance/bank', permission: 'bank_reconciliation' },
      { label: '币种管理', path: '/finance/currencies', permission: 'currency' },
      { label: '工资核算', path: '/finance/payrolls', permission: 'payroll' },
      { label: '收付款计划', path: '/finance/payment-plans', permission: 'payment_plan' },
    ]
  },
  {
    icon: BarChart3,
    label: '报表中心',
    path: '/reports/sales',
    permission: 'report',
    children: [
      { label: '销售报表', path: '/reports/sales', permission: 'sales_report' },
      { label: '销售预测', path: '/reports/sales-forecast', permission: 'sales_report' },
      { label: '销售佣金', path: '/reports/sales-commission', permission: 'sales_commission' },
      { label: '采购报表', path: '/reports/purchase', permission: 'purchase_report' },
      { label: '库存报表', path: '/reports/inventory', permission: 'inventory_report' },
      { label: '订单履行', path: '/reports/trade', permission: 'sales_report' },
      { label: '财务报表', path: '/reports/finance', permission: 'finance_report' },
      { label: '自定义报表', path: '/reports/custom', permission: 'custom_report' },
    ]
  },
  {
    icon: ClipboardList,
    label: '我的审批',
    path: '/system/approval-tasks',
    // 审批人可能是普通用户（非管理员），不可要求 system 权限（与后端 approval-records 仅认证一致）
  },
  {
    icon: Settings,
    label: '系统管理',
    path: '/system/users',
    permission: 'user',
    children: [
      { label: '用户管理', path: '/system/users', permission: 'user' },
      { label: '部门管理', path: '/system/departments', permission: 'department' },
      { label: '角色管理', path: '/system/roles', permission: 'role' },
      { label: '权限码管理', path: '/system/permissions', permission: 'permission' },
      // [2026-09-18 权限细化·第4批] 系统面逐对象查看码（旧码 system 伞已拆分）
      { label: '操作日志', path: '/system/audit-logs', permission: 'audit_log' },
      { label: '审批流程', path: '/system/approval-flows', permission: 'approval_flow' },
      { label: '公司设置', path: '/system/settings', permission: 'setting' },
      // 公司管理（多公司部署控制台，2026-09-17）：仅默认公司 super_admin 可见（下方可见性过滤收敛）
      { label: '公司管理', path: '/system/companies', permission: 'system' },
      { label: '单号规则', path: '/system/numbering', permission: 'numbering' },
      { label: '打印设置', path: '/system/print-settings', permission: 'print_template' },
      { label: '数据备份', path: '/system/backups', permission: 'backup' },
      { label: '授权激活', path: '/system/license', permission: 'license' },
      { label: '数据字典', path: '/system/dict', permission: 'dict' },
    ]
  },
  {
    icon: Database,
    label: '元数据管理',
    path: '/metadata/templates',
    permission: 'metadata',
    children: [
      { label: '行业模板', path: '/metadata/templates' },
      { label: '实体管理', path: '/metadata/entities' },
      { label: '布局管理', path: '/metadata/layouts' },
      { label: '字段权限', path: '/metadata/field-permissions' },
      { label: '动态数据', path: '/metadata-data' },
    ]
  },
];

interface SidebarProps {
  /** 移动/平板：抽屉式导航（汉堡触发 + 遮罩 + 导航后关闭） */
  isMobile?: boolean;
  /** 中等宽度（手机横屏/平板/小窗 768~1199）固定图标窄栏：自动折叠态点菜单即展开 */
  isCompact?: boolean;
}

export function Sidebar({ isMobile = false, isCompact = false }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, permissions, company, companyIsDefault } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar, setSidebarCollapsed, mobileMenuOpen, setMobileMenuOpen } = useAppStore();
  // 「个人模式」（2026-09-22）：夫妻店/小加工没有审批链 → 隐藏「我的审批」「审批流程」入口
  const personalMode = useAppStore((s) => s.personalMode);
  const [expandedMenus, setExpandedMenus] = useState<string[]>([]);

  // RBAC 权限判断："*" 表示全权限（super_admin），未配置权限码的菜单项默认可见
  const hasPermission = (code?: string): boolean => {
    if (!code) return true;
    if (permissions.includes('*')) return true;
    return permissions.includes(code);
  };

  // 「公司管理」部署级入口（多公司 2026-09-17）：仅 super_admin 且当前在默认公司时可见
  // （与后端 RequireSuperAdmin + RequireDefaultCompany 双重守卫一致；公司信息未知时视为可用——
  //  单公司部署需通过该入口创建第 2 家公司，不能藏起来）
  const canManageCompanies = permissions.includes('*') && (companyIsDefault || !company);

  // 导航按「实际使用频率」排序（2026-09-10）：业务单据/实物操作最高频 → 主数据 → 财务/报表/审批 → 元数据/系统配置。
  // 常量与排序函数见 utils/menuPreview.ts（NAV_FREQUENCY_ORDER / navFreqRank）——角色菜单预览共用，防两处清单漂移。

  // 按权限过滤菜单：
  // 1. 子项未显式配置权限码时继承父级权限码（父级有权限码时）
  // 2. 父级自身无权限、且所有子项（继承后）均无权限时整组隐藏
  // 3. 仅保留有权限的子项；父级有权限但无子项时正常显示
  const visibleMenus = menuItems
    .map((item) => {
      const inherited = item.permission;
      const children = item.children
        ?.map((c) => ({ ...c, permission: c.permission ?? inherited }))
        .filter((c) => hasPermission(c.permission) && (c.path !== '/system/companies' || canManageCompanies) && !hiddenInPersonalMode(c.path, personalMode));
      return {
        ...item,
        children: children && children.length > 0 ? children : undefined,
      };
    })
    .filter((item) => ((hasPermission(item.permission) && (item.path !== '/system/companies' || canManageCompanies)) || (item.children && item.children.length > 0)) && !hiddenInPersonalMode(item.path, personalMode))
    .sort((a, b) => navFreqRank(a.path) - navFreqRank(b.path));

  const handleMenuClick = (item: MenuItem) => {
    // 中等宽度自动折叠态（横屏/平板窄栏）：点任意菜单先展开侧栏；有子菜单再展开该项，叶子项直接跳转
    if (sidebarCollapsed && !isMobile && isCompact) {
      setSidebarCollapsed(false);
      if (item.children) {
        setExpandedMenus((prev) => (prev.includes(item.path) ? prev : [...prev, item.path]));
      } else {
        navigate(item.path);
      }
      return;
    }
    if (item.children) {
      if (expandedMenus.includes(item.path)) {
        setExpandedMenus(expandedMenus.filter(p => p !== item.path));
      } else {
        setExpandedMenus([...expandedMenus, item.path]);
      }
    } else {
      navigate(item.path);
      // 移动端：点击导航后自动关闭抽屉
      if (isMobile) setMobileMenuOpen(false);
    }
  };

  const handleChildClick = (path: string) => {
    navigate(path);
    if (isMobile) setMobileMenuOpen(false);
  };

  const isActive = (path: string) => {
    return location.pathname.startsWith(path);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // 移动端抽屉：固定在左侧，通过 translate-x 控制显隐（配合 Layout 遮罩）
  // [2026-09-17 用户反馈「联系客服/退出按钮被地址栏遮挡」] 高度改用 .app-drawer：
  // 手机浏览器 100vh = 地址栏收起时的「大视口」，地址栏可见时抽屉最底部（客服/退出）被盖住；
  // .app-drawer 用 100dvh（动态视口，随地址栏显隐实时变化）→ 底部按钮永远贴着可视区底边。
  const asideClasses = isMobile
    ? `app-drawer fixed left-0 top-0 bg-blue-900 text-white transition-transform duration-300 z-50 flex flex-col w-72 ${
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`
    : `app-drawer fixed left-0 top-0 bg-blue-900 text-white transition-all duration-300 z-50 flex flex-col ${
        sidebarCollapsed ? 'w-20' : 'w-64'
      }`;

  return (
    <aside className={asideClasses}>
      {/* 移动端页头紧凑（px-4 py-3）：给底部客服/退出按钮让出更多可视空间 */}
      <div className={`border-b border-blue-800 ${isMobile ? 'px-4 py-3' : 'p-4'}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
          {(!isMobile && !sidebarCollapsed) && (
            <div>
              <h1 className="font-bold text-lg">LA-ERP 专业版</h1>
              <p className="text-xs text-blue-300">企业资源计划</p>
            </div>
          )}
          {isMobile && (
            <div className="flex-1 flex items-center justify-between">
              <div>
                <h1 className="font-bold text-lg">LA-ERP 专业版</h1>
                <p className="text-xs text-blue-300">企业资源计划</p>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-blue-300 hover:bg-blue-800 hover:text-white transition-colors"
                aria-label="关闭菜单"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 移动端菜单区紧凑（py-2 / space-y-0.5）：一屏多看条目，底栏更快触达 */}
      <nav className={`flex-1 overflow-y-auto ${isMobile ? 'py-2' : 'py-4'}`}>
        <ul className={`px-2 ${isMobile ? 'space-y-0.5' : 'space-y-1'}`}>
          {visibleMenus.map((item) => {
            const Icon = item.icon;
            const hasChildren = item.children && item.children.length > 0;
            const isExpanded = expandedMenus.includes(item.path);
            const active = isActive(item.path);
            // 移动端始终显示完整菜单（不折叠成图标）
            const showLabel = !sidebarCollapsed || isMobile;

            return (
              <li key={item.path}>
                <button
                  onClick={() => handleMenuClick(item)}
                  data-nav-link={hasChildren ? undefined : item.path}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                    isMobile ? 'min-h-[44px]' : ''
                  } ${
                    active 
                      ? 'bg-blue-700 text-white' 
                      : 'hover:bg-blue-800 text-blue-200'
                  }`}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {showLabel && (
                    <>
                      <span className="flex-1 text-left text-sm font-medium">{item.label}</span>
                      {hasChildren && (
                        isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )
                      )}
                    </>
                  )}
                </button>
                
                {hasChildren && showLabel && isExpanded && (
                  <ul className={`ml-4 ${isMobile ? 'mt-0.5 space-y-0.5' : 'mt-1 space-y-1'}`}>
                    {item.children!.map((child) => (
                      <li key={child.path}>
                        <button
                          onClick={() => handleChildClick(child.path)}
                          data-nav-link={child.path}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm ${
                            isMobile ? 'min-h-[44px]' : ''
                          } ${
                            isActive(child.path)
                              ? 'bg-blue-700/50 text-white'
                              : 'text-blue-300 hover:bg-blue-800/50'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          <span>{child.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 移动端底部操作区紧凑 + 安全区兜底（2026-09-17）：
          追加 env(safe-area-inset-bottom) —— iPhone 手势条/浏览器地址栏不再压住
          最下方的「联系客服 / 退出登录」；触控高度（py-2.5）保持不缩。 */}
      <div className={`border-t border-blue-800 ${isMobile ? 'px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]' : 'p-4'}`}>
        {!isMobile && (
          <button
            onClick={toggleSidebar}
            className="w-full flex items-center justify-center py-2.5 rounded-lg bg-blue-800 hover:bg-blue-700 transition-colors"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-5 h-5" />
            ) : (
              <ChevronLeft className="w-5 h-5" />
            )}
          </button>
        )}
        
        {(!sidebarCollapsed || isMobile) && (
          <button
            className="kefu-trigger w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-blue-200 hover:bg-blue-800 transition-colors"
            title="联系客服"
            type="button"
          >
            <MessageCircle className="w-5 h-5" />
            <span className="text-sm">联系客服</span>
          </button>
        )}

        {(!sidebarCollapsed || isMobile) && (
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 mt-2 rounded-lg text-red-300 hover:bg-red-900/30 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-sm">退出登录</span>
          </button>
        )}
      </div>
    </aside>
  );
}
