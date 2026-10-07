/**
 * 行选择纯函数（U-05 2026-09-13）
 *
 * 单独放 utils 便于 `scripts/check_row_selection.mjs` 在 node 里断言
 * （hooks/useRowSelection.ts 依赖 react，node 无法直接加载）。
 */
/** 单行勾选/取消 */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** 全选/取消全选（作用于「本页」：本页已全选 → 取消本页；否则并入本页） */
export function toggleAllInPage(ids: string[], pageIds: string[]): string[] {
  if (pageIds.length === 0) return ids;
  const allSelected = pageIds.every((id) => ids.includes(id));
  if (allSelected) return ids.filter((id) => !pageIds.includes(id));
  return Array.from(new Set([...ids, ...pageIds]));
}

/** 本页勾选态：全选 / 部分（半选）/ 未选 */
export function pageState(ids: string[], pageIds: string[]): 'none' | 'some' | 'all' {
  if (pageIds.length === 0) return 'none';
  const hit = pageIds.filter((id) => ids.includes(id)).length;
  if (hit === 0) return 'none';
  return hit === pageIds.length ? 'all' : 'some';
}

/** 裁掉不在可用集合里的 id（列表刷新/翻页后调用，避免"看不见的选中项"被批量执行） */
export function pruneIds(ids: string[], availableIds: string[]): string[] {
  const set = new Set(availableIds);
  return ids.filter((id) => set.has(id));
}
