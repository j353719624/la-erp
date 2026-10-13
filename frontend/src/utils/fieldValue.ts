import { pickFieldValue } from '@/utils/dimLabel';

/**
 * 单元格展示取值（列码 → 值）统一入口
 *
 * 背景（2026-09-11）：同一件事此前在多处各写一套（布局编辑器预览、动态数据页、各列表页），
 * 导致"列码 color 而数据只存 TEST001COLOR"时有的地方显示值、有的显示空。
 * 约定：凡用户自定义/元数据列（列码可能与数据键不一致）取值，统一走 pickDisplayValue。
 */

const IMAGE_FIELDS = new Set(['images', 'image', 'image_url']);

export function isImageField(field: string): boolean {
  return IMAGE_FIELDS.has((field || '').toLowerCase());
}

/** 图片列占位：有图 → 📷，无图 → —（后端可能把图片数组以 JSON 字符串返回） */
export function imagePlaceholder(row: Record<string, any>, field = 'images'): string {
  let imgs: any = row[field];
  if (imgs === undefined || imgs === null) imgs = row.images ?? row.image_url ?? row.image;
  if (typeof imgs === 'string') {
    try {
      imgs = JSON.parse(imgs);
    } catch {
      imgs = imgs ? [imgs] : [];
    }
  }
  if (!Array.isArray(imgs)) imgs = imgs ? [imgs] : [];
  return imgs.length > 0 ? '📷' : '—';
}

/**
 * 取值：同义键回退（精确 → 大小写不敏感 → 维度语义别名 → ext_fields/ext 子对象）+ 图片列占位。
 * 未命中返回 undefined（由调用方决定显示 '—' 还是 '-'）。
 */
export function pickDisplayValue(row: Record<string, any> | null | undefined, field: string): any {
  if (!row || !field) return undefined;
  if (isImageField(field)) return imagePlaceholder(row, field);
  return pickFieldValue(row, field);
}
