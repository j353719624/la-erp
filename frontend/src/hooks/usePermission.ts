import { useAuthStore } from '@/store/auth';

/** 导入导出专用权限码（后端 importexport 模块统一使用该码，2026-09-12） */
export const PERM_IMPORT_EXPORT = 'import_export';

/**
 * RBAC 权限判断（与 Sidebar 同规则）：
 * - permission 为 '*' 表示全权限（super_admin）
 * - 未配置权限码的场景默认可见
 */
export function usePermission() {
  const permissions = useAuthStore((s) => s.permissions) || [];
  const has = (code?: string): boolean => {
    if (!code) return true;
    if (permissions.includes('*')) return true;
    return permissions.includes(code);
  };
  return { has, canImportExport: has(PERM_IMPORT_EXPORT) };
}

/**
 * 非组件环境（工具函数：导出/上传）使用的即时权限判断。
 * 直接读取 store 快照——用于在动作发生时拦截，而非渲染。
 */
export function hasPermissionNow(code: string): boolean {
  const permissions = useAuthStore.getState().permissions || [];
  return permissions.includes('*') || permissions.includes(code);
}
