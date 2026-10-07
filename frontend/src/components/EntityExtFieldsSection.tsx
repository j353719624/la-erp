import { useEffect, useMemo, useState } from 'react';
import { Field } from '@/types/metadata';
import { DynamicField } from '@/components/DynamicField';
import { loadEntityLayouts } from '@/utils/entityLayout';
import type { FormSection } from '@/utils/entityLayout';

/**
 * 业务表单的「自定义字段」区（客户/供应商等实体表单复用）
 *
 * 逻辑（与商品 ProductForm 一致）：字段池 = 实体 FieldDef 中非固定业务码、非核心字段
 * （即行业模板/自建的自定义字段，值存后端 ext JSON 列）。分组优先按该实体 form 布局
 * sections（保序）；仅当布局真正放入了字段池中的自定义字段码才启用，否则回退按模板
 * group_name 分组，未收录归「其他自定义字段」。
 *
 * ⚠️ 权限：布局/字段接口需 system；非 system 角色 403 时本区自动隐藏（字段池为空）。
 */
const FORM_FIXED_CODES = new Set([
  'id', 'code', 'name', 'status', 'remark', 'created_at', 'updated_at', 'deleted_at',
  'tenant_id', 'created_by', 'updated_by', 'ext', 'ext_fields',
]);

interface Props {
  /** 实体码：supplier / customer … */
  entityCode: string;
  /** 扩展字段值对象（后端 ext JSON 列） */
  value: Record<string, any> | undefined;
  onChange: (code: string, value: any) => void;
  disabled?: boolean;
  /** 组件标题（默认“自定义字段”） */
  title?: string;
}

export function EntityExtFieldsSection({ entityCode, value, onChange, disabled, title = '自定义字段' }: Props) {
  const [fields, setFields] = useState<Field[]>([]);
  const [formSections, setFormSections] = useState<FormSection[]>([]);

  // 实体自定义字段池（过滤固定业务码/核心字段）
  const pool = useMemo(() => {
    return fields.filter((f) => !FORM_FIXED_CODES.has(f.code) && !f.is_core);
  }, [fields]);

  useEffect(() => {
    let alive = true;
    loadEntityLayouts(entityCode).then((data) => {
      if (!alive) return;
      setFields(data.fields);
      setFormSections(data.formSections);
    });
    return () => { alive = false; };
  }, [entityCode]);

  // 展示分组：form 布局 sections（真正放了自定义码）→ 否则模板 group_name
  const displayGroups = useMemo(() => {
    if (pool.length === 0) return null;
    const layout = (() => {
      if (formSections.length === 0) return null;
      const poolCodes = new Set(pool.map((f) => f.code));
      const hasCustomInSections = formSections.some((sec) =>
        (sec.fields || []).some((code) => poolCodes.has(code)),
      );
      if (!hasCustomInSections) return null;
      const groups: { title: string; fields: Field[] }[] = [];
      const placed = new Set<string>();
      for (const sec of formSections) {
        const list: Field[] = [];
        for (const code of sec.fields) {
          const f = pool.find((x) => x.code === code);
          if (f && !placed.has(code)) {
            list.push(f);
            placed.add(code);
          }
        }
        if (list.length) groups.push({ title: sec.title || '未命名分组', fields: list });
      }
      const rest = pool.filter((f) => !placed.has(f.code));
      if (rest.length) groups.push({ title: '其他自定义字段', fields: rest });
      return groups.length ? groups : null;
    })();
    if (layout) return layout;
    // 回退：按模板 group_name 分组
    const byGroup: Record<string, Field[]> = {};
    for (const f of pool) {
      const g = f.group_name || '未分组';
      (byGroup[g] = byGroup[g] || []).push(f);
    }
    return Object.entries(byGroup).map(([gname, list]) => ({ title: gname, fields: list }));
  }, [pool, formSections]);

  if (!displayGroups || displayGroups.length === 0) return null;

  return (
    <div className="border-t border-gray-200 pt-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
      {displayGroups.map((g) => (
        <div key={g.title} className="mb-6">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">{g.title}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {g.fields.map((f) => (
              <DynamicField
                key={f.id || f.code}
                field={f}
                value={value?.[f.code]}
                onChange={onChange}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
