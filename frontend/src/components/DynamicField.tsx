import React from 'react';
import { Field } from '@/types/metadata';

interface DynamicFieldProps {
  field: Field;
  value: any;
  onChange: (code: string, value: any) => void;
  /** 可选：禁用所有动态字段控件（如保存中） */
  disabled?: boolean;
}

export function DynamicField({ field, value, onChange, disabled }: DynamicFieldProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { type } = e.target;
    let val: any = e.target.value;
    if (type === 'checkbox') {
      val = (e.target as HTMLInputElement).checked;
    } else if (type === 'number') {
      // 清空输入必须允许恢复为空（发送 null），而不是被 parseFloat('')||0 强制写成 0，
      // 否则用户一旦清空数字字段就再也无法还原成"未填"
      const raw = e.target.value;
      if (raw === '') {
        val = null;
      } else {
        val = parseFloat(raw);
        if (Number.isNaN(val)) val = null;
      }
    }
    onChange(field.code, val);
  };

  const renderField = () => {
    switch (field.field_type) {
      case 'text':
        return (
          <textarea
            value={value ?? ''}
            onChange={handleChange}
            required={field.is_required}
            disabled={disabled}
            placeholder=""
            rows={4}
            className="form-input"
          />
        );
      case 'number':
        return (
          <input
            type="number"
            value={value ?? ''}
            onChange={handleChange}
            required={field.is_required}
            disabled={disabled}
            placeholder=""
            className="form-input"
          />
        );
      case 'decimal':
        return (
          <input
            type="number"
            value={value ?? ''}
            onChange={handleChange}
            required={field.is_required}
            disabled={disabled}
            placeholder=""
            step="0.01"
            className="form-input"
          />
        );
      case 'date':
        return (
          <input
            type="date"
            value={value ?? ''}
            onChange={handleChange}
            required={field.is_required}
            disabled={disabled}
            className="form-input"
          />
        );
      case 'datetime':
        return (
          <input
            type="datetime-local"
            value={value ?? ''}
            onChange={handleChange}
            required={field.is_required}
            disabled={disabled}
            className="form-input"
          />
        );
      case 'boolean':
        return (
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={value === true}
              onChange={handleChange}
              disabled={disabled}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded"
            />
          </div>
        );
      case 'select': {
        // select 改为「点选常见项 + 可自由输入」（2026-09-09 供应商“结算账期”等固定下拉无法自定义反馈）。
        // 用原生 input+datalist 实现组合框：模板/配置的下拉选项仅作「建议」，允许直接输入任意自定义文本
        // （所见即所存，值不在选项内也允许保存）；同时保留原生 required/disabled/校验高亮等语义，
        // 避免引入 antd 后丢失浏览器必填校验。展示层（列表/详情）对非选项值原样显示，不依赖选项映射。
        const rawOptions = Array.isArray(field.validation?.options) ? field.validation.options : [];
        const suggestions = Array.from(
          new Set(
            rawOptions
              .map((opt: any) => String(typeof opt === 'object' ? (opt?.label ?? opt?.value) : opt))
              .filter((s: string) => s !== ''),
          ),
        );
        const listId = `dynopt-${field.id || field.code}`;
        return (
          <div className="relative">
            <input
              type="text"
              list={listId}
              value={value ?? ''}
              onChange={handleChange}
              required={field.is_required}
              disabled={disabled}
              placeholder={suggestions.length ? '请选择或输入' : ''}
              className="form-input pr-7"
            />
            {!disabled && suggestions.length > 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] select-none"
              >
                ▼
              </span>
            )}
            <datalist id={listId}>
              {suggestions.map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          </div>
        );
      }
      case 'multiselect': {
        const multiOptions = Array.isArray(field.validation?.options) ? field.validation.options : [];
        return (
          <select
            multiple
            value={value || []}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
              onChange(field.code, selected);
            }}
            required={field.is_required}
            disabled={disabled}
            className="form-select h-24"
          >
            {multiOptions.map((opt: any, index: number) => (
              <option key={index} value={String(typeof opt === 'object' ? opt?.value : opt)}>
                {String(typeof opt === 'object' ? (opt?.label ?? opt?.value) : opt)}
              </option>
            ))}
          </select>
        );
      }
      case 'file':
        return (
          <input
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onChange(field.code, file.name);
              }
            }}
            required={field.is_required}
            disabled={disabled}
            className="form-input"
          />
        );
      default:
        return (
          <input
            type="text"
            value={value || ''}
            onChange={handleChange}
            required={field.is_required}
            disabled={disabled}
            placeholder=""
            className="form-input"
          />
        );
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {field.name}
        {field.is_required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {renderField()}
    </div>
  );
}
