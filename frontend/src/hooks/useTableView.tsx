import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TableViewMenu } from '@/components/TableViewMenu';
import { tableColumnLabel } from '@/utils/columnLabels';
import { applyColumnLabels, applyVisibleCols, decodeColLabels, decodeCols, encodeColLabels, encodeCols, resolveVisibleCols, viewParamNames, type ColumnLabels } from '@/utils/tableView';

interface ColumnLike {
  key: string;
  header: ReactNode;
}

interface UseTableViewOptions<T extends ColumnLike> {
  /** 页面标识（本地预设按页面分桶，如 'sales-order-list'） */
  pageKey: string;
  /** 页面当前全部列（描述符数组；通常就是 rowCols） */
  columns: T[];
  /**
   * 同页多表时的 URL 参数命名空间（2026-09-13）。
   * 不传 = 主表，用 `?cols=` / `?colnames=`；次表传 `paramNs: 'payables'` → `?cols.payables=`。
   * ⚠️ 同一页有两张表时**必须**给次表传（否则分享/刷新后次表会被主表的列清单裁掉，只剩锁定列）。
   */
  paramNs?: string;
  /** 锁定列：不允许隐藏（勾选列/操作列），固定首尾 */
  locked?: { leading?: string[]; trailing?: string[] };
  /**
   * 列中文名（可选）：用于视图菜单里的列标签。
   * 返回空串/未命中时回退：通用列名字典 → 菜单内部（锁定列名 / 列 header 文本 / 列 key）。
   * 典型用法：把元数据自定义字段码映射为字段中文名（否则菜单显示英文码）。
   */
  labelOf?: (key: string) => string;
  /**
   * 默认可见列（可选；无 URL `?cols=` 且用户未选择时生效）。
   * 用于「附加可选列默认隐藏」场景：页面把元数据自定义字段追加进 columns，
   * 但不放进 defaultVisible → 首屏不撑爆列，用户可在视图菜单勾选显示。
   * 不传 = 旧行为（默认显示全部列）。
   */
  defaultVisible?: string[];
  /**
   * 视图内「＋ 新建字段」：页面提供（负责权限判断、调元数据 API、创建后重拉布局）。
   * 返回 `{ appeared: false }` 表示该实体列表列已按布局定制、新字段不会自动进列。
   */
  createField?: (input: { name: string; code: string; fieldType: string }) => Promise<{ appeared?: boolean } | void>;
  /** 新建字段提示里的实体名（如“客户”） */
  entityLabel?: string;
}

/**
 * 表格视图（2026-09-11 P2）页面接入一行版：
 * ```tsx
 * const { visibleColumns, menu: viewMenu } = useTableView({
 *   pageKey: 'sales-order-list',
 *   columns: rowCols,
 *   locked: { leading: ['__sel'], trailing: ['__actions'] },
 *   defaultVisible, // 可选：附加可选列默认隐藏时用（不传 = 默认显示全部列）
 * });
 * // thead/tbody 用 visibleColumns 渲染；工具栏里放 {viewMenu}
 * ```
 * 职责：可见列（含列序）↔ URL `?cols=` 双向同步、自定义列名 ↔ URL `?colnames=`、锁定列保护、生成菜单元素。
 * 列定义仍归各页面（元数据布局/后端配置决定"有哪些列"，本 hook 只管"我看哪几列+叫什么名"）。
 */
export function useTableView<T extends ColumnLike>({ pageKey, paramNs, columns, locked, labelOf, createField, entityLabel, defaultVisible }: UseTableViewOptions<T>) {
  const { cols: colsParam, labels: labelsParam } = viewParamNames(paramNs);
  const [searchParams, setSearchParams] = useSearchParams();
  const [visibleCols, setVisibleCols] = useState<string[] | null>(() => decodeCols(searchParams.get(colsParam)));
  const [labels, setLabels] = useState<ColumnLabels | null>(() => decodeColLabels(searchParams.get(labelsParam)));

  useEffect(() => {
    // 只增删自己管的参数（useListFiltersUrl 同样保留其它参数，两者互不干扰）
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        const cols = encodeCols(visibleCols);
        if (cols) sp.set(colsParam, cols);
        else sp.delete(colsParam);
        const names = encodeColLabels(labels);
        if (names) sp.set(labelsParam, names);
        else sp.delete(labelsParam);
        return sp;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCols, labels]);

  // [2026-09-13] 命名空间切换（同页不同实体/不同表）→ 从 URL 重新读取，避免沿用上一实体的列清单
  // 场景：元数据动态数据列表在同一页面切换实体（列定义随之变化），不重读会把新实体的列全裁掉
  const paramRef = useRef({ cols: colsParam, labels: labelsParam });
  useEffect(() => {
    if (paramRef.current.cols === colsParam && paramRef.current.labels === labelsParam) return;
    paramRef.current = { cols: colsParam, labels: labelsParam };
    setVisibleCols(decodeCols(searchParams.get(colsParam)));
    setLabels(decodeColLabels(searchParams.get(labelsParam)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colsParam, labelsParam]);

  // 先按可见列过滤（含顺序），再把用户自定义列名套到表头——页面渲染 c.header 即生效
  // effectiveVisible：用户选择优先；未选择时用页面默认可见列（附加可选列默认隐藏）
  const effectiveVisible = resolveVisibleCols(visibleCols, defaultVisible);
  const visibleColumns = applyColumnLabels(applyVisibleCols(columns, effectiveVisible, locked), labels);
  const menu = (
    <TableViewMenu
      pageKey={pageKey}
      allColumns={columns.map((c) => ({
        key: c.key,
        header: c.header,
        // label 为空时回退：通用列名字典 → 交给菜单（锁定列名/列 header 文本/列 key）
        label: labelOf?.(c.key) || tableColumnLabel(c.key) || undefined,
      }))}
      locked={locked}
      visible={effectiveVisible}
      labels={labels}
      onLabelsChange={setLabels}
      createField={createField}
      entityLabel={entityLabel}
      onChange={setVisibleCols}
    />
  );

  return { visibleCols, setVisibleCols, visibleColumns, labels, menu };
}
