import { useState } from 'react';
import type { ReactNode } from 'react';
import { Select } from 'antd';
import type { SelectProps } from 'antd';

/**
 * 可搜索下拉（基于 antd Select 封装）。
 *
 * 项目内主数据下拉（商品/客户/供应商/仓库/科目/用户/部门/分类/单位…）数据量大，
 * 原生 <select> 无法快速检索。统一改用本组件：
 *  - 输入即过滤（按 label / value / search 关键词，不区分大小写）
 *  - 默认占位「请选择」，允许空值时由调用方显式传 allowClear
 *  - 支持 required 模拟（失焦/变更后空值标红提示），替代原生 select 的 required
 *  - 尺寸默认 large（≈40px，与 form-input/form-select 高度一致），可用 size 覆盖
 *
 * 用法：
 *   <SearchSelect
 *     value={form.customer_id}
 *     onChange={(v) => setForm(p => ({ ...p, customer_id: v ?? '' }))}
 *     placeholder="请选择客户"
 *     options={customers.map(c => ({ value: c.id, label: c.name }))}
 *   />
 */
export interface SearchSelectOption {
  /** 叶子选项的值；分组形态（带 options）时不需要 */
  value?: string | number;
  label: ReactNode;
  /** 附加检索词（如别名/拼音/编码），输入关键词命中即显示；选填 */
  search?: string;
  /** 是否禁用该选项（组件内部「引用值占位」会自动生成 disabled 项） */
  disabled?: boolean;
  /** 分组子选项（antd Select 分组形态；W-01 商品按款分组用） */
  options?: SearchSelectOption[];
}

export interface SearchSelectProps
  extends Omit<SelectProps, 'options' | 'value' | 'onChange' | 'showSearch' | 'filterOption' | 'placeholder'> {
  /** 选项列表（支持分组：分组项带 options 子数组） */
  options: SearchSelectOption[];
  /** 当前值；单选时 '' / null / undefined 视为空，多选时空数组视为空 */
  value?: any;
  onChange?: (value: any) => void;
  /** 空值时对外回调的取值（默认 undefined）。原逻辑若以 '' 表示空，可传 emptyValue="" */
  emptyValue?: any;
  /** 模拟原生 required：空值触碰后标红并提示，替代浏览器级校验（多选模式请勿使用） */
  required?: boolean;
  /** required 校验提示文案，默认「请选择」 */
  requiredMessage?: string;
  /** 外部受控错误态（提交校验失败时由页面置 true，立即标红，无需等失焦） */
  invalid?: boolean;
  /** 已选值不在 options（主数据被删/停用/被过滤/跨部门）时自动补的占位文案，默认「原值不可选（已保留）」 */
  missingValueLabel?: ReactNode;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** 展平分组选项 → 叶子选项（分组项自身不是可选项） */
function flattenOptions(list: SearchSelectOption[]): SearchSelectOption[] {
  return (list || []).flatMap((o) => (Array.isArray(o?.options) && o.options.length ? flattenOptions(o.options) : [o]));
}

export function SearchSelect({
  options,
  value,
  onChange,
  emptyValue,
  required,
  requiredMessage = '请选择',
  invalid,
  missingValueLabel = '原值不可选（已保留）',
  placeholder = '请选择',
  className = '',
  style,
  disabled,
  allowClear,
  mode,
  ...rest
}: SearchSelectProps) {
  // 是否已触碰（onBlur 或做出选择后），用于 required 红框提示
  const [touched, setTouched] = useState(false);

  const isMultiple = mode === 'multiple' || mode === 'tags';
  const isBlank = isMultiple
    ? !Array.isArray(value) || value.length === 0
    : value === undefined || value === null || value === '';

  // 允许外部受控报错（页面提交校验失败时直接标红，不必等失焦/变更）
  const showError = (Boolean(required) && touched && isBlank) || Boolean(invalid);

  const handleChange = (v: any) => {
    setTouched(true);
    const blankNow = isMultiple ? !Array.isArray(v) || v.length === 0 : v === undefined;
    // 清空时 antd 回调 undefined；若调用方以 '' / null 表示空，转成 emptyValue 再对外
    const out = blankNow && emptyValue !== undefined ? emptyValue : v;
    onChange?.(out);
  };

  const filterOption = (input: string, option?: { label?: ReactNode; value?: string | number; search?: string }) => {
    const kw = input.trim().toLowerCase();
    if (!kw) return true;
    const label = String(option?.label ?? '').toLowerCase();
    const search = String(option?.search ?? '').toLowerCase();
    const val = String(option?.value ?? '').toLowerCase();
    return label.includes(kw) || search.includes(kw) || val.includes(kw);
  };

  // —— 引用值兜底占位 ——
  // 已选值有值但 options 中不存在（主数据被软删/停用、跨部门隔离、被联动过滤等）时，
  // 自动补一条禁用占位项：编辑回显不再显示裸 id/空白，也不会因「选项缺失」被误判为空后保存清空。
  // 仅在 options 已加载（非空）时执行，避免把「数据未到」误判为缺失；options 为空时原样透传。
  // ⚠️ 选项可能是分组形态（按款分组）——判断要展平到叶子，否则已选中的 SKU 会被当成「缺失」重复补一条占位。
  const effectiveOptions = (() => {
    if (!options || options.length === 0) return options;
    const leaves = flattenOptions(options);
    const selectedVals = isMultiple
      ? (Array.isArray(value) ? value : []).filter((v: any) => v !== undefined && v !== null && v !== '')
      : value === undefined || value === null || value === ''
        ? []
        : [value];
    const missing = selectedVals.filter((v: any) => !leaves.some((o) => o.value === v));
    if (missing.length === 0) return options;
    const extras: SearchSelectOption[] = missing.map((v: any) => ({
      value: v,
      label: missingValueLabel,
      search: '',
      disabled: true,
    }));
    return [...extras, ...options];
  })();

  return (
    <div className={className} style={style}>
      <Select
        {...rest}
        showSearch
        filterOption={filterOption as SelectProps['filterOption']}
        size="large"
        mode={mode}
        value={isBlank ? (isMultiple ? [] : undefined) : value}
        onChange={handleChange}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        disabled={disabled}
        allowClear={allowClear}
        notFoundContent="未找到匹配项"
        status={showError ? 'error' : undefined}
        options={effectiveOptions}
        className="w-full"
        style={{ width: '100%' }}
      />
      {showError && <div className="mt-1 text-xs text-red-600">{requiredMessage}</div>}
    </div>
  );
}

export default SearchSelect;
