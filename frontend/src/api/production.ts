import { http } from '@/utils/request';
import { WorkOrder, Bom, Routing, WorkCenter, WorkOrderMaterial, CapacityLoadResult, BomTreeResult, ReworkOrder, SubcontractOrder, SerialNumber, MPSPlan, ProductionReturn, MaterialAvailabilityItem, AssemblyOrder } from '@/types/production';
import { PaginationParams, PaginationResult } from '@/types';

export const assemblyApi = {
  list: async (params?: PaginationParams & { assembly_no?: string; status?: string }) => {
    return http.get<PaginationResult<AssemblyOrder>>('/v1/assemblies', params);
  },

  get: async (id: string) => {
    return http.get<AssemblyOrder>(`/v1/assemblies/${id}`);
  },

  create: async (data: Partial<AssemblyOrder>) => {
    return http.post<AssemblyOrder>('/v1/assemblies', data);
  },

  update: async (id: string, data: Partial<AssemblyOrder>) => {
    return http.put<AssemblyOrder>(`/v1/assemblies/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/assemblies/${id}`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/assemblies/${id}/confirm`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/assemblies/${id}/cancel`);
  },

  /** 按 BOM 带出组件清单（A-3） */
  bomComponents: async (productId: string) => {
    return http.get<any[]>(`/v1/assemblies/bom-components?product_id=${productId}`);
  },
};

export const productionApi = {
  workOrderList: async (params?: PaginationParams & { status?: string }) => {
    return http.get<PaginationResult<WorkOrder>>('/v1/work-orders', params);
  },

  getWorkOrder: async (id: string) => {
    return http.get<WorkOrder>(`/v1/work-orders/${id}`);
  },

  createWorkOrder: async (data: Partial<WorkOrder>) => {
    return http.post<WorkOrder>('/v1/work-orders', data);
  },

  updateWorkOrder: async (id: string, data: Partial<WorkOrder>) => {
    return http.put<WorkOrder>(`/v1/work-orders/${id}`, data);
  },

  deleteWorkOrder: async (id: string) => {
    return http.delete(`/v1/work-orders/${id}`);
  },

  confirmWorkOrder: async (id: string) => {
    return http.post(`/v1/work-orders/${id}/confirm`);
  },

  approveWorkOrder: async (id: string) => {
    return http.post(`/v1/work-orders/${id}/approve`);
  },

  completeWorkOrder: async (id: string) => {
    return http.post(`/v1/work-orders/${id}/complete`);
  },

  cancelWorkOrder: async (id: string) => {
    return http.post(`/v1/work-orders/${id}/cancel`);
  },

  getBomItems: async (id: string) => {
    return http.get(`/v1/work-orders/${id}/bom-items`);
  },

  materialAvailability: async (id: string) => {
    return http.get<MaterialAvailabilityItem[]>(`/v1/work-orders/${id}/material-availability`);
  },

  getWorkOrderMaterials: async (id: string) => {
    return http.get<WorkOrderMaterial[]>(`/v1/work-orders/${id}/materials`);
  },

  workCenterLoad: async (params?: { days?: number }) => {
    return http.get<CapacityLoadResult>('/v1/work-centers/load', params);
  },

  getBomTree: async (id: string) => {
    return http.get<BomTreeResult>(`/v1/boms/${id}/tree`);
  },

  reworkOrderList: async (params?: PaginationParams & { status?: string; work_order_no?: string; keyword?: string }) => {
    return http.get<PaginationResult<ReworkOrder>>('/v1/rework-orders', params);
  },

  getReworkOrder: async (id: string) => {
    return http.get<ReworkOrder>(`/v1/rework-orders/${id}`);
  },

  createReworkOrder: async (data: Partial<ReworkOrder>) => {
    return http.post<ReworkOrder>('/v1/rework-orders', data);
  },

  updateReworkOrder: async (id: string, data: Partial<ReworkOrder>) => {
    return http.put(`/v1/rework-orders/${id}`, data);
  },

  deleteReworkOrder: async (id: string) => {
    return http.delete(`/v1/rework-orders/${id}`);
  },

  confirmReworkOrder: async (id: string) => {
    return http.post<ReworkOrder>(`/v1/rework-orders/${id}/confirm`);
  },

  completeReworkOrder: async (id: string) => {
    return http.post<ReworkOrder>(`/v1/rework-orders/${id}/complete`);
  },

  cancelReworkOrder: async (id: string) => {
    return http.post<ReworkOrder>(`/v1/rework-orders/${id}/cancel`);
  },

  subcontractOrderList: async (params?: PaginationParams & { status?: string; keyword?: string }) => {
    return http.get<PaginationResult<SubcontractOrder>>('/v1/subcontract-orders', params);
  },

  getSubcontractOrder: async (id: string) => {
    return http.get<SubcontractOrder>(`/v1/subcontract-orders/${id}`);
  },

  createSubcontractOrder: async (data: Partial<SubcontractOrder>) => {
    return http.post<SubcontractOrder>('/v1/subcontract-orders', data);
  },

  updateSubcontractOrder: async (id: string, data: Partial<SubcontractOrder>) => {
    return http.put(`/v1/subcontract-orders/${id}`, data);
  },

  deleteSubcontractOrder: async (id: string) => {
    return http.delete(`/v1/subcontract-orders/${id}`);
  },

  confirmSubcontractOrder: async (id: string) => {
    return http.post<SubcontractOrder>(`/v1/subcontract-orders/${id}/confirm`);
  },

  /** 外协收货：支持实收数量与分批收货（增重/损耗场景，2026-09-11） */
  receiveSubcontractOrder: async (
    id: string,
    data?: { qty?: number; batch?: boolean; diff_reason?: string; remark?: string; batch_no?: string; receive_date?: string; warehouse_id?: string },
  ) => {
    return http.post<SubcontractOrder>(`/v1/subcontract-orders/${id}/receive`, data ?? {});
  },

  /** 结束收货（剩余不再回来，如已确认损耗） */
  finishReceiveSubcontractOrder: async (id: string, reason?: string) => {
    return http.post<SubcontractOrder>(`/v1/subcontract-orders/${id}/finish-receive`, { reason: reason ?? '' });
  },

  issueSubcontractOrder: async (id: string, lines: { material_line_id: string; qty: number }[]) => {
    return http.post<SubcontractOrder>(`/v1/subcontract-orders/${id}/issue`, lines);
  },

  returnSubcontractMaterial: async (id: string, lines: { material_line_id: string; qty: number }[]) => {
    return http.post<SubcontractOrder>(`/v1/subcontract-orders/${id}/return-material`, lines);
  },

  completeSubcontractOrder: async (id: string) => {
    return http.post<SubcontractOrder>(`/v1/subcontract-orders/${id}/complete`);
  },

  cancelSubcontractOrder: async (id: string) => {
    return http.post<SubcontractOrder>(`/v1/subcontract-orders/${id}/cancel`);
  },

  serialNumberList: async (params?: PaginationParams & { status?: string; keyword?: string; product_id?: string }) => {
    return http.get<PaginationResult<SerialNumber>>('/v1/serial-numbers', params);
  },

  registerSerialNumbers: async (data: { product_id?: string; product_code?: string; product_name?: string; warehouse_id?: string; warehouse_name?: string; serial_nos?: string[]; source_type?: string; source_no?: string; remark?: string }) => {
    return http.post('/v1/serial-numbers', data);
  },

  serialNumberOut: async (id: string) => {
    return http.post(`/v1/serial-numbers/${id}/out`);
  },

  serialNumberScrap: async (id: string) => {
    return http.post(`/v1/serial-numbers/${id}/scrap`);
  },

  mpsList: async (params?: PaginationParams) => {
    return http.get<PaginationResult<MPSPlan>>('/v1/mps-plans', params);
  },

  mpsGenerate: async (data: { period_start: string; period_end: string; product_ids?: string[] }) => {
    return http.post<MPSPlan>('/v1/mps-plans', data);
  },

  mpsGet: async (id: string) => {
    return http.get<MPSPlan>(`/v1/mps-plans/${id}`);
  },

  mpsDelete: async (id: string) => {
    return http.delete(`/v1/mps-plans/${id}`);
  },

  mpsGenerateWorkOrders: async (id: string) => {
    return http.post(`/v1/mps-plans/${id}/generate-work-orders`);
  },

  startProcess: async (id: string, data: { operator_id?: string; operator_name?: string }) => {
    return http.post(`/v1/work-order-processes/${id}/start`, data);
  },

  completeProcess: async (id: string, data: { operator_id?: string; operator_name?: string; qty_good?: number; qty_bad?: number; actual_time?: number; labor_rate?: number }) => {
    return http.post(`/v1/work-order-processes/${id}/complete`, data);
  },

  pickingList: async (params?: PaginationParams & { status?: string; picking_no?: string }) => {
    return http.get<PaginationResult<any>>('/v1/production-pickings', params);
  },

  createPicking: async (data: any) => {
    return http.post('/v1/production-pickings', data);
  },

  confirmPicking: async (id: string) => {
    return http.post(`/v1/production-pickings/${id}/confirm`);
  },

  deletePicking: async (id: string) => {
    return http.delete(`/v1/production-pickings/${id}`);
  },

  productionSettings: async () => {
    return http.get<any>('/v1/production-settings');
  },

  updateProductionSettings: async (data: {
    allow_over_issue?: boolean;
    allow_no_workorder_pick?: boolean;
    allow_return_after_complete?: boolean;
  }) => {
    return http.put<any>('/v1/production-settings', data);
  },

  receiptList: async (params?: PaginationParams & { status?: string; receipt_no?: string }) => {
    return http.get<PaginationResult<any>>('/v1/production-receipts', params);
  },

  createReceipt: async (data: any) => {
    return http.post('/v1/production-receipts', data);
  },

  confirmReceipt: async (id: string) => {
    return http.post(`/v1/production-receipts/${id}/confirm`);
  },

  deleteReceipt: async (id: string) => {
    return http.delete(`/v1/production-receipts/${id}`);
  },

  returnList: async (params?: PaginationParams & { status?: string; work_order_id?: string }) => {
    return http.get<PaginationResult<ProductionReturn>>('/v1/production-returns', params);
  },

  getReturn: async (id: string) => {
    return http.get<ProductionReturn>(`/v1/production-returns/${id}`);
  },

  createReturn: async (data: any) => {
    return http.post<ProductionReturn>('/v1/production-returns', data);
  },

  confirmReturn: async (id: string) => {
    return http.post(`/v1/production-returns/${id}/confirm`);
  },

  cancelReturn: async (id: string) => {
    return http.post(`/v1/production-returns/${id}/cancel`);
  },

  deleteReturn: async (id: string) => {
    return http.delete(`/v1/production-returns/${id}`);
  },

  mrpRun: async () => {
    return http.post<any>('/v1/mrp/run');
  },

  requirementList: async (params?: PaginationParams & { status?: string; mrp_no?: string }) => {
    return http.get<PaginationResult<any>>('/v1/mrp/requirements', params);
  },

  getRequirement: async (id: string) => {
    return http.get<any>(`/v1/mrp/requirements/${id}`);
  },

  deleteRequirement: async (id: string) => {
    return http.delete(`/v1/mrp/requirements/${id}`);
  },

  generateWorkOrders: async (id: string) => {
    return http.post<any[]>(`/v1/mrp/requirements/${id}/generate-work-orders`);
  },

  suggestionList: async (params?: PaginationParams & { status?: string; suggestion_no?: string }) => {
    return http.get<PaginationResult<any>>('/v1/purchase-suggestions', params);
  },

  getSuggestion: async (id: string) => {
    return http.get<any>(`/v1/purchase-suggestions/${id}`);
  },

  deleteSuggestion: async (id: string) => {
    return http.delete(`/v1/purchase-suggestions/${id}`);
  },

  convertSuggestion: async (id: string) => {
    return http.post<any>(`/v1/purchase-suggestions/${id}/convert`);
  },

  bomList: async (params?: PaginationParams) => {
    return http.get<PaginationResult<Bom>>('/v1/boms', params);
  },

  getBom: async (id: string) => {
    return http.get<Bom>(`/v1/boms/${id}`);
  },

  createBom: async (data: Partial<Bom>) => {
    return http.post<Bom>('/v1/boms', data);
  },

  updateBom: async (id: string, data: Partial<Bom>) => {
    return http.put<Bom>(`/v1/boms/${id}`, data);
  },

  deleteBom: async (id: string) => {
    return http.delete(`/v1/boms/${id}`);
  },

  activateBom: async (id: string) => {
    return http.post(`/v1/boms/${id}/activate`);
  },

  deactivateBom: async (id: string) => {
    return http.post(`/v1/boms/${id}/deactivate`);
  },

  routingList: async (params?: PaginationParams) => {
    return http.get<PaginationResult<Routing>>('/v1/routings', params);
  },

  workCenterList: async (params?: PaginationParams & { keyword?: string; status?: string }) => {
    return http.get<PaginationResult<WorkCenter>>('/v1/work-centers', params);
  },
  getWorkCenter: async (id: string) => {
    return http.get<WorkCenter>(`/v1/work-centers/${id}`);
  },
  createWorkCenter: async (data: Partial<WorkCenter>) => {
    return http.post<WorkCenter>('/v1/work-centers', data);
  },
  updateWorkCenter: async (id: string, data: Partial<WorkCenter>) => {
    return http.put<WorkCenter>(`/v1/work-centers/${id}`, data);
  },
  deleteWorkCenter: async (id: string) => {
    return http.delete(`/v1/work-centers/${id}`);
  },

  getRouting: async (id: string) => {
    return http.get<Routing>(`/v1/routings/${id}`);
  },

  createRouting: async (data: Partial<Routing>) => {
    return http.post<Routing>('/v1/routings', data);
  },

  updateRouting: async (id: string, data: Partial<Routing>) => {
    return http.put<Routing>(`/v1/routings/${id}`, data);
  },

  deleteRouting: async (id: string) => {
    return http.delete(`/v1/routings/${id}`);
  },
};
// ===== 生产资料管理（2026-09-11）：设备 / 工装 / 班组 / 技术资料 =====

export interface ProductionEquipment {
  id: string;
  equipment_no: string;
  name: string;
  category?: string;
  model?: string;
  spec?: string;
  manufacturer?: string;
  serial_no?: string;
  location?: string;
  work_center_id?: string;
  work_center_name?: string;
  status: string; // idle/running/maintenance/repair/scrapped
  capacity_per_hour?: number;
  purchase_date?: string;
  warranty_until?: string;
  responsible?: string;
  is_active: boolean;
  remark?: string;
  edges?: { maintenances?: EquipmentMaintenance[] };
}

export interface EquipmentMaintenance {
  id: string;
  equipment_id: string;
  equipment_no?: string;
  equipment_name?: string;
  record_type: string; // maintain/repair/check
  plan_date?: string;
  done_date?: string;
  content?: string;
  result?: string;
  cost?: string;
  executor?: string;
  next_date?: string;
  status: string; // planned/done/cancelled
  remark?: string;
}

export const EQUIPMENT_STATUS_TEXT: Record<string, string> = {
  idle: '空闲', running: '运行', maintenance: '保养中', repair: '维修中', scrapped: '已报废',
};
export const MAINTENANCE_TYPE_TEXT: Record<string, string> = {
  maintain: '保养', repair: '维修', check: '点检',
};

export const equipmentApi = {
  list: async (params?: PaginationParams & { keyword?: string; status?: string }) =>
    http.get<PaginationResult<ProductionEquipment>>('/v1/production-equipments', params),
  all: async () => http.get<ProductionEquipment[]>('/v1/production-equipments/all'),
  get: async (id: string) => http.get<ProductionEquipment>(`/v1/production-equipments/${id}`),
  create: async (data: any) => http.post<ProductionEquipment>('/v1/production-equipments', data),
  update: async (id: string, data: any) => http.put(`/v1/production-equipments/${id}`, data),
  remove: async (id: string) => http.delete(`/v1/production-equipments/${id}`),
};

export const equipmentMaintenanceApi = {
  list: async (params?: PaginationParams & { equipment_id?: string; record_type?: string; status?: string; nearing_days?: number }) =>
    http.get<PaginationResult<EquipmentMaintenance>>('/v1/equipment-maintenances', params),
  create: async (data: any) => http.post<EquipmentMaintenance>('/v1/equipment-maintenances', data),
  done: async (id: string, data: { result?: string; cost?: string; executor?: string; next_date?: string }) =>
    http.post<EquipmentMaintenance>(`/v1/equipment-maintenances/${id}/done`, data),
  remove: async (id: string) => http.delete(`/v1/equipment-maintenances/${id}`),
};

export interface Tooling {
  id: string;
  tooling_no: string;
  name: string;
  category: string; // mold/fixture/gauge/other
  model?: string;
  spec?: string;
  applicable_product_id?: string;
  applicable_product_name?: string;
  life_times: number;
  used_times: number;
  status: string; // idle/in_use/maintenance/scrapped
  location?: string;
  responsible?: string;
  purchase_date?: string;
  cost?: string;
  last_maintain_date?: string;
  next_maintain_date?: string;
  maintain_interval_days: number;
  remark?: string;
}

export const TOOLING_CATEGORY_TEXT: Record<string, string> = {
  mold: '模具', fixture: '夹具', gauge: '量具', other: '其它',
};
export const TOOLING_STATUS_TEXT: Record<string, string> = {
  idle: '在库', in_use: '在用', maintenance: '保养中', scrapped: '已报废',
};

export const toolingApi = {
  list: async (params?: PaginationParams & { keyword?: string; category?: string; status?: string; nearing_days?: number }) =>
    http.get<PaginationResult<Tooling>>('/v1/toolings', params),
  get: async (id: string) => http.get<Tooling>(`/v1/toolings/${id}`),
  create: async (data: any) => http.post<Tooling>('/v1/toolings', data),
  update: async (id: string, data: any) => http.put(`/v1/toolings/${id}`, data),
  remove: async (id: string) => http.delete(`/v1/toolings/${id}`),
  use: async (id: string, times = 1) => http.post<Tooling>(`/v1/toolings/${id}/use`, { times }),
  maintain: async (id: string, data: { date?: string; remark?: string }) => http.post<Tooling>(`/v1/toolings/${id}/maintain`, data),
  scrap: async (id: string, reason?: string) => http.post<Tooling>(`/v1/toolings/${id}/scrap`, { reason }),
};

export interface TeamMember {
  id?: string;
  // [2026-09-19 班组关联员工] 选了员工档案的成员携带（未建档成员为空）
  employee_id?: string | null;
  name: string;
  employee_no?: string;
  skill?: string;
  skill_level?: string;
  phone?: string;
  is_active?: boolean;
  remark?: string;
}

export interface ProductionTeam {
  id: string;
  code: string;
  name: string;
  workshop?: string;
  leader?: string;
  shift: string; // day/night/middle/other
  member_count: number;
  is_active: boolean;
  remark?: string;
  edges?: { members?: TeamMember[] };
}

export const SHIFT_TEXT: Record<string, string> = {
  day: '白班', middle: '中班', night: '夜班', other: '其它',
};
export const SKILL_LEVEL_TEXT: Record<string, string> = {
  junior: '初级', middle: '中级', senior: '高级', expert: '技师',
};

export const productionTeamApi = {
  list: async (params?: PaginationParams & { keyword?: string; shift?: string }) =>
    http.get<PaginationResult<ProductionTeam>>('/v1/production-teams', params),
  get: async (id: string) => http.get<ProductionTeam>(`/v1/production-teams/${id}`),
  create: async (data: any) => http.post<ProductionTeam>('/v1/production-teams', data),
  update: async (id: string, data: any) => http.put(`/v1/production-teams/${id}`, data),
  remove: async (id: string) => http.delete(`/v1/production-teams/${id}`),
};

export interface ProductDocument {
  id: string;
  doc_no: string;
  product_id?: string;
  product_name?: string;
  doc_type: string; // drawing/instruction/spec/standard/other
  title: string;
  version: string;
  content?: string;
  file_url?: string;
  effective_date?: string;
  status: string; // draft/effective/obsolete
  author?: string;
  remark?: string;
}

export const DOC_TYPE_TEXT: Record<string, string> = {
  drawing: '图纸', instruction: '作业指导书', spec: '工艺参数', standard: '检验标准', other: '其它',
};
export const DOC_STATUS_TEXT: Record<string, string> = {
  draft: '草稿', effective: '生效中', obsolete: '已作废',
};

export const productDocumentApi = {
  list: async (params?: PaginationParams & { keyword?: string; doc_type?: string; status?: string; product_id?: string; only_current?: string }) =>
    http.get<PaginationResult<ProductDocument>>('/v1/product-documents', params),
  get: async (id: string) => http.get<ProductDocument>(`/v1/product-documents/${id}`),
  create: async (data: any) => http.post<ProductDocument>('/v1/product-documents', data),
  update: async (id: string, data: any) => http.put(`/v1/product-documents/${id}`, data),
  publish: async (id: string) => http.post<ProductDocument>(`/v1/product-documents/${id}/publish`),
  remove: async (id: string) => http.delete(`/v1/product-documents/${id}`),
};

// ── 报工中心（2026-09-19 第六批①）：记录/统计/待报工/单条·批量报工/撤销 ────────

export interface WorkReportProcess {
  id: string;
  process_code?: string;
  process_name: string;
  work_center_name?: string | null;
  status: string; // pending / in_progress / completed
  operator_id?: string | null;
  operator_name?: string | null;
  qty_planned: string;
  qty_good: string;
  qty_bad: string;
  qty_completed: string;
  actual_time: number;
  labor_rate: string;
  started_at?: string | null;
  completed_at?: string | null;
  edges?: { work_order?: { order_no: string; product_name?: string; product_code?: string; qty?: string; status?: string } };
}

export const WORK_REPORT_STATUS_TEXT: Record<string, string> = { pending: '待开工', in_progress: '进行中', completed: '已报工' };
export const WORK_REPORT_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-50 text-blue-600',
  completed: 'bg-green-50 text-green-600',
};

export interface WorkReportStats {
  total: number;
  completed: number;
  in_progress: number;
  pending: number;
  qty_good: string;
  qty_bad: string;
  actual_time: string;
}

export interface WorkReportListParams {
  page?: number;
  page_size?: number;
  keyword?: string;
  status?: string;
  operator?: string;
  start_date?: string;
  end_date?: string;
}
export interface PendingProcessParams {
  page?: number;
  page_size?: number;
  keyword?: string;
  work_order_no?: string;
  status?: string;
}
export interface WorkReportSubmitInput {
  operator_id?: string | null;
  operator_name?: string;
  qty_good: number;
  qty_bad: number;
  actual_time: number;
  labor_rate?: number;
}
export interface BulkReportFailure {
  process_id: string;
  process_name?: string;
  work_order_no?: string;
  reason: string;
}
export interface BulkReportResult {
  completed: number;
  failed: BulkReportFailure[];
}

export const workReportApi = {
  /** 报工记录列表（关键词/操作工/期间/状态） */
  list: async (params?: WorkReportListParams) => {
    return http.get<PaginationResult<WorkReportProcess>>('/v1/work-order-processes', params);
  },
  /** 报工统计（与列表同筛选口径） */
  stats: async (params?: WorkReportListParams) => {
    return http.get<WorkReportStats>('/v1/work-order-processes/stats', params);
  },
  /** 待报工工序（仅「生产中」工单的未完成工序） */
  pending: async (params?: PendingProcessParams) => {
    return http.get<PaginationResult<WorkReportProcess>>('/v1/work-order-processes/pending', params);
  },
  /** 单工序报工 */
  report: async (id: string, data: WorkReportSubmitInput) => {
    return http.post<WorkReportProcess>('/v1/work-order-processes/' + id + '/complete', data);
  },
  /** 批量报工（逐条校验，失败不阻断其余；返回逐条失败原因） */
  bulkReport: async (items: (WorkReportSubmitInput & { process_id: string })[]) => {
    return http.post<BulkReportResult>('/v1/work-order-processes/bulk-report', { items });
  },
  /** 报工撤销（退回进行中 + 清零数量/工时 + 重算工单成本） */
  revert: async (id: string) => {
    return http.post<WorkReportProcess>('/v1/work-order-processes/' + id + '/revert');
  },
};
