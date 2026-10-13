import { http } from '@/utils/request';
import { Entity, Field, CreateFieldInput, UpdateFieldInput, BatchCreateFieldsInput, Layout } from '@/types/metadata';
import { PaginationParams, PaginationResult } from '@/types';

export const entityApi = {
  list: async (params?: { category?: string; keyword?: string } & PaginationParams) => {
    return http.get<PaginationResult<Entity>>('/v1/metadata/entities', params);
  },

  get: async (id: string) => {
    return http.get<Entity>(`/v1/metadata/entities/${id}`);
  },

  getByCode: async (code: string) => {
    return http.get<Entity>(`/v1/metadata/entities/code/${code}`);
  },

  create: async (data: Partial<Entity>) => {
    return http.post<Entity>('/v1/metadata/entities', data);
  },

  update: async (id: string, data: Partial<Entity>) => {
    return http.put<Entity>(`/v1/metadata/entities/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/metadata/entities/${id}`);
  },
};

export const fieldApi = {
  list: async (entityId: string) => {
    return http.get<Field[]>(`/v1/metadata/fields?entity_id=${entityId}`);
  },

  get: async (id: string) => {
    return http.get<Field>(`/v1/metadata/fields/${id}`);
  },

  create: async (data: CreateFieldInput) => {
    return http.post<Field>('/v1/metadata/fields', data);
  },

  update: async (id: string, data: UpdateFieldInput) => {
    return http.put<Field>(`/v1/metadata/fields/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/metadata/fields/${id}`);
  },

  batch: async (data: BatchCreateFieldsInput) => {
    return http.post<Field[]>('/v1/metadata/fields/batch', data);
  },
  /**
   * 轻量字段标签（登录即可读，2026-09-16）：
   * 业务单据页展示"商品自定义字段"中文名（code→name，按 sort_order）用；不含配置细节。
   */
  labels: async (entityCode: string) => {
    return http.get<{ code: string; name: string; sort_order?: number }[]>(
      `/v1/metadata/fields/labels?entity_code=${encodeURIComponent(entityCode)}`,
    );
  },
};

export const templateApi = {
  list: async (params?: { category?: string }) => {
    return http.get<any[]>('/v1/metadata/templates', params);
  },

  get: async (id: string) => {
    return http.get<any>(`/v1/metadata/templates/${id}`);
  },

  create: async (data: any) => {
    return http.post<any>('/v1/metadata/templates', data);
  },

  update: async (id: string, data: any) => {
    return http.put<any>(`/v1/metadata/templates/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/metadata/templates/${id}`);
  },

  getCurrent: async () => {
    return http.get<any>('/v1/metadata/templates/current');
  },

  apply: async (id: string) => {
    return http.post<any>(`/v1/metadata/templates/${id}/apply`);
  },
};
export const dynamicApi = {
  list: async (entityCode: string, params?: PaginationParams & { keyword?: string; filters?: any[] }) => {
    return http.get<PaginationResult<any>>(`/v1/dynamic/${entityCode}`, params);
  },

  get: async (entityCode: string, id: string) => {
    return http.get<any>(`/v1/dynamic/${entityCode}/${id}`);
  },

  create: async (entityCode: string, data: any) => {
    return http.post<any>(`/v1/dynamic/${entityCode}`, data);
  },

  update: async (entityCode: string, id: string, data: any) => {
    return http.put<any>(`/v1/dynamic/${entityCode}/${id}`, data);
  },

  delete: async (entityCode: string, id: string) => {
    return http.delete(`/v1/dynamic/${entityCode}/${id}`);
  },
};

export const layoutApi = {
  list: async (entityId: string, params?: { layout_type?: string; scope?: string }) => {
    return http.get<Layout[]>(`/v1/metadata/layouts?entity_id=${entityId}`, params as any);
  },

  get: async (id: string) => {
    return http.get<Layout>(`/v1/metadata/layouts/${id}`);
  },

  getDefault: async (entityId: string, layoutType: string) => {
    return http.get<Layout>(`/v1/metadata/layouts/default?entity_id=${entityId}&layout_type=${layoutType}`);
  },

  create: async (data: Partial<Layout>) => {
    return http.post<Layout>('/v1/metadata/layouts', data);
  },

  update: async (id: string, data: Partial<Layout>) => {
    return http.put<Layout>(`/v1/metadata/layouts/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/metadata/layouts/${id}`);
  },
};

export interface FieldPermission {
  id: string;
  role_id: string;
  entity_id: string;
  field_code: string;
  access_level: 'read' | 'write' | 'none';
}

export const fieldPermissionApi = {
  list: async (params: { role_id: string; entity_id: string }) => {
    return http.get<FieldPermission[]>('/v1/metadata/field-permissions', params);
  },

  batchSave: async (data: { role_id: string; entity_id: string; items: { field_code: string; access_level: string }[] }) => {
    return http.post<{ saved: number }>('/v1/metadata/field-permissions/batch', data);
  },

  my: async (entityId: string) => {
    return http.get<Record<string, string>>(`/v1/metadata/field-permissions/my?entity_id=${entityId}`);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/metadata/field-permissions/${id}`);
  },
};
