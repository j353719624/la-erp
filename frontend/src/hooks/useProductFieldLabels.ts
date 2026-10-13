import { useEffect, useState } from 'react';
import { loadProductFieldLabels, type ProductFieldLabel } from '@/utils/productExt';

/**
 * 商品字段标签（单据页展示自定义字段中文名用，2026-09-16）。
 * 数据由 utils/productExt.ts 模块级缓存（跨页共享、失败静默回退 code）。
 */
export function useProductFieldLabels(): ProductFieldLabel[] {
  const [labels, setLabels] = useState<ProductFieldLabel[]>([]);
  useEffect(() => {
    let alive = true;
    loadProductFieldLabels().then((list) => {
      if (alive) setLabels(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  return labels;
}
