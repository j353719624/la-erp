import { X, ShoppingCart, Minus, Plus, Trash2, Package, AlertCircle, CheckCircle2 } from 'lucide-react';
import { CartLine, cartCount, cartTotal, formatQty, roundQty } from '@/utils/portalCart';
import { format } from '@/utils/format';

interface Props {
  open: boolean;
  lines: CartLine[];
  submitting: boolean;
  /** 结算成功后的提示信息（含单号）；非空时展示成功态 */
  success: string;
  /** 结算失败提示（如库存不足/商品已下架） */
  error: string;
  onClose: () => void;
  onUpdateQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
  /** 结算成功后“查看我的订单” */
  onViewOrders: () => void;
}

export function PortalCartDrawer({
  open,
  lines,
  submitting,
  success,
  error,
  onClose,
  onUpdateQty,
  onRemove,
  onCheckout,
  onViewOrders,
}: Props) {
  if (!open) return null;

  const count = cartCount(lines);
  const total = cartTotal(lines);

  return (
    <div className="fixed inset-0 z-[90] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-md h-full bg-gray-50 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-[#ff4400]" />
            <h3 className="text-base font-semibold text-gray-800">购物车</h3>
            {count > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#ff4400] text-white text-[11px] font-medium">
                {formatQty(count)}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭购物车"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 结算成功提示 */}
        {success ? (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mb-4" />
            <h4 className="text-lg font-semibold text-gray-800 mb-2">下单成功</h4>
            <p className="text-sm text-gray-500 mb-6">{success}</p>
            <div className="flex gap-3">
              <button
                onClick={onViewOrders}
                className="px-5 py-2.5 bg-[#ff4400] hover:bg-[#e63c00] text-white text-sm font-semibold rounded-xl"
              >
                查看我的订单
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2.5 border border-gray-200 bg-white text-gray-600 text-sm rounded-xl"
              >
                继续逛逛
              </button>
            </div>
          </div>
        ) : lines.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
            <Package className="w-14 h-14 text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm mb-6">购物车还是空的，去挑选喜欢的商品吧～</p>
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-[#ff4400] hover:bg-[#e63c00] text-white text-sm font-semibold rounded-xl"
            >
              去逛逛
            </button>
          </div>
        ) : (
          <>
            {/* 商品列表 */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {lines.map((l) => {
                const min = Number(l.min_order_qty) > 0 ? Number(l.min_order_qty) : 0;
                // [2026-09-17 审查修复] 无起订量时 qty≤1 也不可再减：此前减到 0 会静默移除此行（无确认，
                // 客户易误触「商品消失、合计骤降」）；移除请走右侧垃圾桶按钮。
                const canMinus = min > 0 ? l.qty > min : l.qty > 1;
                return (
                  <div key={l.product_id} className="flex gap-3 bg-white rounded-xl border border-gray-100 p-3">
                    <div className="w-20 h-20 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden shrink-0">
                      {l.image_url ? (
                        <img src={l.image_url} alt={l.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                          <Package className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{l.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5 truncate">
                            {l.spec ? `规格：${l.spec}` : '标准款'}
                            {l.unit ? ` · ${l.unit}` : ''}
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            货号：{l.code}
                            {min > 0 ? ` · 起订 ${formatQty(min)}${l.unit || ''}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => onRemove(l.product_id)}
                          className="text-gray-300 hover:text-red-500 shrink-0 mt-0.5"
                          aria-label="移除商品"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="mt-auto flex items-center justify-between">
                        <span className="text-[#ff4400] font-semibold">¥{format.currency(l.price)}</span>
                        <div className="inline-flex items-center border border-gray-200 rounded-lg overflow-hidden">
                          <button
                            onClick={() => onUpdateQty(l.product_id, roundQty(l.qty - 1))}
                            disabled={!canMinus}
                            className="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                            aria-label="减少"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-12 text-center text-sm text-gray-700">{formatQty(l.qty)}</span>
                          <button
                            onClick={() => onUpdateQty(l.product_id, roundQty(l.qty + 1))}
                            className="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-50"
                            aria-label="增加"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部合计 + 结算 */}
            <div className="shrink-0 bg-white border-t border-gray-100 px-5 py-4">
              {error && (
                <div className="mb-3 flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-500">
                  共{' '}
                  <span className="text-gray-800 font-semibold">{formatQty(count)}</span>{' '}
                  {Number.isInteger(count) ? '件商品' : '件（数量合计，可含小数）'}
                </span>
                <div className="text-sm text-gray-500">
                  合计：
                  <span className="text-[#ff4400] text-xl font-bold ml-1">¥{format.currency(total)}</span>
                </div>
              </div>
              <button
                onClick={onCheckout}
                disabled={submitting}
                className="w-full py-3 bg-[#ff4400] hover:bg-[#e63c00] disabled:opacity-50 text-white font-semibold rounded-xl shadow transition-colors"
              >
                {submitting ? '正在提交订单...' : '去结算（提交订单）'}
              </button>
              <div className="mt-2 flex items-center justify-center gap-1 text-[11px] text-gray-400 text-center">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  提交后生成订单，由客服确认后发货；合计按加购时价格<b>估算</b>，
                  实际金额以结算页按客户价/数量阶梯重算为准
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
