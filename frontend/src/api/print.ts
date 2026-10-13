import { http } from '@/utils/request';
import { PrintTemplate, CreatePrintTemplateInput, UpdatePrintTemplateInput } from '@/types/print';

// 统一打印模板 API（各板块打印设置互不影响，按 doc_type 隔离）
export const printTemplateApi = {
  // 列表（可按 doc_type 过滤）
  list: async (docType?: string) => {
    const q = docType ? `?doc_type=${docType}` : '';
    return http.get<any[]>(`/v1/print-templates${q}`);
  },
  // 指定类型的默认模板（打印页统一调用）
  byType: async (docType: string) => {
    return http.get<PrintTemplate | null>(`/v1/print-templates/by-type/${docType}`);
  },
  get: async (id: string) => {
    return http.get<PrintTemplate>(`/v1/print-templates/${id}`);
  },
  create: async (data: CreatePrintTemplateInput) => {
    return http.post<PrintTemplate>('/v1/print-templates', data);
  },
  update: async (id: string, data: UpdatePrintTemplateInput) => {
    return http.put<PrintTemplate>(`/v1/print-templates/${id}`, data);
  },
  remove: async (id: string) => {
    return http.delete<any>(`/v1/print-templates/${id}`);
  },
  duplicate: async (id: string) => {
    return http.post<PrintTemplate>(`/v1/print-templates/${id}/duplicate`);
  },
};
