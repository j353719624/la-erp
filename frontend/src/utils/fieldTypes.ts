/**
 * 元数据字段类型选项（2026-09-11 抽取公共定义）。
 *
 * 原先只在「元数据管理 → 字段管理」页面里写死；表格视图支持"直接新建字段"后需要同一份，
 * 抽到这里避免两处定义各写一套（本项目最高频缺陷：同一件事多处实现）。
 */
export interface FieldTypeOption {
  value: string;
  label: string;
}

export const FIELD_TYPES: FieldTypeOption[] = [
  { value: 'string', label: '文本' },
  { value: 'text', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'decimal', label: '小数' },
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'boolean', label: '布尔值' },
  { value: 'select', label: '下拉选择' },
  { value: 'multiselect', label: '多选' },
  { value: 'file', label: '文件' },
];

/** 字段类型的中文名（未收录回退原值） */
export function fieldTypeLabel(value: string): string {
  return FIELD_TYPES.find((t) => t.value === value)?.label || value;
}

/** 字段编码合法性：小写字母开头，可含数字与下划线（建库列名/接口字段名都用它） */
export function isValidFieldCode(code: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(code);
}
