import dayjs from 'dayjs';
import { LS } from './localKeys';

/**
 * 报表区间工具（2026-09-11，报表增强共用）。
 *
 * - `QUICK_RANGES`：本月 / 上月 / 本年 快捷区间（各报表页日期栏复用）
 * - `buildCompareRanges`：由当前区间推导「上一等长周期（环比）」与「去年同期（同比）」的查询参数
 */
export const QUICK_RANGES = [
  { label: '本月', start: () => dayjs().startOf('month'), end: () => dayjs() },
  { label: '上月', start: () => dayjs().subtract(1, 'month').startOf('month'), end: () => dayjs().subtract(1, 'month').endOf('month') },
  { label: '本年', start: () => dayjs().startOf('year'), end: () => dayjs() },
] as const;

export interface RangeParams {
  start_date?: string;
  end_date?: string;
}

/** 当前区间的上期（环比）与去年同期（同比）参数；区间不完整时返回 null */
export function buildCompareRanges(startDate?: string, endDate?: string): { prev: RangeParams; yoy: RangeParams } | null {
  if (!startDate || !endDate) return null;
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  if (!start.isValid() || !end.isValid() || end.isBefore(start)) return null;
  const days = end.diff(start, 'day') + 1;
  return {
    prev: {
      start_date: start.subtract(days, 'day').format('YYYY-MM-DD'),
      end_date: start.subtract(1, 'day').format('YYYY-MM-DD'),
    },
    yoy: {
      start_date: start.subtract(1, 'year').format('YYYY-MM-DD'),
      end_date: end.subtract(1, 'year').format('YYYY-MM-DD'),
    },
  };
}

/** 报表期间记忆（2026-09-12）：记住上次查看的起止日期（按报表页分桶；未使用过返回 null 走页面默认）
 *
 * 键名与页面 state / 后端查询参数统一为 start_date / end_date（曾用 start/end 导致与页面 state 联合类型不兼容）。
 */
export function readReportPeriod(page: string): { start_date: string; end_date: string } | null {
  try {
    const raw = localStorage.getItem(`${LS.reportPeriod}:${page}`);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v.start_date === 'string' && typeof v.end_date === 'string') {
      return { start_date: v.start_date, end_date: v.end_date };
    }
  } catch {
    /* 损坏数据忽略，走页面默认 */
  }
  return null;
}

/** 记住本次查看的报表期间（写入失败静默，不影响报表使用） */
export function writeReportPeriod(page: string, startDate: string, endDate: string): void {
  try {
    localStorage.setItem(`${LS.reportPeriod}:${page}`, JSON.stringify({ start_date: startDate, end_date: endDate }));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
