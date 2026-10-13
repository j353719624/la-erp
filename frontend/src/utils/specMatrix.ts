/**
 * 多规格商品（SPU/SKU）「规格矩阵」纯逻辑（W-01，2026-09-13）
 *
 * 背景（用户反馈「多规格商品操作繁琐，入库出库都非常低效」）：一款多 SKU（如 颜色×尺码=6 个）
 * 在单据里要一条条加行、在平铺的同名商品下拉里逐个翻找。仓库/开单的标准做法是
 * 「按款 → 规格矩阵一次录完数量」。
 *
 * 本模块只放纯函数（无 React、无请求、无 DOM），便于：
 *  ① 组件 `MultiSpecPickerModal` 复用；
 *  ② 门禁脚本 `scripts/check_spec_matrix.mjs` 直接 import 跑断言（node --experimental-strip-types）。
 *
 * SKU 事实（见 internal/service/base/product_spu_service.go GenerateSKUs）：
 *  - 每个 SKU 是一条商品：name=款名、spec=维度值按维度顺序用 "/" 拼接（如 `红/S`）、
 *    ext_fields[维度码]=维度值（如 {color:'红', size:'S'}）、code=`款编码-序号`。
 *  - 维度定义（顺序/名称/可选值）在多规格商品(SPU)的 dims 上，SKU 上只有值。
 */

/** SKU 商品的最小结构（Product 满足） */
export interface SpecSkuLike {
  id: string;
  spec?: string | null;
  ext_fields?: Record<string, unknown> | null;
  stock_by_warehouse?: { warehouse_id?: string | null; qty_available?: string | number | null }[] | null;
  stock_qty?: string | number | null;
}

/** 款规格维度（SpuDim 满足） */
export interface SpecDimLike {
  code: string;
  name?: string | null;
  values: string[];
}

/**
 * SKU → 各维度值（与 dims 顺序对齐）。
 * 取值优先 ext_fields（精确键 → 大小写不敏感键），全部取到即返回；
 * 否则用 spec 按 "/" 拆分（仅当拆分数与维度数一致时可信），仍缺则该项为空串（调用方转入「其他规格」）。
 */
export function skuDimValues(sku: SpecSkuLike, dims: SpecDimLike[]): string[] {
  if (!dims.length) return [];
  const ef = sku.ext_fields && typeof sku.ext_fields === 'object' ? sku.ext_fields : null;
  const out: string[] = [];
  let allFound = true;
  for (const dim of dims) {
    let raw: unknown;
    if (ef) {
      if (Object.prototype.hasOwnProperty.call(ef, dim.code)) raw = ef[dim.code];
      else {
        const key = Object.keys(ef).find((k) => k.toLowerCase() === dim.code.toLowerCase());
        if (key) raw = ef[key];
      }
    }
    const text = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!text) allFound = false;
    out.push(text);
  }
  if (allFound) return out;
  const parts = String(sku.spec ?? '').split('/').map((s) => s.trim());
  if (parts.length === dims.length && parts.every(Boolean)) return parts;
  return out;
}

/** 规格矩阵构建结果 */
export interface SpecMatrixResult<T> {
  /** matrix=按维度网格录入；list=无维度（单 SKU）/ 3+ 维时退化为扁平行列表 */
  mode: 'matrix' | 'list';
  /** 第一维名称（list 为空） */
  rowLabel: string;
  /** 第二维名称（一维/列表为空） */
  colLabel: string;
  /** 列值（一维矩阵为 ['']） */
  colValues: string[];
  /** 行：label=行值，cells 与 colValues 对齐；无对应 SKU 的组合为 null */
  rows: { label: string; cells: (T | null)[] }[];
  /** 未并入矩阵的 SKU（规格缺失/重复组合/3+ 维），由界面在「其他规格」区兜底录入 */
  leftover: T[];
}

const keyOf = (vals: string[]) => vals.join('\u0001');

const uniqueValues = (values: string[]) => [...new Set((values || []).map((v) => String(v).trim()).filter(Boolean))];

/**
 * 维度 × SKU 列表 → 矩阵：
 *  - 2 维：行为 dims[0].values、列为 dims[1].values（颜色×尺码这类标准网格）；
 *  - 1 维：行为该维值、单列；
 *  - 0 维 / 3+ 维：mode='list'，全部 SKU 进 leftover 扁平录入（网格无法表达）。
 * 匹配不到的 SKU 一律进 leftover，绝不静默丢弃——含"维度值不在 dims.values"（规格被编辑/导入脏数据）
 * 与"组合重复/缺值"三种情况（2026-09-13 审查补齐第一种）。
 */
export function buildSpecMatrix<T extends SpecSkuLike>(dims: SpecDimLike[], skus: T[]): SpecMatrixResult<T> {
  const useDims = (dims || []).filter((d) => d && d.code && uniqueValues(d.values).length > 0);
  if (useDims.length === 0 || useDims.length >= 3) {
    return { mode: 'list', rowLabel: '', colLabel: '', colValues: [], rows: [], leftover: [...skus] };
  }
  const byKey = new Map<string, T>();
  const leftover: T[] = [];
  for (const sku of skus) {
    const vals = skuDimValues(sku, useDims);
    if (vals.some((v) => !v)) {
      leftover.push(sku);
      continue;
    }
    const key = keyOf(vals);
    if (byKey.has(key)) {
      // 同组合重复（异常数据）不覆盖，进兜底区由人工决定
      leftover.push(sku);
      continue;
    }
    byKey.set(key, sku);
  }
  if (useDims.length === 1) {
    const values = uniqueValues(useDims[0].values);
    const rows = values.map((v) => ({ label: v, cells: [byKey.get(v) ?? null] }));
    // ⚠️ 2026-09-13 审查修复：SKU 维度值不在 dims.values（规格被编辑/导入脏数据）时，
    // byKey 收了但它不落任何格子——必须补进 leftover，绝不静默丢弃（模块契约）
    const used = new Set(values);
    for (const [k, sku] of byKey) if (!used.has(k)) leftover.push(sku);
    return { mode: 'matrix', rowLabel: useDims[0].name || useDims[0].code, colLabel: '', colValues: [''], rows, leftover };
  }
  const rowValues = uniqueValues(useDims[0].values);
  const colValues = uniqueValues(useDims[1].values);
  const usedKeys = new Set<string>();
  const rows = rowValues.map((rv) => ({
    label: rv,
    cells: colValues.map((cv) => {
      const key = keyOf([rv, cv]);
      const sku = byKey.get(key) ?? null;
      if (sku) usedKeys.add(key);
      return sku;
    }),
  }));
  for (const [key, sku] of byKey) if (!usedKeys.has(key)) leftover.push(sku);
  return {
    mode: 'matrix',
    rowLabel: useDims[0].name || useDims[0].code,
    colLabel: useDims[1].name || useDims[1].code,
    colValues,
    rows,
    leftover,
  };
}

/** 维度摘要文案：`颜色[红、蓝] × 尺码[S、M]`（与多规格商品页一致） */
export function spuDimsSummary(dims: SpecDimLike[] | undefined | null): string {
  return (dims || [])
    .map((d) => `${d.name || d.code}[${(d.values || []).join('、')}]`)
    .join(' × ');
}

/**
 * 某 SKU 在某仓库的可用库存（出库矩阵的「可用」列）。
 * 数据源 = 商品列表接口的 stock_by_warehouse（qty_available）；缺值为 0，不抛错。
 */
export function availableQtyInWarehouse(
  sku: Pick<SpecSkuLike, 'stock_by_warehouse'>,
  warehouseId?: string | null,
): number {
  if (!warehouseId) return 0;
  const row = (sku.stock_by_warehouse || []).find((w) => String(w?.warehouse_id ?? '') === warehouseId);
  const n = Number(row?.qty_available ?? 0);
  return Number.isFinite(n) ? n : 0;
}
