/**
 * 「我的快捷方式」（P-05，2026-09-14）：顶栏个人自定义快捷入口。
 *
 * 需求：用户希望在顶部「首页」旁放几个自己常用的页面快捷方式，自己挑选。
 * 设计：
 *   - 展示位：Header 面包屑右侧——PC lg 以上平铺；手机/窄屏收进 ⚡ 下拉（P-05b，用户实测反馈）
 *   - 配置位：个人中心（点击右上角头像进入）→「我的快捷方式」卡片
 *   - 存储：localStorage（本机个人偏好，与主题/密度同类；键登记 localKeys.ts）
 *   - 选项来源：Sidebar 导出的 menuItems（菜单单一数据源）+ 与命令面板同口径的权限过滤
 *   - 保存后通过 window 自定义事件即时刷新顶栏（同标签页）；跨标签页靠 storage 事件
 */
import { menuItems } from '@/components/Layout/Sidebar';
import { hiddenInPersonalMode } from '@/utils/menuPreview';
import { LS } from '@/utils/localKeys';

export interface QuickLink {
  label: string;
  path: string;
}

/** 最多可配置的快捷方式数量 */
export const QUICK_LINKS_MAX = 6;

/** 保存后通知顶栏刷新的事件名 */
export const QUICK_LINKS_EVENT = 'laerp-quicklinks-changed';

/**
 * 全部可选快捷方式：从全站菜单扁平化（与命令面板同口径——子项继承父级权限码后过滤）。
 * has(code) 传当前用户的权限判断函数（super_admin 通配已由调用方处理）。
 */
export function quickLinkOptions(has: (code?: string) => boolean, personalMode = false): QuickLink[] {
  const out: QuickLink[] = [];
  const seen = new Set<string>();
  for (const m of menuItems) {
    const children = m.children
      ?.map((c) => ({ ...c, permission: c.permission ?? m.permission }))
      .filter((c) => has(c.permission) && !hiddenInPersonalMode(c.path, personalMode));
    if (children && children.length > 0) {
      for (const c of children) {
        if (!seen.has(c.path)) {
          seen.add(c.path);
          out.push({ label: c.label, path: c.path });
        }
      }
    } else if (!m.children && has(m.permission) && m.path && !hiddenInPersonalMode(m.path, personalMode)) {
      if (!seen.has(m.path)) {
        seen.add(m.path);
        out.push({ label: m.label, path: m.path });
      }
    }
  }
  return out;
}

/** 读取已配置的快捷方式（损坏数据静默丢弃，保证顶栏不炸） */
export function readQuickLinks(): QuickLink[] {
  try {
    const raw = localStorage.getItem(LS.quickLinks);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.path === 'string' && typeof x.label === 'string')
      .slice(0, QUICK_LINKS_MAX);
  } catch {
    return [];
  }
}

/** 保存（截断上限）+ 通知顶栏即时刷新 */
export function saveQuickLinks(links: QuickLink[]): void {
  try {
    localStorage.setItem(LS.quickLinks, JSON.stringify(links.slice(0, QUICK_LINKS_MAX)));
    window.dispatchEvent(new Event(QUICK_LINKS_EVENT));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
