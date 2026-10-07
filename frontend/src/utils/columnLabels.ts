/**
 * 系统内置数据表列 → 中文显示名
 *
 * 动态数据页 / 布局编辑器里，"数据表列（系统内置）" 是指真实数据库表中、
 * 但没有在「字段管理」注册为元数据字段的列（如商品表的 spec/barcode/sale_price…）。
 * 元数据字段（FieldDef）自带中文 name，不走本映射；本表只兜底"表列"的中文名，
 * 未收录的列回退显示原始列码（code）。
 */
export const SYSTEM_COLUMN_LABELS: Record<string, string> = {
  // ── 通用/系统列 ─────────────────────────────
  id: 'ID',
  tenant_id: '租户',
  department_id: '部门',
  code: '编码',
  name: '名称',
  status: '状态',
  remark: '备注',
  ext: '扩展字段',
  ext_fields: '扩展字段',
  created_at: '创建时间',
  updated_at: '更新时间',
  deleted_at: '删除时间',
  created_by: '创建人',
  updated_by: '更新人',
  sort_order: '排序',
  seq: '序号',

  // ── 商品（products）─────────────────────────
  category_id: '分类',
  unit_id: '单位',
  spec: '规格',
  model: '型号',
  barcode: '条码',
  product_type: '商品类型',
  is_batch: '批次管理',
  is_serial: '序列号管理',
  shelf_life_days: '保质期(天)',
  safety_stock: '安全库存',
  min_order_qty: '最低订购量',
  cost_method: '成本核算方法',
  sale_price: '销售价',
  purchase_price: '采购价',
  image_url: '图片',
  images: '图片集',
  is_combo: '组合商品',
  is_active: '启用',

  // ── 客户/供应商/往来单位（customers/suppliers）──
  contact_person: '联系人',
  phone: '电话',
  mobile: '手机',
  email: '邮箱',
  fax: '传真',
  address: '地址',
  tax_no: '税号',
  payment_term: '账期(天)',
  credit_limit: '信用额度',
  customer_type: '客户类型',
  customer_grade: '客户等级',
  supplier_type: '供应商类型',
  website: '网址',
  bank_name: '开户行',
  bank_account: '银行账号',
  settlement_type: '结算方式',
  default_price_list: '默认价格表',
  level: '等级',

  // ── 仓库/库位（warehouses/locations/racks）──
  warehouse_type: '仓库类型',
  manager: '负责人',
  area: '面积',
  location_type: '库位类型',
  rack_code: '货架编码',
  capacity: '容量',
  is_frozen: '冻结',

  // ── 单据通用（采购/销售/库存/生产/财务单头）──
  order_no: '单据编号',
  doc_no: '单据编号',
  doc_date: '单据日期',
  order_date: '单据日期',
  business_date: '业务日期',
  doc_type: '单据类型',
  source_type: '来源类型',
  source_no: '来源单号',
  warehouse_id: '仓库',
  to_warehouse_id: '目标仓库',
  supplier_id: '供应商',
  customer_id: '客户',
  total_amount: '总金额',
  total_qty: '总数量',
  amount: '金额',
  tax_amount: '税额',
  discount_amount: '折扣额',
  paid_amount: '已付金额',
  unpaid_amount: '未付金额',
  currency: '币种',
  exchange_rate: '汇率',
  approver: '审批人',
  approved_at: '审批时间',
  submitter: '提交人',
  submitted_at: '提交时间',
  department: '部门',
  project: '项目',
  due_date: '到期日',
  delivery_date: '交货日期',

  // ── 单据行 ────────────────────────────────
  product_id: '商品',
  line_no: '行号',
  unit_cost: '单价',
  price: '单价',
  qty: '数量',
  unit_price: '单价',
  line_amount: '行金额',
  received_qty: '已收数量',
  delivered_qty: '已发数量',
  invoiced_qty: '已开票数量',
  batch_no: '批号',
  lot_no: '批次号',

  // ── 库存 ──────────────────────────────────
  on_hand_qty: '在手数量',
  available_qty: '可用数量',
  locked_qty: '锁定数量',
  in_transit_qty: '在途数量',
  allocated_qty: '已分配数量',
  balance_qty: '结存数量',
  movement_type: '流水类型',
  in_qty: '入库数量',
  out_qty: '出库数量',

  // ── 财务 ──────────────────────────────────
  account_code: '科目编码',
  account_name: '科目名称',
  debit: '借方',
  credit: '贷方',
  balance: '余额',
  direction: '方向',
  ar_amount: '应收金额',
  ap_amount: '应付金额',
};

/** 返回表列的中文显示名；未收录返回空串（由调用方回退到原始列码）。 */
export function tableColumnLabel(code: string): string {
  return SYSTEM_COLUMN_LABELS[code] || '';
}

// 实体分类（entity_defs.category 存储英文模块码 base/purchase/sale…）→ 中文；兼容历史中文值
export const ENTITY_CATEGORY_LABELS: Record<string, string> = {
  base: '基础数据',
  purchase: '采购',
  sale: '销售',
  production: '生产',
  finance: '财务',
  inventory: '库存',
  system: '系统',
  trade: '购销',
  business: '业务单据',
  '基础数据': '基础数据',
  '业务单据': '业务单据',
  '辅助资料': '辅助资料',
  '其他': '其他',
};

/** 实体分类显示名；未知/空返回 '-' */
export function entityCategoryLabel(v?: string): string {
  return (v && ENTITY_CATEGORY_LABELS[v]) || v || '-';
}
