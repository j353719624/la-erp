/**
 * 审批步骤「金额阈值条件」工具（S-08 2026-09-14）
 *
 * 后端条件格式：`amount <运算符> <数字>`（如 `amount >= 10000`）；空条件 = 无条件（该步恒需审批）。
 * 表单用「运算符 + 金额」两个控件编辑，本模块负责字符串 ↔ 控件的双向转换与展示文案，
 * 与后端 `internal/service/workflow/condition.go` 的正则保持同一口径。
 */

/** 可选运算符（value 直接拼进条件字符串，与后端解析器一致） */
export const CONDITION_OPS = [
  { value: '>=', label: '金额 ≥' },
  { value: '>', label: '金额 >' },
  { value: '<=', label: '金额 ≤' },
  { value: '<', label: '金额 <' },
  { value: '=', label: '金额 =' },
] as const;

/** 解析条件字符串 → { op, value }；无条件 / 无法解析（历史脏数据）返回 op:''（保留原文展示兜底） */
export function parseCondition(raw?: string): { op: string; value?: number } {
  const s = (raw || '').trim();
  if (!s) return { op: '' };
  const m = s.match(/^amount\s*(>=|<=|==|=|>|<)\s*(\d+(?:\.\d+)?)$/);
  if (!m) return { op: '' };
  return { op: m[1] === '==' ? '=' : m[1], value: Number(m[2]) };
}

/** 控件 → 条件字符串（未选运算符或未填金额 → ''，即无条件） */
export function buildCondition(op?: string, value?: number | null): string {
  if (!op || value === undefined || value === null || Number.isNaN(value)) return '';
  return `amount ${op} ${value}`;
}

/** 展示文案：`金额 ≥ 10000`；无法解析的字符串原样兜底；空条件显示为「无条件」 */
export function conditionLabel(raw?: string): string {
  const s = (raw || '').trim();
  if (!s) return '无条件';
  const { op, value } = parseCondition(s);
  if (!op) return s;
  const label = CONDITION_OPS.find((o) => o.value === op)?.label;
  return `${label || op} ${value}`;
}
