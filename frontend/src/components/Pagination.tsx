import { ChevronLeft, ChevronRight } from 'lucide-react';

/** 每页条数默认选项（可覆盖）；2026-09-12 新增切换（设置便利性 U-01） */
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** 可选：切换每页条数（传入才显示切换器；页面负责回到第 1 页并重新请求/写入 URL） */
  onPageSizeChange?: (size: number) => void;
  /** 可选：每页条数可选项（默认 10/20/50/100） */
  pageSizeOptions?: number[];
  /** 可选：加载中禁用翻页，防止重复请求同一页 */
  loading?: boolean;
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS, loading }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages || totalPages === 0;
  // 加载中禁翻页（防重复请求）
  const prevBtnDisabled = prevDisabled || !!loading;
  const nextBtnDisabled = nextDisabled || !!loading;
  // 当前 pageSize 不在选项里时补入（避免 select 显示错误值）
  const sizeOptions = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <div className="p-3 md:p-4 border-t border-gray-100 flex items-center justify-between gap-3">
      <p className="text-sm text-gray-500 truncate">
        <span className="hidden sm:inline">共 {total} 条数据，显示 {startItem}-{endItem}，</span>
        第 <span className="font-medium text-gray-700">{page}</span>/{totalPages || 1} 页
      </p>
      <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
        {/* 每页条数切换（2026-09-12）：长列表少翻页；切换后由页面回到第 1 页并写入 URL */}
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            disabled={!!loading}
            aria-label="每页条数"
            title="每页显示条数"
            className="h-8 px-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sizeOptions.map((s) => (
              <option key={s} value={s}>
                {s} 条/页
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={prevBtnDisabled}
          aria-label="上一页"
          className="flex items-center justify-center w-8 h-8 md:w-auto md:px-3 md:py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4 md:hidden" />
          <span className="hidden md:inline">上一页</span>
        </button>
        <span className="px-2 py-1 text-sm text-gray-600 hidden sm:inline">{page}</span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={nextBtnDisabled}
          aria-label="下一页"
          className="flex items-center justify-center w-8 h-8 md:w-auto md:px-3 md:py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-4 h-4 md:hidden" />
          <span className="hidden md:inline">下一页</span>
        </button>
      </div>
    </div>
  );
}
