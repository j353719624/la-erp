/**
 * 商品（/products 业务页）读取「商品」实体元数据布局的工具
 *
 * 「布局管理」为商品实体配置的 list/form 布局，除驱动 元数据→动态数据 页外，
 * 也驱动真实业务页：
 *   - 商品管理列表（loadProductListLayout / isProductListLayoutCustomized）
 *   - 商品详情弹窗 / 编辑表单自定义字段区（formSections，按 form 布局 sections 分组排序）
 *
 * ⚠️ 权限注意：GET /v1/metadata/layouts/* 挂在 RequirePermission("system") 下，
 * 采购/仓管等非 system 角色访问商品页会 403 → 一律 catch 并返回空（页面走默认展示）。
 */
import { entityApi, fieldApi, layoutApi } from '@/api/metadata';
import { Field } from '@/types/metadata';
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

export interface ProductLayoutData {
  /** 商品实体 FieldDef（核心+模板自定义字段） */
  fields: Field[];
  /** 默认 list 布局 table.columns（已归一化），无布局/无权限时为空数组 */
  listColumns: LayoutColumn[];
  /** 默认 form 布局 sections（已归一化、保序），无布局/无权限时为空数组 */
  formSections: FormSection[];
}

/** 种子/模板自动生成的“通用核心”列码（区别于用户/业务有意配置的业务列） */
const SEED_CORE_CODES = new Set(['id', 'code', 'name', 'status', 'remark', 'created_at', 'updated_at', 'deleted_at']);

/** 商品管理列表“页面默认业务信息列”码（与商品业务页默认展示一致的列） */
export const PRODUCT_LIST_DEFAULT_INFO = ['code', 'spec', 'barcode', 'sale_price', 'purchase_price', 'status'];

/** 商品表单/详情顶部固定展示的业务字段码（这些码不进自定义字段区，避免重复） */
export const PRODUCT_FORM_FIXED_CODES = new Set(['id', 'code', 'name', 'status', 'remark', 'created_at', 'updated_at', 'deleted_at']);

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
 * 读取「商品」实体默认 list/form 布局与字段（一次并发）。
 * 任何异常（无实体/无权限 403/无默认布局/网络错误）都静默返回空，不影响商品页正常使用。
 */
export async function loadProductLayouts(): Promise<ProductLayoutData> {
  try {
    const entRes = await entityApi.getByCode('product');
    if (entRes.code !== 0 || !entRes.data) return { fields: [], listColumns: [], formSections: [] };
    const entityId = entRes.data.id;
    // [2026-09-14] loadOptions 失败隔离：单项失败降级为空（非 system 角色 403 属预期）
    const [fieldsRes, listRes, formRes] = await loadOptions([
      fieldApi.list(entityId),
      layoutApi.getDefault(entityId, 'list'),
      layoutApi.getDefault(entityId, 'form'),
    ], '商品布局');
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

/** 向后兼容：仅读 list 布局（商品列表用） */
export async function loadProductListLayout(): Promise<{ fields: Field[]; listColumns: LayoutColumn[] }> {
  const data = await loadProductLayouts();
  return { fields: data.fields, listColumns: data.listColumns };
}

/**
 * 商品管理列表是否“用户/业务有意配置了布局”：
 * 只有布局列包含种子核心码之外的业务列（spec/barcode/sale_price/purchase_price… 或模板/自定义字段）时，
 * 才认定用户想让商品业务列表按布局显示；纯种子/模板通用核心列（code/name/status…）视为默认，
 * 商品业务页回退到自己的完整默认列，避免新库/套模板后商品页列被“通用默认布局”削掉。
 */
export function isProductListLayoutCustomized(listColumns: LayoutColumn[]): boolean {
  if (!Array.isArray(listColumns) || listColumns.length === 0) return false;
  return listColumns.some((c) => !SEED_CORE_CODES.has(c.field));
}

/**
 * 列显示名：布局显式显示名(≠列码) → 元数据字段中文名 → 系统表列中文名 → 原始列码。
 * （与动态数据页/布局编辑器同规则）
 */
export function layoutColLabel(code: string, layoutLabel: string | undefined, fields: Field[]): string {
  if (layoutLabel && layoutLabel !== code) return layoutLabel;
  const f = fields.find((x) => x.code === code);
  if (f?.name) return f.name;
  return tableColumnLabel(code) || code;
}
