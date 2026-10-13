/**
 * 通用「真实业务页按实体默认 list 布局显示」工具（商品 / 采购订单…列表页复用）
 *
 * 「布局管理」为实体配置的 list 布局除驱动 元数据→动态数据 页外，也可驱动真实业务列表页：
 *   - 固定业务/操作列由各页面自己保留；
 *   - “信息列”由实体默认 list 布局的 table.columns 决定顺序/显隐/标签/宽度。
 *
 * ⚠️ 权限注意：GET /v1/metadata/layouts/* 挂在 RequirePermission("system") 下，
 * 非 system 角色访问业务页会 403 → 一律 catch 并返回空（页面走默认展示）。
 */
import { entityApi, fieldApi, layoutApi } from '@/api/metadata';
import { Field } from '@/types/metadata';
import type { ReactNode } from 'react';
import { normalizeLayoutConfig } from '@/utils/layoutConfig';
import { tableColumnLabel } from '@/utils/columnLabels';
import { loadOptions } from '@/utils/loadOptions';

export interface LayoutColumn {
  field: string;
  label?: string;
  width?: number;
}

/** form 布局的一个分组：title + 组内字段码（保序；码为元数据 FieldDef.code） */
export interface FormSection {
  title: string;
  gridCols?: number;
  fields: string[];
}

/** 种子/模板自动生成的“通用核心”列码（区别于用户/业务有意配置的业务列） */
const SEED_CORE_CODES = new Set(['id', 'code', 'name', 'status', 'remark', 'created_at', 'updated_at', 'deleted_at']);

/** 解析 form 布局 config → sections（保序）；无有效 sections 时返回 [] */
function parseFormSections(cfg: any): FormSection[] {
  const sections = Array.isArray(cfg?.sections) ? cfg.sections : [];
  const out: FormSection[] = [];
  for (const s of sections) {
    const list: string[] = Array.isArray(s?.fields)
      ? s.fields.map((f: any) => (typeof f === 'string' ? f : f?.field)).filter((x: any) => typeof x === 'string' && x)
      : [];
    if (list.length === 0) continue;
    out.push({ title: s?.title || '未命名分组', gridCols: s?.gridCols || 2, fields: list });
  }
  return out;
}

/**
 * 读取实体默认 list/form 布局与字段（一次并发）。
 * 任何异常（无实体/无权限 403/无默认布局/网络错误）都静默返回空，不影响业务页正常使用。
 */
export async function loadEntityLayouts(entityCode: string): Promise<{
  fields: Field[];
  listColumns: LayoutColumn[];
  formSections: FormSection[];
}> {
  try {
    const entRes = await entityApi.getByCode(entityCode);
    if (entRes.code !== 0 || !entRes.data) return { fields: [], listColumns: [], formSections: [] };
    const entityId = entRes.data.id;
    // [2026-09-14] loadOptions 失败隔离：单项失败降级为空（非 system 角色 403 属预期）
    const [fieldsRes, listRes, formRes] = await loadOptions([
      fieldApi.list(entityId),
      layoutApi.getDefault(entityId, 'list'),
      layoutApi.getDefault(entityId, 'form'),
    ], '实体布局');
    const fields: Field[] = fieldsRes?.code === 0 && Array.isArray(fieldsRes.data) ? fieldsRes.data : [];

    let listColumns: LayoutColumn[] = [];
    if (listRes && listRes.code === 0 && listRes.data) {
      const cfg = normalizeLayoutConfig(listRes.data.config, 'list');
      const cols = cfg?.table?.columns;
      if (Array.isArray(cols) && cols.length > 0) {
        listColumns = cols
          .map((c: any) => ({ field: c.field, label: c.label, width: c.width }))
          .filter((c: LayoutColumn) => !!c.field);
      }
    }

    let formSections: FormSection[] = [];
    if (formRes && formRes.code === 0 && formRes.data) {
      const cfg = normalizeLayoutConfig(formRes.data.config, 'form');
      formSections = parseFormSections(cfg);
    }

    return { fields, listColumns, formSections };
  } catch {
    return { fields: [], listColumns: [], formSections: [] };
  }
}

/**
 * 读取实体的默认 list 布局与字段。
 * 任何异常（无实体/无权限 403/无默认布局/网络错误）都静默返回空，不影响业务页正常使用。
 */
export async function loadEntityListLayout(entityCode: string): Promise<{ fields: Field[]; listColumns: LayoutColumn[] }> {
  const data = await loadEntityLayouts(entityCode);
  return { fields: data.fields, listColumns: data.listColumns };
}

/**
 * 业务列表是否“用户/业务有意配置了布局”：
 * 只有布局列包含种子核心码之外的业务列（order_no/order_date/currency… 或模板/自定义字段）时，
 * 才认定用户想让业务列表按布局显示；纯种子/模板通用核心列（code/name/status…）视为默认，
 * 业务页回退到自己的完整默认列，避免新库/套模板后业务页列被“通用默认布局”削掉。
 */
export function isEntityListLayoutCustomized(listColumns: LayoutColumn[]): boolean {
  if (!Array.isArray(listColumns) || listColumns.length === 0) return false;
  return listColumns.some((c) => !SEED_CORE_CODES.has(c.field));
}

/**
 * 列显示名：布局显式显示名(≠列码) → 元数据字段中文名 → 系统表列中文名 → 原始列码。
 * （与动态数据页/布局编辑器同规则）
 */
/** 详情弹窗的列描述符（与列表列结构一致，直接交给 RecordDetailModal） */
export interface DetailColumnSpec<Row> {
  key: string;
  header: ReactNode;
  cell?: (row: Row) => ReactNode;
}

/**
 * 构建「查看」详情弹窗的列 = 列表列（去勾选/操作）+ **未进列表列的元数据字段**。
 *
 * 起因（2026-09-11 用户反馈“查看显示信息不全，例如我自定义的会员”）：
 * 详情若只按列表列渲染，自定义字段没被加进布局 list 列时就完全看不到 ——
 * 但详情应该是“这个实体的全部业务字段”，不应受列表布局裁剪。
 */
export function buildDetailColumns<Row>(opts: {
  listColumns: DetailColumnSpec<Row>[];
  metaFields: Field[];
  renderField: (code: string, row: Row) => ReactNode;
  /** 额外排除的列 key（默认排除勾选/操作列） */
  excludeKeys?: string[];
  /** 跳过的字段码（默认跳过 id/tenant_id/deleted_at 这类技术列） */
  skipCodes?: string[];
}): DetailColumnSpec<Row>[] {
  const exclude = new Set(opts.excludeKeys ?? ['__sel', '__actions']);
  const skip = new Set(opts.skipCodes ?? ['id', 'tenant_id', 'deleted_at']);
  const base = opts.listColumns.filter((c) => !exclude.has(c.key));
  const used = new Set(base.map((c) => c.key));
  const extra = opts.metaFields
    .filter((f) => !used.has(f.code) && !skip.has(f.code))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.code.localeCompare(b.code))
    .map((f) => ({
      key: f.code,
      header: f.name || tableColumnLabel(f.code) || f.code,
      cell: (row: Row) => opts.renderField(f.code, row),
    }));
  return [...base, ...extra];
}

export function entityColLabel(code: string, layoutLabel: string | undefined, fields: Field[]): string {
  if (layoutLabel && layoutLabel !== code) return layoutLabel;
  const f = fields.find((x) => x.code === code);
  if (f?.name) return f.name;
  return tableColumnLabel(code) || code;
}
