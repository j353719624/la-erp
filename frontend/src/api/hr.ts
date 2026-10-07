import { http } from '@/utils/request';
import { PaginationParams, PaginationResult } from '@/types';

/**
 * 人事管理 API（2026-09-19）：员工档案 + 劳动合同。
 *
 * 权限码：employee / employee_create / employee_edit / employee_delete；
 *        labor_contract / labor_contract_create / labor_contract_edit / labor_contract_delete。
 */

export interface Employee {
  id: string;
  code: string;
  name: string;
  gender?: string;
  id_card?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  education?: string | null;
  department_id?: string | null;
  position?: string | null;
  employment_type?: string;
  status?: string;
  hire_date?: string;
  probation_end_date?: string | null;
  regular_date?: string | null;
  leave_date?: string | null;
  leave_reason?: string | null;
  base_salary?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  remark?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface LaborContract {
  id: string;
  code: string;
  employee_id: string;
  contract_type: string;
  start_date: string;
  end_date?: string | null;
  sign_date?: string | null;
  probation_months?: number;
  status: string;
  terminated_date?: string | null;
  terminate_reason?: string | null;
  previous_contract_id?: string | null;
  remark?: string | null;
  edges?: { employee?: Employee };
}

export const EMPLOYEE_STATUS_TEXT: Record<string, string> = {
  probation: '试用',
  active: '在职',
  left: '离职',
};

export const EMPLOYMENT_TYPE_TEXT: Record<string, string> = {
  full_time: '全职',
  part_time: '兼职',
  internship: '实习',
  labor: '劳务',
};

export const CONTRACT_TYPE_TEXT: Record<string, string> = {
  fixed: '固定期限',
  open: '无固定期限',
  internship: '实习',
  dispatch: '劳务派遣',
};

export interface EmployeeListParams extends PaginationParams {
  keyword?: string;
  department_id?: string;
  status?: string;
  employment_type?: string;
}

export const employeeApi = {
  list: async (params?: EmployeeListParams) => {
    return http.get<PaginationResult<Employee>>('/v1/employees', params);
  },
  get: async (id: string) => {
    return http.get<Employee>(`/v1/employees/${id}`);
  },
  create: async (data: Partial<Employee>) => {
    return http.post<Employee>('/v1/employees', data);
  },
  update: async (id: string, data: Partial<Employee>) => {
    return http.put<Employee>(`/v1/employees/${id}`, data);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/employees/${id}`);
  },
};

export interface ContractListParams extends PaginationParams {
  keyword?: string;
  status?: string;
  contract_type?: string;
  employee_id?: string;
  expiring_days?: number;
}

export const laborContractApi = {
  list: async (params?: ContractListParams) => {
    return http.get<PaginationResult<LaborContract>>('/v1/labor-contracts', params);
  },
  get: async (id: string) => {
    return http.get<LaborContract>(`/v1/labor-contracts/${id}`);
  },
  create: async (data: Partial<LaborContract>) => {
    return http.post<LaborContract>('/v1/labor-contracts', data);
  },
  update: async (id: string, data: Partial<LaborContract>) => {
    return http.put<LaborContract>(`/v1/labor-contracts/${id}`, data);
  },
  terminate: async (id: string, data: { date?: string; reason?: string }) => {
    return http.post<LaborContract>(`/v1/labor-contracts/${id}/terminate`, data);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/labor-contracts/${id}`);
  },
};

/** 合同显示状态（派生：到期/续签由日期与续签链推导，不落库） */
export function contractDisplayStatus(c: LaborContract, all?: LaborContract[]): {
  text: string;
  cls: string;
} {
  if (c.status === 'terminated') return { text: '已终止', cls: 'bg-gray-100 text-gray-500' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (c.end_date) {
    const end = new Date(c.end_date);
    end.setHours(0, 0, 0, 0);
    if (end.getTime() < today.getTime()) return { text: '已到期', cls: 'bg-red-50 text-red-600' };
    const days = Math.round((end.getTime() - today.getTime()) / 86400000);
    if (days <= 30) return { text: `${days} 天后到期`, cls: 'bg-amber-50 text-amber-600' };
  }
  if (all?.some((x) => x.previous_contract_id === c.id)) {
    return { text: '已续签', cls: 'bg-blue-50 text-blue-600' };
  }
  return { text: '生效中', cls: 'bg-green-50 text-green-600' };
}

// ── 考勤申请（请假/加班，轻量考勤，2026-09-19 人事第三批②）──────────────────

export interface AttendanceRequest {
  id: string;
  code: string;
  employee_id?: string | null;
  employee_name: string;
  department?: string | null;
  request_type: string; // leave 请假 / overtime 加班
  category?: string | null;
  start_date: string;
  end_date?: string | null;
  days: string;
  hours: string;
  reason?: string | null;
  status: string;
  remark?: string | null;
  created_at?: string;
}

export interface AttendanceSummaryItem {
  employee_id?: string | null;
  employee_name: string;
  leave_days: string;
  overtime_hours: string;
  leave_count: number;
  overtime_count: number;
}

export const ATTENDANCE_STATUS_TEXT: Record<string, string> = {
  draft: '草稿', submitted: '待审批', approved: '已通过', rejected: '已驳回', cancelled: '已取消',
};
export const ATTENDANCE_STATUS_COLOR: Record<string, string> = {
  draft: 'bg-yellow-50 text-yellow-700',
  submitted: 'bg-blue-50 text-blue-600',
  approved: 'bg-green-50 text-green-600',
  rejected: 'bg-red-50 text-red-600',
  cancelled: 'bg-gray-100 text-gray-500',
};
export const ATTENDANCE_TYPE_TEXT: Record<string, string> = { leave: '请假', overtime: '加班' };
export const LEAVE_CATEGORY_TEXT: Record<string, string> = {
  annual: '年假', sick: '病假', personal: '事假', marriage: '婚假', maternity: '产假',
  paternity: '陪产假', bereavement: '丧假', compensatory: '调休', other: '其他',
};
export const OVERTIME_CATEGORY_TEXT: Record<string, string> = {
  workday: '工作日', weekend: '休息日', holiday: '法定假日',
};

export interface AttendanceListParams extends PaginationParams {
  keyword?: string;
  status?: string;
  request_type?: string;
  employee?: string;
}

/** 新建/编辑入参（数值字段按数字提交，后端 decimal 接住） */
export interface AttendanceRequestInput {
  employee_id?: string;
  employee_name: string;
  department?: string;
  request_type: string;
  category?: string;
  start_date: string;
  end_date?: string;
  days?: number;
  hours?: number;
  reason?: string;
  remark?: string;
}

export const attendanceApi = {
  list: async (params?: AttendanceListParams) => {
    return http.get<PaginationResult<AttendanceRequest>>('/v1/attendance-requests', params);
  },
  get: async (id: string) => {
    return http.get<AttendanceRequest>(`/v1/attendance-requests/${id}`);
  },
  summary: async (period: string) => {
    return http.get<AttendanceSummaryItem[]>('/v1/attendance-requests/summary', { period });
  },
  create: async (data: AttendanceRequestInput) => {
    return http.post<AttendanceRequest>('/v1/attendance-requests', data);
  },
  update: async (id: string, data: AttendanceRequestInput) => {
    return http.put<AttendanceRequest>(`/v1/attendance-requests/${id}`, data);
  },
  submit: async (id: string) => {
    return http.post<AttendanceRequest>(`/v1/attendance-requests/${id}/submit`);
  },
  approve: async (id: string) => {
    return http.post<AttendanceRequest>(`/v1/attendance-requests/${id}/approve`);
  },
  reject: async (id: string) => {
    return http.post<AttendanceRequest>(`/v1/attendance-requests/${id}/reject`);
  },
  cancel: async (id: string) => {
    return http.post<AttendanceRequest>(`/v1/attendance-requests/${id}/cancel`);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/attendance-requests/${id}`);
  },
};

// ── 人事异动流水（入转调离留痕，2026-09-19 第三批③，只读审计）────────────────

export interface EmployeeChange {
  id: string;
  employee_id: string;
  employee_name: string;
  change_type: string;
  before_value?: string | null;
  after_value?: string | null;
  effective_date: string;
  reason?: string | null;
  remark?: string | null;
  created_at?: string;
}

export const EMPLOYEE_CHANGE_TYPE_TEXT: Record<string, string> = {
  hire: '入职', regularize: '转正', transfer: '调岗', dept_change: '调部门',
  salary: '调薪', leave: '离职', rehire: '复职', other: '其他',
};
export const EMPLOYEE_CHANGE_TYPE_COLOR: Record<string, string> = {
  hire: 'bg-green-50 text-green-600',
  regularize: 'bg-blue-50 text-blue-600',
  transfer: 'bg-purple-50 text-purple-600',
  dept_change: 'bg-indigo-50 text-indigo-600',
  salary: 'bg-amber-50 text-amber-600',
  leave: 'bg-red-50 text-red-600',
  rehire: 'bg-teal-50 text-teal-600',
};

export interface EmployeeChangeListParams extends PaginationParams {
  keyword?: string;
  change_type?: string;
  employee_id?: string;
}

export const employeeChangeApi = {
  list: async (params?: EmployeeChangeListParams) => {
    return http.get<PaginationResult<EmployeeChange>>('/v1/employee-changes', params);
  },
};

// ── 招聘管理（职位/候选人/面试/录用转档案，2026-09-19 第四批①）──────────────

export interface RecruitmentPosition {
  id: string;
  code: string;
  title: string;
  department_id?: string | null;
  headcount: number;
  salary_min?: string | null;
  salary_max?: string | null;
  requirements?: string | null;
  owner?: string | null;
  status: string;
  remark?: string | null;
  created_at?: string;
}

export interface RecruitmentInterview {
  id?: string;
  round: number;
  interview_date: string;
  interviewer?: string | null;
  comment?: string | null;
  result: string;
  remark?: string | null;
}

export interface RecruitmentCandidate {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  position_id?: string | null;
  position_title?: string | null;
  source?: string | null;
  education?: string | null;
  experience_years?: number | null;
  expected_salary?: string | null;
  status: string;
  employee_id?: string | null;
  hired_at?: string | null;
  remark?: string | null;
  edges?: { interviews?: RecruitmentInterview[] };
}

export const POSITION_STATUS_TEXT: Record<string, string> = { open: '招聘中', paused: '已暂停', closed: '已关闭' };
export const POSITION_STATUS_COLOR: Record<string, string> = {
  open: 'bg-green-50 text-green-600',
  paused: 'bg-amber-50 text-amber-600',
  closed: 'bg-gray-100 text-gray-500',
};
export const CANDIDATE_STATUS_TEXT: Record<string, string> = {
  new: '新简历', screening: '初筛通过', interview: '面试中', offer: '已发Offer',
  hired: '已录用', rejected: '已淘汰', withdrawn: '已放弃',
};
export const CANDIDATE_STATUS_COLOR: Record<string, string> = {
  new: 'bg-blue-50 text-blue-600',
  screening: 'bg-indigo-50 text-indigo-600',
  interview: 'bg-purple-50 text-purple-600',
  offer: 'bg-amber-50 text-amber-600',
  hired: 'bg-green-50 text-green-600',
  rejected: 'bg-red-50 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-500',
};
export const CANDIDATE_SOURCE_TEXT: Record<string, string> = {
  website: '招聘网站', referral: '内部推荐', headhunter: '猎头', campus: '校招', walkin: '社招直投', other: '其他',
};
export const INTERVIEW_RESULT_TEXT: Record<string, string> = { pending: '待定', pass: '通过', fail: '不通过' };

export interface PositionListParams extends PaginationParams {
  keyword?: string;
  status?: string;
}
export interface CandidateListParams extends PaginationParams {
  keyword?: string;
  status?: string;
  position_id?: string;
}
export interface PositionInput {
  title: string;
  department_id?: string;
  headcount?: number;
  salary_min?: number;
  salary_max?: number;
  requirements?: string;
  owner?: string;
  status?: string;
  remark?: string;
}
export interface CandidateInput {
  name: string;
  phone?: string;
  email?: string;
  position_id?: string;
  source?: string;
  education?: string;
  experience_years?: number;
  expected_salary?: number;
  status?: string;
  remark?: string;
  interviews?: { round: number; interview_date: string; interviewer?: string; comment?: string; result?: string; remark?: string }[];
}
export interface HireInput {
  department_id: string;
  position?: string;
  hire_date?: string;
  base_salary?: number;
}

export const recruitmentApi = {
  positionList: async (params?: PositionListParams) => {
    return http.get<PaginationResult<RecruitmentPosition>>('/v1/recruitment-positions', params);
  },
  positionGet: async (id: string) => {
    return http.get<RecruitmentPosition>(`/v1/recruitment-positions/${id}`);
  },
  positionCreate: async (data: PositionInput) => {
    return http.post<RecruitmentPosition>('/v1/recruitment-positions', data);
  },
  positionUpdate: async (id: string, data: PositionInput) => {
    return http.put<RecruitmentPosition>(`/v1/recruitment-positions/${id}`, data);
  },
  positionRemove: async (id: string) => {
    return http.delete(`/v1/recruitment-positions/${id}`);
  },
  candidateList: async (params?: CandidateListParams) => {
    return http.get<PaginationResult<RecruitmentCandidate>>('/v1/recruitment-candidates', params);
  },
  candidateGet: async (id: string) => {
    return http.get<RecruitmentCandidate>(`/v1/recruitment-candidates/${id}`);
  },
  candidateCreate: async (data: CandidateInput) => {
    return http.post<RecruitmentCandidate>('/v1/recruitment-candidates', data);
  },
  candidateUpdate: async (id: string, data: CandidateInput) => {
    return http.put<RecruitmentCandidate>(`/v1/recruitment-candidates/${id}`, data);
  },
  candidateRemove: async (id: string) => {
    return http.delete(`/v1/recruitment-candidates/${id}`);
  },
  /** 录用转档案：生成员工档案（EMP 工号），候选人状态置「已录用」 */
  candidateHire: async (id: string, data: HireInput) => {
    return http.post(`/v1/recruitment-candidates/${id}/hire`, data);
  },
};

// ── 培训管理（2026-09-19 第四批②）──────────────────────────────────────────

export interface TrainingParticipant {
  id?: string;
  employee_id?: string | null;
  employee_name: string;
  department?: string | null;
  result: string;
  score?: string | null;
  remark?: string | null;
}

export interface TrainingRecord {
  id: string;
  code: string;
  title: string;
  category?: string | null;
  trainer?: string | null;
  training_date: string;
  location?: string | null;
  hours: string;
  status: string;
  remark?: string | null;
  edges?: { participants?: TrainingParticipant[] };
}

export const TRAINING_CATEGORY_TEXT: Record<string, string> = {
  onboard: '入职培训', skill: '技能培训', safety: '安全培训', management: '管理培训', other: '其他',
};
export const TRAINING_STATUS_TEXT: Record<string, string> = { planned: '计划中', completed: '已完成' };
export const TRAINING_STATUS_COLOR: Record<string, string> = {
  planned: 'bg-blue-50 text-blue-600',
  completed: 'bg-green-50 text-green-600',
};
export const PARTICIPANT_RESULT_TEXT: Record<string, string> = { attended: '已参加', absent: '缺席' };

export interface TrainingListParams extends PaginationParams {
  keyword?: string;
  status?: string;
  category?: string;
}
export interface TrainingInput {
  title: string;
  category?: string;
  trainer?: string;
  training_date: string;
  location?: string;
  hours?: number;
  status?: string;
  remark?: string;
  participants?: { employee_id?: string; employee_name?: string; department?: string; result?: string; score?: number; remark?: string }[];
}

export const trainingApi = {
  list: async (params?: TrainingListParams) => {
    return http.get<PaginationResult<TrainingRecord>>('/v1/training-records', params);
  },
  get: async (id: string) => {
    return http.get<TrainingRecord>(`/v1/training-records/${id}`);
  },
  create: async (data: TrainingInput) => {
    return http.post<TrainingRecord>('/v1/training-records', data);
  },
  update: async (id: string, data: TrainingInput) => {
    return http.put<TrainingRecord>(`/v1/training-records/${id}`, data);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/training-records/${id}`);
  },
};

// ── 绩效考核（模板/考核单，2026-09-19 第四批③）──────────────────────────────

export interface PerfTemplateItem {
  id?: string;
  indicator: string;
  weight: string;
  description?: string | null;
}

export interface PerfTemplate {
  id: string;
  name: string;
  remark?: string | null;
  created_at?: string;
  edges?: { items?: PerfTemplateItem[] };
}

export interface PerfAssessmentItem {
  id?: string;
  indicator: string;
  weight: string;
  score: string;
  remark?: string | null;
}

export interface PerfAssessment {
  id: string;
  code: string;
  employee_id?: string | null;
  employee_name: string;
  department?: string | null;
  template_id?: string | null;
  template_name?: string | null;
  period: string;
  total_score: string;
  level?: string | null;
  status: string;
  remark?: string | null;
  edges?: { items?: PerfAssessmentItem[] };
}

export const PERF_STATUS_TEXT: Record<string, string> = { draft: '草稿', finalized: '已定案' };
export const PERF_STATUS_COLOR: Record<string, string> = {
  draft: 'bg-yellow-50 text-yellow-700',
  finalized: 'bg-green-50 text-green-600',
};
export const PERF_LEVEL_TEXT: Record<string, string> = {
  A: 'A（优秀）', B: 'B（良好）', C: 'C（合格）', D: 'D（待改进）',
};
export const PERF_LEVEL_COLOR: Record<string, string> = {
  A: 'bg-green-50 text-green-600',
  B: 'bg-blue-50 text-blue-600',
  C: 'bg-amber-50 text-amber-600',
  D: 'bg-red-50 text-red-600',
};

export interface PerfTemplateListParams extends PaginationParams {
  keyword?: string;
}
export interface PerfAssessmentListParams extends PaginationParams {
  keyword?: string;
  status?: string;
  period?: string;
}
export interface TemplateInput {
  name: string;
  remark?: string;
  items?: { indicator: string; weight: number; description?: string }[];
}
export interface AssessmentInput {
  employee_id?: string;
  employee_name?: string;
  department?: string;
  template_id?: string;
  period: string;
  remark?: string;
  items?: { indicator: string; weight: number; score: number; remark?: string }[];
}

export const perfTemplateApi = {
  list: async (params?: PerfTemplateListParams) => {
    return http.get<PaginationResult<PerfTemplate>>('/v1/perf-templates', params);
  },
  get: async (id: string) => {
    return http.get<PerfTemplate>(`/v1/perf-templates/${id}`);
  },
  create: async (data: TemplateInput) => {
    return http.post<PerfTemplate>('/v1/perf-templates', data);
  },
  update: async (id: string, data: TemplateInput) => {
    return http.put<PerfTemplate>(`/v1/perf-templates/${id}`, data);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/perf-templates/${id}`);
  },
};

export const perfApi = {
  list: async (params?: PerfAssessmentListParams) => {
    return http.get<PaginationResult<PerfAssessment>>('/v1/perf-assessments', params);
  },
  get: async (id: string) => {
    return http.get<PerfAssessment>(`/v1/perf-assessments/${id}`);
  },
  create: async (data: AssessmentInput) => {
    return http.post<PerfAssessment>('/v1/perf-assessments', data);
  },
  update: async (id: string, data: AssessmentInput) => {
    return http.put<PerfAssessment>(`/v1/perf-assessments/${id}`, data);
  },
  finalize: async (id: string) => {
    return http.post<PerfAssessment>(`/v1/perf-assessments/${id}/finalize`);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/perf-assessments/${id}`);
  },
};

// ── 计件薪酬（单价/登记/汇总/工序报工导入，2026-09-19 第五批①）────────────────

export interface PieceRate {
  id: string;
  name: string;
  product_id?: string | null;
  unit_price: string;
  status: string;
  remark?: string | null;
  created_at?: string;
}

export const PIECE_RATE_STATUS_TEXT: Record<string, string> = { active: '启用', disabled: '停用' };
export const PIECE_RATE_STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-50 text-green-600',
  disabled: 'bg-gray-100 text-gray-500',
};

export interface PieceworkRecord {
  id: string;
  code: string;
  employee_id?: string | null;
  employee_name: string;
  department?: string | null;
  item_name: string;
  rate_id?: string | null;
  qty: string;
  unit_price: string;
  amount: string;
  work_date?: string;
  source?: string;
  work_order_process_id?: string | null;
  remark?: string | null;
  created_at?: string;
}

export const PIECEWORK_SOURCE_TEXT: Record<string, string> = { manual: '手工登记', process: '工序导入' };

export interface PieceworkSummaryItem {
  employee_id?: string | null;
  employee_name: string;
  department?: string | null;
  total_qty: string;
  total_amount: string;
  count: number;
}

export interface ImportableProcess {
  process_id: string;
  process_name: string;
  operator_id?: string | null;
  operator_name: string;
  qty_good: string;
  completed_at?: string | null;
  work_order_no?: string;
  matched_rate_id?: string | null;
  matched_price: string;
  already_imported?: boolean;
}

export interface PieceRateListParams extends PaginationParams {
  keyword?: string;
  status?: string;
}
export interface PieceworkListParams extends PaginationParams {
  keyword?: string;
  period?: string;
  employee?: string;
}
export interface PieceRateInput {
  name: string;
  product_id?: string | null;
  unit_price: number;
  status?: string;
  remark?: string;
}
export interface PieceworkRecordInput {
  employee_id?: string | null;
  employee_name?: string;
  department?: string;
  item_name: string;
  rate_id?: string | null;
  qty: number;
  unit_price?: number;
  work_date: string;
  remark?: string;
}

export const pieceRateApi = {
  list: async (params?: PieceRateListParams) => {
    return http.get<PaginationResult<PieceRate>>('/v1/piecework-rates', params);
  },
  create: async (data: PieceRateInput) => {
    return http.post<PieceRate>('/v1/piecework-rates', data);
  },
  update: async (id: string, data: PieceRateInput) => {
    return http.put<PieceRate>('/v1/piecework-rates/' + id, data);
  },
  remove: async (id: string) => {
    return http.delete('/v1/piecework-rates/' + id);
  },
};

export const pieceworkApi = {
  list: async (params?: PieceworkListParams) => {
    return http.get<PaginationResult<PieceworkRecord>>('/v1/piecework-records', params);
  },
  create: async (data: PieceworkRecordInput) => {
    return http.post<PieceworkRecord>('/v1/piecework-records', data);
  },
  update: async (id: string, data: PieceworkRecordInput) => {
    return http.put<PieceworkRecord>('/v1/piecework-records/' + id, data);
  },
  remove: async (id: string) => {
    return http.delete('/v1/piecework-records/' + id);
  },
  summary: async (period: string) => {
    return http.get<PieceworkSummaryItem[]>('/v1/piecework-records/summary', { period });
  },
  importableProcesses: async (period: string) => {
    return http.get<ImportableProcess[]>('/v1/piecework-records/importable-processes', { period });
  },
  importProcesses: async (processIds: string[]) => {
    return http.post<{ created: number; skipped: string[] }>('/v1/piecework-records/import-processes', { process_ids: processIds });
  },
};

// ── 人事报表（编制与人数/离职率/培训统计，2026-09-19 第五批②）──────────────

export interface HeadcountRow {
  department_id?: string | null;
  department_name: string;
  headcount?: number | null;
  active: number;
  probation: number;
  left: number;
  on_duty: number;
  gap?: number | null;
}

export interface HeadcountReport {
  total_headcount: number;
  total_on_duty: number;
  total_left: number;
  month_hires: number;
  month_leaves: number;
  rows: HeadcountRow[];
}

export interface TurnoverMonthRow {
  month: number;
  begin: number;
  hires: number;
  leaves: number;
  end: number;
  rate: number;
}

export interface TurnoverReport {
  year: number;
  total_hires: number;
  total_leaves: number;
  avg_rate: number;
  rows: TurnoverMonthRow[];
}

export interface TrainingDeptRow {
  department: string;
  sessions: number;
  participants: number;
  people: number;
  hours: string;
}

export interface TrainingReport {
  sessions: number;
  participants: number;
  people: number;
  total_hours: string;
  avg_hours: string;
  rows: TrainingDeptRow[];
}

export const hrReportApi = {
  headcount: async () => {
    return http.get<HeadcountReport>('/v1/hr-reports/headcount');
  },
  turnover: async (params?: { year?: number; department_id?: string }) => {
    return http.get<TurnoverReport>('/v1/hr-reports/turnover', params);
  },
  training: async (params?: { start_date?: string; end_date?: string; department_id?: string }) => {
    return http.get<TrainingReport>('/v1/hr-reports/training', params);
  },
};
