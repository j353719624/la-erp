import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { menuItems } from '@/components/Layout/Sidebar';
import { visibleMenusForPreview, menuPreviewStats } from '@/utils/menuPreview';
import { useAppStore } from '@/store/app';

interface PermissionMenuPreviewProps {
  /** 该角色拥有的权限码集合（'*' = 全权限） */
  permissions: string[];
  /** 底部说明文案 */
  caption?: string;
  /** 菜单区最大高度（超出滚动） */
  maxHeight?: string;
  className?: string;
}

/**
 * 菜单预览面板（2026-09-17 角色可视化）：所见即所得地展示
 * 「拥有这些权限的用户，登录后左侧导航会看到哪些菜单」。
 *
 * 数据源 = 真实侧边栏 menuItems（单一来源，与运行期完全一致），
 * 过滤规则见 utils/menuPreview.ts（与 Sidebar.visibleMenus 同步，门禁 0.85 断言）。
 */
export function PermissionMenuPreview({
  permissions,
  caption = '与登录后左侧导航一致（按所选权限实时计算）',
  maxHeight = '420px',
  className = '',
}: PermissionMenuPreviewProps) {
  const codesKey = permissions.join('\u0000');
  // 「个人模式」下「我的审批/审批流程」不可见——预览必须与运行期侧栏一致（同一隐藏清单）
  const personalMode = useAppStore((s) => s.personalMode);
  const menus = useMemo(
    () => visibleMenusForPreview(menuItems, permissions, personalMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [codesKey, personalMode],
  );
  const stats = menuPreviewStats(menus);
  const allPower = permissions.includes('*');

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-sm font-medium text-gray-700">菜单预览</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${stats.menus > 0 ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
          可见 {stats.menus} 个菜单 · {stats.children} 个子项
        </span>
        {allPower && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">
            <ShieldCheck className="w-3 h-3" />
            全权限（超级管理员）
          </span>
        )}
      </div>

      <div className="rounded-lg bg-blue-900 p-2 overflow-y-auto" style={{ maxHeight }}>
        {menus.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-blue-300">
            该角色登录后看不到任何菜单，请至少勾选一个「XX列表」类权限
          </div>
        ) : (
          <ul className="space-y-0.5">
            {menus.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.path}>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-blue-100">
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-[13px] font-medium flex-1 truncate">{item.label}</span>
                    {item.children && (
                      <span className="text-[11px] text-blue-300">{item.children.length} 项</span>
                    )}
                  </div>
                  {item.children && item.children.length > 0 && (
                    <ul className="mt-0.5 mb-1 space-y-0.5">
                      {item.children.map((child) => (
                        <li
                          key={child.path}
                          className="flex items-center gap-2 pl-8 pr-2.5 py-1 text-blue-300"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
                          <span className="text-xs truncate">{child.label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {caption && <p className="text-xs text-gray-400 mt-2">{caption}</p>}
    </div>
  );
}
