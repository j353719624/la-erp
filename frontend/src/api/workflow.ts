import { http } from '@/utils/request';

export interface ApprovalStep {
  id?: string;
  step_no: number;
  name: string;
  approver_type: string;
  approver_id?: string;
  approver_name?: string;
  action_type?: string;
  timeout_hours?: number;
  is_optional?: boolean;
  condition?: string;
  remark?: string;
}

export interface ApprovalFlow {
  id: string;
  code: string;
  name: string;
  biz_type: string;
  is_active: boolean;
  config?: Record<string, unknown>;
  remark?: string;
  edges?: { steps?: ApprovalStep[] };
  created_at?: string;
}

export interface ApprovalRecord {
  id: string;
  flow_code: string;
  biz_type: string;
  biz_id: string;
  biz_no: string;
  initiator_id: string;
  initiator_name: string;
  current_status: string;
  current_step: number;
  history?: Array<Record<string, unknown>>;
  remark?: string;
  created_at?: string;
}

export interface ApprovalFlowCreateInput {
  code: string;
  name: string;
  biz_type: string;
  config?: Record<string, unknown>;
  remark?: string;
  steps?: Partial<ApprovalStep>[];
}

export const approvalFlowApi = {
  list: async (params?: { biz_type?: string; is_active?: boolean }) => {
    return http.get<ApprovalFlow[]>('/v1/approval-flows', params);
  },
  get: async (id: string) => {
    return http.get<ApprovalFlow>(`/v1/approval-flows/${id}`);
  },
  create: async (data: ApprovalFlowCreateInput) => {
    return http.post<ApprovalFlow>('/v1/approval-flows', data);
  },
  update: async (id: string, data: { name?: string; is_active?: boolean; config?: Record<string, unknown>; remark?: string; steps?: Partial<ApprovalStep>[] }) => {
    return http.put(`/v1/approval-flows/${id}`, data);
  },
  delete: async (id: string) => {
    return http.delete(`/v1/approval-flows/${id}`);
  },
  activate: async (id: string) => {
    return http.post(`/v1/approval-flows/${id}/activate`);
  },
  deactivate: async (id: string) => {
    return http.post(`/v1/approval-flows/${id}/deactivate`);
  },
};

export const approvalRecordApi = {
  list: async (params?: { biz_type?: string; status?: string; initiator_id?: string; approver_id?: string }) => {
    return http.get<ApprovalRecord[]>('/v1/approval-records', params);
  },
  submit: async (data: { biz_type: string; biz_id: string; biz_no: string; initiator_id: string; initiator_name: string; remark?: string }) => {
    return http.post<ApprovalRecord>('/v1/approval-records/submit', data);
  },
  approve: async (data: { biz_type: string; biz_id: string; approver_id: string; remark?: string }) => {
    return http.post<ApprovalRecord>('/v1/approval-records/approve', data);
  },
  reject: async (data: { biz_type: string; biz_id: string; approver_id: string; remark?: string }) => {
    return http.post<ApprovalRecord>('/v1/approval-records/reject', data);
  },
};
