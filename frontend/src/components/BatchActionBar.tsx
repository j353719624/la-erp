import type { ReactNode } from 'react';

/**
 * 批量操作工具条（U-05 2026-09-13）
 *
 * 显示时机：**仅当勾选了行时出现**（未勾选 = 不占位、也不会误点；等价于"无勾选时按钮禁用"且更省空间）。
 * 单个动作按钮：`count = 0`（勾选的行里没有符合该动作条件的）→ 禁用，避免"点了全失败"。
 */
export interface BatchActionBarItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** 符合该动作条件的行数（>0 才可点；不传统计时按已选条数展示） */
  count?: number;
  onClick: () => void;
}

export function BatchActionBar({
  count,
  actions,
  onClear,
  onExport,
  exportDisabled,
  busy,
}: {
  count: number;
  actions: BatchActionBarItem[];
  onClear: () => void;
  onExport?: () => void;
  exportDisabled?: boolean;
  busy?: boolean;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
      <span className="text-sm text-blue-800">
        已选 <b>{count}</b> 条
      </span>
      <span className="hidden sm:inline text-xs text-blue-400">|</span>
      {actions.map((a) => {
        const n = a.count;
        const blocked = busy || a.disabled || (n !== undefined && n === 0);
        return (
          <button
            key={a.key}
            type="button"
            disabled={blocked}
            onClick={a.onClick}
            title={n === 0 ? '勾选的行中没有可执行此操作的记录' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm transition-colors ${
              blocked
                ? 'text-gray-400 bg-white/60 border border-gray-200 cursor-not-allowed'
                : a.danger
                  ? 'text-red-600 bg-white border border-red-200 hover:bg-red-50'
                  : 'text-blue-700 bg-white border border-blue-200 hover:bg-blue-100'
            }`}
          >
            {a.icon}
            {a.label}
            {n !== undefined && n > 0 && <span className="text-xs opacity-80">（{n}）</span>}
          </button>
        );
      })}
      {onExport && (
        <button
          type="button"
          disabled={busy || exportDisabled}
          onClick={onExport}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm border transition-colors ${
            busy || exportDisabled
              ? 'text-gray-400 bg-white/60 border-gray-200 cursor-not-allowed'
              : 'text-gray-700 bg-white border-gray-200 hover:bg-gray-50'
          }`}
        >
          导出选中
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onClear}
        className="ml-auto text-sm text-gray-500 hover:text-gray-800 disabled:text-gray-300"
      >
        清空选择
      </button>
    </div>
  );
}
