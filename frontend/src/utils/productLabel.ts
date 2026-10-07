/**
 * 商品下拉/选项统一显示：名称 · 规格（编码）
 *
 * 背景（2026-09-11 用户反馈）：SPU 多规格商品的多个 SKU 商品名称相同、仅编码不同，
 * 下拉只显示「编码 - 名称」时无法分辨颜色/尺码/容量等规格，选商品要逐个对编码。
 * 统一显示「名称 · 规格（编码）」——规格取 product.spec（SPU 生成 SKU 时=维度值串，
 * 如 白色/L、256G/Pro；普通商品=自身规格字段），编码放括号内次要位置，兼顾检索与唯一性。
 *
 * 检索：SearchSelect 的 filterOption 按 label 匹配，编码/名称/规格均可命中，无需额外 search 字段。
 *
 * W-01（2026-09-13）追加两个多规格场景能力：
 *  - productSelectGroups：下拉按款（SPU）分组——6 个同名 SKU 归到一个组头下，叶子只显示「规格（编码）」；
 *  - matchProductByScan：扫码/输码匹配（条码精确 → 编码精确 → 关键词唯一命中），供入库/出库扫码快速添加。
 */
export interface ProductLike {
  name?: string | null;
  spec?: string | null;
  code?: string | null;
  /** 自定义/维度字段（如 {color:'黑色', size:'S'}）；spec 为空时用它兜底拼规格 */
  ext_fields?: Record<string, unknown> | null;
}

/** 维度字段优先顺序（颜色/尺码/容量/型号…），用于 spec 为空时兜底 */
const DIM_KEYS = [
  'color', 'size', 'capacity', 'model', 'power', 'interface', 'voltage',
  'material', 'version', 'length', 'width', 'height', 'weight', 'style', 'pattern',
];

/** 规格文本：优先 product.spec（SPU 生成时=维度值串），否则回落 ext_fields 维度值（最多 3 个） */
export function productSpecText(p?: ProductLike | null): string {
  const spec = String(p?.spec ?? '').trim();
  if (spec) return spec;
  const ef = p?.ext_fields;
  if (!ef || typeof ef !== 'object') return '';
  const vals: string[] = [];
  for (const k of DIM_KEYS) {
    const v = (ef as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && String(v).trim()) vals.push(String(v).trim());
  }
  if (vals.length === 0) {
    for (const k of Object.keys(ef)) {
      const v = (ef as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim() && vals.length < 3) vals.push(v.trim());
    }
  }
  return vals.join('/');
}

/** 商品下拉统一标签：`名称 · 规格`（简洁：不带编码；编码放入检索词，输入仍可命中） */
export function productOptionLabel(p?: ProductLike | null): string {
  const name = String(p?.name ?? '').trim() || '未命名商品';
  const spec = productSpecText(p);
  return `${name}${spec ? ` · ${spec}` : ''}`;
}

/** 商品下拉检索词（编码/名称/规格/维度值；SearchSelect 输入时命中即显示） */
export function productOptionSearch(p?: ProductLike | null): string {
  return [p?.code, p?.name, productSpecText(p)]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** 下拉叶子选项 */
export interface ProductSelectLeaf {
  value: string;
  label: string;
  search: string;
}

/** 下拉分组（antd Select 的分组形态：组头 label + 子选项） */
export interface ProductSelectGroup {
  label: string;
  options: ProductSelectLeaf[];
}

/** 分组输入：需要 id / 款边（Product 满足） */
export interface ProductSelectSource extends ProductLike {
  id: string;
  is_combo?: boolean | null;
  edges?: { spu?: { code?: string | null; name?: string | null } | null } | null;
}

/**
 * 商品下拉选项：多规格（款）商品**按款分组**，独立商品归入「普通商品」组。
 *
 * 为什么分组：多规格 SKU 的商品名相同（都是款名），平铺时 6 个一模一样的选项连在一起；
 * 分组后组头=「款号 · 款名」，叶子=「规格（编码）」，一眼能对上是哪一支；搜索仍按 编码/名称/规格 命中。
 *
 * 无多规格商品时返回**扁平**列表（不出现只包一层的「普通商品」空壳分组）。
 * @param opts.comboHint 组装商品在标签后加提示（出库场景）
 */
export function productSelectGroups(
  products: ProductSelectSource[],
  opts?: { comboHint?: boolean },
): (ProductSelectLeaf | ProductSelectGroup)[] {
  const groups = new Map<string, ProductSelectGroup>();
  const plain: ProductSelectLeaf[] = [];
  const leafOf = (p: ProductSelectSource, label: string): ProductSelectLeaf => ({
    value: p.id,
    label,
    search: productOptionSearch(p),
  });
  for (const p of products) {
    if (!p || !p.id) continue;
    const spu = p.edges?.spu;
    const spuName = [String(spu?.code ?? '').trim(), String(spu?.name ?? '').trim()].filter(Boolean).join(' · ');
    const comboHint = opts?.comboHint && p.is_combo ? '（组装，无现货自动扣配件）' : '';
    if (spuName) {
      const group = groups.get(spuName) ?? { label: spuName, options: [] };
      // 组头已给出款名 → 叶子只保留「规格（编码）」，短且可区分
      const spec = productSpecText(p);
      group.options.push(leafOf(p, `${spec || '默认'}（${p.code}）${comboHint}`));
      groups.set(spuName, group);
    } else {
      plain.push(leafOf(p, `${productOptionLabel(p)}${comboHint}`));
    }
  }
  if (groups.size === 0) return plain;
  const out: (ProductSelectLeaf | ProductSelectGroup)[] = [...groups.values()];
  if (plain.length) out.push({ label: '普通商品', options: plain });
  return out;
}

/** 扫码匹配结果 */
export interface ScanMatch<T> {
  /** 命中商品；未命中/歧义时为 null */
  hit: T | null;
  /** true=条码或编码精确命中；false=关键词模糊命中 */
  exact: boolean;
  /** 模糊命中的候选个数（>1 时由页面提示改用条码/编码） */
  count: number;
}

/**
 * 扫码 / 输码匹配：条码精确 → 编码精确（大小写不敏感）→ 关键词（编码/名称/规格）唯一命中。
 * 命中多个时**不猜**（返回 count 让页面提示改用精确码），避免扫错录错。
 */
export function matchProductByScan<T extends ProductLike & { id: string; barcode?: string | null }>(
  products: T[],
  code: string,
): ScanMatch<T> {
  const raw = String(code ?? '').trim();
  if (!raw) return { hit: null, exact: false, count: 0 };
  const lower = raw.toLowerCase();
  const byBarcode = products.find((p) => String(p?.barcode ?? '').trim().toLowerCase() === lower);
  if (byBarcode) return { hit: byBarcode, exact: true, count: 1 };
  const byCode = products.find((p) => String(p?.code ?? '').trim().toLowerCase() === lower);
  if (byCode) return { hit: byCode, exact: true, count: 1 };
  const hits = products.filter((p) => productOptionSearch(p).toLowerCase().includes(lower));
  if (hits.length === 1) return { hit: hits[0], exact: false, count: 1 };
  return { hit: null, exact: false, count: hits.length };
}
