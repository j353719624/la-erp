import { create } from 'zustand';
import { authApi } from '@/api/auth';
import { storage } from '@/utils/storage';
import { useAppStore } from '@/store/app';
import { User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  permissions: string[];
  /** 是否仍在使用默认口令（admin/admin123），用于登录后提示强制改密（F5） */
  needChangePassword: boolean;
  /** 多公司（2026-09-17）：当前登录所属公司编码与是否默认公司（「公司管理」入口收敛） */
  company: string;
  companyIsDefault: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User, token: string, refreshToken?: string, permissions?: string[], needChangePassword?: boolean, company?: string, companyIsDefault?: boolean) => void;
  logout: () => void;
  initAuth: () => void;
  updatePermissions: (permissions: string[]) => void;
  /** 从服务端拉取最新权限快照（应用启动时调用，升级/调权限后刷新页面即生效）；同时刷新公司信息 */
  refreshPermissions: () => Promise<void>;
  setNeedChangePassword: (needChangePassword: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  permissions: [],
  needChangePassword: false,
  company: '',
  companyIsDefault: false,
  isAuthenticated: false,
  isLoading: true,

  login: (user, token, refreshToken, permissions, needChangePassword, company, companyIsDefault) => {
    storage.setUser(user);
    storage.setToken(token);
    if (refreshToken) {
      storage.setRefreshToken(refreshToken);
    }
    const perms = permissions || [];
    storage.setPermissions(perms);
    if (company) {
      storage.setCompany(company, !!companyIsDefault);
    }
    const remembered = storage.getCompany();
    set({
      user,
      token,
      permissions: perms,
      needChangePassword: !!needChangePassword,
      company: company || remembered?.code || '',
      companyIsDefault: company ? !!companyIsDefault : !!remembered?.isDefault,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  logout: () => {
    // [2026-09-13 审查修复] 原实现「先 void 发请求 → 立即 storage.clear()」存在时序缺陷：
    // axios 请求拦截器在微任务里读 token，执行时 storage 已被清空 → 吊销请求不带 Authorization
    // （401 被 catch 吞掉）→ token_version 不递增、旧 access token 2h 内仍有效。
    // 现在：先捕获 token → 本地立即登出（UI 无感）→ 用显式 Authorization 请求后端吊销。
    const token = storage.getToken();
    // 公司记忆保留（storage 不清 company）：下次登录默认选中上次公司（仅体验，不影响安全）
    const remembered = storage.getCompany();
    storage.clear();
    set({
      user: null,
      token: null,
      permissions: [],
      needChangePassword: false,
      company: remembered?.code || '',
      companyIsDefault: !!remembered?.isDefault,
      isAuthenticated: false,
      isLoading: false,
    });
    // 「个人模式」是服务端设置，登出后必须复位本地镜像：
    // 否则同一 SPA 会话内换公司/换账号登录时会残留上一会话的值，
    // 导致「标准模式的公司」把「提交审批」永久隐藏（2026-09-22 审查修复；fail-safe 回标准模式）。
    useAppStore.getState().setPersonalMode(false);
    if (token) void authApi.logout(token).catch(() => {});
  },

  updatePermissions: (permissions) => {
    storage.setPermissions(permissions);
    set({ permissions });
  },

  refreshPermissions: async () => {
    // 未登录（登录页/客户门户）无需拉取；令牌失效由请求拦截器统一处理（静默续期或跳登录）
    if (!storage.getToken()) return;
    try {
      const res = await authApi.me();
      if (res.code === 0 && Array.isArray(res.data?.permissions)) {
        storage.setPermissions(res.data.permissions);
        const patch: Partial<AuthState> = { permissions: res.data.permissions };
        // 多公司：/auth/me 同时返回当前公司（存量旧会话首次刷新即补全公司信息）
        if (res.data.company) {
          storage.setCompany(res.data.company, !!res.data.company_is_default);
          patch.company = res.data.company;
          patch.companyIsDefault = !!res.data.company_is_default;
        }
        set(patch);
      }
    } catch {
      // 忽略：保持现有权限快照，避免网络抖动导致界面异常
    }
  },

  setNeedChangePassword: (needChangePassword) => {
    set({ needChangePassword });
  },

  initAuth: () => {
    const user = storage.getUser<User>();
    const token = storage.getToken();
    const permissions = storage.getPermissions();
    const remembered = storage.getCompany();
    if (user && token) {
      set({
        user,
        token,
        permissions,
        company: remembered?.code || '',
        companyIsDefault: !!remembered?.isDefault,
        isAuthenticated: true,
        isLoading: false,
      });
    } else {
      set({ isLoading: false });
    }
  },
}));
