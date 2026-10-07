/**
 * 客户门户购物车（浏览器 localStorage 持久化，按客户隔离）。
 *
 * 设计说明：
 * - 购物车是“下单前草稿”，保存在本机，客户刷新页面/重进商城仍能看到已添加的商品；
 * - 按客户 ID 分桶存储（key: la-erp-portal-cart:<customer_id>），同一设备不同客户登录互不可见；
 * - 结算仍走后端 /v1/portal/orders（价格以服务端客户价为准，购物车价格仅作展示合计）；
 * - 数量支持小数（部分商品按重量/体积，如 kg 0.5），统一保留最多 3 位小数避免浮点长尾。
 */
import { LS } from './localKeys';

export interface CartLine {
  product_id: string;
  code: string;
  name: string;
  /** 规格（可能是同款可选规格的区分值，可能为空串） */
  spec: string;
  unit: string;
  price: number;
  image_url: string;
  /** 数量（可小数，最多 3 位） */
  qty: number;
  /** 起订量（0=不限；后端按商品设置校验） */
  min_order_qty?: number;
}

const CART_PREFIX = `${LS.portalCartPrefix}:`;

/** 数量规范化：保留最多 3 位小数（0.1+0.2 不产生长尾），下限 0 */
export function roundQty(q: number): number {
  const v = Number(q);
  if (!isFinite(v) || v <= 0) return 0;
  return Math.round(v * 1000) / 1000;
}

/** 数量展示文本：整数不带小数点；小数去尾零（如 0.5 / 2.25） */
export function formatQty(q: number): string {
  const r = roundQty(q);
  if (r === 0) return '0';
  if (Number.isInteger(r)) return String(r);
  return r.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}

/** 客户购物车存储键；无客户 ID（未登录兜底）归入 guest */
const cartKey = (customerId: string | null): string => CART_PREFIX + (customerId || 'guest');

function readLines(customerId: string | null): CartLine[] {
  try {
    const raw = localStorage.getItem(cartKey(customerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l) => l && typeof l.product_id === 'string' && typeof l.qty === 'number' && l.qty > 0)
      .map((l) => ({ ...l, qty: roundQty(l.qty), min_order_qty: Number(l.min_order_qty) > 0 ? Number(l.min_order_qty) : 0 }));
  } catch {
    return [];
  }
}

function writeLines(customerId: string | null, lines: CartLine[]): void {
  try {
    localStorage.setItem(cartKey(customerId), JSON.stringify(lines));
  } catch {
    // 存储不可用（隐私模式等）：购物车仅本次会话内存生效，不阻塞下单流程
  }
}

/** 读取购物车（按客户隔离） */
export function loadCart(customerId: string | null): CartLine[] {
  return readLines(customerId);
}

/** 加入购物车：同商品合并数量；返回最新购物车 */
export function addToCart(customerId: string | null, line: CartLine, qty = 1): CartLine[] {
  const lines = readLines(customerId);
  const min = Number(line.min_order_qty) > 0 ? Number(line.min_order_qty) : 0;
  const q = roundQty(Math.max(min, qty)); // 不低于起订量
  const idx = lines.findIndex((l) => l.product_id === line.product_id);
  if (idx >= 0) {
    lines[idx] = { ...lines[idx], qty: roundQty(lines[idx].qty + q) };
  } else {
    lines.push({ ...line, qty: q });
  }
  writeLines(customerId, lines);
  return lines;
}

/** 修改某商品数量（qty<=0 视为移除；不低于起订量）；返回最新购物车 */
export function updateCartQty(customerId: string | null, productId: string, qty: number): CartLine[] {
  const lines = readLines(customerId);
  const next = lines
    .map((l) => {
      if (l.product_id !== productId) return l;
      const min = Number(l.min_order_qty) > 0 ? Number(l.min_order_qty) : 0;
      const q = roundQty(Math.max(min, qty)); // 低于起订量 → 回弹到起订量（删除走 remove）
      return { ...l, qty: q };
    })
    .filter((l) => l.qty > 0);
  writeLines(customerId, next);
  return next;
}

/** 移除某商品；返回最新购物车 */
export function removeCartLine(customerId: string | null, productId: string): CartLine[] {
  const lines = readLines(customerId).filter((l) => l.product_id !== productId);
  writeLines(customerId, lines);
  return lines;
}

/** 清空购物车 */
export function clearCart(customerId: string | null): void {
  try {
    localStorage.removeItem(cartKey(customerId));
  } catch {
    // ignore
  }
}

/** 购物车总数量（各商品数量之和，可小数） */
export function cartCount(lines: CartLine[]): number {
  return lines.reduce((a, l) => a + (l.qty || 0), 0);
}

/** 购物车金额合计（展示用；最终以服务端客户价为准） */
export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((a, l) => a + Number(l.price || 0) * (l.qty || 0), 0);
}
