/**
 * 单据明细行的通用纯逻辑（W-01，2026-09-13）
 *
 * 页面明细里「数量以字符串保留小数中间态」（用户输入 "1." 这类中间态不能被吃掉），
 * 参与求和/乘积处必须 Number() 化——这两件事原先在 20+ 个表单页各抄一份，容易漏。
 * 这里收敛两个纯函数，供入库/出库等表单复用；门禁脚本直接跑断言。
 */

/** 明细行最小结构（StockInLine/StockOutLine 等满足） */
export interface DocLineLike {
  product_id: string;
  quantity?: unknown;
  amount?: unknown;
  cost_price?: unknown;
}

/** 批量添加项：商品 id + 数量（矩阵/扫码共用） */
export interface LineAdd {
  productId: string;
  qty: number;
}

/**
 * 序列号输入解析（2026-09-13 审查修复）：受控 input 的 value=join(', ')，若 onChange 里立即
 * `split().filter(Boolean)`，用户键入的逗号会被当空项剔除 → 显示回原值，**逗号在输入过程中消失**，
 * 后续字符并入前一个序列号（"SN1,SN2" 落成 "SN1SN2"）。
 * 解析规则：按中英文逗号切分并 trim；**保留恰好一个末尾空段**（用户刚敲下逗号的中间态），
 * 折叠中间空段；提交前用 `cleanSerialNos` 过滤空值。
 */
export function parseSerialNos(raw: string): string[] {
  const parts = String(raw ?? '').split(/[,，]/).map((s) => s.trim());
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    if (parts[i] === '' && !isLast) continue; // 中间空段（连续逗号）折叠
    out.push(parts[i]); // 末尾空段保留（输入中间态）
  }
  return out;
}

/** 提交/失焦时清理：去空、去首尾空白（解析中间态不得进入提交数据） */
export function cleanSerialNos(list: string[] | undefined | null): string[] {
  return (list || []).map((s) => String(s ?? '').trim()).filter(Boolean);
}

/** 明细合计（金额/数量），全部 Number() 化防字符串拼接 */
export function docLineTotals<L extends DocLineLike>(lines: L[]): { totalAmount: number; totalQty: number } {
  let totalAmount = 0;
  let totalQty = 0;
  for (const l of lines) {
    totalAmount += Number(l.amount) || 0;
    totalQty += Number(l.quantity) || 0;
  }
  return { totalAmount, totalQty };
}

/**
 * 把「批量添加」（规格矩阵 / 扫码）的商品并进明细：
 *  - 同商品已在明细 → **数量累加**（金额按该行现价重算），不产生重复行；
 *  - 否则按 makeLine 生成新行追加。
 * 合并分支的金额重算：默认按 `cost_price`（入库/出库等成本口径单据）；
 * **销售/采购订单等按行单价计价**、或**累加字段不是 `quantity`**（如盘点行的 `actual_qty`）的单据，
 * 传 `recompute(line, addQty)` —— addQty 是**本次增加的数量**，回调自己决定累加到哪个字段并重算金额。
 * 返回新数组（不改动入参），并给出 merged/added 供提示文案使用。
 */
export function mergeAddsIntoLines<L extends DocLineLike>(
  lines: L[],
  adds: LineAdd[],
  makeLine: (add: LineAdd) => L,
  recompute?: (line: L, addQty: number) => L,
): { lines: L[]; merged: number; added: number } {
  const out = lines.map((l) => ({ ...l }));
  let merged = 0;
  let added = 0;
  for (const add of adds) {
    const qty = Number(add.qty) || 0;
    if (!add.productId || qty <= 0) continue;
    const idx = out.findIndex((l) => l.product_id === add.productId);
    if (idx >= 0) {
      if (recompute) {
        out[idx] = recompute(out[idx], qty);
      } else {
        const next = (Number(out[idx].quantity) || 0) + qty;
        out[idx] = { ...out[idx], quantity: next, amount: next * (Number(out[idx].cost_price) || 0) };
      }
      merged += 1;
    } else {
      out.push(makeLine(add));
      added += 1;
    }
  }
  return { lines: out, merged, added };
}

/**
 * 订单行（销售/采购）合并重算：按行现价把**本次增加的数量**并进去，重算 qty/amount/tax_amount。
 * 与订单表单「通用重算」同口径：qty(主单位)=quantity×unit_rate；amount=max(0, qty×price−discount)；
 * tax_amount=amount×tax_rate%。订单行没有 cost_price——若走 mergeAddsIntoLines 默认分支金额会被清 0。
 */
export function recomputePricedLine<
  L extends DocLineLike & {
    qty?: unknown;
    unit_rate?: unknown;
    price?: unknown;
    discount?: unknown;
    tax_rate?: unknown;
    tax_amount?: unknown;
  },
>(line: L, addQty: number): L {
  const nextQty = (Number(line.quantity) || 0) + addQty;
  const qty = nextQty * (Number(line.unit_rate) || 1);
  const amount = Math.max(0, qty * (Number(line.price) || 0) - (Number(line.discount) || 0));
  const taxAmount = (amount * (Number(line.tax_rate) || 0)) / 100;
  return { ...line, quantity: nextQty, qty, amount, tax_amount: taxAmount };
}
