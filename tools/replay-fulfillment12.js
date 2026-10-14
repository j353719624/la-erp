#!/usr/bin/env node
// 第 8 项审计第十二轮：订单取消状态机与库存单缺失记录的返回形态
// CC1 approved 订单取消（第二次取证，确认 W6 结论）
// CC2 已 cancelled 订单再次取消
// CC3 closed 订单取消（对照 X6e）
// CC4 取消 approved 订单后是否释放锁定库存（stock_locked / lock_remark）
// CC5 库存单不存在时 confirm/cancel 的 http 状态与文案（对照恢复端 404「记录不存在」）
// CC6 部分发货后订单状态为 approved 时再次发货是否仍允许
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
const log = [];
let TOKEN = "";
async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  try { return { status: r.status, ...(await r.json()) }; } catch { return { status: r.status }; }
}
function rec(step, resp, extra) {
  log.push({ step, code: resp?.code, message: resp?.message ?? "", status: resp?.status, ...(extra ? { detail: extra } : {}) });
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 110)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 220)}` : ""));
  return resp?.data;
}
function pick(list) { return (list?.list || list || [])[0]; }
function linesOf(d) { return d?.edges?.lines || d?.lines || []; }
function brief(d) { return linesOf(d).map((l) => `L${l.line_no}:${l.delivered_qty}/${l.qty}`).join(" "); }

let CUST, PROD, UNIT;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  CUST = pick((await call("GET", "/api/v1/customers?page_size=5"))?.data);
  PROD = pick((await call("GET", "/api/v1/products?page_size=5"))?.data);
  UNIT = ((await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [])[0];
  console.log("前置:", CUST?.name, "|", PROD?.name, "\n");

  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WAREHOUSE, type: "purchase",
    lines: [{ product_id: PROD.id, qty: 300, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF12-STOCK",
  });
  if (si?.data?.id) rec("补库存", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- CC1 approved 取消 ----------
  console.log("\n=== CC1：approved 订单取消 ===");
  let approvedOrder;
  {
    const so = rec("源订单", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: PROD.id, qty: 5, price: 70, unit_id: UNIT?.id }], remark: "FULF12-CC1",
    }));
    rec("confirm", await call("POST", `/api/v1/sales-orders/${so.id}/confirm`, {}));
    const locked = rec("approve", await call("POST", `/api/v1/sales-orders/${so.id}/approve`, {}));
    rec("锁定状态", locked, { stock_locked: locked?.stock_locked, lock_remark: locked?.lock_remark });
    const c1 = await call("POST", `/api/v1/sales-orders/${so.id}/cancel`, {});
    rec("approved 取消", c1, { status: c1?.data?.status, stock_locked: c1?.data?.stock_locked, lock_remark: c1?.data?.lock_remark });
    const after = await call("GET", `/api/v1/sales-orders/${so.id}`);
    rec("取消后订单", after, { status: after?.data?.status, stock_locked: after?.data?.stock_locked, lock_remark: after?.data?.lock_remark, lines: brief(after) });
    // CC2 再次取消
    const c2 = await call("POST", `/api/v1/sales-orders/${so.id}/cancel`, {});
    rec("cancelled 再取消", c2, { status: c2?.data?.status });
    const bal = pick((await call("GET", "/api/v1/inventory-balances?page_size=200"))?.data?.list);
    rec("库存余额", undefined, { qty_available: bal?.qty_available, qty_locked: bal?.qty_locked });
    approvedOrder = so;
  }

  // ---------- CC3 closed 取消 ----------
  console.log("\n=== CC3：closed 订单取消（对照） ===");
  {
    const so = rec("源订单", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: PROD.id, qty: 1, price: 70, unit_id: UNIT?.id }], remark: "FULF12-CC3",
    }));
    rec("confirm", await call("POST", `/api/v1/sales-orders/${so.id}/confirm`, {}));
    rec("approve", await call("POST", `/api/v1/sales-orders/${so.id}/approve`, {}));
    const out = rec("出库", await call("POST", "/api/v1/stock-outs", {
      warehouse_id: WAREHOUSE, type: "sales", source_id: so.id, source_no: so.order_no,
      lines: [{ product_id: PROD.id, qty: 1, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF12-CC3",
    }));
    rec("confirm", await call("POST", `/api/v1/stock-outs/${out.id}/confirm`, {}));
    const soAfter = await call("GET", `/api/v1/sales-orders/${so.id}`);
    rec("订单状态", soAfter, { status: soAfter?.data?.status });
    rec("closed 取消", await call("POST", `/api/v1/sales-orders/${so.id}/cancel`, {}));
  }

  // ---------- CC5 库存单缺失记录 ----------
  console.log("\n=== CC5：库存单不存在时的动作返回 ===");
  const D = "00000000-0000-0000-0000-000000000000";
  rec("stock-ins/confirm 不存在", await call("POST", `/api/v1/stock-ins/${D}/confirm`, {}));
  rec("stock-ins/cancel 不存在", await call("POST", `/api/v1/stock-ins/${D}/cancel`, {}));
  rec("stock-outs/confirm 不存在", await call("POST", `/api/v1/stock-outs/${D}/confirm`, {}));
  rec("stock-outs/cancel 不存在", await call("POST", `/api/v1/stock-outs/${D}/cancel`, {}));
  rec("sales-orders/confirm 不存在", await call("POST", `/api/v1/sales-orders/${D}/confirm`, {}));
  rec("sales-orders/cancel 不存在", await call("POST", `/api/v1/sales-orders/${D}/cancel`, {}));
  rec("stock-ins/DELETE 不存在", await call("DELETE", `/api/v1/stock-ins/${D}`, undefined));
  rec("stock-ins/PUT 不存在", await call("PUT", `/api/v1/stock-ins/${D}`, { warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 1, unit_cost: 1 }] }));

  writeFileSync("evidence/backend-runtime/audit-fulfillment-round12-20261013.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "订单取消状态机与库存单缺失记录返回形态", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round12-20261013.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
