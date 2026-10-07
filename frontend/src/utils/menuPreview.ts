import type { MenuItem } from '@/components/Layout/Sidebar';

/**
 * 菜单预览（所见即所得）工具 —— 2026-09-17 部门/角色可视化改造。
 *
 * 用途：角色管理「权限配置」右侧实时预览 + 角色列表「预览菜单」，
 * 把「该角色登录后左侧导航会看到什么」直接画出来，避免管理员逐条猜权限的含义。
 *
 * ⚠️ 过滤语义必须与 `components/Layout/Sidebar.tsx` 的 `visibleMenus` 完全一致：
 *   ① 子项未配置权限码时继承父级权限码；
 *   ② 父级无权限、且所有子项（继承后）均无权限 → 整组隐藏；
 *   ③ 仅保留有权限的子项；
 *   ④ `/system/companies`（公司管理）为部署级入口，仅全权限（super_admin）可见。
 * 门禁 scripts/check_visual_config.mjs 断言两者规则同步（Sidebar 结构被改会报红）。
 */

/** 导航按「实际使用频率」排序（与 Sidebar 同序；2026-09-10 上线）——单一来源，Sidebar 从此导入 */
export const NAV_FREQUENCY_ORDER = [
  '/dashboard', // 仪表盘（首页）
  '/sales-orders', // 销售订单
  '/sales-contracts', // 销售合同
  '/purchase-orders', // 采购订单
  '/inventory', // 库存管理
  '/production', // 生产管理
  '/products', // 商品管理
  '/customers', // 客户管理
  '/suppliers', // 供应商管理
  '/finance', // 财务模块
  '/hr', // 人事管理（2026-09-19 用户反馈：此前不在清单 → 被排到最末）
  '/reports', // 报表中心
  '/system/approval-tasks', // 我的审批
  '/metadata', // 元数据管理
  '/system', // 系统管理
];

export const navFreqRank = (path: string): number => {
  const idx = NAV_FREQUENCY_ORDER.findIndex((p) => path.startsWith(p));
  return idx < 0 ? NAV_FREQUENCY_ORDER.length : idx;
};

/**
 * 「个人模式」下隐藏的菜单路径（2026-09-22）——夫妻店/个人/小加工没有审批链：
 * 「我的审批」与「审批流程」两个入口不显示（后端同时兜底：未配置流程时提交即通过）。
 * Sidebar 运行期与角色菜单预览**共用本清单**，避免两处漏改。
 */
export const PERSONAL_MODE_HIDDEN_PATHS = ['/system/approval-tasks', '/system/approval-flows'];

/** 个人模式下是否隐藏该菜单路径（供 Sidebar / 预览统一判断） */
export const hiddenInPersonalMode = (path: string, personalMode: boolean): boolean =>
  personalMode && PERSONAL_MODE_HIDDEN_PATHS.includes(path);

/**
 * 给定权限码集合，返回该角色可见的菜单（结构与 Sidebar 的 visibleMenus 相同）。
 * 权限码 `*` = 全权限（super_admin），可见全部菜单。
 */
export function visibleMenusForPreview(items: MenuItem[], permissions: string[], personalMode = false): MenuItem[] {
  const hasPermission = (code?: string): boolean => {
    if (!code) return true;
    if (permissions.includes('*')) return true;
    return permissions.includes(code);
  };
  // 公司管理（部署级入口）：预览按「默认公司 + 超级管理员」口径——与 Sidebar 运行期过滤同规则
  const canManageCompanies = permissions.includes('*');

  return items
    .map((item) => {
      const inherited = item.permission;
      const children = item.children
        ?.map((c) => ({ ...c, permission: c.permission ?? inherited }))
        .filter(
          (c) =>
            hasPermission(c.permission) &&
            (c.path !== '/system/companies' || canManageCompanies) &&
            !hiddenInPersonalMode(c.path, personalMode),
        );
      return {
        ...item,
        children: children && children.length > 0 ? children : undefined,
      };
    })
    .filter(
      (item) =>
        ((hasPermission(item.permission) && (item.path !== '/system/companies' || canManageCompanies)) ||
          (item.children && item.children.length > 0)) &&
        !hiddenInPersonalMode(item.path, personalMode),
    )
    .sort((a, b) => navFreqRank(a.path) - navFreqRank(b.path));
}

/** 预览统计：一级菜单数 + 子菜单总数（用于「可见 N 个菜单 / M 个子项」摘要） */
export function menuPreviewStats(items: MenuItem[]): { menus: number; children: number } {
  return {
    menus: items.length,
    children: items.reduce((n, m) => n + (m.children?.length || 0), 0),
  };
}
