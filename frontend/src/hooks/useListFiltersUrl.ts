import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPreferredPageSize } from '@/utils/preferences';

type Primitive = string | number;

/**
 * 列表页筛选条件 ↔ URL 双向同步（2026-09-11 P0-5 易用性）。
 *
 * 解决的问题（ERP 老痛点）：
 *  - 筛选后点进详情/编辑，返回时条件与页码全丢 → 被迫重新筛选
 *  - 刷新页面丢条件
 *  - 想把「某个筛选结果」发同事，只能口头描述
 *
 * 用法（最小侵入，不动页面既有 state 结构）：
 * ```tsx
 * const { initial, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
 * const [keyword, setKeyword] = useState(initial.keyword);
 * const [pagination, setPagination] = useState({ page: initial.page, page_size: initial.page_size, total: 0 });
 *
 * // 值变化 → 写回 URL（replace 模式，不污染浏览器历史）
 * useEffect(() => {
 *   syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
 * }, [keyword, pagination.page, pagination.page_size]);
 * ```
 * 约定：与默认值相同/为空的项会从 URL 移除，保持地址干净、可分享。
 */
export function useListFiltersUrl<T extends Record<string, Primitive>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const defaultsRef = useRef(defaults);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // URL → 初值（仅首次读取；非法值回落默认值）
  const initial = useRef<T>(
    (() => {
      const out = { ...defaultsRef.current } as T;
      (Object.keys(defaultsRef.current) as (keyof T)[]).forEach((key) => {
        const raw = paramsRef.current.get(String(key));
        if (raw === null || raw === '') {
          // [P-01 个人偏好] 全局默认每页条数：仅当页面声明了 page_size 且 URL 未带时生效
          // （preference=0 表示未设置 → 沿用页面自身默认，如审计日志 20 条）
          if (key === 'page_size') {
            const pref = getPreferredPageSize();
            if (pref > 0) out[key] = pref as T[keyof T];
          }
          return;
        }
        const def = defaultsRef.current[key];
        if (typeof def === 'number') {
          const n = Number(raw);
          out[key] = (Number.isFinite(n) ? n : def) as T[keyof T];
        } else {
          out[key] = raw as T[keyof T];
        }
      });
      return out;
    })(),
  ).current;

  /** 把当前筛选值写回 URL（只增删本 hook 管理的字段，保留其它参数） */
  const syncUrl = (values: Partial<T>) => {
    const sp = new URLSearchParams(paramsRef.current);
    (Object.keys(defaultsRef.current) as (keyof T)[]).forEach((key) => {
      const v = values[key];
      if (v === undefined || v === null || v === '' || String(v) === String(defaultsRef.current[key])) {
        sp.delete(String(key));
        return;
      }
      // [P-01 个人偏好] 每页条数等于"个人默认"时不写 URL：偏好是个人设置、不是可分享状态；
      // 且挂载瞬间写 URL 会与 useTableView 等其它 URL 写入方同 tick 竞争（实测会被对方
      // 用同一渲染周期的旧参数抹掉）。URL 只记录"偏离个人默认"的选择。
      if (key === 'page_size') {
        const pref = getPreferredPageSize();
        if (pref > 0 && String(v) === String(pref)) {
          sp.delete(String(key));
          return;
        }
      }
      sp.set(String(key), String(v));
    });
    setParams(sp, { replace: true });
    paramsRef.current = sp; // 连续调用时避免读到旧值
  };

  return { initial, syncUrl };
}
