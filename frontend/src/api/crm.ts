import { http } from '@/utils/request';
import { PaginationParams, PaginationResult } from '@/types';

// ── CRM（2026-09-19 第六批③）：商机 + 跟进记录 + 漏斗看板 ─────────────────────

export interface CrmOpportunity {
  id: string;
  code: string;
  name: string;
  customer_id?: string | null;
  customer_name?: string | null;
  lead_id?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  amount: string;
  stage: string;
  probability: number;
  expected_close_date?: string | null;
  source?: string | null;
  owner?: string | null;
  won_at?: string | null;
  lost_reason?: string | null;
  remark?: string | null;
  created_at?: string;
}

export const CRM_STAGE_TEXT: Record<string, string> = {
  prospecting: '初步接触', qualification: '需求确认', proposal: '报价', negotiation: '谈判', won: '已赢单', lost: '已输单',
};
export const CRM_STAGE_COLOR: Record<string, string> = {
  prospecting: 'bg-gray-100 text-gray-600',
  qualification: 'bg-sky-50 text-sky-600',
  proposal: 'bg-indigo-50 text-indigo-600',
  negotiation: 'bg-purple-50 text-purple-600',
  won: 'bg-green-50 text-green-600',
  lost: 'bg-red-50 text-red-600',
};

export const CRM_ACTIVITY_TYPE_TEXT: Record<string, string> = { call: '电话', visit: '拜访', email: '邮件', wechat: '微信', other: '其他' };
export const CRM_TARGET_TYPE_TEXT: Record<string, string> = { lead: '线索', opportunity: '商机', customer: '客户' };

export interface CrmActivity {
  id: string;
  target_type: string;
  target_id: string;
  target_name?: string | null;
  type: string;
  content: string;
  activity_at: string;
  next_follow_at?: string | null;
  created_at?: string;
}

export interface PendingFollowup {
  activity_id: string;
  target_type: string;
  target_id: string;
  target_name: string;
  last_type: string;
  last_content: string;
  next_follow_at?: string | null;
  overdue_days: number;
}

export interface CrmFunnelStage { stage: string; label: string; count: number; amount: string; }
export interface CrmFunnel {
  stages: CrmFunnelStage[];
  total_count: number;
  active_amount: string;
  won_count: number;
  won_amount: string;
  period_won_count: number;
  period_won_amount: string;
  lost_count: number;
  conversion_rate: number;
}

export interface OpportunityListParams extends PaginationParams {
  keyword?: string;
  stage?: string;
  owner?: string;
}
export interface OpportunityInput {
  name: string;
  customer_id?: string | null;
  customer_name?: string;
  contact_name?: string;
  contact_phone?: string;
  amount?: number;
  stage?: string;
  probability?: number;
  expected_close_date?: string | null;
  source?: string;
  owner?: string;
  remark?: string;
}

export const crmOpportunityApi = {
  list: async (params?: OpportunityListParams) => {
    return http.get<PaginationResult<CrmOpportunity>>('/v1/crm-opportunities', params);
  },
  get: async (id: string) => {
    return http.get<CrmOpportunity>('/v1/crm-opportunities/' + id);
  },
  create: async (data: OpportunityInput) => {
    return http.post<CrmOpportunity>('/v1/crm-opportunities', data);
  },
  update: async (id: string, data: OpportunityInput) => {
    return http.put<CrmOpportunity>('/v1/crm-opportunities/' + id, data);
  },
  updateStage: async (id: string, data: { stage: string; lost_reason?: string }) => {
    return http.post<CrmOpportunity>('/v1/crm-opportunities/' + id + '/stage', data);
  },
  remove: async (id: string) => {
    return http.delete('/v1/crm-opportunities/' + id);
  },
  funnel: async (params?: { owner?: string; start_date?: string; end_date?: string }) => {
    return http.get<CrmFunnel>('/v1/crm-opportunities/funnel', params);
  },
};

export const crmActivityApi = {
  list: async (params?: PaginationParams & { target_type?: string; target_id?: string; keyword?: string }) => {
    return http.get<PaginationResult<CrmActivity>>('/v1/crm-activities', params);
  },
  pending: async () => {
    return http.get<PendingFollowup[]>('/v1/crm-activities/pending');
  },
  create: async (data: { target_type: string; target_id: string; type: string; content: string; activity_at?: string; next_follow_at?: string | null }) => {
    return http.post<CrmActivity>('/v1/crm-activities', data);
  },
  remove: async (id: string) => {
    return http.delete('/v1/crm-activities/' + id);
  },
};

export interface ConvertLeadResult {
  customer: { id: string; code: string; name: string };
  opportunity?: CrmOpportunity | null;
}
