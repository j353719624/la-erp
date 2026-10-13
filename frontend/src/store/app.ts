import { create } from 'zustand';
import { LS } from '@/utils/localKeys';
import {
  applyDensity,
  applyPreferences,
  applyTheme,
  readPreferences,
  resolveTheme,
  subscribeResolvedTheme,
  writePreferences,
  type Density,
  type ThemeMode,
} from '@/utils/preferences';

export type { ThemeMode };

interface AppState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  currentPage: string;
  setCurrentPage: (page: string) => void;
  breadcrumb: string[];
  setBreadcrumb: (breadcrumb: string[]) => void;
  /** 用户选择的主题模式（light/dark/system，P-01 2026-09-13） */
  theme: ThemeMode;
  /** 实际生效主题（system 跟随系统，系统深浅色切换时实时更新） */
  resolvedTheme: 'light' | 'dark';
  /** 表格密度（comfortable/compact） */
  density: Density;
  setTheme: (mode: ThemeMode) => void;
  setDensity: (density: Density) => void;
  /** 头部快捷按钮：按当前实际主题取反（显式退出 system 模式，符合预期） */
  toggleTheme: () => void;
  /** 启动时应用全部偏好（App 挂载调用） */
  initTheme: () => void;
  /**
   * 「个人模式」（2026-09-22）：夫妻店/个人/小加工 —— 无审批链、允许无库存开单。
   * 只读镜像后端设置（system_setting.personal_mode），由 Layout 从 /settings/company 拉取后写入；
   * 页面只读它做 UI 收敛（隐藏「提交审批」按钮等），一切限制的实际放开均在后端判断。
   */
  personalMode: boolean;
  setPersonalMode: (on: boolean) => void;
}

// 侧边栏折叠态持久化（2026-09-12）：仅用户手动折叠（toggleSidebar）时写入；
// 中屏自动折叠走 setSidebarCollapsed（不写），避免“系统自动折叠”被当成用户偏好。
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(LS.sidebarCollapsed) === '1';
  } catch {
    return false;
  }
}
function writeSidebarCollapsed(v: boolean): void {
  try {
    localStorage.setItem(LS.sidebarCollapsed, v ? '1' : '0');
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarCollapsed: readSidebarCollapsed(),

  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed;
      writeSidebarCollapsed(next); // 用户手动折叠：刷新后保持
      return { sidebarCollapsed: next };
    }),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  mobileMenuOpen: false,

  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),

  currentPage: '',

  setCurrentPage: (page) => set({ currentPage: page }),

  breadcrumb: [],

  setBreadcrumb: (breadcrumb) => set({ breadcrumb }),

  personalMode: false,

  setPersonalMode: (on) => set({ personalMode: on }),

  // ── 个人偏好（P-01）：初始值取自 preferences（localStorage，含老键迁移）──
  theme: readPreferences().theme,
  resolvedTheme: resolveTheme(readPreferences().theme),
  density: readPreferences().density,

  setTheme: (mode) => {
    writePreferences({ theme: mode });
    const effective = applyTheme(mode);
    set({ theme: mode, resolvedTheme: effective });
  },

  setDensity: (density) => {
    writePreferences({ density });
    applyDensity(density);
    set({ density });
  },

  toggleTheme: () => {
    const next: ThemeMode = get().resolvedTheme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  initTheme: () => {
    const p = applyPreferences();
    set({ theme: p.theme, resolvedTheme: resolveTheme(p.theme), density: p.density });
    // 跟随系统：系统深浅色变化时同步 resolvedTheme（订阅仅绑定一次）
    if (!themeSubscriptionBound) {
      themeSubscriptionBound = true;
      subscribeResolvedTheme((effective) => set({ resolvedTheme: effective }));
    }
  },
}));

/** 系统色订阅只绑一次（initTheme 可能被重复调用，如 HMR） */
let themeSubscriptionBound = false;
