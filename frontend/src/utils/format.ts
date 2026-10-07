/**
 * 日期语义字段的**本地午夜** ISO 后缀（2026-09-22 三位一体审查修复）。
 *
 * 为何不能用 `T00:00:00Z`：服务端把用户填的「日期」按**本地日历天**做区间查询/统计
 *（SQLite 对 time 字段是字面字符串比较、不做时区换算），而 `...Z`（UTC 午夜）的字面
 * 比本地边界（如 `2026-09-22T00:00:00+08:00`）**小** → 按日期筛选/统计会**丢区间首日**。
 * 实测症状：当天培训统计恒 0、考勤月度汇总月初记录漏算（工资少算）、单据列表筛「当天」查不到。
 * 统一用 +08:00（与 `format.today()` 的「东八区」约定一致）后，存储字面与查询边界字面一致。
 */
export const DATE_FIELD_SUFFIX = 'T00:00:00+08:00';

/**
 * 「含结束日」区间的上界后缀（本地当日末刻）。用于 `period_end` 这类**区间上界**字段：
 * 曾写 `T23:59:59Z`（= 本地次日 07:59:59）→ 把结束日之后一天的记录算进区间（MPS 需求偏大）。
 */
export const DATE_END_SUFFIX = 'T23:59:59+08:00';

/**
 * 把 `YYYY-MM-DD` 转成后端可解析的**本地午夜** ISO 串；非纯日期串 / 空值**原样返回**
 *（null / undefined / 空串保留各页面原有的「清空 / 不修改」语义，故不强行转换）。
 * 全站唯一入口：页面里**禁止**再手写 `+'T00:00:00Z'`（门禁拦截）。
 */
export function toLocalDateISO(v: string | null | undefined): string | null | undefined {
  if (!v) return v;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + DATE_FIELD_SUFFIX : v;
}

export const format = {
  currency: (value: number | string | null | undefined, decimals: number = 2): string => {
    if (value === null || value === undefined || value === '') {
      return '0.00';
    }
    // 后端金额字段为字符串（decimal 序列化），须转数字后格式化，否则千分位/小数位不生效
    const num = typeof value === 'string' ? Number(value) : value;
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('zh-CN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  },

  qty: (value: string | number | null | undefined, decimals: number = 2): string => {
    const num = typeof value === 'string' ? parseFloat(value) : (value as number);
    if (num === null || num === undefined || isNaN(num)) {
      return '0';
    }
    return num.toLocaleString('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
  },

  /** 带币种的金额显示：本币 → ¥1,234.56；外币 → USD 1,234.56（避免外币单仍显示人民币符号） */
  amountText: (value: number | string | null | undefined, currency?: string | null): string => {
    if (value === null || value === undefined || value === '') return '¥0.00';
    const num = typeof value === 'string' ? Number(value) : value;
    const body = (isNaN(num) ? 0 : num).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency && currency !== 'CNY' ? `${currency} ${body}` : `¥${body}`;
  },

  date: (dateStr: string, format: string = 'YYYY-MM-DD'): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  },

  /** 本地时区（东八区）的今天，避免 toISOString() 在凌晨取到 UTC 昨天 */
  today: (): string => {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
  },

  statusText: (status: string): string => {
    const statusMap: Record<string, string> = {
      draft: '草稿',
      in_transit: '运输中',
      confirmed: '已确认',
      approved: '已审核',
      completed: '已完成',
      cancelled: '已取消',
      closed: '已关闭',
      in_progress: '生产中',
      checking: '盘点中',
      submitted: '待审批',
      pending: '待处理',
      active: '启用',
      inactive: '停用',
      posted: '已过账',
      unpaid: '未支付',
      paid: '已支付',
      partial: '部分支付',
      rejected: '已驳回',
      converted: '已转订单',
      expired: '已过期',
      received: '已收货',
      shipped: '已发货',
      void: '已作废',
    };
    return statusMap[status] || status;
  },

  statusColor: (status: string): string => {
    const colorMap: Record<string, string> = {
      draft: 'bg-yellow-50 text-yellow-700',
      in_transit: 'bg-blue-50 text-blue-700',
      confirmed: 'bg-blue-50 text-blue-700',
      approved: 'bg-green-50 text-green-700',
      completed: 'bg-gray-50 text-gray-700',
      cancelled: 'bg-red-50 text-red-700',
      closed: 'bg-gray-100 text-gray-600',
      in_progress: 'bg-amber-50 text-amber-700',
      checking: 'bg-purple-50 text-purple-700',
      submitted: 'bg-blue-50 text-blue-700',
      pending: 'bg-orange-50 text-orange-700',
      active: 'bg-green-50 text-green-700',
      inactive: 'bg-gray-50 text-gray-700',
      posted: 'bg-green-50 text-green-700',
      unpaid: 'bg-orange-50 text-orange-700',
      paid: 'bg-green-50 text-green-700',
      partial: 'bg-yellow-50 text-yellow-700',
      rejected: 'bg-red-50 text-red-700',
    };
    return colorMap[status] || 'bg-gray-50 text-gray-700';
  },

  directionText: (direction: string): string => {
    return direction === 'debit' ? '借方' : '贷方';
  },

  directionColor: (direction: string): string => {
    return direction === 'debit' ? 'text-blue-600' : 'text-green-600';
  },
};
