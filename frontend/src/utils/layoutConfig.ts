/**
 * 布局配置兼容层
 *
 * 历史遗留（早期 seedLayouts / 旧库）默认布局的 config 是顶层结构：
 *   { "columns": [ { "field_code": "name", "label": "名称", "visible": true } ] }
 * 而当前消费端（动态数据页 / 布局编辑器）读取的是：
 *   list:   { "table": { "columns": [{ field, label, width }] }, "header": { "searchFields": [...] } }
 *   form:   { "sections": [{ title, gridCols, fields: [{ field }] }] }
 * 读取前统一归一化，避免"布局管理里保存了、动态页却不生效/编辑打开是空的"。
 */

export function normalizeLayoutConfig(raw: any, type?: string): any {
  if (!raw || typeof raw !== 'object') return raw || {};
  const cfg: any = { ...raw };
  const isForm = type === 'form';
  const legacyCols: any[] = Array.isArray(cfg.columns) ? cfg.columns : [];

  if (legacyCols.length > 0) {
    const valid = legacyCols.filter((c: any) => c && c.field_code && c.visible !== false);
    if (isForm) {
      // 历史表单布局也存了 columns —— 统一包一层"基本信息"分组
      if (!Array.isArray(cfg.sections) || cfg.sections.length === 0) {
        cfg.sections = [{
          title: '基本信息',
          gridCols: 2,
          fields: valid.map((c: any) => ({ field: c.field_code })),
        }];
      }
    } else {
      if (!Array.isArray(cfg.table?.columns)) {
        cfg.table = {
          columns: valid.map((c: any) => ({
            field: c.field_code,
            label: c.label ?? '',
            width: c.width,
          })),
        };
        if (!Array.isArray(cfg.header?.searchFields)) {
          cfg.header = { ...(cfg.header || {}), searchFields: ['name'] };
        }
      }
    }
    delete cfg.columns;
  }
  return cfg;
}
