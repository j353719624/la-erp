import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** 右侧操作区（主操作按钮等），移动端自动换行 */
  extra?: React.ReactNode;
  /** 可选：页头下方的筛选/工具栏区 */
  children?: React.ReactNode;
  /** 可选：显示返回按钮并绑定回调 */
  onBack?: () => void;
  /** 可选：返回按钮禁用（如保存中），防止误触丢失未保存数据 */
  backDisabled?: boolean;
}

/**
 * 统一页头组件（对标 Ant Design Pro PageContainer）：
 * 标题 + 副标题 + 右侧操作区；标题与操作区始终同行，
 * 移动端主操作按钮文字隐藏（由调用方用 `hidden md:inline` 包裹），只保留图标。
 */
export function PageHeader({ title, subtitle, extra, children, onBack, backDisabled }: PageHeaderProps) {
  return (
    <div className="page-header space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              disabled={backDisabled}
              className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              aria-label="返回"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-lg md:text-2xl font-bold text-gray-800 truncate">{title}</h1>
            {subtitle && <p className="page-subtitle text-gray-500 mt-0.5 text-sm truncate">{subtitle}</p>}
          </div>
        </div>
        {extra && (
          // [P-06 2026-09-14] 窄屏溢岀修复：extra 允许换行 + 可收缩（去掉 shrink-0）——
          // 此前多控件页头（如税务报表：月份+3按钮）在窄屏溢出/挤爆标题；单按钮页头不受影响
          <div className="flex flex-wrap items-center justify-end gap-2 md:gap-3 min-w-0">{extra}</div>
        )}
      </div>
      {children}
    </div>
  );
}
