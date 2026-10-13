import { productExtSummary, type ProductFieldLabel } from '@/utils/productExt';

/**
 * 单据行「商品信息」只读小字（2026-09-16 用户需求）：
 * 把商品自定义字段（如 原产国）以紧凑文本显示在商品列下方——只读、不可编辑；
 * 最多展示 max 项（默认 2），悬停可见完整内容；无字段值时不渲染（不占位）。
 * 数据读取链见 utils/productExt.ts（行快照 → 本地抄写 → 商品边）。
 */
export function LineProductExt({
  line,
  labels,
  max = 2,
}: {
  line: unknown;
  labels: ProductFieldLabel[];
  max?: number;
}) {
  const text = productExtSummary(line, labels, max);
  if (!text) return null;
  const full = productExtSummary(line, labels);
  return (
    <div className="mt-0.5 text-[11px] leading-4 text-gray-400 max-w-[220px] truncate" title={full}>
      {text}
    </div>
  );
}
