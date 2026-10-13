import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  /** 可选操作按钮（如"新建"） */
  action?: React.ReactNode;
  className?: string;
}

/**
 * 统一空态组件：图标 + 标题 + 描述 + 可选操作。
 */
export function EmptyState({
  title = '暂无数据',
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`empty-state flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}>
      <div className="empty-state-icon w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Inbox className="w-8 h-8 text-gray-300" />
      </div>
      <p className="text-gray-600 font-medium">{title}</p>
      {description && <p className="text-gray-400 text-sm mt-1 max-w-sm">{description}</p>}
      {action && <div className="empty-state-action mt-5">{action}</div>}
    </div>
  );
}
