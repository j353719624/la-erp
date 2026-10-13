import { useEffect, useState } from 'react';

/**
 * 响应式媒体查询 hook。
 * 说明：不用 antd Grid.useBreakpoint（在部分内嵌/后台标签页环境不随视口更新），
 * 自写基于 window.matchMedia 的订阅，随宽度变化可靠触发重渲染。
 * 首帧直接用 matchMedia 初值（客户端渲染场景安全）。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
