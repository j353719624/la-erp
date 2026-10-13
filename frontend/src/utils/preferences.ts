import { LS } from './localKeys';

/**
 * 个人偏好（P-01，2026-09-13）：主题三态 / 表格密度 / 默认每页条数。
 *
 * 设计要点：
 *  - **单一存储键** `LS.preferences`（JSON），键名登记在 `utils/localKeys.ts`；
 *    老格式 `laerp_theme`（单值 light/dark）首次读取时自动迁移，旧用户偏好不丢。
 *  - 主题三态：`light` / `dark` / **`system`**（跟随操作系统深浅色，系统切换实时生效）。
 *    默认 `light` —— 与升级前行为一致（勿改成 system，否则老用户界面会随系统突变）。
 *  - 密度：`comfortable`（默认）/ `compact`（html.compact，CSS 压低表格行高）。
 *  - 每页条数：`pageSize`，**0 = 未设置**（列表页沿用各自默认，如审计日志 20 条）；
 *    由 `useListFiltersUrl` 在 URL 未带 `page_size` 时消费。
 *
 * 用法：启动应用时 `applyPreferences()`；个人中心改偏好走 `writePreferences + applyXxx`；
 * 头部快捷按钮走 `store/app.ts` 的 setTheme/toggleTheme。
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

export interface Preferences {
  theme: ThemeMode;
  density: Density;
  pageSize: number;
}

/** 默认值：主题 light（升级前行为）/ 密度舒适 / 每页条数未设置 */
export const PREFERENCE_DEFAULTS: Preferences = {
  theme: 'light',
  density: 'comfortable',
  pageSize: 0,
};

/** 可选的每页条数（与分页组件的选项保持一致） */
export const PAGE_SIZE_CHOICES = [10, 20, 50, 100] as const;

/** 升级前主题键（单值）：读取时一次性迁移进 LS.preferences */
const LEGACY_THEME_KEY = 'laerp_theme';

/** 归一化：脏数据/非法值一律回落默认（老库零迁移原则的 localStorage 版） */
function normalize(raw: Partial<Preferences> | null | undefined): Preferences {
  const out: Preferences = { ...PREFERENCE_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system') out.theme = raw.theme;
  if (raw.density === 'comfortable' || raw.density === 'compact') out.density = raw.density;
  const ps = Number(raw.pageSize);
  if ((PAGE_SIZE_CHOICES as readonly number[]).includes(ps)) out.pageSize = ps;
  return out;
}

export function readPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(LS.preferences);
    if (stored) return normalize(JSON.parse(stored) as Partial<Preferences>);
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') {
      const migrated: Preferences = { ...PREFERENCE_DEFAULTS, theme: legacy };
      try {
        localStorage.setItem(LS.preferences, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_THEME_KEY);
      } catch {
        /* 隐私模式等场景忽略 */
      }
      return migrated;
    }
  } catch {
    /* 脏数据/隐私模式：回落默认 */
  }
  return { ...PREFERENCE_DEFAULTS };
}

/** 合并写入（返回归一化后的完整偏好） */
export function writePreferences(patch: Partial<Preferences>): Preferences {
  const next = normalize({ ...readPreferences(), ...patch });
  try {
    localStorage.setItem(LS.preferences, JSON.stringify(next));
  } catch {
    /* 忽略 */
  }
  return next;
}

// ── DOM 应用（副作用集中在此模块，页面/组件只调 API）──────────────────────────

const mediaQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** system 模式下实际生效的主题 */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return mediaQuery()?.matches ? 'dark' : 'light';
  }
  return mode;
}

let watcherBound = false;
const resolvedListeners = new Set<(t: 'light' | 'dark') => void>();

/** 订阅「实际生效主题」变化（跟随系统时，系统深浅切换会触发）；返回退订函数 */
export function subscribeResolvedTheme(fn: (t: 'light' | 'dark') => void): () => void {
  bindSystemWatcher();
  resolvedListeners.add(fn);
  return () => {
    resolvedListeners.delete(fn);
  };
}

function bindSystemWatcher(): void {
  if (watcherBound) return;
  const mq = mediaQuery();
  if (!mq) return;
  watcherBound = true;
  const onChange = () => {
    // 仅 system 模式响应系统变化；显式 light/dark 不受影响
    if (readPreferences().theme !== 'system') return;
    applyTheme('system');
  };
  mq.addEventListener?.('change', onChange);
}

/** 应用主题（返回实际生效值）：html.dark + 通知订阅者 */
export function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const effective = resolveTheme(mode);
  bindSystemWatcher();
  try {
    document.documentElement.classList.toggle('dark', effective === 'dark');
  } catch {
    /* SSR/测试环境 */
  }
  resolvedListeners.forEach((fn) => fn(effective));
  return effective;
}

/** 应用表格密度：html.compact（CSS 见 index.css「表格密度」段） */
export function applyDensity(density: Density): void {
  try {
    document.documentElement.classList.toggle('compact', density === 'compact');
  } catch {
    /* 忽略 */
  }
}

/** 启动时一次性应用全部偏好（App 挂载时调用；返回生效偏好） */
export function applyPreferences(prefs?: Preferences): Preferences {
  const p = prefs ?? readPreferences();
  applyTheme(p.theme);
  applyDensity(p.density);
  return p;
}

/** 列表页默认每页条数（0 = 未设置，页面沿用自身默认；由 useListFiltersUrl 消费） */
export function getPreferredPageSize(): number {
  return readPreferences().pageSize;
}
