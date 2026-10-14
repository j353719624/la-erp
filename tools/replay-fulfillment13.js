#!/usr/bin/env node
// 第 8 项审计第十三轮：订单取消状态机（改用非序列号/非批次商品，确保备货成功）
// CD1 approved 订单取消 → 是否允许、是否释放锁定库存
// CD2 cancelled 订单再次取消
// CD3 closed 订单取消（对照 X6e）
// CD4 draft 订单取消
// CD5 confirmed（未审批）订单取消
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 110)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 240)}` : ""));
  return resp?.data;
}
function linesOf(d) { return d?.edges?.lines || d?.lines || []; }
function brief(d) { return linesOf(d).map((l) => `L${l.line_no}:${l.delivered_qty}/${l.qty}`).join(" "); }
async function findPlainProduct() {
  const list = (await call("GET", "/api/v1/products?page_size=200"))?.data?.list || [];
  for (const p of list) {
    if (p.is_serial !== true && p.is_batch !== true && p.is_combo !== true) return p;
  }
  throw new Error("没有普通商品");
}
let CUST, PROD, UNIT;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  CUST = ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0];
  PROD = await findPlainProduct();
  UNIT = ((await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [])[0];
  console.log("前置:", CUST?.name, "|", PROD?.name, "\n");

  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WAREHOUSE, type: "purchase",
    lines: [{ product_id: PROD.id, qty: 500, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF13-STOCK",
  });
  if (si?.data?.id) rec("补库存", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  const mkOrder = (remark, qty) => call("POST", "/api/v1/sales-orders", {
    customer_id: CUST.id, warehouse_id: WAREHOUSE,
    lines: [{ product_id: PROD.id, qty, price: 70, unit_id: UNIT?.id }], remark,
  });

  // ---------- CD4 draft 取消 ----------
  console.log("\n=== CD4：draft 订单取消 ===");
  {
    const so = rec("draft 订单", await mkOrder("FULF13-CD4", 3));
    rec("取消", await call("POST", `/api/v1/sales-orders/${so.id}/cancel`, {}));
  }
  // ---------- CD5 confirmed 取消 ----------
  console.log("\n=== CD5：confirmed（未审批）订单取消 ===");
  {
    const so = rec("订单", await mkOrder("FULF13-CD5", 3));
    rec("confirm", await call("POST", `/api/v1/sales-orders/${so.id}/confirm`, {}));
    const before = await call("GET", `/api/v1/sales-orders/${so.id}`);
    rec("取消前锁定", before, { status: before?.data?.status, stock_locked: before?.data?.stock_locked, lock_remark: before?.data?.lock_remark });
    const c = await call("POST", `/api/v1/sales-orders/${so.id}/cancel`, {});
    rec("confirmed 取消", c, { status: c?.data?.status, stock_locked: c?.data?.stock_locked, lock_remark: c?.data?.lock_remark });
    const after = await call("GET", `/api/v1/sales-orders/${so.id}`);
    rec("取消后", after, { status: after?.data?.status, stock_locked: after?.data?.stock_locked, lock_remark: after?.data?.lock_remark });
  }
  // ---------- CD1 approved 取消 ----------
  console.log("\n=== CD1：approved 订单取消 ===");
  {
    const so = rec("订单", await mkOrder("FULF13-CD1", 4));
    rec("confirm", await call("POST", `/api/v1/sales-orders/${so.id}/confirm`, {}));
    const ap = rec("approve", await call("POST", `/api/v1/sales-orders/${so.id}/approve`, {}));
    rec("approve 后锁定", ap, { status: ap?.status, stock_locked: ap?.stock_locked, lock_remark: ap?.lock_remark });
    const c = await call("POST", `/api/v1/sales-orders/${so.id}/cancel`, {});
    rec("approved 取消", c, { status: c?.data?.status, stock_locked: c?.data?.stock_locked, lock_remark: c?.data?.lock_remark });
    const after = await call("GET", `/api/v1/sales-orders/${so.id}`);
    rec("取消后订单", after, { status: after?.data?.status, stock_locked: after?.data?.stock_locked, lock_remark: after?.data?.lock_remark, lines: brief(after) });
    const bal = ((await call("GET", "/api/v1/inventory-balances?page_size=200"))?.data?.list || []).find((b) => b.product_id === PROD.id);
    rec("库存余额", undefined, { qty_available: bal?.qty_available, qty_locked: bal?.qty_locked });
    rec("cancelled 再取消", await call("POST", `/api/v1/sales-orders/${so.id}/cancel`, {}));
  }
  // ---------- CD3 closed 取消 ----------
  console.log("\n=== CD3：closed 订单取消（对照 X6e） ===");
  {
    const so = rec("订单", await mkOrder("FULF13-CD3", 1));
    rec("confirm", await call("POST", `/api/v1/sales-orders/${so.id}/confirm`, {}));
    rec("approve", await call("POST", `/api/v1/sales-orders/${so.id}/approve`, {}));
    const out = rec("出库", await call("POST", "/api/v1/stock-outs", {
      warehouse_id: WAREHOUSE, type: "sales", source_id: so.id, source_no: so.order_no,
      lines: [{ product_id: PROD.id, qty: 1, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF13-CD3",
    }));
    rec("出库 confirm", await call("POST", `/api/v1/stock-outs/${out.id}/confirm`, {}));
    const soAfter = await call("GET", `/api/v1/sales-orders/${so.id}`);
    rec("订单状态", soAfter, { status: soAfter?.data?.status, lines: brief(soAfter) });
    rec("closed 取消", await call("POST", `/api/v1/sales-orders/${so.id}/cancel`, {}));
    const fin = await call("GET", `/api/v1/sales-orders/${so.id}`);
    rec("取消后状态", fin, { status: fin?.data?.status, lines: brief(fin) });
  }

  writeFileSync("evidence/backend-runtime/audit-fulfillment-round13-20261013.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "订单取消状态机（草稿/已确认/已审批/已关闭）", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round13-20261013.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
