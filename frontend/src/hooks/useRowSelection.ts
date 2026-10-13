import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pageState, pruneIds, toggleAllInPage, toggleId } from '@/utils/rowSelection';

/**
 * 行选择（批量操作基础，U-05 2026-09-13）
 *
 * 设计要点（安全优先）：
 *  - 选择**只保留在当前列表里**的行：列表变化（翻页/筛选/刷新）时自动裁掉不在列表中的 id，
 *    避免“看不见的选中项”被批量确认/过账（例如切到第 2 页后把第 1 页的选择也一起执行）。
 *  - id 集合用 string[]（可序列化、便于纯函数断言与门禁检查），不是 Set。
 *
 * 纯函数在 `utils/rowSelection.ts`（供 `scripts/check_row_selection.mjs` 断言），本文件只做 React 状态封装。
 */

export interface RowSelection<T> {
  /** 已选 id（顺序 = 勾选先后） */
  ids: string[];
  count: number;
  /** 本页勾选态（表头 checkbox 用） */
  state: 'none' | 'some' | 'all';
  isSelected: (row: T) => boolean;
  toggle: (row: T) => void;
  toggleAll: () => void;
  clear: () => void;
  /** 已选行的对象（仅当前列表内可解析的行） */
  selectedRows: T[];
}

export function useRowSelection<T>({ rows, getKey }: { rows: T[]; getKey: (row: T) => string }): RowSelection<T> {
  const [ids, setIds] = useState<string[]>([]);
  // getKey 通常是行内箭头函数（每次 render 都是新引用）→ 用 ref 稳住依赖，避免 useMemo 每帧重算
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const pageIds = useMemo(
    () => rows.map((r) => getKeyRef.current(r)).filter((x): x is string => !!x),
    [rows],
  );

  // 列表变化 → 裁掉失效选择（只比对长度即可判断是否有变化，避免无谓 setState 触发重渲染）
  useEffect(() => {
    setIds((prev) => {
      const next = pruneIds(prev, pageIds);
      return next.length === prev.length ? prev : next;
    });
  }, [pageIds]);

  const isSelected = useCallback((row: T) => {
    const key = getKeyRef.current(row);
    return !!key && ids.includes(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const selectedRows = useMemo(
    () => rows.filter((r) => {
      const key = getKeyRef.current(r);
      return !!key && ids.includes(key);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, ids],
  );

  return {
    ids,
    count: ids.length,
    state: pageState(ids, pageIds),
    isSelected,
    toggle: useCallback((row: T) => {
      const key = getKeyRef.current(row);
      if (key) setIds((prev) => toggleId(prev, key));
    }, []),
    toggleAll: useCallback(() => setIds((prev) => toggleAllInPage(prev, pageIds)), [pageIds]),
    clear: useCallback(() => setIds([]), []),
    selectedRows,
  };
}
