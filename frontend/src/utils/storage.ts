const TOKEN_KEY = 'la-erp-token';
const REFRESH_TOKEN_KEY = 'la-erp-refresh-token';
const USER_KEY = 'la-erp-user';
const PERMISSIONS_KEY = 'la-erp-permissions';
// 多公司（2026-09-17）：当前/上次登录公司（登录页默认选中项）。非敏感信息，登出不清除（仅作体验记忆）
const COMPANY_KEY = 'la-erp-company';

export const storage = {
  getToken: (): string | null => {
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken: (token: string): void => {
    localStorage.setItem(TOKEN_KEY, token);
  },

  removeToken: (): void => {
    localStorage.removeItem(TOKEN_KEY);
  },

  getRefreshToken: (): string | null => {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },

  setRefreshToken: (token: string): void => {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  },

  removeRefreshToken: (): void => {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },

  getPermissions: (): string[] => {
    try {
      return JSON.parse(localStorage.getItem(PERMISSIONS_KEY) || '[]') as string[];
    } catch {
      return [];
    }
  },

  setPermissions: (permissions: string[]): void => {
    localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions));
  },

  getUser: <T>(): T | null => {
    const user = localStorage.getItem(USER_KEY);
    return user ? JSON.parse(user) : null;
  },

  setUser: <T>(user: T): void => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  removeUser: (): void => {
    localStorage.removeItem(USER_KEY);
  },

  /** 当前/上次登录公司（登录页默认选中；登出保留作体验记忆） */
  getCompany: (): { code: string; isDefault: boolean } | null => {
    try {
      const raw = localStorage.getItem(COMPANY_KEY);
      return raw ? (JSON.parse(raw) as { code: string; isDefault: boolean }) : null;
    } catch {
      return null;
    }
  },

  setCompany: (code: string, isDefault: boolean): void => {
    localStorage.setItem(COMPANY_KEY, JSON.stringify({ code, isDefault }));
  },

  clear: (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PERMISSIONS_KEY);
  },
};
