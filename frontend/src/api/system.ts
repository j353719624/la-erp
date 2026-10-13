import { http } from '@/utils/request';
import { User, Role, Permission, Department } from '@/types';
import { PaginationParams, PaginationResult } from '@/types';
import { NotificationItem, NotificationListResult, UnreadCountResult } from '@/types/notification';

// 单号规则（B-05 2026-09-13）：前缀/日期段/流水位数/重置策略可配置
export interface NumberingRule {
  biz_type: string;
  label: string;
  prefix: string;
  date_format: '' | '2006' | '200601' | '20060102';
  seq_digits: number;
  reset: 'never' | 'yearly' | 'monthly' | 'daily';
  sample: string;
  is_default: boolean;
  /** 系统默认值（页面「恢复默认」直接回填，避免前端写死前缀/位数） */
  default_prefix: string;
  default_date_format: '' | '2006' | '200601' | '20060102';
  default_seq_digits: number;
  default_reset: 'never' | 'yearly' | 'monthly' | 'daily';
}

export const numberingApi = {
  list: async () => {
    return http.get<NumberingRule[]>('/v1/numbering-rules');
  },
  /** 批量预览下一号（按可见行懒加载，一次最多 20 个对象） */
  preview: async (bizTypes: string[]) => {
    return http.get<Record<string, string>>('/v1/numbering-rules/preview', { biz_types: bizTypes.join(',') });
  },
  save: async (rules: NumberingRule[]) => {
    return http.put<NumberingRule[]>('/v1/numbering-rules', { rules });
  },
};

export const userApi = {
  list: async (params?: PaginationParams) => {
    return http.get<PaginationResult<User>>('/v1/users', params);
  },

  get: async (id: string) => {
    return http.get<User>(`/v1/users/${id}`);
  },

  create: async (data: Partial<User>) => {
    return http.post<User>('/v1/users', data);
  },

  update: async (id: string, data: Partial<User>) => {
    return http.put<User>(`/v1/users/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/users/${id}`);
  },

  assignRoles: async (id: string, data: { role_ids: string[] }) => {
    return http.post(`/v1/users/${id}/roles`, data);
  },

  /** 管理员重置用户密码：返回一次性临时密码（旧会话立即失效，2026-09-12） */
  resetPassword: async (id: string) => {
    return http.post<{ temp_password: string }>(`/v1/users/${id}/reset-password`, {});
  },
};

export const roleApi = {
  list: async (params?: PaginationParams) => {
    return http.get<PaginationResult<Role>>('/v1/roles', params);
  },

  get: async (id: string) => {
    return http.get<Role>(`/v1/roles/${id}`);
  },

  create: async (data: Partial<Role>) => {
    return http.post<Role>('/v1/roles', data);
  },

  update: async (id: string, data: Partial<Role>) => {
    return http.put<Role>(`/v1/roles/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/roles/${id}`);
  },

  assignPermissions: async (id: string, data: { permission_ids: string[] }) => {
    return http.post(`/v1/roles/${id}/permissions`, data);
  },
};

export const departmentApi = {
  list: async (params?: PaginationParams) => {
    return http.get<PaginationResult<Department>>('/v1/departments', params);
  },

  listAll: async () => {
    return http.get<Department[]>('/v1/departments/all');
  },

  get: async (id: string) => {
    return http.get<Department>(`/v1/departments/${id}`);
  },

  create: async (data: Partial<Department>) => {
    return http.post<Department>('/v1/departments', data);
  },

  update: async (id: string, data: Partial<Department>) => {
    return http.put<Department>(`/v1/departments/${id}`, data);
  },

  /** [2026-09-17 组织架构可视化] 调整部门归属：parentId=null 移到顶级（服务端强制防成环） */
  move: async (id: string, parentId: string | null) => {
    return http.put<Department>(`/v1/departments/${id}/move`, { parent_id: parentId });
  },

  delete: async (id: string) => {
    return http.delete(`/v1/departments/${id}`);
  },
};

export const isolationApi = {
  get: async () => {
    return http.get<{ mode: string }>('/v1/data-isolation');
  },

  set: async (mode: string) => {
    return http.put<{ mode: string }>('/v1/data-isolation', { mode });
  },
};

export const permissionApi = {
  list: async (params?: PaginationParams) => {
    return http.get<PaginationResult<Permission>>('/v1/permissions', params);
  },

  get: async (id: string) => {
    return http.get<Permission>(`/v1/permissions/${id}`);
  },

  create: async (data: Partial<Permission>) => {
    return http.post<Permission>('/v1/permissions', data);
  },

  update: async (id: string, data: Partial<Permission>) => {
    return http.put<Permission>(`/v1/permissions/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/permissions/${id}`);
  },
};

export const notificationApi = {
  list: async (params?: PaginationParams & { unread_only?: boolean }) => {
    return http.get<NotificationListResult>('/v1/notifications', params);
  },

  unreadCount: async () => {
    return http.get<UnreadCountResult>('/v1/notifications/unread-count');
  },

  markRead: async (id: string) => {
    return http.put(`/v1/notifications/${id}/read`);
  },

  markAllRead: async () => {
    return http.put<{ updated: number }>('/v1/notifications/read-all');
  },
};

export const leadApi = {
  list: async (params?: PaginationParams & { status?: string; owner?: string }) => {
    return http.get<PaginationResult<any>>('/v1/leads', params);
  },
  create: async (data: any) => { return http.post<any>('/v1/leads', data); },
  get: async (id: string) => { return http.get<any>(`/v1/leads/${id}`); },
  status: async (id: string, status: string) => { return http.post<any>(`/v1/leads/${id}/status?status=${status}`); },
  // [2026-09-19 第六批③] 转化可选参数：关联已有客户 / 同时建商机；返回 { customer, opportunity? }
  convert: async (id: string, data?: { customer_id?: string | null; create_opportunity?: boolean; opportunity_name?: string; amount?: number; owner?: string }) => {
    return http.post<{ customer: { id: string; code: string; name: string }; opportunity?: { id: string; code: string; name: string } | null }>(`/v1/leads/${id}/convert`, data ?? {});
  },
  remove: async (id: string) => { return http.delete(`/v1/leads/${id}`); },
};
