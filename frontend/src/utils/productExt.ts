/**
 * 单据行「商品自定义字段」只读展示工具（2026-09-16 用户需求）
 *
 * 背景：商品上的自定义字段（元数据 FieldDef，值存商品 ext_fields）需要
 * 在出库/入库/订单/调拨/盘点等业务单据中只读带出展示（行内小字、详情、打印「商品信息」列）。
 * 商品字段改动后全链路同步显示最新值（实时读取）。
 *
 * 读取链（依次回退）：
 *   1. line.ext.product_ext —— 行快照（预留：未来写入行 ext 快照时优先使用）
 *   2. line.ext_fields —— 新建单据时本地抄写的商品字段（尚未保存时）
 *   3. line.edges.product.ext_fields —— 商品边（编辑/详情/打印，后端加载商品边后提供）
 */
import { fieldApi } from '@/api/metadata';

export interface ProductFieldLabel {
  code: string;
  name: string;
  sort_order?: number;
}

export interface ProductExtEntry {
  code: string;
  label: string;
  value: string;
}

let labelsCache: ProductFieldLabel[] | null = null;
let labelsInflight: Promise<ProductFieldLabel[]> | null = null;

/**
 * 拉取商品实体字段标签（code→中文名，模块级缓存，跨页共享）。
 * 失败静默返回空数组（展示降级为 code，不影响单据功能）；不缓存失败结果，下次可重试。
 */
export async function loadProductFieldLabels(): Promise<ProductFieldLabel[]> {
  if (labelsCache) return labelsCache;
  if (labelsInflight) return labelsInflight;
  labelsInflight = (async () => {
    try {
      const res = await fieldApi.labels('product');
      const list = res.code === 0 && Array.isArray(res.data) ? res.data : [];
      labelsCache = list;
      return list;
    } catch {
      return [];
    } finally {
      labelsInflight = null;
    }
  })();
  return labelsInflight;
}

/** 从单据行解析商品自定义字段容器（读取链：行快照 → 本地抄写 → 商品边；空对象视为无值继续回退） */
export function productExtOf(line: unknown): Record<string, unknown> | undefined {
  const l = line as Record<string, any> | undefined;
  if (!l) return undefined;
  const isFilled = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v as object).length > 0;

  const snapshot = l.ext && typeof l.ext === 'object' ? (l.ext as Record<string, unknown>).product_ext : undefined;
  if (isFilled(snapshot)) return snapshot as Record<string, unknown>;
  if (isFilled(l.ext_fields)) return l.ext_fields as Record<string, unknown>;
  const fromProduct = l.edges?.product?.ext_fields;
  if (isFilled(fromProduct)) return fromProduct as Record<string, unknown>;
  return undefined;
}

/** 值 → 展示文本（空值/空数组/空对象 → 空串被过滤；布尔中文化；数组用「、」连接） */
function toDisplayText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v === true) return '是';
  if (v === false) return '否';
  if (Array.isArray(v)) {
    return v
      .map((x) => (x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x)))
      .filter((s) => s.trim() !== '')
      .join('、');
  }
  if (typeof v === 'object') {
    return Object.keys(v as object).length > 0 ? JSON.stringify(v) : '';
  }
  return String(v);
}

/**
 * 解析出可展示条目（过滤空值；按字段定义排序——已定义字段按 sort_order，未定义按 code 字典序排最后）。
 */
export function productExtEntries(line: unknown, labels: ProductFieldLabel[] | null): ProductExtEntry[] {
  const src = productExtOf(line);
  if (!src) return [];
  const rank = new Map<string, number>();
  const nameOf = new Map<string, string>();
  (labels || []).forEach((f, i) => {
    rank.set(f.code, typeof f.sort_order === 'number' ? f.sort_order : i);
    nameOf.set(f.code, f.name || f.code);
  });
  return Object.entries(src)
    .filter(([code]) => code !== 'ext' && code !== 'ext_fields')
    .map(([code, v]) => ({ code, label: nameOf.get(code) || code, value: toDisplayText(v) }))
    .filter((e) => e.value.trim() !== '')
    .sort(
      (a, b) =>
        (rank.has(a.code) ? rank.get(a.code)! : Number.MAX_SAFE_INTEGER) -
          (rank.has(b.code) ? rank.get(b.code)! : Number.MAX_SAFE_INTEGER) || a.code.localeCompare(b.code),
    );
}

/**
 * 紧凑摘要文本：`原产国：中国 · 配料表：小麦粉、水`
 * max 限制展示项数（超出追加「等N项」）；不传 max 展示全部（打印用）。
 */
export function productExtSummary(line: unknown, labels: ProductFieldLabel[] | null, max?: number): string {
  const entries = productExtEntries(line, labels);
  if (entries.length === 0) return '';
  const shown = max && max > 0 ? entries.slice(0, max) : entries;
  const text = shown.map((e) => `${e.label}：${e.value}`).join(' · ');
  return max && max > 0 && entries.length > max ? `${text} 等${entries.length}项` : text;
}
