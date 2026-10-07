import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Store,
  LogOut,
  Package,
  Receipt,
  ShoppingCart,
  Search,
  ShoppingBag,
  ChevronRight,
} from 'lucide-react';
import { portalApi, PortalProduct, PortalCategory, PortalOrder } from '@/api/portal';
import { portalStorage } from '@/utils/request';
import {
  CartLine,
  loadCart,
  addToCart,
  updateCartQty,
  removeCartLine,
  clearCart,
  cartCount,
  formatQty,
} from '@/utils/portalCart';
import { format } from '@/utils/format';
import { joinDimChips, dedupeDimEntries } from '@/utils/dimLabel';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { PortalProductDetail } from './PortalProductDetail';
import { PortalCartDrawer } from './PortalCartDrawer';

// 客户可见订单全流程进度（确认→支付→备货→出库→完成）
const PROGRESS_STEPS = [
  { key: 'confirmed', label: '订单确认' },
  { key: 'paid', label: '客户支付' },
  { key: 'preparing', label: '备货' },
  { key: 'shipped', label: '出库' },
  { key: 'completed', label: '完成' },
];

const PROGRESS_INDEX: Record<string, number> = {
  submitted: -1,
  confirmed: 0,
  paid: 1,
  preparing: 2,
  shipped: 3,
  completed: 4,
};

const PAGE_SIZE = 24;

function ProgressSteps({ progress }: { progress: string }) {
  const current = PROGRESS_INDEX[progress] ?? -1;
  return (
    <div className="flex items-center gap-0.5">
      {PROGRESS_STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border shrink-0 ${
              i <= current
                ? 'bg-[#ff4400] border-[#ff4400] text-white'
                : 'bg-gray-100 border-gray-300 text-gray-400'
            }`}
          >
            {i + 1}
          </div>
          <div className={`ml-1 text-[10px] whitespace-nowrap ${i <= current ? 'text-[#d63a00]' : 'text-gray-400'}`}>
            {s.label}
          </div>
          {i < PROGRESS_STEPS.length - 1 && (
            <div className={`w-3 h-0.5 mx-1 ${i < current ? 'bg-[#ff4400]' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/** 商品卡片：图片 + 名称 + 规格 + 价格 + 快速加购；点击卡片看详情 */
function ProductCard({
  p,
  onOpen,
  onQuickAdd,
}: {
  p: PortalProduct;
  onOpen: (id: string) => void;
  onQuickAdd: (p: PortalProduct) => void;
}) {
  const stock = Number(p.stock_qty || 0);
  const stockHidden = !!p.stock_hidden;
  const images = p.images && p.images.length > 0 ? p.images : p.image_url ? [p.image_url] : [];
  return (
    <article
      onClick={() => onOpen(p.id)}
      className="group bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-lg transition-shadow overflow-hidden cursor-pointer flex flex-col"
    >
      <div className="relative aspect-square bg-gray-50 overflow-hidden">
        {images.length > 0 ? (
          <img
            src={images[0]}
            alt={p.name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <Package className="w-12 h-12" />
          </div>
        )}
        {!stockHidden && stock > 0 && (
          <span className="absolute left-2 top-2 px-1.5 py-0.5 rounded text-[10px] bg-black/45 text-white">
            现货 {format.qty(stock)}
          </span>
        )}
        {!stockHidden && stock <= 0 && (
          <span className="absolute left-2 top-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/90 text-white">
            暂无现货
          </span>
        )}
      </div>
      <div className="p-3 flex flex-col flex-1">
        <h3 className="text-sm font-medium text-gray-800 truncate leading-snug">{p.name}</h3>
        <p className="text-xs text-gray-400 mt-0.5 truncate">
          {p.code}
          {p.spec ? ` · ${p.spec}` : ''}
          {p.unit ? ` / ${p.unit}` : ''}
        </p>
        {p.spu_id && (
          <span className="inline-flex mt-1 self-start text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-500 border border-orange-200">
            多规格可选{(p.attributes?.length || 0) > 0 ? `（${joinDimChips(dedupeDimEntries((p.attributes || []).map((a) => ({ key: a.label, value: a.value }))).map((a) => a.key))}）` : ''}
          </span>
        )}
        <div className="mt-auto pt-2.5 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[15px] font-bold text-[#ff4400]">¥{format.currency(p.sale_price)}</span>
            {p.unit && <span className="text-[11px] text-gray-400 ml-0.5">/{p.unit}</span>}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuickAdd(p);
            }}
            className="w-8 h-8 rounded-lg bg-[#fff2ec] text-[#ff4400] hover:bg-[#ff4400] hover:text-white flex items-center justify-center transition-colors shrink-0"
            aria-label={`加入购物车：${p.name}`}
            title="加入购物车"
          >
            <ShoppingCart className="w-4 h-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function PortalShop() {
  const navigate = useNavigate();
  const [view, setView] = useState<'shop' | 'orders'>('shop');

  // ── 商城目录 ─────────────────────────────
  const [categories, setCategories] = useState<PortalCategory[]>([]);
  const [products, setProducts] = useState<PortalProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // [2026-09-17 审查修复] 「还有下一页」标记：后端先分页后按款折叠，total 为折叠前行数，
  // 不能用 products.length < total 判定（永远成立 → 按钮卡死、反复空拉）——以「本页是否满页」为口径
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [shopError, setShopError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState('');
  // [易用性 P2] 排序（关键词/分类/排序写入 URL：刷新与返回不丢条件）
  const [sort, setSort] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const urlInitedRef = useRef(false);
  useEffect(() => {
    // 首帧从 URL 回填（只执行一次，避免覆盖用户后续操作）
    if (urlInitedRef.current) return;
    urlInitedRef.current = true;
    const kw = searchParams.get('keyword') || '';
    const cat = searchParams.get('category_id') || '';
    const st = searchParams.get('sort') || '';
    if (kw) setKeyword(kw);
    if (cat) setCategoryId(cat);
    if (st) setSort(st);
  }, [searchParams]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (keyword.trim()) next.set('keyword', keyword.trim());
    if (categoryId) next.set('category_id', categoryId);
    if (sort) next.set('sort', sort);
    setSearchParams(next, { replace: true });
  }, [keyword, categoryId, sort, setSearchParams]);
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  // ── 购物车（localStorage 持久化）────────────
  const customerId = portalStorage.getCustomerId();
  const [cart, setCart] = useState<CartLine[]>(() => loadCart(customerId));
  const cartCountNum = useMemo(() => cartCount(cart), [cart]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const checkoutBusyRef = useRef(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutSuccess, setCheckoutSuccess] = useState('');
  // 窗口聚焦刷新节流：管理端改库存/总开关后，客户切回本页时看到最新状态
  const viewRef = useRef<'shop' | 'orders'>('shop');
  viewRef.current = view;
  const lastFocusFetchRef = useRef(0);

  // ── 商品详情 ─────────────────────────────
  const [detailId, setDetailId] = useState<string | null>(null);

  // ── 我的订单 ─────────────────────────────
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);

  // ── 轻提示 toast ─────────────────────────
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const fetchProducts = useCallback(
    async (p = 1, replace = true) => {
      const seq = nextSeq();
      if (replace) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setShopError('');
      try {
        const res = await portalApi.listProducts({
          page: p,
          page_size: PAGE_SIZE,
          keyword: debouncedKeyword || undefined,
          category_id: categoryId || undefined,
          sort: sort || undefined,
        });
        if (!isCurrent(seq)) return;
        if (res.code === 0) {
          const list = res.data?.list ?? [];
          setProducts((prev) => {
            if (replace) return list;
            // 折叠/分页边界可能返回已在列表中的同款 → 追加时按 id 去重（防跨页重复卡片）
            const seen = new Set(prev.map((x) => x.id));
            return [...prev, ...list.filter((x) => !seen.has(x.id))];
          });
          setTotal(res.data?.total ?? list.length);
          setPage(p);
          // 本页不满 → 已到最后一页（折叠后 list 可能少于 PAGE_SIZE，重拉只会得到空页）
          setHasMore(list.length >= PAGE_SIZE);
        } else {
          setShopError(res.message || '商品加载失败，请重试');
        }
      } catch {
        if (isCurrent(seq)) setShopError('商品加载失败，请检查网络后重试');
      } finally {
        if (isCurrent(seq)) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedKeyword, categoryId, sort, nextSeq, isCurrent]
  );

  // 初始：鉴权 + 分类 + 第一页商品
  useEffect(() => {
    if (!portalStorage.getToken()) {
      navigate('/portal/login', { replace: true });
      return;
    }
    portalApi
      .listCategories()
      .then((res) => {
        if (res.code === 0) setCategories(res.data ?? []);
      })
      .catch(() => {
        // 分类加载失败不阻塞商品浏览
      });
  }, [navigate]);

  // 关键词 / 分类变化 → 回到第一页重新拉取
  useEffect(() => {
    fetchProducts(1, true);
  }, [fetchProducts]);

  // 窗口重新聚焦时（限 30s 一次、仅商城视图）重拉第一页：管理端改动库存/开关后即时生效
  useEffect(() => {
    const refreshOnFocus = () => {
      if (viewRef.current !== 'shop') return;
      const now = Date.now();
      if (now - lastFocusFetchRef.current < 30000) return;
      lastFocusFetchRef.current = now;
      fetchProducts(1, true);
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [fetchProducts]);

  const loadMoreProducts = () => {
    if (loadingMore || !hasMore) return;
    fetchProducts(page + 1, false);
  };

  const fetchOrders = useCallback(async (p = 1) => {
    if (p === 1) setOrdersLoading(true);
    setOrdersError('');
    try {
      const res = await portalApi.myOrders({ page: p, page_size: 20 });
      if (res.code === 0) {
        const list = res.data?.list ?? [];
        setOrders((prev) => (p === 1 ? list : [...prev, ...list]));
        setOrdersTotal(res.data?.total ?? list.length);
        setOrdersPage(p);
      } else {
        setOrdersError(res.message || '订单加载失败，请重试');
      }
    } catch {
      setOrdersError('订单加载失败，请检查网络后重试');
    } finally {
      setOrdersLoading(false);
      setLoadingMoreOrders(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'orders') fetchOrders(1);
  }, [view, fetchOrders]);

  const loadMoreOrders = () => {
    if (loadingMoreOrders || orders.length >= ordersTotal) return;
    setLoadingMoreOrders(true);
    fetchOrders(ordersPage + 1);
  };

  // ── 购物车操作 ───────────────────────────
  const handleAddToCart = (line: CartLine, qty: number) => {
    setCart(addToCart(customerId, line, qty));
    notify(`已加入购物车：${line.name}${line.spec ? `（${line.spec}）` : ''} ×${formatQty(qty)}`);
  };

  const handleQuickAdd = (p: PortalProduct) => {
    // 快速加购：未设起订量按 1；设了起订量按起订量（数量可小数由商品决定）
    const min = Number(p.min_order_qty) > 0 ? Number(p.min_order_qty) : 1;
    const qty = Math.max(1, min);
    handleAddToCart(
      {
        product_id: p.id,
        code: p.code,
        name: p.name,
        spec: p.spec || '',
        unit: p.unit || '',
        price: Number(p.sale_price || 0),
        image_url: p.image_url || '',
        qty,
        min_order_qty: min > 1 ? min : 0,
      },
      qty
    );
  };

  const handleUpdateQty = (productId: string, qty: number) => {
    setCart(updateCartQty(customerId, productId, qty));
  };

  const handleRemove = (productId: string) => {
    setCart(removeCartLine(customerId, productId));
  };

  const handleCheckout = async () => {
    if (checkoutBusyRef.current) return; // 双击防重
    if (cart.length === 0) return;
    checkoutBusyRef.current = true;
    setCheckoutBusy(true);
    setCheckoutError('');
    setCheckoutSuccess('');
    try {
      const lines = cart.map((l) => ({ product_id: l.product_id, product_name: l.name, qty: l.qty }));
      const res = await portalApi.createOrder(lines);
      if (res.code === 0) {
        clearCart(customerId);
        setCart([]);
        const amount = Number(res.data?.total_amount || 0);
        setCheckoutSuccess(
          `订单 ${res.data?.order_no || ''} 已提交，合计 ¥${format.currency(amount)}，客服将尽快与您确认`
        );
      } else {
        setCheckoutError(res.message || '下单失败，请稍后重试');
      }
    } catch (err: any) {
      setCheckoutError(err?.message || '下单失败，请检查网络后重试');
    } finally {
      checkoutBusyRef.current = false;
      setCheckoutBusy(false);
    }
  };

  const handleViewOrders = () => {
    setCheckoutSuccess('');
    setCartOpen(false);
    setView('orders');
    fetchOrders(1);
  };

  const openCart = () => {
    setCheckoutError('');
    setCheckoutSuccess('');
    setCartOpen(true);
  };

  const handleLogout = () => {
    // 主动退出：① 先取 token ② 清空本机当前客户购物车草稿（避免公用设备遗留/他人误提交）；
    // 会话超时 401 自动跳登录不在此路径，购物车保留（重登恢复）
    // ③ 清门户本地会话 ④ 带 Authorization 显式调服务端登出（token_version+1，复制出去的 token 立即失效）——
    // 先清本地再调用 = 请求无 token、服务端无法吊销（同主站登出约定，P2-10）
    const token = portalStorage.getToken();
    clearCart(customerId);
    portalStorage.clear();
    portalApi.logout(token).catch(() => undefined);
    navigate('/portal/login', { replace: true });
  };

  // 顶部导航 tab：桌面端居中显示在顶栏、移动端下移为第二行全宽（复用避免样式分叉）
  const viewTabs: { key: 'shop' | 'orders'; label: string; icon: typeof ShoppingBag }[] = [
    { key: 'shop', label: '商品选购', icon: ShoppingBag },
    { key: 'orders', label: '我的订单', icon: Receipt },
  ];

  const filteredEmpty = !loading && !shopError && products.length === 0;

  return (
    <div className="portal-shell min-h-screen bg-gray-50 overflow-x-clip">
      {/* ── 顶部导航 ───────────────────────── */}
      <header className="bg-white shadow-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-2 sm:gap-3">
          <button onClick={() => setView('shop')} className="flex items-center gap-2 shrink-0 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#ff4400] to-[#ff7a3c] flex items-center justify-center shadow shrink-0">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div className="text-left leading-tight min-w-0">
              <div className="font-bold text-gray-800 text-[15px] truncate">客户自助商城</div>
              <div className="text-[10px] text-gray-400 hidden sm:block">在线选品 · 自助下单</div>
            </div>
          </button>

          {/* 导航：md+ 居中显示在顶栏（移动端下移为第二行，见 header 底部） */}
          <nav className="hidden md:flex items-center gap-1 bg-gray-100 rounded-xl p-1 shrink-0">
            {viewTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  view === t.key ? 'bg-white text-[#ff4400] shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={openCart}
              className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-gray-600 hover:bg-orange-50 hover:text-[#ff4400] transition-colors"
              aria-label="购物车"
              title="购物车"
            >
              <ShoppingCart className="w-5 h-5" />
              <span className="hidden sm:inline text-sm">购物车</span>
              {cartCountNum > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff4400] text-white text-[10px] font-bold flex items-center justify-center">
                  {cartCountNum > 99 ? '99+' : formatQty(cartCountNum)}
                </span>
              )}
            </button>
            <span className="hidden md:inline text-sm text-gray-500 max-w-[120px] truncate">
              你好，{portalStorage.getCustomerName() || '客户'}
            </span>
            <button
              onClick={() => navigate('/login')}
              className="hidden md:inline text-xs text-gray-400 hover:text-gray-600 underline"
            >
              内部管理
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2.5 py-1.5 rounded-lg"
            >
              <LogOut className="w-3.5 h-3.5" /> 退出
            </button>
          </div>
        </div>

        {/* 移动端导航第二行：导航下移全宽均分，顶栏只留 品牌+购物车+退出，
            避免右侧操作（退出/购物车）在窄屏被挤出屏外、与下方内容错位 */}
        <nav className="md:hidden bg-gray-100 border-t border-gray-200">
          <div className="max-w-6xl mx-auto px-4 py-1.5 flex gap-1.5">
            {viewTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  view === t.key ? 'bg-white text-[#ff4400] shadow-sm' : 'text-gray-500 active:bg-gray-200'
                }`}
              >
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5">
        {/* ── 商城视图 ─────────────────────── */}
        {view === 'shop' && (
          <div className="space-y-4">
            {/* 欢迎横幅 + 搜索 */}
            <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#ff4400] via-[#ff5f1f] to-[#ff8a3c] text-white p-6 sm:p-8">
              <div className="relative z-10">
                <h1 className="text-xl sm:text-2xl font-bold">欢迎选购</h1>
                <p className="text-white/85 text-sm mt-1 mb-5">浏览商品 → 选择规格 → 加入购物车 → 一键提交订单</p>
                <div className="relative max-w-xl">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜索商品名称 / 货号 / 规格 / 条码"
                    className="w-full pl-11 pr-4 py-3 bg-white rounded-xl text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/70 shadow-lg"
                  />
                </div>
              </div>
            </section>

            {/* 分类筛选 */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              <button
                onClick={() => setCategoryId('')}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm border transition-colors ${
                  !categoryId
                    ? 'bg-[#ff4400] border-[#ff4400] text-white font-medium'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-[#ff8a3c] hover:text-[#ff4400]'
                }`}
              >
                全部
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(categoryId === c.id ? '' : c.id)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm border transition-colors ${
                    categoryId === c.id
                      ? 'bg-[#ff4400] border-[#ff4400] text-white font-medium'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-[#ff8a3c] hover:text-[#ff4400]'
                  }`}
                >
                  {c.name}
                  {c.product_count > 0 && <span className="ml-1 opacity-70 text-xs">({c.product_count})</span>}
                </button>
              ))}
            </div>

            {/* 排序（综合=名称升序 / 上架最新 / 销量优先 / 价格升降）；移动端与“共 N 件”同行，空间不够自动换行 */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-gray-500">共 {total} 件商品 · 同款多规格合并展示</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#ff8a3c]/40"
                aria-label="商品排序"
              >
                <option value="">综合排序</option>
                <option value="newest">最新上架</option>
                <option value="sales">销量优先</option>
                <option value="price_asc">价格从低到高</option>
                <option value="price_desc">价格从高到低</option>
              </select>
            </div>

            {/* 商品网格 */}
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="aspect-square bg-gray-100 animate-pulse" />
                    <div className="p-3 space-y-2">
                      <div className="h-3 bg-gray-100 animate-pulse rounded" />
                      <div className="h-3 bg-gray-100 animate-pulse rounded w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : shopError ? (
              <div className="text-center py-14">
                <div className="text-gray-500 mb-3">{shopError}</div>
                <button
                  onClick={() => fetchProducts(1, true)}
                  className="px-5 py-2 bg-[#ff4400] hover:bg-[#e63c00] text-white text-sm rounded-lg"
                >
                  重新加载
                </button>
              </div>
            ) : filteredEmpty ? (
              <div className="text-center py-16 text-gray-400">
                <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="mb-4">
                  {(categoryId || keyword) ? '没有找到匹配的商品，换个条件试试？' : '暂无可选购商品，请联系管理员上架'}
                </p>
                {(categoryId || keyword) && (
                  <button
                    onClick={() => {
                      setCategoryId('');
                      setKeyword('');
                    }}
                    className="px-5 py-2 border border-gray-200 bg-white text-gray-600 text-sm rounded-lg hover:text-[#ff4400] hover:border-[#ff8a3c]"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {products.map((p) => (
                    <ProductCard key={p.id} p={p} onOpen={setDetailId} onQuickAdd={handleQuickAdd} />
                  ))}
                </div>
                {hasMore && (
                  <div className="text-center pt-2">
                    <button
                      onClick={loadMoreProducts}
                      disabled={loadingMore}
                      className="px-6 py-2.5 bg-white border border-gray-200 text-gray-600 text-sm rounded-xl hover:border-[#ff8a3c] hover:text-[#ff4400] disabled:opacity-50 shadow-sm"
                    >
                      {loadingMore ? '加载中...' : `加载更多（${products.length}/${total}）`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 我的订单视图 ─────────────────── */}
        {view === 'orders' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">我的订单</h2>
              <button
                onClick={() => setView('shop')}
                className="flex items-center gap-1 text-sm text-[#ff4400] hover:text-[#e63c00]"
              >
                去选购 <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-4 py-3 text-left text-gray-500">订单号</th>
                    <th className="px-4 py-3 text-left text-gray-500">金额</th>
                    <th className="px-4 py-3 text-left text-gray-500">订单进度</th>
                    <th className="px-4 py-3 text-left text-gray-500">物流单号</th>
                    <th className="px-4 py-3 text-left text-gray-500">下单时间</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersLoading && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                        加载中...
                      </td>
                    </tr>
                  )}
                  {!ordersLoading && ordersError && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center">
                        <span className="text-gray-500">{ordersError}</span>{' '}
                        <button onClick={() => fetchOrders(1)} className="ml-2 text-[#ff4400] underline">
                          重新加载
                        </button>
                      </td>
                    </tr>
                  )}
                  {!ordersLoading && !ordersError && orders.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-14 text-center">
                        <div className="text-gray-300 mb-2">
                          <Package className="w-10 h-10 mx-auto" />
                        </div>
                        <div className="text-gray-400 mb-4">还没有订单，去挑选心仪的商品吧～</div>
                        <button
                          onClick={() => setView('shop')}
                          className="px-5 py-2 bg-[#ff4400] hover:bg-[#e63c00] text-white text-sm rounded-lg"
                        >
                          去选购
                        </button>
                      </td>
                    </tr>
                  )}
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="px-4 py-3 text-gray-700 font-medium whitespace-nowrap">{o.order_no}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        ¥{format.currency(o.total_amount)}
                      </td>
                      <td className="px-4 py-3">
                        <ProgressSteps progress={o.customer_progress} />
                      </td>
                      <td className="px-4 py-3">
                        {o.tracking_no ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 font-medium">
                            {o.tracking_no}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {o.created_at ? new Date(o.created_at).toLocaleString('zh-CN') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!ordersLoading && !ordersError && ordersTotal > 0 && orders.length < ordersTotal && (
                <div className="text-center py-3">
                  <button
                    onClick={loadMoreOrders}
                    disabled={loadingMoreOrders}
                    className="px-6 py-2 text-sm bg-white border border-gray-200 hover:border-[#ff8a3c] hover:text-[#ff4400] text-gray-600 rounded-lg disabled:opacity-50"
                  >
                    {loadingMoreOrders ? '加载中...' : `加载更多订单（${orders.length}/${ordersTotal}）`}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── 轻提示 ───────────────────────── */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[100] px-4 py-2.5 bg-gray-900/90 text-white text-sm rounded-xl shadow-xl max-w-[90vw]">
          {toast}
        </div>
      )}

      {/* ── 商品详情弹层 ─────────────────── */}
      <PortalProductDetail
        open={!!detailId}
        productId={detailId}
        onClose={() => setDetailId(null)}
        onAddToCart={handleAddToCart}
      />

      {/* ── 购物车抽屉 ─────────────────── */}
      <PortalCartDrawer
        open={cartOpen}
        lines={cart}
        submitting={checkoutBusy}
        success={checkoutSuccess}
        error={checkoutError}
        onClose={() => setCartOpen(false)}
        onUpdateQty={handleUpdateQty}
        onRemove={handleRemove}
        onCheckout={handleCheckout}
        onViewOrders={handleViewOrders}
      />
    </div>
  );
}
