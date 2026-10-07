import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Minus,
  Plus,
  ShoppingCart,
  Package,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Check,
  Truck,
} from 'lucide-react';
import { portalApi, PortalProduct, PortalVariant } from '@/api/portal';
import { CartLine, formatQty, roundQty } from '@/utils/portalCart';
import { format } from '@/utils/format';
import { dimLabel, joinDimLabels, mergeDimGroups, dedupeDimEntries, excludeDimEntries } from '@/utils/dimLabel';

/** 详情页可选规格（当前商品 + 同款不同规格），统一为可加购的“SKU 选项” */
interface SkuOption {
  id: string;
  code: string;
  name: string;
  /** 商品描述（管理端录入；客户门户详情页展示文案） */
  description: string;
  spec: string;
  unit: string;
  price: number;
  stock: number;
  /** 起订量（0=不限；数量可小数） */
  minOrderQty: number;
  images: string[];
  /** 产品相关信息（颜色/尺码等商品自定义字段，切换规格联动） */
  attributes: { label: string; value: string }[];
}

interface Props {
  open: boolean;
  productId: string | null;
  onClose: () => void;
  onAddToCart: (line: CartLine, qty: number) => void;
}

/** 该规格的实际最小可购数量：设置了起订量用之，否则必须 >0 */
function optionMin(o: SkuOption | undefined): number {
  if (!o) return 0;
  return o.minOrderQty > 0 ? o.minOrderQty : 0;
}

/** 单行数量上限（与后端 portalMaxLineQty 一致：超出到结算会被 400 拒绝，前端提前拦截） */
const MAX_LINE_QTY = 99999;

/** 某 SKU 的属性键值映射（颜色/尺码等，label→value）；同义维度（TEST001COLOR 与 颜色）自动去重
 *  键统一 dimLabel 中文化：避免选择器/判匹配时“TEST001COLOR”与“颜色”被当成两个维度 */
function attrsOf(o?: SkuOption): Record<string, string> {
  const m: Record<string, string> = {};
  const entries: { key: string; value: string }[] = [];
  for (const a of o?.attributes || []) {
    if (a.label && a.value != null && String(a.value).trim() !== '') entries.push({ key: a.label, value: String(a.value).trim() });
  }
  for (const e of dedupeDimEntries(entries)) m[dimLabel(e.key)] = e.value;
  return m;
}

/**
 * 从可选 SKU 推导**选择维度**（颜色/尺码…）及每个维度的可选值（按出现顺序去重）。
 * 仅多值属性（同款下有 ≥2 个不同值）才算“可选维度”；单值属性（面料/季节/原产国…全款一致）
 * 不生成选择器，由「产品相关信息」展示（2026-09-11：否则会出现只有一个按钮的伪选择项）。
 */
function buildDimGroups(options: SkuOption[]): { label: string; values: string[] }[] {
  const groups: { label: string; values: string[] }[] = [];
  const seenLabel = new Set<string>();
  for (const o of options) {
    for (const label of Object.keys(attrsOf(o))) {
      if (seenLabel.has(label)) continue;
      seenLabel.add(label);
      const values: string[] = [];
      for (const o2 of options) {
        const v = attrsOf(o2)[label];
        if (v != null && !values.includes(v)) values.push(v);
      }
      if (values.length > 1) groups.push({ label, values });
    }
  }
  return groups;
}

/** 在可选 SKU 中找与已选维度匹配的一个（SKU 缺失该维度时视为不约束；用于逐步选色的可达性判断） */
function matchOption(options: SkuOption[], picked: Record<string, string>): SkuOption | undefined {
  for (const o of options) {
    const m = attrsOf(o);
    let ok = true;
    for (const [label, val] of Object.entries(picked)) {
      if (m[label] != null && m[label] !== val) {
        ok = false;
        break;
      }
    }
    if (ok) return o;
  }
  return undefined;
}

/** 归一化一张图：商品详情弹层展示用（前端已相对路径，直接渲染即可） */
export function PortalProductDetail({ open, productId, onClose, onAddToCart }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<SkuOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  // 天猫式维度选择：当前已选的 颜色/尺码 值（label→value）
  const [picked, setPicked] = useState<Record<string, string>>({});
  // 数量以文本承载（支持小数与中间空值输入），提交时 roundQty 规范化
  const [qtyText, setQtyText] = useState('1');
  const [qtyError, setQtyError] = useState('');
  const [activeImg, setActiveImg] = useState(0);
  const [imgFailed, setImgFailed] = useState<Record<number, boolean>>({});
  const [added, setAdded] = useState(false);
  // 管理端“客户可见库存”关闭时为 true：隐藏现货/缺货等库存信息
  const [stockHidden, setStockHidden] = useState(false);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 详情请求竞态守卫：快速连续打开不同商品时丢弃过期响应，避免旧商品覆盖新商品
  const loadSeqRef = useRef(0);
  // 缩略图条横向滚动容器：图片较多时缩略图在左列内横向滚动（不溢出到右侧信息面板），
  // 并自动将当前选中缩略图滚入可视区
  const thumbStripRef = useRef<HTMLDivElement | null>(null);

  // 激活图变化（点击缩略图/上一张/下一张/切换规格）时，把对应缩略图横向滚入可视区
  useEffect(() => {
    const strip = thumbStripRef.current;
    if (!strip) return;
    const btn = strip.querySelector<HTMLElement>(`[data-img="${activeImg}"]`);
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeImg, options, selectedId]);

  const load = useCallback(async (id: string) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError('');
    setImgFailed({});
    setAdded(false); // 重新打开商品时复位“已加入购物车”反馈
    try {
      const res = await portalApi.getProduct(id);
      if (seq !== loadSeqRef.current) return; // 已有更新的请求 → 丢弃过期响应
      if (res.code === 0 && res.data?.product) {
        const p: PortalProduct = res.data.product;
        setStockHidden(!!p.stock_hidden);
        const imgs = (p.images && p.images.length > 0 ? p.images : p.image_url ? [p.image_url] : []).filter(Boolean);
        const base: SkuOption = {
          id: p.id,
          code: p.code,
          name: p.name,
          description: (p.description || '').trim(),
          spec: p.spec || '',
          unit: p.unit || '',
          price: Number(p.sale_price || 0),
          stock: Number(p.stock_qty || 0),
          minOrderQty: Number(p.min_order_qty) > 0 ? Number(p.min_order_qty) : 0,
          images: imgs,
          attributes: p.attributes || [],
        };
        const variants: SkuOption[] = (res.data.variants || []).map((v: PortalVariant) => ({
          id: v.id,
          code: v.code,
          name: v.name,
          description: (v.description || '').trim(),
          spec: v.spec || '',
          unit: v.unit || '',
          price: Number(v.sale_price || 0),
          stock: Number(v.stock_qty || 0),
          minOrderQty: Number(v.min_order_qty) > 0 ? Number(v.min_order_qty) : 0,
          images: v.image_url ? [v.image_url] : [],
          attributes: v.attributes || [],
        }));
        setOptions([base, ...variants]);
        setSelectedId(p.id);
        setPicked(attrsOf(base));
        setQtyText(base.minOrderQty > 0 ? formatQty(base.minOrderQty) : '1');
        setQtyError('');
        setActiveImg(0);
      } else {
        setError(res.message || '商品加载失败，请重试');
      }
    } catch (err) {
      if (seq === loadSeqRef.current) setError(err instanceof Error && err.message ? err.message : '商品加载失败，请检查网络后重试');
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && productId) {
      load(productId);
    } else {
      setOptions([]);
      setError('');
    }
  }, [open, productId, load]);

  // 弹层打开期间锁定页面滚动：防止背景页（若存在横向溢出）被左右拖动/回弹而带动整个
  // 固定遮罩与弹层“左右来回移动”（移动端常见），关闭时恢复原状态
  useEffect(() => {
    if (!open) return;
    const prevBody = document.body.style.overflow;
    const prevHtmlOverflowX = document.documentElement.style.overflowX;
    const prevBodyOverflowX = document.body.style.overflowX;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflowX = prevHtmlOverflowX;
      document.body.style.overflowX = prevBodyOverflowX;
    };
  }, [open]);

  // 卸载/关闭时清理“已加入”提示定时器
  useEffect(() => {
    return () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    };
  }, []);

  const selected = useMemo(
    () => options.find((o) => o.id === selectedId) || options[0],
    [options, selectedId]
  );

  const showAdded = () => {
    setAdded(true);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(false), 1500);
  };

  const selectOption = (id: string) => {
    const o = options.find((x) => x.id === id) || options[0];
    setPicked(attrsOf(o));
    setSelectedId(o.id);
    setQtyText(o.minOrderQty > 0 ? formatQty(o.minOrderQty) : '1'); // 切换规格回到该规格起订/1
    setQtyError('');
    setActiveImg(0);
    setImgFailed({});
  };

  /** 天猫式：点选某维度值 → 尝试锁定到唯一 SKU */
  const pickDim = (label: string, value: string) => {
    const next = { ...picked, [label]: value };
    setPicked(next);
    const m = matchOption(options, next);
    if (m) selectOption(m.id);
  };

  const clampQtyText = (raw: string): number => {
    const v = parseFloat(raw);
    if (!isFinite(v)) return 0;
    const min = optionMin(selected);
    // [P3-7 2026-09-17 审查修复] 前端先行限制单行上限（与后端 portalMaxLineQty 一致），
    // 否则超限要等提交结算才 400（用户白填一遍）
    const q = roundQty(Math.min(MAX_LINE_QTY, Math.max(0, v)));
    return min > 0 ? Math.max(min, q) : q;
  };

  const handleAdd = () => {
    if (!selected) return;
    const q = clampQtyText(qtyText);
    if (q <= 0) {
      setQtyError('请填写大于 0 的数量');
      return;
    }
    const min = optionMin(selected);
    if (q < min) {
      setQtyError(`低于起订量 ${formatQty(min)}${selected.unit || ''}，已自动按起订量加入`);
    }
    // [P3-7] 输入超过单行上限：按上限加入并提示（不再等结算接口 400）
    if ((parseFloat(qtyText) || 0) > MAX_LINE_QTY) {
      setQtyError(`单件商品数量上限 ${MAX_LINE_QTY}，已按上限加入`);
    }
    const finalQty = Math.max(q, min);
    setQtyText(formatQty(finalQty));
    onAddToCart(
      {
        product_id: selected.id,
        code: selected.code,
        name: selected.name,
        spec: selected.spec,
        unit: selected.unit,
        price: selected.price,
        image_url: selected.images[0] || '',
        qty: finalQty,
        min_order_qty: min,
      },
      finalQty
    );
    showAdded();
  };

  if (!open) return null;

  const images = selected?.images || [];
  const canPrev = images.length > 1;
  const canNext = images.length > 1;
  const minQty = optionMin(selected);
  const units = new Set(options.map((o) => (o.unit || '').trim()).filter(Boolean));
  const showUnitOnChips = units.size > 1; // 同款存在不同单位时，规格 chip 上标注单位防混选
  const curQty = roundQty(parseFloat(qtyText) || 0);
  // 天猫式维度矩阵：SKU 带 颜色/尺码 等属性且有多个可选时启用；否则回退规格 chip
  const dimGroups = mergeDimGroups(buildDimGroups(options));
  // 产品相关信息（去重后）：剔除已在“维度选择器”展示的维度（颜色/尺码），仅保留面料/季节等补充信息；
  // 无选择器时（单规格）全部保留，信息区是唯一出口。全被覆盖则不展示该区块，避免与「规格」「选择器」三处重复。
  const infoAttrs = excludeDimEntries(
    // selected 在“打开弹层但尚未加载完成”时为 undefined（options 为空）→ 必须空值保护，
    // 否则渲染期直接抛 TypeError（2026-09-11 客户反馈“门户详情打开就报错”）
    dedupeDimEntries((selected?.attributes ?? []).map((a) => ({ key: a.label, value: a.value }))),
    options.length > 1 ? dimGroups.map((g) => g.label) : [],
  );
  const matrix = dimGroups.length > 0 && options.length > 1;
  const pickedComplete = matrix ? dimGroups.every((g) => !!(picked[g.label] ?? '').trim()) : true;
  const matched = matrix ? matchOption(options, picked) : selected;
  const comboInvalid = matrix && pickedComplete && !matched;
  const addDisabled = !selected || !isFinite(curQty) || curQty <= 0 || (matrix && (!pickedComplete || comboInvalid));

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="portal-detail-dialog relative w-full max-w-4xl max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-800">商品详情</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center py-24 text-gray-400 text-sm">加载中...</div>
        )}

        {!loading && error && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 px-6">
            <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-gray-500 mb-4">{error}</p>
            <div className="flex gap-3">
              {productId && (
                <button
                  onClick={() => load(productId)}
                  className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg"
                >
                  重新加载
                </button>
              )}
              <button onClick={onClose} className="px-4 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-lg">
                关闭
              </button>
            </div>
          </div>
        )}

        {!loading && !error && selected && (
          <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden">
            <div className="portal-detail-grid grid grid-cols-1 gap-4 p-4 w-full min-w-0">
              {/* 左：多图画廊 */}
              <div className="min-w-0">
                <div className="portal-detail-media relative aspect-square bg-gray-50 border border-gray-100 rounded-xl overflow-hidden">
                  {images.length > 0 ? (
                    <img
                      key={activeImg}
                      src={images[activeImg]}
                      alt={selected.name}
                      onError={() => setImgFailed((prev) => ({ ...prev, [activeImg]: true }))}
                      className={`w-full h-full object-contain ${imgFailed[activeImg] ? 'hidden' : ''}`}
                    />
                  ) : null}
                  {(!images.length || imgFailed[activeImg]) && (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
                      <Package className="w-14 h-14" />
                      <span className="text-xs mt-2 text-gray-400">暂无图片</span>
                    </div>
                  )}
                  {canPrev && (
                    <button
                      onClick={() => setActiveImg((i) => (i - 1 + images.length) % images.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 hover:bg-white text-gray-600 shadow flex items-center justify-center"
                      aria-label="上一张"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                  )}
                  {canNext && (
                    <button
                      onClick={() => setActiveImg((i) => (i + 1) % images.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 hover:bg-white text-gray-600 shadow flex items-center justify-center"
                      aria-label="下一张"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}
                  {images.length > 1 && (
                    <span className="absolute right-2 bottom-2 px-1.5 py-0.5 rounded bg-black/50 text-white text-[10px]">
                      {activeImg + 1}/{images.length}
                    </span>
                  )}
                </div>
                {/* 缩略图：overflow-x-auto 将滚动限制在左列内（图片多时不溢出到右侧面板
                    被其拦截点击——修复第 7 张起不可点击切换），激活项自动滚入可视区 */}
                {images.length > 1 && (
                  <div
                    ref={thumbStripRef}
                    role="group"
                    aria-label="商品图片缩略图"
                    className="flex gap-2 mt-3 overflow-x-auto pb-1"
                  >
                    {images.map((u, i) => (
                      <button
                        key={i}
                        data-img={i}
                        onClick={() => setActiveImg(i)}
                        className={`w-16 h-16 rounded-lg overflow-hidden border-2 shrink-0 ${i === activeImg ? 'border-orange-500' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <img
                          src={u}
                          alt={`${selected.name} ${i + 1}`}
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 右：购买信息 */}
              <div className="flex flex-col min-w-0">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 leading-snug break-words">{selected.name}</h2>

                {/* 货号/规格信息 */}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 min-w-0">
                  <span className="break-words">
                    货号：<span className="text-gray-600 font-medium">{selected.code}</span>
                  </span>
                  {selected.spec && (
                    <span className="break-words">
                      规格：<span className="text-gray-600 font-medium">{selected.spec}</span>
                    </span>
                  )}
                  {selected.unit && <span className="shrink-0">单位：{selected.unit}</span>}
                </div>

                {/* 产品相关信息（仅补充信息：与「规格」「维度选择器」重复的颜色/尺码不再重复展示） */}
                {infoAttrs.length > 0 && (
                  <div className="mt-5">
                    <div className="text-sm text-gray-600 mb-2">产品相关信息</div>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg text-sm">
                      {infoAttrs.map((a, i) => (
                        <div key={`${a.key}-${i}`} className="flex items-baseline gap-2 min-w-0">
                          <dt className="text-gray-400 shrink-0">{dimLabel(a.key)}</dt>
                          <dd className="text-gray-700 break-words text-right">{a.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {/* 价格（客户可见库存关闭时不展示库存徽标） */}
                <div className="mt-4 flex items-end justify-between flex-wrap gap-2 min-w-0">
                  <div className="min-w-0 break-words">
                    <span className="text-2xl sm:text-3xl font-bold text-[#ff4400]">
                      ¥{format.currency(selected.price)}
                    </span>
                    <span className="text-xs text-gray-400 ml-1">/{selected.unit || '件'}</span>
                  </div>
                  {!stockHidden && (
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                        selected.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {selected.stock > 0
                        ? `现货 ${format.qty(selected.stock)} ${selected.unit || '件'}`
                        : '暂无现货（可下单，客服跟进）'}
                    </span>
                  )}
                </div>

                {/* 同款不同规格：天猫式 颜色/尺码 维度选择；无属性维度时回退规格 chip */}
                {options.length > 1 && (
                  <div className="mt-5">
                    <div className="text-sm text-gray-600 mb-2">
                      {matrix
                        ? `选择${dimGroups.length > 0 ? ' ' + joinDimLabels(dimGroups.map((g) => g.label)) : ''}`
                        : '选择规格'}{' '}
                      <span className="text-gray-400 text-xs">
                        （已选：{matrix && matched ? matched.spec || matched.code : selected.spec || selected.code}）
                      </span>
                    </div>
                    {matrix ? (
                      <div className="space-y-3">
                        {dimGroups.map((g) => (
                          <div key={g.label} className="flex flex-wrap items-start gap-2">
                            <span className="w-14 shrink-0 pt-1.5 text-sm text-gray-600">{dimLabel(g.label)}</span>
                            <div className="flex flex-wrap gap-2">
                              {g.values.map((v) => {
                                const active = picked[g.label] === v;
                                // 其它维度已选后，该值若不存在对应 SKU 则禁用（灰掉）
                                const reachable = !!matchOption(options, { ...picked, [g.label]: v });
                                return (
                                  <button
                                    key={v}
                                    onClick={() => pickDim(g.label, v)}
                                    disabled={!reachable}
                                    className={`px-3 py-1.5 rounded-lg border text-sm transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                                      active
                                        ? 'border-orange-500 bg-orange-50 text-orange-600 font-medium'
                                        : 'border-gray-200 text-gray-600 hover:border-orange-300'
                                    }`}
                                  >
                                    {v}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        {!pickedComplete && (
                          <p className="text-xs text-gray-500">
                            请选择：{dimGroups.filter((g) => !(picked[g.label] ?? '').trim()).map((g) => dimLabel(g.label)).join('、')}
                          </p>
                        )}
                        {pickedComplete && comboInvalid && (
                          <p className="text-xs text-amber-600">该{joinDimLabels(dimGroups.map((g) => g.label))}组合暂无货或不存在，请更换选择</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {options.map((o) => {
                          const isSel = o.id === selected.id;
                          return (
                            <button
                              key={o.id}
                              onClick={() => selectOption(o.id)}
                              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                                isSel
                                  ? 'border-orange-500 bg-orange-50 text-orange-600 font-medium'
                                  : 'border-gray-200 text-gray-600 hover:border-orange-300'
                              }`}
                            >
                              {o.spec || o.code}
                              {showUnitOnChips && o.unit ? <span className="ml-0.5 text-xs opacity-70">·{o.unit}</span> : null}
                              {!stockHidden && o.stock <= 0 ? (
                                <span className="ml-1 text-xs text-amber-500">(缺货)</span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 数量（可小数） */}
                <div className="mt-5">
                  <div className="text-sm text-gray-600 mb-2">
                    购买数量
                    {minQty > 0 && (
                      <span className="text-gray-400 text-xs ml-1">起订 {formatQty(minQty)} {selected.unit || ''}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="inline-flex items-center border border-gray-200 rounded-lg overflow-hidden shrink-0">
                      <button
                        onClick={() => {
                          const next = roundQty((parseFloat(qtyText) || 0) - 1);
                          setQtyText(Math.max(minQty, next) > 0 ? formatQty(Math.max(minQty, next)) : '');
                          setQtyError('');
                        }}
                        className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50"
                        aria-label="减少数量"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        step="any"
                        min={minQty > 0 ? minQty : undefined}
                        max={MAX_LINE_QTY}
                        value={qtyText}
                        onChange={(e) => {
                          setQtyText(e.target.value);
                          setQtyError('');
                        }}
                        className="w-20 text-center text-sm text-gray-800 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        onClick={() => {
                          const next = roundQty(Math.min(MAX_LINE_QTY, (parseFloat(qtyText) || 0) + 1));
                          setQtyText(formatQty(Math.max(minQty, next)));
                          setQtyError('');
                        }}
                        className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50"
                        aria-label="增加数量"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {qtyError && <p className="mt-2 text-xs text-red-500">{qtyError}</p>}
                </div>

                {/* 加入购物车（窄屏/矮屏隐藏：底部常驻操作栏已有同功能按钮，避免两个加购按钮；
                    真桌面尺寸由 CSS（宽且高）才显示此按钮） */}
                <div className="portal-detail-inline-add mt-6">
                  <button
                    onClick={handleAdd}
                    disabled={addDisabled}
                    className={`inline-flex items-center gap-2 px-8 py-3 rounded-xl text-white font-semibold shadow transition-colors disabled:opacity-50 ${
                      added ? 'bg-emerald-500' : 'bg-[#ff4400] hover:bg-[#e63c00]'
                    }`}
                  >
                    {added ? <Check className="w-5 h-5" /> : <ShoppingCart className="w-5 h-5" />}
                    {added ? '已加入购物车' : '加入购物车'}
                  </button>
                </div>

                {/* 商品描述（管理端“商品资料”录入；无内容则不展示） */}
                {selected.description && (
                  <div className="mt-6 pt-4 border-t border-gray-100">
                    <h4 className="text-xs font-medium text-gray-500 mb-1.5">商品描述</h4>
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line break-words">
                      {selected.description}
                    </p>
                  </div>
                )}

                {/* 服务说明 */}
                <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-400 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-gray-300" /> 下单后由客服确认备货，确认后尽快安排发货
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-gray-300" /> 价格以最终确认单为准；如需议价请联系客服
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 底部操作栏（窄屏与矮屏常驻，贴近主流电商详情页）：数量步进 + 加入购物车主按钮，
            无需滚动到中部即可加购；仅“真桌面”（宽且高）隐藏（信息区已有同功能按钮） */}
        <div className="portal-detail-actions shrink-0 flex items-center gap-2 px-4 py-2.5 border-t border-gray-100 bg-white">
          <span className="shrink-0 text-[11px] text-gray-400 max-w-[72px] truncate">
            {selected ? `已选 ${selected.spec || selected.code}` : ''}
          </span>
          <div className="inline-flex items-center border border-gray-200 rounded-lg overflow-hidden shrink-0">
            <button
              onClick={() => {
                const next = roundQty((parseFloat(qtyText) || 0) - 1);
                setQtyText(Math.max(minQty, next) > 0 ? formatQty(Math.max(minQty, next)) : '');
                setQtyError('');
              }}
              className="w-8 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50"
              aria-label="减少数量"
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="number"
              step="any"
              min={minQty > 0 ? minQty : undefined}
              max={MAX_LINE_QTY}
              value={qtyText}
              onChange={(e) => {
                setQtyText(e.target.value);
                setQtyError('');
              }}
              className="w-12 text-center text-sm text-gray-800 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              aria-label="购买数量"
            />
            <button
              onClick={() => {
                const next = roundQty(Math.min(MAX_LINE_QTY, (parseFloat(qtyText) || 0) + 1));
                setQtyText(formatQty(Math.max(minQty, next)));
                setQtyError('');
              }}
              className="w-8 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50"
              aria-label="增加数量"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleAdd}
            disabled={addDisabled}
            className={`flex-1 h-10 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-1.5 shadow transition-colors disabled:opacity-50 ${added ? 'bg-emerald-500' : 'bg-[#ff4400] hover:bg-[#e63c00]'}`}
          >
            {added ? <Check className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
            {added ? '已加入购物车' : '加入购物车'}
          </button>
        </div>
      </div>
    </div>
  );
}
