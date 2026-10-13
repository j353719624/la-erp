interface TableSkeletonProps {
  rows?: number;
}

/**
 * 表格加载骨架屏（对标 shadcn/ui Skeleton）：用灰色渐变条模拟表格行，
 * 替代小 spinner，降低加载时的"跳动感"。
 */
export function TableSkeleton({ rows = 5 }: TableSkeletonProps) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 py-3.5 border-b border-gray-50 last:border-0"
        >
          <div
            className="h-3.5 bg-gray-100 rounded"
            style={{ width: `${28 + ((i * 37) % 45)}%` }}
          />
          <div
            className="h-3.5 bg-gray-100 rounded"
            style={{ width: `${18 + ((i * 53) % 35)}%` }}
          />
          <div className="h-3.5 bg-gray-100 rounded flex-1" />
          <div className="w-16 h-6 bg-gray-100 rounded-md flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}
