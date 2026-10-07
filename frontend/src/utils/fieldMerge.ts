/**
 * 表单字段来源合并（纯函数，无外部依赖——供页面与门禁脚本共用）
 *
 * 背景（2026-09-16 用户反馈修复）：
 *   商品列表「视图 → ＋新建字段」创建的字段写入实体字段池（元数据 FieldDef），
 *   并在提示中承诺“表单/详情同步可用”。但 ProductForm 在“已应用商品行业模板”时
 *   只显示模板字段（industry_template_fields），新建字段在表单/编辑页永远看不到——
 *   用户表现为“视图改动后，新增商品里并没有随着改变”。
 *
 * 约定：凡“按模板展示字段”的表单页，字段来源一律用本函数合并，
 *       禁止回退为“只取模板字段”；模板字段优先（同 code 冲突时保留模板版，
 *       模板的分组/必填等配置以模板为准），字段池中模板未收录的字段追加在后。
 */

export interface MergeableField {
  code?: string;
  sort_order?: number;
}

/** 按 sort_order 升序（缺省 0），不改动入参数组 */
function byOrder<T extends MergeableField>(a: T, b: T): number {
  return (a.sort_order || 0) - (b.sort_order || 0);
}

/**
 * 合并「模板字段」与「实体字段池」：
 *   - 模板字段在前（保持模板排序），池中额外字段追加在后（保持池内排序）；
 *   - 同 code 去重：模板版优先；
 *   - code 为空的池字段（脏数据）被忽略。
 */
export function mergeTemplateAndPoolFields<T extends MergeableField>(
  templateFields: T[],
  poolFields: T[],
): T[] {
  const tplCodes = new Set(templateFields.map((f) => f.code).filter(Boolean));
  const extras = poolFields.filter((f) => !!f.code && !tplCodes.has(f.code));
  return [...[...templateFields].sort(byOrder), ...[...extras].sort(byOrder)];
}
