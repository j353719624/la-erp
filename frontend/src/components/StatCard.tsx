import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  label: string;
  /** 已格式化的展示值（含货币符号等） */
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Tailwind 背景色类（如 bg-green-500） */
  color: string;
  /** 环比变化百分比；undefined 时不显示趋势 */
  trend?: number;
  /** 底部补充信息（真实统计，如"低库存 N 项"） */
  footer?: React.ReactNode;
  onClick?: () => void;
  /** 可选：禁用点击（数据未就绪等场景） */
  disabled?: boolean;
}

/**
 * KPI 统计卡片（对标 Tremor / Shipyard MetricCard）：
 * 标签 + 大数值 + 渐变图标 + 可选环比趋势/补充信息；悬停浮起。
 */
export function StatCard({ label, value, icon: Icon, color, trend, footer, onClick, disabled }: StatCardProps) {
  const up = (trend ?? 0) >= 0;
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={`bg-white rounded-xl border border-gray-100 p-5 shadow-sm transition-all duration-300 group ${
        onClick && !disabled ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : ''
      } ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-500 truncate">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1.5 truncate">{value}</p>
        </div>
        <div
          className={`w-11 h-11 ${color} rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm group-hover:scale-105 transition-transform`}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      {trend !== undefined && (
        <div className="mt-3 flex items-center gap-1 text-xs">
          {up ? (
            <TrendingUp className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-red-500" />
          )}
          <span className={up ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
            {up ? '+' : ''}
            {trend}%
          </span>
          <span className="text-gray-400">较上月</span>
        </div>
      )}
      {footer && <div className="mt-3 text-xs text-gray-400">{footer}</div>}
    </div>
  );
}
