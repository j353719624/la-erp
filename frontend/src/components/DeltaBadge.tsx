/**
 * 报表同比/环比涨跌标记（2026-09-11，报表增强共用组件）。
 *
 * 约定：
 *  - `base` 为 0 / null / undefined / 非有限数时**不渲染**（避免出现 "↑∞%" 这类误导）
 *  - 正增长绿色 ↑，负增长红色 ↓；对"毛利率"这类本身就是百分比的指标，展示的是相对变化率
 */
export function DeltaBadge({ label, cur, base }: { label: string; cur?: number; base?: number | null }) {
  if (base === null || base === undefined || !Number.isFinite(Number(base)) || Number(base) === 0) return null;
  const pct = ((Number(cur) || 0) - Number(base)) / Math.abs(Number(base)) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-[11px] ${up ? 'text-green-600' : 'text-red-600'}`}>
      {label} {up ? '↑' : '↓'}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}
