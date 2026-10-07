import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { storage } from './storage';
import { LS } from './localKeys';
import { DATE_FIELD_SUFFIX } from './format';
import { useAuthStore } from '@/store/auth';
import { useAppStore } from '@/store/app';

interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

/**
 * 清理请求数据：
 * 1. 空字符串分流：文本类字段保留空串=「显式清空」；id/日期/数字等删除=「不修改」
 *    （2026-09-17 审查：此前一律删除 → 用户删掉电话/备注再保存无效，后端视为“不修改”）
 * 2. 将 YYYY-MM-DD 格式的日期字符串转换为 ISO 8601 格式，后端 time.Time 需要
 */

/**
 * 文本类字段名（空串 = 显式清空；**未列入**的字段空串仍按「不修改」删除）：
 * 只收录可安全清空的文本字段；id/日期/数字类一律不列（空串发送会令后端 UUID/时间/数字解析失败）。
 */
const CLEARABLE_TEXT_KEY =
  /(^|_)(name|code|remark|note|memo|desc|description|address|phone|mobile|tel|fax|contact|contact_person|email|bank|bank_account|tax_no|avatar|url|link|spec|color|title|content|reason|summary|label|alias|position|website|wechat|id_card|invoice_title|legal_person)$/i;
/** 日期语义字段名：须以 date / _at / _until 结尾（(^|_) 边界锚定，防误伤 update/validate 等普通字段） */
const DATE_SUFFIX = /(^|_)(date|at|until)$/i;

function cleanData(data: any): any {
  if (data === null || data === undefined || typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(cleanData);
  }
  const cleaned: Record<string, any> = {};
  for (const key in data) {
    const value = data[key];
    if (value === '') {
      // [2026-09-17 审查修复] 空字符串按字段类型分流（此前一律删除 = 无法清空字段）：
      //  · 文本类 → 保留空串 = 显式清空（后端 *string 收到 "" 置空）
      //  · 其余（xxx_id / 日期 / 数字等）→ 删除 = 不修改（空串会令 UUID/时间/数字解析失败）
      if (CLEARABLE_TEXT_KEY.test(key)) {
        cleaned[key] = '';
      }
      continue;
    }
    if (typeof value === 'string' && DATE_SUFFIX.test(key) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      // 仅转换日期语义字段（date/_at/_until 结尾，如 order_date、created_at、valid_until）为 ISO 8601。
      // ⚠️ 旧正则 /(date|_at)$/ 两个缺陷（2026-09-17 实测）：① 漏网 valid_until（销售报价「有效期至」填写即 400）；
      //    ② 误伤 update/validate 等恰以 date 结尾的普通字段。
      // ⚠️ 后缀必须是**本地午夜**（+08:00）而非 `Z`（2026-09-22 三位一体审查修复）：
      //    服务端按本地日历天做区间查询/统计，`Z` 字面比本地边界小 → 丢区间首日
      //    （当天培训统计恒 0 / 考勤月度汇总月初漏算 / 单据列表筛「当天」查不到）。
      cleaned[key] = value + DATE_FIELD_SUFFIX;
      continue;
    }
    cleaned[key] = cleanData(value);
  }
  return cleaned;
}

const request: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = storage.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ---- 无感续期：access token 过期时用 refresh token 换新 token 并重放请求 ----
let refreshPromise: Promise<boolean> | null = null;

// 独立 axios 实例调用刷新接口，避免触发本拦截器造成递归
const refreshRequest = axios.create({ baseURL: '/api', timeout: 10000 });

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = storage.getRefreshToken();
  if (!refreshToken) return false;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await refreshRequest.post<ApiResponse<{ access_token: string; refresh_token: string; permissions?: string[] }>>(
        '/v1/auth/refresh',
        { refresh_token: refreshToken }
      );
      if (res.data.code === 0 && res.data.data?.access_token) {
        // [2026-09-17 审查修复] 会话纪元校验：刷新期间若已登出/切换账号（refresh token 已被清除或替换），
        // 丢弃本次晚到的结果——否则会把旧会话 token 写回本地（与当前界面/账号不一致，极端时序可跨账号串号）。
        if (storage.getRefreshToken() !== refreshToken) return false;
        storage.setToken(res.data.data.access_token);
        if (res.data.data.refresh_token) {
          storage.setRefreshToken(res.data.data.refresh_token);
        }
        // 同步最新权限（角色权限变更后刷新即生效），供菜单/路由守卫使用
        if (Array.isArray(res.data.data.permissions)) {
          useAuthStore.getState().updatePermissions(res.data.data.permissions);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function redirectToLogin() {
  storage.clear();
  // 「个人模式」是服务端设置，令牌失效自动登出时也要复位本地镜像
  // （否则在已处于 /login 不跳转的分支下会残留上一会话的值 → 标准模式公司误隐藏审批入口）。
  useAppStore.getState().setPersonalMode(false);
  // [2026-09-17 审查修复] 已在登录页时不再强制跳转：登录页挂载即请求公开接口（/v1/public/company），
  // 该接口一旦 401 会「重载→再请求→再 401」造成整页循环；与门户 redirectToPortalLogin 的守卫对齐。
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

request.interceptors.response.use(
  async (response: AxiosResponse<ApiResponse>) => {
    // blob 下载（导出模板/导出数据/报表导出）：不走业务 code 判定，直接放行（P0 修复）
    if (response.config.responseType === 'blob') {
      return response;
    }
    const res = response.data;
    if (res.code !== 0 && res.code !== 200) {
      // 仅 401（令牌缺失/失效/过期）视为会话失效需重登；403（已登录但无权限）不应清会话跳登录，
      // 否则任意无 system 权限的业务角色在 Layout 挂载请求 /v1/settings 时会被误踢回登录页。
      if (res.code === 401) {
        // [FIX-Rev] P1：刷新接口自身失败不重试 + 单次重放上限（__retried），防无限 refresh 循环
        const url: string = response.config?.url || '';
        const cfg = response.config as any;
        const retried = cfg?.__retried;
        // [2026-09-17 登录修复] 登录接口自身的 401（账号/密码错误）不得走刷新/跳转链路：
        // 否则整页被强制刷新，登录页的错误提示一闪而过甚至丢失、已输入内容被清空
        // [P3-6] 用 endsWith 精确匹配（includes 会误命中 /auth/login-log 类路径）
        if (url.endsWith('/auth/login')) {
          return Promise.reject(new Error(res.message || '用户名或密码错误'));
        }
        if (!url.endsWith('/auth/refresh') && !retried && (await tryRefreshToken())) {
          cfg.__retried = true;
          return request(response.config);
        }
        redirectToLogin();
      }
      return Promise.reject(new Error(res.message || '请求失败'));
    }
    return response;
  },
  async (error) => {
    // 提取后端返回的错误信息
    const errData = error.response?.data;
    if (errData?.message) {
      error.message = errData.message;
    } else if (!error.response) {
      // 无响应 = 网络层错误（断连/超时）：转中文兜底，避免页面 catch 透传 err.message 时显示英文 "Network Error"
      error.message = '网络异常，请检查网络连接后重试';
    }
    if (error.response?.status === 401) {
      // 仅 401 需无感续期/重登；403（无权限）走 catch 展示错误，不清会话不跳登录
      const url: string = error.config?.url || '';
      // [2026-09-17 登录修复] 登录接口自身的 401 = 账号/密码错误：直接透传给登录页展示
      // （此前会走「刷新令牌→重放→跳登录页」链路 → 整页刷新、错误提示一闪而过甚至丢失、输入被清空）
      // [P3-6] 用 endsWith 精确匹配
      if (url.endsWith('/auth/login')) {
        return Promise.reject(error);
      }
      const retried = (error.config as any)?.__retried;
      // 刷新接口自身失败不再重试，避免递归
      if (!url.endsWith('/auth/refresh') && !retried) {
        if (await tryRefreshToken()) {
          error.config.__retried = true;
          return request(error.config);
        }
      }
      redirectToLogin();
    }
    return Promise.reject(error);
  }
);

export const http = {
  get: async <T = any>(url: string, params?: any): Promise<ApiResponse<T>> => {
    const response = await request.get<ApiResponse<T>>(url, { params });
    return response.data;
  },

  post: async <T = any>(url: string, data?: any, config?: { headers?: Record<string, string> }): Promise<ApiResponse<T>> => {
    const cleaned = cleanData(data);
    const response = await request.post<ApiResponse<T>>(url, cleaned, config);
    return response.data;
  },

  put: async <T = any>(url: string, data?: any): Promise<ApiResponse<T>> => {
    const cleaned = cleanData(data);
    const response = await request.put<ApiResponse<T>>(url, cleaned);
    return response.data;
  },

  delete: async <T = any>(url: string, params?: any): Promise<ApiResponse<T>> => {
    const response = await request.delete<ApiResponse<T>>(url, { params });
    return response.data;
  },

  /** 上传（multipart/form-data）：直接传 FormData，不清理、不覆盖 Content-Type */
  upload: async <T = any>(url: string, formData: FormData): Promise<ApiResponse<T>> => {
    const response = await request.post<ApiResponse<T>>(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /** 下载（blob）：用于文件/CSV 导出 */
  download: async (url: string, params?: any): Promise<Blob> => {
    const response = await request.get(url, { params, responseType: 'blob' });
    return response.data;
  },
};

// ==================== 客户自助门户请求（独立 token，过期跳门户登录页） ====================
// [P3-13] 键名统一登记在 utils/localKeys.ts（禁止页面/工具内另行硬编码字符串）
export const portalStorage = {
  getToken: (): string | null => localStorage.getItem(LS.portalToken),
  setToken: (t: string) => localStorage.setItem(LS.portalToken, t),
  getCustomerName: (): string | null => localStorage.getItem(LS.portalCustomerName),
  setCustomerName: (n: string) => localStorage.setItem(LS.portalCustomerName, n),
  // 客户 ID：用于购物车按客户隔离（不同客户在同一设备登录互不可见）
  getCustomerId: (): string | null => localStorage.getItem(LS.portalCustomerId),
  setCustomerId: (id: string) => localStorage.setItem(LS.portalCustomerId, id),
  clear: () => {
    localStorage.removeItem(LS.portalToken);
    localStorage.removeItem(LS.portalCustomerName);
    localStorage.removeItem(LS.portalCustomerId);
  },
};

const portalRequest: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

portalRequest.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = portalStorage.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function redirectToPortalLogin() {
  portalStorage.clear();
  if (!window.location.pathname.startsWith('/portal/login')) {
    window.location.href = '/portal/login';
  }
}

portalRequest.interceptors.response.use(
  async (response: AxiosResponse<ApiResponse>) => {
    const res = response.data;
    if (res.code !== 0 && res.code !== 200) {
      // 仅 401 视为门户会话失效跳门户登录；403（无权限）仅拒绝，不误清门户会话
      if (res.code === 401) {
        // [2026-09-17 登录修复] 门户登录接口自身的 401（账号或密码错误）透传给登录页展示，不跳转
        // [P3-6] endsWith 精确匹配（与主拦截器一致，防 includes 误命中）
        const loginUrl: string = response.config?.url || '';
        if (!loginUrl.endsWith('/portal/login')) {
          redirectToPortalLogin();
        }
      }
      return Promise.reject(new Error(res.message || '请求失败'));
    }
    return response;
  },
  (error) => {
    const errData = error.response?.data;
    if (errData?.message) {
      error.message = errData.message;
    } else if (!error.response) {
      // 无响应 = 网络层错误（断连/超时）：转中文兜底（与主拦截器一致）
      error.message = '网络异常，请检查网络连接后重试';
    }
    if (error.response?.status === 401) {
      // [2026-09-17 登录修复] 门户登录接口自身的 401（账号或密码错误）透传给登录页展示，不跳转
      // [P3-6] endsWith 精确匹配（与主拦截器一致）
      const loginUrl: string = error.config?.url || '';
      if (!loginUrl.endsWith('/portal/login')) {
        redirectToPortalLogin();
      }
    }
    return Promise.reject(error);
  }
);

export const portalHttp = {
  get: async <T = any>(url: string, params?: any): Promise<ApiResponse<T>> => {
    const response = await portalRequest.get<ApiResponse<T>>(url, { params });
    return response.data;
  },

  post: async <T = any>(url: string, data?: any, config?: { headers?: Record<string, string> }): Promise<ApiResponse<T>> => {
    const response = await portalRequest.post<ApiResponse<T>>(url, cleanData(data), config);
    return response.data;
  },

  put: async <T = any>(url: string, data?: any): Promise<ApiResponse<T>> => {
    const response = await portalRequest.put<ApiResponse<T>>(url, cleanData(data));
    return response.data;
  },

  delete: async <T = any>(url: string, params?: any): Promise<ApiResponse<T>> => {
    const response = await portalRequest.delete<ApiResponse<T>>(url, { params });
    return response.data;
  },
};

export type { ApiResponse };
