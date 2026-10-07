import { message } from '@/utils/appMessage';

/**
 * 表单易用性工具（2026-09-11 易用性改造）
 *
 * 解决三个问题：
 *  ① 提交时缺乏统一校验：此前依赖浏览器原生 required（气泡样式不可控、滚到哪算哪）
 *  ② 报错后**不滚动、不聚焦**：用户在长表单底部点保存，提示在顶部/字段处，看不到 → "点了没反应"
 *  ③ 错误文案不统一：有的 message、有的页面级 error、有的原生气泡
 *
 * 约定：
 *  - 页面给字段容器加 `data-field="<字段名>"`（最外层包裹 div 即可），工具负责滚动与聚焦
 *  - 受控组件（SearchSelect / DynamicField 等）通过 `invalid` prop 显示红框红字
 *  - 提交处：`const err = firstInvalid(rules, values); if (err) return failField(err, setInvalid)`
 */

export interface ValidateRule {
  /** 字段名（与 data-field / invalid 键一致） */
  field: string;
  /** 中文标签（用于提示文案） */
  label: string;
  /** 取值函数（默认从 values 里取同名字段） */
  value?: (values: Record<string, any>) => any;
  /** 校验通过条件 */
  ok: (v: any, values: Record<string, any>) => boolean;
  /** 自定义提示文案 */
  message?: string;
}

export interface FieldError {
  field: string;
  label: string;
  message: string;
}

/** 按顺序校验，返回第一个错误（全部通过返回 null） */
export function firstInvalid(rules: ValidateRule[], values: Record<string, any>): FieldError | null {
  for (const r of rules) {
    const v = r.value ? r.value(values) : values[r.field];
    if (!r.ok(v, values)) {
      return { field: r.field, label: r.label, message: r.message || `请填写「${r.label}」` };
    }
  }
  return null;
}

/** 收集全部错误（用于错误汇总条） */
export function allInvalid(rules: ValidateRule[], values: Record<string, any>): FieldError[] {
  const out: FieldError[] = [];
  for (const r of rules) {
    const v = r.value ? r.value(values) : values[r.field];
    if (!r.ok(v, values)) out.push({ field: r.field, label: r.label, message: r.message || `请填写「${r.label}」` });
  }
  return out;
}

/** 滚动到字段并聚焦（平滑滚动 + 自动聚焦输入框，帮助用户立刻改） */
export function scrollToField(field: string): void {
  const box =
    document.querySelector<HTMLElement>(`[data-field="${field}"]`) ||
    document.querySelector<HTMLElement>(`[name="${field}"]`);
  if (!box) return;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const focusable = box.matches('input,select,textarea')
    ? box
    : box.querySelector<HTMLElement>('input:not([type=hidden]),select,textarea,.ant-select-selector');
  // 等滚动动画接近结束再聚焦，避免页面跳动
  window.setTimeout(() => focusable?.focus({ preventScroll: true }), 280);
}

export type InvalidSetter = (next: Record<string, boolean>) => void;

/**
 * 提交失败统一处理：toast 提示 + 标红 + 滚动聚焦。
 * @param err 第一个错误
 * @param errors 全部错误（用于汇总条，可省略）
 * @param setInvalid 受控错误态 setter（页面用 useState<Record<string, boolean>>）
 */
export function failField(err: FieldError, errors: FieldError[] = [err], setInvalid?: InvalidSetter): string {
  const invalidMap: Record<string, boolean> = {};
  for (const e of errors) invalidMap[e.field] = true;
  setInvalid?.(invalidMap);

  if (errors.length > 1) {
    message.error(`${err.message}（共 ${errors.length} 项待完善：${errors.map((e) => e.label).join('、')}）`);
  } else {
    message.error(err.message);
  }
  scrollToField(err.field);
  return err.message;
}

/** 清空某个字段的错误态（用户修改后调用） */
export function clearInvalid(field: string, setInvalid?: InvalidSetter, current: Record<string, boolean> = {}): void {
  if (!setInvalid || !current[field]) return;
  const next = { ...current };
  delete next[field];
  setInvalid(next);
}
