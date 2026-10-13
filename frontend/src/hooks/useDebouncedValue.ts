import { useEffect, useState } from 'react';

/**
 * 防抖值：输入变化后 delay 毫秒才更新返回值。
 * 用于列表页 keyword 搜索（每击键一次全表查询 → 只发一次），避免请求风暴。
 * 用法：
 *   const [keyword, setKeyword] = useState('');
 *   const debouncedKeyword = useDebouncedValue(keyword, 300);
 *   // effect 依赖 debouncedKeyword（请求用防抖值），输入框 value 仍用 keyword（即时响应）
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default useDebouncedValue;
