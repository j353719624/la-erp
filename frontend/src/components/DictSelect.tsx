import { Select } from 'antd';
import { useDictEntries, dictOptions } from '@/hooks/useDictItems';

/**
 * 字典下拉（S-05 2026-09-13）：选项来自数据字典 `type_code`。
 *
 * 场景：业务表单的下拉不应写死在页面里（商品类型/线索来源/收付款方式…），
 * 数据字典里增删改一项，所有用到该类型的页面即时生效。
 * 兜底：字典为空（未配置/接口失败）时用 `fallbackOptions`，避免出现"点了没反应的假下拉"；
 *       当前值不在选项里（历史脏值/已删项）时追加一行提示项，保证编辑时不丢值。
 */
interface Props {
  typeCode: string;
  value?: string;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  fallbackOptions?: { value: string; label: string }[];
  size?: 'small' | 'middle' | 'large';
}

export function DictSelect({
  typeCode,
  value,
  onChange,
  placeholder = '请选择',
  allowClear = true,
  disabled,
  className,
  style,
  fallbackOptions,
  size,
}: Props) {
  const entries = useDictEntries(typeCode);
  const base = entries.length > 0 ? dictOptions(entries, value) : (fallbackOptions ?? []);
  const opts =
    value && !base.some((o) => o.value === value)
      ? [...base, { value, label: `${value}（不在字典，请重选）` }]
      : base;
  return (
    <Select
      showSearch
      size={size}
      value={value || undefined}
      placeholder={placeholder}
      allowClear={allowClear}
      disabled={disabled}
      className={className}
      style={style}
      optionFilterProp="label"
      options={opts}
      onChange={(v) => onChange?.(v as string | undefined)}
    />
  );
}

export default DictSelect;
