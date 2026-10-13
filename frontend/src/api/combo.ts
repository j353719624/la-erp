import { http } from '@/utils/request';
import { ComboDetail, ComboListItem, ComboLine, ComboActionResult, ComboStock } from '@/types/product';
import { PaginationParams, PaginationResult } from '@/types';

/** 组合商品（组装商品）API：配方维护 + 组装/拆解 */
export const comboApi = {
  /** 组合商品列表（成品） */
  list: async (params?: PaginationParams & { name?: string }) => {
    return http.get<PaginationResult<ComboListItem>>('/v1/combo-products', params);
  },

  /** 组合商品详情（成品 + 配方行 + 单件成本） */
  get: async (id: string) => {
    return http.get<ComboDetail>(`/v1/combo-products/${id}`);
  },

  /** 保存配方（把某商品标记为组合商品并全量替换配件行） */
  save: async (id: string, lines: Partial<ComboLine>[]) => {
    return http.put<null>(`/v1/combo-products/${id}`, { lines });
  },

  /** 取消组合标记（软删配方，商品本身保留） */
  remove: async (id: string) => {
    return http.delete<null>(`/v1/combo-products/${id}`);
  },

  /** 实体组装：成品入库 N，配件按配方出库 */
  assemble: async (id: string, warehouseId: string, qty: number) => {
    return http.post<ComboActionResult>(`/v1/combo-products/${id}/assemble`, { warehouse_id: warehouseId, qty });
  },

  /** 拆解：成品出库 N，配件按配方入库 */
  disassemble: async (id: string, warehouseId: string, qty: number) => {
    return http.post<ComboActionResult>(`/v1/combo-products/${id}/disassemble`, { warehouse_id: warehouseId, qty });
  },

  /** 某仓库下组合商品可组装数量与成品实体库存 */
  stock: async (id: string, warehouseId: string) => {
    return http.get<ComboStock>(`/v1/combo-products/${id}/available`, { warehouse_id: warehouseId });
  },
};
