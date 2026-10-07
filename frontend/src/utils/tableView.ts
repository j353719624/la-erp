import type { ReactNode } from 'react';
// 带 .ts 扩展名：让 node --experimental-strip-types 检测脚本（scripts/check_table_view.mjs）能直接加载本模块
import { LS } from './localKeys.ts';

/**
 * 表格视图预设（2026-09-11 易用性 P2）——「我的视图」：用户自己决定「这张表显示哪些列」。
 *
 * 与「元数据布局」的分工（勿混淆）：
 *  - 布局（后端 Layout + 字段管理）：管理员级，决定**这张表有哪些列可用**（全公司统一）
 *  - 视图预设（本工具 + localStorage）：用户级，决定**我在这些列里看哪几个**（个人偏好，换人不影响别人）
 *
 * 分享链路：可见列同时写入 URL（`?cols=code,name,spec`）→ 复制地址栏即可把「我现在看的这张表」发同事，
 * 对方打开就是同一套列（不依赖他的本地预设）。
 */

/** URL 参数名（与 useListFiltersUrl 管理的筛选参数互不干扰：它会保留未知参数） */
export const TABLE_VIEW_PARAM = 'cols';
/** URL 参数名：自定义列名（列 key → 用户改名；值形如 `origin_country|产地;sale_price|单价`） */
export const TABLE_COL_LABELS_PARAM = 'colnames';

/**
 * 同页多表时的 URL 参数名（2026-09-13 修复真实 bug）。
 *
 * 背景：全站只用了 `?cols=` 一个参数——**同一页面的两张表会互相裁列**：
 * 主表保存视图后 URL 变成 `?cols=<主表列>`，刷新/分享链接打开时次表也按这份清单过滤，
 * 于是次表只剩锁定列（实测「税金计提」页第二张表只剩「操作」列）。
 *
 * 约定：页面**主表**沿用默认 `?cols=`（存量分享链接不变）；**次表**传 `namespace` → `?cols.<ns>` / `?colnames.<ns>`。
 * 用法：`useTableView({ pageKey: 'tax-accrual-payables', paramNs: 'payables', columns })`
 */
export function viewParamNames(namespace?: string): { cols: string; labels: string } {
  const suffix = namespace ? `.${namespace}` : '';
  return { cols: `${TABLE_VIEW_PARAM}${suffix}`, labels: `${TABLE_COL_LABELS_PARAM}${suffix}` };
}

/** 自定义列名：列 key → 显示名 */
export type ColumnLabels = Record<string, string>;

/** 保存的视图 */
export interface SavedTableView {
  id: string;
  name: string;
  cols: string[];
  /** 该视图自定义的列名（可选；未设置的列用页面默认表头） */
  labels?: ColumnLabels;
}

/** URL 值 → 列 key 数组；空/无效 → null（表示用页面默认列） */
export function decodeCols(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

/** 列 key 数组 → URL 值 */
export function encodeCols(cols: string[] | null): string {
  return (cols ?? []).join(',');
}

/** 自定义列名 → URL 值（形如 `origin_country|产地;sale_price|单价`；名内特殊字符用 URI 编码） */
export function encodeColLabels(labels: ColumnLabels | null | undefined): string {
  if (!labels) return '';
  return Object.entries(labels)
    .filter(([k, v]) => k && v && v.trim())
    .map(([k, v]) => `${k}|${encodeURIComponent(v.trim())}`)
    .join(';');
}

/** URL 值 → 自定义列名；空/全部无效 → null（用页面默认表头） */
export function decodeColLabels(raw: string | null | undefined): ColumnLabels | null {
  if (!raw) return null;
  const out: ColumnLabels = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('|');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    let value = '';
    try {
      value = decodeURIComponent(part.slice(i + 1)).trim();
    } catch {
      continue; // 坏编码忽略该项，不让整页报错
    }
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 解析“生效的可见列”（2026-09-12 追加；配合页面把**元数据自定义字段**追加为可选列）：
 * - 用户已选择（visible 非 null，含空数组=主动清空）→ 用用户选择；
 * - 未选择（null）且页面给了 defaultVisible → 用默认可见列（附加可选列默认隐藏，不撑爆列）；
 * - 都没有 → null（= 显示全部列，历史行为不变）。
 */
export function resolveVisibleCols(visible: string[] | null, defaultVisible?: string[] | null): string[] | null {
  if (visible) return visible;
  return defaultVisible && defaultVisible.length > 0 ? defaultVisible : null;
}

/**
 * 把自定义列名套到列描述符的 header 上（页面照旧渲染 `c.header` 即生效，无需改页面代码）。
 * 未改名的列保持原 header（可能是带图标的 JSX）。
 */
export function applyColumnLabels<T extends { key: string; header?: ReactNode }>(
  cols: T[],
  labels: ColumnLabels | null | undefined,
): T[] {
  if (!labels) return cols;
  return cols.map((c) => (labels[c.key] ? { ...c, header: labels[c.key] } : c));
}

/**
 * 按可见列过滤 + **按用户顺序**输出（"我的视图"支持排序列，2026-09-11 追加）。
 * - visible=null → 返回全部列（页面默认顺序）
 * - visible 数组的顺序 = 显示顺序（可写入 URL，分享后对端列序一致）
 * - visible 里已不存在的列 key（布局改过/元数据字段被删）自动忽略，不报错
 * - leading/trailing：**锁定列**（勾选列、操作列）——固定保留在首/尾，不参与排序
 */
export function applyVisibleCols<T extends { key: string }>(
  all: T[],
  visible: string[] | null,
  opts?: { leading?: string[]; trailing?: string[] },
): T[] {
  if (!visible) return all;
  const byKey = new Map(all.map((c) => [c.key, c]));
  const out: T[] = [];
  const seen = new Set<string>();
  const leading = opts?.leading ?? [];
  const trailing = opts?.trailing ?? [];
  const locked = new Set([...leading, ...trailing]);
  for (const k of leading) {
    const c = byKey.get(k);
    if (c) {
      out.push(c);
      seen.add(k);
    }
  }
  for (const k of visible) {
    if (seen.has(k) || locked.has(k)) continue;
    const c = byKey.get(k);
    if (c) {
      out.push(c);
      seen.add(k);
    }
  }
  for (const k of trailing) {
    const c = byKey.get(k);
    if (c && !seen.has(k)) out.push(c);
  }
  return out;
}

/**
 * 在可见列顺序里上移/下移一列（dir=-1 上移，1 下移）。
 * - 锁定列不可移动，也不作为跨越目标（跳过）
 * - 越界返回原顺序
 */
export function moveCol(order: string[], key: string, dir: -1 | 1, locked: string[] = []): string[] {
  const idx = order.indexOf(key);
  if (idx < 0 || locked.includes(key)) return order;
  let target = idx + dir;
  while (target >= 0 && target < order.length && locked.includes(order[target])) target += dir;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

// ── 本地预设（localStorage，按页面分桶） ─────────────────────────────────────

const presetKeyOf = (pageKey: string) => `${LS.tableViewPresets}:${pageKey}`;

/** 读取某页面已保存的视图（解析失败一律当空，不阻断页面） */
export function listSavedViews(pageKey: string): SavedTableView[] {
  try {
    const raw = localStorage.getItem(presetKeyOf(pageKey));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x): x is SavedTableView =>
        Boolean(x) && typeof x.id === 'string' && typeof x.name === 'string' && Array.isArray(x.cols),
    );
  } catch {
    return [];
  }
}

function writeSavedViews(pageKey: string, list: SavedTableView[]): SavedTableView[] {
  try {
    localStorage.setItem(presetKeyOf(pageKey), JSON.stringify(list));
  } catch {
    /* 隐私模式/配额满：忽略，页面仍可用（只是不持久） */
  }
  return list;
}

/** 保存当前视图（同名覆盖，避免同一页面堆一堆同名项） */
export function saveSavedView(
  pageKey: string,
  name: string,
  cols: string[],
  labels?: ColumnLabels | null,
): SavedTableView[] {
  const trimmed = name.trim();
  if (!trimmed) return listSavedViews(pageKey);
  const list = listSavedViews(pageKey);
  const clean = labels && Object.keys(labels).length ? { ...labels } : undefined;
  const existing = list.find((v) => v.name === trimmed);
  if (existing) {
    existing.cols = [...cols];
    existing.labels = clean;
    return writeSavedViews(pageKey, list);
  }
  const item: SavedTableView = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    cols: [...cols],
    labels: clean,
  };
  return writeSavedViews(pageKey, [...list, item]);
}

/** 删除某个已保存视图 */
export function removeSavedView(pageKey: string, id: string): SavedTableView[] {
  return writeSavedViews(
    pageKey,
    listSavedViews(pageKey).filter((v) => v.id !== id),
  );
}

/** 重命名已保存视图（新名为空或与其它视图重名时保持不变，由调用方提示） */
export function renameSavedView(pageKey: string, id: string, name: string): SavedTableView[] {
  const trimmed = name.trim();
  const list = listSavedViews(pageKey);
  const target = list.find((v) => v.id === id);
  if (!trimmed || !target) return list;
  if (list.some((v) => v.id !== id && v.name === trimmed)) return list;
  target.name = trimmed;
  return writeSavedViews(pageKey, list);
}
