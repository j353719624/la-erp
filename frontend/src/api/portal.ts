import { portalHttp, http } from '@/utils/request';

// 客户自助门户 API（登录/商品/下单/我的订单 走 portal token；设置客户账号走内部 token）

/** 门户商品“产品相关信息”条目（颜色/尺码等商品自定义字段；label 已按元数据转中文） */
export interface PortalAttribute {
  label: string;
  value: string;
}

export interface PortalProduct {
  id: string;
  code: string;
  name: string;
  spec: string;
  sale_price: number;
  unit: string;
  category_id: string;
  category_name: string;
  /** 现货在库可用合计（跨仓库汇总；0 表示暂无现货） */
  stock_qty: number;
  /** 是否隐藏库存（管理端“客户可见库存”关闭=true，前端据此不渲染库存信息） */
  stock_hidden?: boolean;
  /** 起订量（0=不限；数量可小数） */
  min_order_qty: number;
  /** 安全库存（内部补货阈值；后端在库存隐藏时置 0，前端不使用） */
  safety_stock: number;
  /** 商品首图（相对路径 /uploads/...，无图空串） */
  image_url: string;
  /** 多图（商城详情画册用，无图空数组） */
  images: string[];
  /** 商品描述（客户门户详情页展示文案；管理端商品资料录入） */
  description?: string;
  /** 产品相关信息（颜色/尺码等商品自定义字段，无则空数组） */
  attributes?: PortalAttribute[];
  /** 所属款(SPU)：有值=该卡片是某款下的一个 SKU（同款多颜色/尺码，详情可选规格） */
  spu_id?: string;
}

/** 同款（同分类同名）商品的不同规格，详情页用于“选择型号/规格” */
export interface PortalVariant {
  id: string;
  code: string;
  name: string;
  spec: string;
  sale_price: number;
  unit: string;
  /** 起订量（0=不限；数量可小数） */
  min_order_qty: number;
  stock_qty: number;
  /** 与父商品一致的库存隐藏标记（show_stock=关时为 true） */
  stock_hidden?: boolean;
  image_url: string;
  /** 商品描述（客户门户详情页展示文案） */
  description?: string;
  /** 产品相关信息（该规格自己的自定义字段，无则空数组） */
  attributes?: PortalAttribute[];
}

export interface PortalProductDetail {
  product: PortalProduct;
  variants: PortalVariant[];
}

export interface PortalCategory {
  id: string;
  name: string;
  product_count: number;
}

export interface PortalOrder {
  id: string;
  order_no: string;
  status: string;
  customer_progress: string;
  total_amount: number;
  order_date: string | null;
  tracking_no: string;
  shipped_at: string | null;
  created_at: string;
}

export interface PortalLoginResult {
  access_token: string;
  customer_id: string;
  customer_name: string;
}

export const portalApi = {
  // 客户登录（公开）
  login: async (account: string, password: string) => {
    return portalHttp.post<PortalLoginResult>('/v1/portal/login', { account, password });
  },

  // 客户登出（服务端吊销：token_version+1，旧 token 立即失效）。
  // ⚠️ 必须【先取 token → 清本地 → 带 Authorization 显式调用】（同主站登出约定）：
  // 先清本地再调用 = 请求无 token、服务端无法吊销（复制出的 token 到期前仍可用，P2-10）。
  logout: async (token: string | null) => {
    return portalHttp.post('/v1/portal/logout', undefined, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  },

  // 商品分类（仅含在售商品的分类；客户 token）
  listCategories: async () => {
    return portalHttp.get<PortalCategory[]>('/v1/portal/categories');
  },

  // 商品列表（客户 token；可按关键词/分类筛选）
  listProducts: async (params?: { page?: number; page_size?: number; keyword?: string; category_id?: string; sort?: string }) => {
    return portalHttp.get<{ total: number; list: PortalProduct[] }>('/v1/portal/products', params);
  },

  // 商品详情（多图 + 同款可选规格；客户 token）
  getProduct: async (id: string) => {
    return portalHttp.get<PortalProductDetail>(`/v1/portal/products/${id}`);
  },

  // 自助下单（客户 token）
  createOrder: async (lines: { product_id: string; product_name?: string; qty: number }[]) => {
    return portalHttp.post<{ order_no: string; order_id: string; status: string; total_amount: number; message: string }>(
      '/v1/portal/orders',
      { lines }
    );
  },

  // 我的订单（客户 token）
  myOrders: async (params?: { page?: number; page_size?: number }) => {
    return portalHttp.get<{ total: number; list: PortalOrder[] }>('/v1/portal/orders', params);
  },

  // 为客户设置自助登录账号（内部 customer_edit 权限）
  setupAccount: async (customerId: string, account: string, password: string) => {
    return http.post<{ customer_id: string; login_account: string; enabled: boolean }>(
      `/v1/customers/${customerId}/portal-account`,
      { account, password }
    );
  },

  // ===== 门户管理（内部 sales_order_list 权限）=====

  // 门户全局配置（enabled 总开关 + show_stock 客户可见库存）
  getSettings: async () => {
    return http.get<{ enabled: boolean; show_stock: boolean; key: string; note: string }>('/v1/portal/admin/settings');
  },

  // 设置门户全局开关（局部更新：enabled/show_stock 均可省略）
  updateSettings: async (params: { enabled?: boolean; show_stock?: boolean }) => {
    return http.put<{ enabled: boolean; show_stock: boolean }>('/v1/portal/admin/settings', params);
  },

  // 客户级自助下单资格开关
  setCustomerEnabled: async (customerId: string, enabled: boolean) => {
    return http.put<{ customer_id: string; portal_enabled: boolean }>(
      `/v1/customers/${customerId}/portal-enabled`,
      { enabled }
    );
  },

  // 自助订单列表（source=portal）
  adminOrders: async (params?: { page?: number; page_size?: number }) => {
    return http.get<{ total: number; list: PortalAdminOrder[] }>('/v1/portal/admin/orders', params);
  },

  // 已开通自助下单资格的客户列表
  adminCustomers: async (params?: { page?: number; page_size?: number }) => {
    return http.get<{ total: number; list: PortalAdminCustomer[] }>('/v1/portal/admin/customers', params);
  },
};

export interface PortalAdminOrder {
  id: string;
  order_no: string;
  customer_id: string;
  customer_name: string;
  status: string;
  customer_progress: string;
  total_amount: number;
  order_date: string | null;
  created_at: string;
}

export interface PortalAdminCustomer {
  id: string;
  code: string;
  name: string;
  status: string;
  login_account: string;
  last_login_at: string | null;
}
