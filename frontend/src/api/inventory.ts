import { http } from '@/utils/request';
import {
  InventoryBalance,
  StockMovement,
  StockIn,
  StockInPhoto,
  StockOut,
  InventoryCheck,
  StockTransfer,
  StockAdjust,
  Location,
  Rack,
  LoanOrder
} from '@/types/inventory';
import { PaginationParams, PaginationResult } from '@/types';

export const inventoryApi = {
  balance: async (params?: PaginationParams & { product_id?: string; warehouse_id?: string }) => {
    return http.get<PaginationResult<InventoryBalance>>('/v1/inventory-balances', params);
  },

  // B-3 库存预留/锁定
  lock: async (id: string, qty: number) => {
    return http.post<InventoryBalance>(`/v1/inventory-balances/${id}/lock`, { qty });
  },

  unlock: async (id: string, qty: number) => {
    return http.post<InventoryBalance>(`/v1/inventory-balances/${id}/unlock`, { qty });
  },

  movement: async (params?: PaginationParams & { 
    product_id?: string; 
    warehouse_id?: string;
    start_date?: string;
    end_date?: string;
  }) => {
    return http.get<PaginationResult<StockMovement>>('/v1/stock-movements', params);
  },
};

export const inventoryCheckApi = {
  list: async (params?: PaginationParams) => {
    return http.get<PaginationResult<InventoryCheck>>('/v1/inventory-checks', params);
  },

  get: async (id: string) => {
    return http.get<InventoryCheck>(`/v1/inventory-checks/${id}`);
  },

  create: async (data: Partial<InventoryCheck>) => {
    return http.post<InventoryCheck>('/v1/inventory-checks', data);
  },

  update: async (id: string, data: Partial<InventoryCheck>) => {
    return http.put<InventoryCheck>(`/v1/inventory-checks/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/inventory-checks/${id}`);
  },

  start: async (id: string) => {
    return http.post(`/v1/inventory-checks/${id}/start`);
  },

  complete: async (id: string) => {
    return http.post(`/v1/inventory-checks/${id}/complete`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/inventory-checks/${id}/cancel`);
  },
};

export const stockTransferApi = {
  list: async (params?: PaginationParams) => {
    return http.get<PaginationResult<StockTransfer>>('/v1/stock-transfers', params);
  },

  get: async (id: string) => {
    return http.get<StockTransfer>(`/v1/stock-transfers/${id}`);
  },

  create: async (data: Partial<StockTransfer>) => {
    return http.post<StockTransfer>('/v1/stock-transfers', data);
  },

  update: async (id: string, data: Partial<StockTransfer>) => {
    return http.put<StockTransfer>(`/v1/stock-transfers/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/stock-transfers/${id}`);
  },

  dispatch: async (id: string) => {
    return http.post(`/v1/stock-transfers/${id}/dispatch`);
  },

  complete: async (id: string) => {
    return http.post(`/v1/stock-transfers/${id}/complete`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/stock-transfers/${id}/cancel`);
  },
};

export const stockAdjustApi = {
  list: async (params?: PaginationParams & { adjust_no?: string; status?: string }) => {
    return http.get<PaginationResult<StockAdjust>>('/v1/inventory-adjusts', params);
  },

  get: async (id: string) => {
    return http.get<StockAdjust>(`/v1/inventory-adjusts/${id}`);
  },

  create: async (data: Partial<StockAdjust>) => {
    return http.post<StockAdjust>('/v1/inventory-adjusts', data);
  },

  update: async (id: string, data: Partial<StockAdjust>) => {
    return http.put<StockAdjust>(`/v1/inventory-adjusts/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/inventory-adjusts/${id}`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/inventory-adjusts/${id}/confirm`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/inventory-adjusts/${id}/cancel`);
  },
};

export const stockInApi = {
  list: async (params?: PaginationParams & { status?: string }) => {
    return http.get<PaginationResult<StockIn>>('/v1/stock-ins', params);
  },

  get: async (id: string) => {
    return http.get<StockIn>(`/v1/stock-ins/${id}`);
  },

  create: async (data: Partial<StockIn>) => {
    return http.post<StockIn>('/v1/stock-ins', data);
  },

  update: async (id: string, data: Partial<StockIn>) => {
    return http.put<StockIn>(`/v1/stock-ins/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/stock-ins/${id}`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/stock-ins/${id}/confirm`);
  },

  // 入库位置拍照记录（2026-09-14）：确认后仍可补拍/改元数据/删除（仅留档，不影响库存）
  addPhotos: async (id: string, photos: StockInPhoto[]) => {
    return http.post<StockInPhoto[]>(`/v1/stock-ins/${id}/photos`, { photos });
  },

  updatePhoto: async (id: string, photoId: string, data: Partial<StockInPhoto>) => {
    return http.put(`/v1/stock-ins/${id}/photos/${photoId}`, data);
  },

  deletePhoto: async (id: string, photoId: string) => {
    return http.delete(`/v1/stock-ins/${id}/photos/${photoId}`);
  },
};

export const stockOutApi = {
  list: async (params?: PaginationParams & { status?: string }) => {
    return http.get<PaginationResult<StockOut>>('/v1/stock-outs', params);
  },

  get: async (id: string) => {
    return http.get<StockOut>(`/v1/stock-outs/${id}`);
  },

  create: async (data: Partial<StockOut>) => {
    return http.post<StockOut>('/v1/stock-outs', data);
  },

  update: async (id: string, data: Partial<StockOut>) => {
    return http.put<StockOut>(`/v1/stock-outs/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/stock-outs/${id}`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/stock-outs/${id}/confirm`);
  },
};

// 期初库存批量导入（CSV / Excel）
export const openingStockApi = {
  import: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return http.upload<{ total: number; success: number; failed: number; messages?: string[] }>('/v1/import/opening-stock', formData);
  },
};

// 库位（Location）管理
export const locationApi = {
  list: async (params?: PaginationParams & { warehouse_id?: string; name?: string }) => {
    return http.get<PaginationResult<Location>>('/v1/locations', params);
  },
  create: async (data: Partial<Location>) => {
    return http.post<Location>('/v1/locations', data);
  },
  update: async (id: string, data: Partial<Location>) => {
    return http.put<Location>(`/v1/locations/${id}`, data);
  },
  delete: async (id: string) => {
    return http.delete(`/v1/locations/${id}`);
  },
};

// 货架（Rack）管理
export const rackApi = {
  list: async (params?: PaginationParams & { location_id?: string; name?: string }) => {
    return http.get<PaginationResult<Rack>>('/v1/racks', params);
  },
  create: async (data: Partial<Rack>) => {
    return http.post<Rack>('/v1/racks', data);
  },
  update: async (id: string, data: Partial<Rack>) => {
    return http.put<Rack>(`/v1/racks/${id}`, data);
  },
  delete: async (id: string) => {
    return http.delete(`/v1/racks/${id}`);
  },
};

// 借出借入（P2 单据功能）
export const loanApi = {
  list: async (params?: PaginationParams & { loan_type?: string; status?: string; party_name?: string }) => {
    return http.get<PaginationResult<LoanOrder>>('/v1/loan-orders', params);
  },

  get: async (id: string) => {
    return http.get<LoanOrder>(`/v1/loan-orders/${id}`);
  },

  create: async (data: Partial<LoanOrder>) => {
    return http.post<LoanOrder>('/v1/loan-orders', data);
  },

  update: async (id: string, data: Partial<LoanOrder>) => {
    return http.put<LoanOrder>(`/v1/loan-orders/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/loan-orders/${id}`);
  },

  confirm: async (id: string) => {
    return http.post(`/v1/loan-orders/${id}/confirm`);
  },

  cancel: async (id: string) => {
    return http.post(`/v1/loan-orders/${id}/cancel`);
  },

  /** 归还：{ line_id, qty }[] */
  returnItems: async (id: string, lines: { line_id: string; qty: number }[]) => {
    return http.post<LoanOrder>(`/v1/loan-orders/${id}/return`, { lines });
  },
};

// ===== 寄售代销（P2 单据功能）=====

export interface ConsignmentOrderLine {
  id: string;
  line_no: number;
  product_id: string;
  product_name?: string;
  product_code?: string;
  spec?: string;
  qty: string;
  sold_qty: string;
  returned_qty: string;
  unit_cost: string;
  amount: string;
  batch_no?: string;
}

export interface ConsignmentOrder {
  id: string;
  consignment_no: string;
  party_id?: string;
  party_name?: string;
  warehouse_id: string;
  status: string; // draft / confirmed / settled / cancelled
  consignment_date?: string;
  expected_return_date?: string;
  total_qty: string;
  sold_qty: string;
  returned_qty: string;
  total_amount: string;
  remark?: string;
  edges?: {
    lines?: ConsignmentOrderLine[];
    warehouse?: { id: string; name: string };
  };
}

export const consignmentApi = {
  list: async (params?: PaginationParams & { status?: string; party_name?: string }) => {
    return http.get<PaginationResult<ConsignmentOrder>>('/v1/consignments', params);
  },
  get: async (id: string) => {
    return http.get<ConsignmentOrder>(`/v1/consignments/${id}`);
  },
  create: async (data: any) => {
    return http.post<ConsignmentOrder>('/v1/consignments', data);
  },
  update: async (id: string, data: any) => {
    return http.put<ConsignmentOrder>(`/v1/consignments/${id}`, data);
  },
  remove: async (id: string) => {
    return http.delete(`/v1/consignments/${id}`);
  },
  confirm: async (id: string) => {
    return http.post<ConsignmentOrder>(`/v1/consignments/${id}/confirm`);
  },
  sold: async (id: string, lines: { line_id: string; qty: number }[]) => {
    return http.post<ConsignmentOrder>(`/v1/consignments/${id}/sold`, { lines });
  },
  returnItems: async (id: string, lines: { line_id: string; qty: number }[]) => {
    return http.post<ConsignmentOrder>(`/v1/consignments/${id}/return`, { lines });
  },
  cancel: async (id: string) => {
    return http.post<ConsignmentOrder>(`/v1/consignments/${id}/cancel`);
  },
};
