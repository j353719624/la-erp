import { http } from '@/utils/request';
import { Product, Category, CategoryTreeNode, Unit, Warehouse, PriceList, UnitConversion, Spu, SpuGenerateResult } from '@/types/product';
import { PaginationParams, PaginationResult } from '@/types';

export const productApi = {
  list: async (params?: PaginationParams & { name?: string; keyword?: string; product_type?: string; category_id?: string; status?: string }) => {
    return http.get<PaginationResult<Product>>('/v1/products', params);
  },

  get: async (id: string) => {
    return http.get<Product>(`/v1/products/${id}`);
  },

  create: async (data: Partial<Product>) => {
    return http.post<Product>('/v1/products', data);
  },

  update: async (id: string, data: Partial<Product>) => {
    return http.put<Product>(`/v1/products/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/products/${id}`);
  },
};

export const categoryApi = {
  list: async (params?: { entity_code?: string }) => {
    return http.get<PaginationResult<Category>>('/v1/categories', params);
  },

  /** 全量分类树（无分页截断），供分类管理父级下拉/树形列表及各表单分类下拉使用 */
  tree: async (entityCode: string) => {
    return http.get<CategoryTreeNode[]>('/v1/categories/tree', { entity_code: entityCode });
  },

  get: async (id: string) => {
    return http.get<Category>(`/v1/categories/${id}`);
  },

  create: async (data: Partial<Category>) => {
    return http.post<Category>('/v1/categories', data);
  },

  update: async (id: string, data: Partial<Category>) => {
    return http.put<Category>(`/v1/categories/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/categories/${id}`);
  },
};

export const unitApi = {
  list: async (params?: PaginationParams & { name?: string; code?: string; status?: string; is_base?: boolean }) => {
    return http.get<PaginationResult<Unit>>('/v1/units', params);
  },

  get: async (id: string) => {
    return http.get<Unit>(`/v1/units/${id}`);
  },

  create: async (data: Partial<Unit>) => {
    return http.post<Unit>('/v1/units', data);
  },

  update: async (id: string, data: Partial<Unit>) => {
    return http.put<Unit>(`/v1/units/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/units/${id}`);
  },
};

/** 商品多计量单位换算（P1-1） */
export const unitConversionApi = {
  list: async (productId: string) => {
    return http.get<UnitConversion[]>(`/v1/products/${productId}/unit-conversions`);
  },

  create: async (productId: string, data: { unit_id: string; unit_name?: string; rate: number; remark?: string }) => {
    return http.post<UnitConversion>(`/v1/products/${productId}/unit-conversions`, data);
  },

  update: async (productId: string, id: string, data: { rate?: number; remark?: string }) => {
    return http.put(`/v1/products/${productId}/unit-conversions/${id}`, data);
  },

  delete: async (productId: string, id: string) => {
    return http.delete(`/v1/products/${productId}/unit-conversions/${id}`);
  },
};

/** 商品款(SPU)主档：款下多 SKU（颜色/尺码各为一条商品） */
export const spuApi = {
  list: async (params?: PaginationParams & { keyword?: string }) => {
    return http.get<PaginationResult<Spu>>('/v1/spus', params);
  },
  /** 多规格商品详情（含其下 SKU 商品明细） */
  get: async (id: string) => {
    return http.get<Spu>(`/v1/spus/${id}`);
  },
  create: async (data: Partial<Spu>) => {
    return http.post<Spu>('/v1/spus', data);
  },
  update: async (id: string, data: Partial<Spu>) => {
    return http.put<Spu>(`/v1/spus/${id}`, data);
  },
  delete: async (id: string) => {
    return http.delete(`/v1/spus/${id}`);
  },
  /** 款下按 颜色×尺码 批量生成 SKU 商品 */
  generateSKUs: async (id: string, data: { sale_price?: number | string; purchase_price?: number | string; skip_existing?: boolean }) => {
    return http.post<SpuGenerateResult>(`/v1/spus/${id}/skus`, data);
  },
};

export const warehouseApi = {
  list: async (params?: PaginationParams & { name?: string; status?: string }) => {
    return http.get<PaginationResult<Warehouse>>('/v1/warehouses', params);
  },

  get: async (id: string) => {
    return http.get<Warehouse>(`/v1/warehouses/${id}`);
  },

  create: async (data: Partial<Warehouse>) => {
    return http.post<Warehouse>('/v1/warehouses', data);
  },

  update: async (id: string, data: Partial<Warehouse>) => {
    return http.put<Warehouse>(`/v1/warehouses/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/warehouses/${id}`);
  },
};

export const priceListApi = {
  list: async (params?: PaginationParams & { name?: string; list_type?: string; status?: string }) => {
    return http.get<PaginationResult<PriceList>>('/v1/price-lists', params);
  },

  get: async (id: string) => {
    return http.get<PriceList>(`/v1/price-lists/${id}`);
  },

  create: async (data: Partial<PriceList>) => {
    return http.post<PriceList>('/v1/price-lists', data);
  },

  update: async (id: string, data: Partial<PriceList>) => {
    return http.put<PriceList>(`/v1/price-lists/${id}`, data);
  },

  delete: async (id: string) => {
    return http.delete(`/v1/price-lists/${id}`);
  },

  /** 取价：客户/供应商价目表自动带价 */
  price: async (params: { list_type: string; entity_id?: string; product_id: string; qty?: number }) => {
    return http.get<{ price: string; found: boolean }>('/v1/price-lists/price', params);
  },
};
