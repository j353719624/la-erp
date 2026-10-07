import { http } from '@/utils/request';

/**
 * 多公司（多组织）前端 API（2026-09-17）。
 *
 * - publicList：登录页公司下拉（免认证；仅启用中的公司，最小暴露：编码/名称/默认标记）。
 *   单公司部署时后端仍返回 1 条，登录页据此自动隐藏选择器（与升级前体验一致）。
 * - list/create/update：部署控制台「公司管理」。仅默认公司的 super_admin 可操作
 *   （后端双重校验；其余情况返回 403，页面给出中文提示）。
 */
export interface PublicCompany {
  code: string;
  name: string;
  is_default: boolean;
}

export interface CompanyInfo {
  id: string;
  code: string;
  name: string;
  status: string;
  is_default: boolean;
  db_path: string;
  db_size: number;
  loaded: boolean;
  last_error?: string;
  created_at: string;
}

export interface CreateCompanyParams {
  code: string;
  name: string;
  with_demo_data?: boolean;
}

export interface UpdateCompanyParams {
  name?: string;
  status?: 'active' | 'disabled';
}

export const companyApi = {
  publicList: async () => http.get<PublicCompany[]>('/v1/companies/public'),

  list: async () => http.get<CompanyInfo[]>('/v1/console/companies'),

  create: async (params: CreateCompanyParams) => http.post<CompanyInfo>('/v1/console/companies', params),

  update: async (id: string, params: UpdateCompanyParams) =>
    http.put<CompanyInfo>(`/v1/console/companies/${id}`, params),
};
