/**
 * localStorage 键名集中管理（上下文复查 2026-09-11）。
 *
 * 起因：上手清单的"已看过报表"标记曾被 OnboardingCard 与报表页各自硬编码字符串，
 * 一旦有一处改名就静默失效（同一件事多处实现 = 本项目最高频缺陷类型）。
 */
export const LS = {
  /** 仪表盘上手清单：用户点"不再提示" */
  onboardingDismissed: 'la-erp-onboarding-dismissed',
  /** 仪表盘上手清单：是否看过经营报表（任一报表页写入） */
  onboardingReportSeen: 'la-erp-onboarding-report-seen',
  /** 命令面板最近访问的页面路径 */
  commandRecent: 'la-erp-command-recent',
  /** 表格视图预设（按页面分桶，实际键为 `${tableViewPresets}:${pageKey}`） */
  tableViewPresets: 'la-erp-table-view',
  /** 侧边栏折叠状态（仅用户手动折叠时写入；页面刷新后保持） */
  sidebarCollapsed: 'la-erp-sidebar-collapsed',
  /** PWA 安装/新版本浮层：用户关闭过（刷新不再打扰） */
  pwaPromptDismissed: 'la-erp-pwa-dismissed',
  /** 报表期间记忆（按报表页分桶，实际键为 `${reportPeriod}:${page}`） */
  reportPeriod: 'la-erp-report-period',
  /** 开单默认值记忆（按单据页分桶，实际键为 `${docDefaults}:${pageKey}:${field}`） */
  docDefaults: 'la-erp-doc-defaults',
  /** 筛选预设（按页面分桶，实际键为 `${filterPresets}:${pageKey}`） */
  filterPresets: 'la-erp-filter-presets',
  /** 个人偏好（P-01：主题三态/表格密度/默认每页条数，单一 JSON 键） */
  preferences: 'la-erp-preferences',
  /** 「我的快捷方式」（P-05）：顶栏个人自定义快捷入口（JSON 数组，最多 6 个） */
  quickLinks: 'la-erp-quick-links',
  /** 客户门户：访问 token（门户独立会话，与内部用户 token 分离） */
  portalToken: 'la-erp-portal-token',
  /** 客户门户：当前客户名称 */
  portalCustomerName: 'la-erp-portal-customer-name',
  /** 客户门户：当前客户 ID（购物车按客户分桶：`${portalCartPrefix}:${customerId}`） */
  portalCustomerId: 'la-erp-portal-customer-id',
  /** 客户门户：购物车前缀（后续拼接客户 ID） */
  portalCartPrefix: 'la-erp-portal-cart',
} as const;

/** 标记"已看过经营报表"——仪表盘上手清单据此自动打勾（各报表页挂载时调用） */
export function markReportSeen(): void {
  try {
    localStorage.setItem(LS.onboardingReportSeen, '1');
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
