import { http } from '@/utils/request';
import { User } from '@/types';

export interface LoginParams {
  username: string;
  password: string;
  /** 多公司部署：目标公司编码（登录页公司选择器提供）；单公司部署可省略 */
  company?: string;
}

export interface LoginResult {
  access_token: string;
  refresh_token: string;
  user: User;
  roles: any[];
  permissions: string[];
  need_change_password?: boolean;
  /** 多公司（2026-09-17）：当前登录所属公司编码 / 是否默认公司（供菜单收敛与提示） */
  company?: string;
  company_is_default?: boolean;
}

export const authApi = {
  login: async (params: LoginParams) => {
    return http.post<LoginResult>('/v1/auth/login', params);
  },

  refresh: async (refreshToken: string) => {
    return http.post<LoginResult>('/v1/auth/refresh', { refresh_token: refreshToken });
  },

  /**
   * 登出（吊销令牌）：可传显式 access token——退出登录时本地令牌已被清除，
   * 依赖拦截器从 storage 读 token 会拿不到（2026-09-13 审查修复：吊销曾整单失效）。
   */
  logout: async (token?: string) => {
    return http.post('/v1/auth/logout', undefined, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  },

  /** 当前登录用户的最新权限（应用启动时刷新，升级新增权限码后无需重新登录）；含当前公司信息（多公司） */
  me: async () => {
    return http.get<{ permissions: string[]; company?: string; company_is_default?: boolean }>('/v1/auth/me');
  },

  changePassword: async (params: { old_password: string; new_password: string }) => {
    return http.post('/v1/users/change-password', params);
  },
};
