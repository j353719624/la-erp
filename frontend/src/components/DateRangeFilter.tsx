import { QUICK_RANGES } from '@/utils/reportRange';

/**
 * 列表页日期区间筛选（2026-09-12，U-02 设置便利性下沉）。
 *
 * 报表页原有「本月/上月/本年」快捷区间 + 起止日期，但只有 3 个报表页用；
 * 凭证/收付款/应收应付/库存流水/审计日志等列表此前只能手输两个日期（凭证页连日期筛选都没有）。
 *
 * 设计：
 *  - 值由页面 state 管理（配合 hooks/useListFiltersUrl 自动写 URL：刷新/返回/发链接保持条件）
 *  - 快捷项命中时高亮（便于确认当前区间）
 *  - end_date 交给后端 parseEndDate()（含当天整天），组件不补时分秒
 */
export interface DateRangeValue {
  start_date: string;
  end_date: string;
}

export function DateRangeFilter({
  value,
  onChange,
  className = '',
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  className?: string;
}) {
  const hit = (start: string, end: string) => value.start_date === start && value.end_date === end;
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      <input
        type="date"
        value={value.start_date}
        onChange={(e) => onChange({ ...value, start_date: e.target.value })}
        className="form-input w-36"
        aria-label="开始日期"
      />
      <span className="text-gray-400 text-sm">~</span>
      <input
        type="date"
        value={value.end_date}
        onChange={(e) => onChange({ ...value, end_date: e.target.value })}
        className="form-input w-36"
        aria-label="结束日期"
      />
      <div className="flex items-center gap-1.5">
        {QUICK_RANGES.map((q) => {
          const s = q.start().format('YYYY-MM-DD');
          const e = q.end().format('YYYY-MM-DD');
          const active = hit(s, e);
          return (
            <button
              key={q.label}
              type="button"
              onClick={() => onChange({ start_date: s, end_date: e })}
              className={active ? 'btn-primary px-2.5 py-1 text-xs' : 'btn-secondary px-2.5 py-1 text-xs'}
              title={active ? `当前区间：${q.label}` : `切换为${q.label}`}
            >
              {q.label}
            </button>
          );
        })}
        {(value.start_date || value.end_date) && (
          <button
            type="button"
            onClick={() => onChange({ start_date: '', end_date: '' })}
            className="btn-secondary px-2.5 py-1 text-xs"
            title="清除日期筛选"
          >
            清除
          </button>
        )}
      </div>
    </div>
  );
}
