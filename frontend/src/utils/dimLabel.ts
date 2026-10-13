// 商品多规格维度标签中文化（门户商城卡片徽标 / 详情“选择规格”矩阵共用）
// 背景：SKU 维度既可能是已中文化的字段名（型号/尺码…），也可能是未映射的字段码
// （capacity/model/color/size…），后端只对元数据已定义字段转 label，自定义维度
// （如电子“容量/型号”）会原样返回字段码 → 前端统一兜底中文，全行业可读。
const DIM_LABEL: Record<string, string> = {
  color: '颜色',
  size: '尺码',
  spec: '规格',
  capacity: '容量',
  model: '型号',
  power: '功率',
  interface: '接口',
  voltage: '电压',
  current: '电流',
  memory: '内存',
  storage: '存储',
  config: '配置',
  version: '版本',
  material: '材质',
  pattern: '花型',
  style: '款式',
  color_code: '色号',
  length: '长度',
  width: '宽度',
  height: '高度',
  weight: '重量',
  // 常用商品信息字段（门户“产品相关信息”/属性去重展示）
  season: '季节',
  style_no: '款号',
  fabric: '面料',
  texture: '材质',
  lining: '里料',
  country: '原产国',
  wash: '洗涤说明',
};

/** 单个维度标签兜底中文：已知码 → 中文；已含中文直接返回；自定义码（TEST001COLOR）→ 语义包含匹配后中文 */
export function dimLabel(raw?: string): string {
  if (!raw) return '';
  const t = raw.trim();
  if (DIM_LABEL[t]) return DIM_LABEL[t];
  if (/[\u4e00-\u9fa5]/.test(t)) return t;
  // 未直接命中时做语义包含匹配（TEST001COLOR → color → 颜色；prod_size → size → 尺码）
  const key = dimKeyOf(t);
  if (key && DIM_LABEL[key]) return DIM_LABEL[key];
  return t;
}

/** 多个维度标签去重 + 中文化，以「 / 」连接（详情“选择规格”标题/提示用） */
export function joinDimLabels(raws: (string | undefined)[]): string {
  const seen: string[] = [];
  for (const r of raws) {
    const v = dimLabel(r);
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen.join(' / ');
}

/** 多个维度标签去重 + 中文化，以「/」连接（商城卡片“多规格可选（…）”用） */
export function joinDimChips(raws: (string | undefined)[]): string {
  const seen: string[] = [];
  for (const r of raws) {
    const v = dimLabel(r);
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen.join('/');
}

// ── 维度去重（2026-09-11）：同一商品可能同时存在旧自定义字段（如 TEST001COLOR/TEST001SIZE）
//    与标准维度字段（color/size → 颜色/尺码），二者值相同 → 展示层重复两份。以下工具把
//    “语义相同的维度 + 相同值”合并为一份，并对同义维度组做值合并，避免重复选择器/重复信息。 ──

/** 中文维度名 → 标准键（与 DIM_LABEL 反向对应） */
const ZH_TO_KEY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(DIM_LABEL)) m[v] = k;
  return m;
})();

/** 维度键归一：把字段码/标签归一到语义键（颜色/color/TEST001COLOR → color；尺码/size/TEST001SIZE → size） */
export function dimKeyOf(raw?: string): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  if (DIM_LABEL[lower]) return lower;
  if (ZH_TO_KEY[t]) return ZH_TO_KEY[t];
  // 自定义字段码常带前缀/数字/下划线（TEST001COLOR、prod_size、weight_kg）→ 按**词边界**包含匹配：
  // 键必须是独立的词或词尾（前为串首/非字母、后为串尾/非字母/复数 s），
  // 否则 unit_conversion 会被当成 version(版本)、oversize 会被当成 size(尺码) —— 2026-09-11 上下文复查修正
  for (const k of Object.keys(DIM_LABEL)) {
    if (k.length < 3) continue;
    if (new RegExp(`(^|[^a-z])${k}s?($|[^a-z])`).test(lower)) return k;
  }
  return '';
}

/** 可读性评分：中文标签 > 已知英文码 > 原始自定义码（用于同义维度去重时保留更可读的一份） */
function readableScore(raw: string): number {
  const t = String(raw ?? '').trim();
  if (!t) return 0;
  let s = 0;
  if (/[\u4e00-\u9fa5]/.test(t)) s += 3;
  if (DIM_LABEL[t.toLowerCase()]) s += 2;
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(t)) s += 1;
  return s;
}

/**
 * 维度条目去重：同一语义维度且值相同时只保留一份（保留可读性最高者，如「颜色」优于「TEST001COLOR」）。
 * 非维度字段（dimKeyOf=''）一律保留，不同值的同义维度也保留（避免丢数据）。
 */
export function dedupeDimEntries<T extends { key: string; value: string }>(entries: T[]): T[] {
  const keptIndex = new Map<string, number>();
  const out: T[] = [];
  for (const e of entries) {
    const k = dimKeyOf(e.key);
    const sig = k ? `${k}|${String(e.value ?? '').trim()}` : '';
    if (!sig) {
      out.push(e);
      continue;
    }
    const idx = keptIndex.get(sig);
    if (idx === undefined) {
      keptIndex.set(sig, out.length);
      out.push(e);
      continue;
    }
    // 同语义同值重复：保留可读性更高的标签
    if (readableScore(e.key) > readableScore(out[idx].key)) out[idx] = e;
  }
  return out;
}

/** 同义维度组合并：同语义维度的可选值取并集，标签保留可读性最高者（如 TEST001COLOR+颜色 → 颜色） */
export function mergeDimGroups(groups: { label: string; values: string[] }[]): { label: string; values: string[] }[] {
  const out: { label: string; values: string[] }[] = [];
  const index = new Map<string, number>();
  for (const g of groups) {
    const k = dimKeyOf(g.label);
    const sig = k || `label:${g.label}`;
    const i = index.get(sig);
    if (i === undefined) {
      index.set(sig, out.length);
      out.push({ label: g.label, values: [...g.values] });
      continue;
    }
    for (const v of g.values) if (!out[i].values.includes(v)) out[i].values.push(v);
    if (readableScore(g.label) > readableScore(out[i].label)) out[i].label = g.label;
  }
  return out;
}

/**
 * 过滤掉与「维度选择器」重复的信息条目（2026-09-11 用户反馈：规格/产品相关信息/选择器三处都在显示颜色尺码）。
 * - 传入选择器展示的维度标签（dimLabels）：命中同语义维度的信息条目不重复展示（选择器里已可见）
 * - dimLabels 为空（无选择器，单规格商品）时全部保留——此时信息区是唯一出口，不能丢信息
 * - 非维度字段（面料/季节/原产国…）始终保留
 */
export function excludeDimEntries<T extends { key: string; value: string }>(entries: T[], dimLabels: string[]): T[] {
  const keys = new Set(dimLabels.map((l) => dimKeyOf(l)).filter(Boolean));
  if (keys.size === 0) return entries;
  return entries.filter((e) => {
    const k = dimKeyOf(e.key);
    return !(k && keys.has(k));
  });
}

/**
 * 行数据取值（含同义键回退）：布局列字段码与数据实际存储键不一致时（如列 color、数据存 TEST001COLOR；
 * 列 style_no、数据存 spu_code），按「精确 → 大小写不敏感 → 维度语义别名」依次回退，避免显示出 —。
 * 顺序：行顶层 → 行的 ext_fields 子对象（元数据/模板字段值都存这里）。
 * 用于布局编辑器真实数据预览与列表信息列渲染。
 */
export function pickFieldValue(row: Record<string, any> | null | undefined, field: string): any {
  if (!row || !field) return undefined;
  const ok = (v: any) => v !== undefined && v !== null && v !== '';
  const probe = (obj: Record<string, any>): any => {
    const direct = obj[field];
    if (ok(direct)) return direct;
    const lower = field.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower && ok(obj[k])) return obj[k];
    }
    const want = dimKeyOf(field);
    if (want) {
      for (const k of Object.keys(obj)) {
        if (k !== field && dimKeyOf(k) === want && ok(obj[k])) return obj[k];
      }
    }
    return undefined;
  };
  const top = probe(row);
  if (top !== undefined) return top;
  // 值可能存在子对象里：元数据/模板字段在 ext_fields，部分实体用 ext
  for (const key of ['ext_fields', 'ext']) {
    const box = row[key];
    if (box && typeof box === 'object' && !Array.isArray(box)) {
      const v = probe(box as Record<string, any>);
      if (v !== undefined) return v;
    }
  }
  return row[field];
}
