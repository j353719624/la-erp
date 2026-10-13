import { useCallback, useRef } from 'react';

/**
 * 列表请求竞态守卫（P0-4/P1）：
 * 列表页快速切换筛选/搜索/翻页时，旧请求可能晚于新请求返回并覆盖新结果，
 * 导致“列表显示与筛选条件不一致”，用户可能基于错误数据执行审核/删除等操作。
 *
 * 用法（在 fetch 函数内）：
 *   const { nextSeq, isCurrent } = useRequestGuard();
 *   const fetch = async () => {
 *     const seq = nextSeq();               // 每次发起请求取新序号
 *     ...
 *     if (response.code === 0) {
 *       if (!isCurrent(seq)) return;       // 已有更新的请求 → 丢弃本次过期响应
 *       setList(...);
 *     }
 *     finally { if (isCurrent(seq)) setLoading(false); }
 *   };
 *
 * 注：nextSeq/isCurrent 用 useCallback 保持稳定引用，
 * 便于把二者放入 useCallback 的依赖数组而不会导致回调每次渲染重建/重复请求。
 */
export function useRequestGuard() {
  const seqRef = useRef(0);
  /** 返回本次请求的序号（每次调用自增，旧请求序号自动失效） */
  const nextSeq = useCallback(() => ++seqRef.current, []);
  /** 该序号是否仍是最新一次请求（false = 过期响应，应丢弃） */
  const isCurrent = useCallback((seq: number) => seq === seqRef.current, []);
  return { nextSeq, isCurrent };
}

export default useRequestGuard;
