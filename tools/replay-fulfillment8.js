#!/usr/bin/env node
// 第 8 项审计第八轮：同商品多行源订单的 delivered_qty 分配语义
// Y1 两行各 2 件：先发 2（应填满行1），再发 2（是否进行2？），再发 1（超额？剩余如何计算）
// Y2 两行 2+3：一次性发 5（是否按合计剩余放行）
// Y3 两行 2+3：一次性发 4（分配结果）
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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 80)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 220)}` : ""));
  return resp?.data;
}
function pick(list) { return (list?.list || list || [])[0]; }
function linesOf(d) { return d?.edges?.lines || d?.lines || []; }
function brief(ls) { return ls.map((l) => `L${l.line_no}:${l.delivered_qty}/${l.qty}`).join(" "); }

let CUST, PROD, UNIT;
async function shipAndCheck(tag, sod, qty) {
  const out = await call("POST", "/api/v1/stock-outs", {
    warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "sales",
    lines: [{ product_id: PROD.id, qty, unit_cost: 100, unit_id: UNIT?.id }], remark: `FULF8-${tag}`,
  });
  const outd = rec(`${tag}-出库${qty}`, out);
  if (!outd?.id) return;
  const cf = await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {});
  rec(`${tag}-confirm`, cf);
  const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
  rec(`${tag}-订单行`, { code: 0 }, brief(linesOf(g?.data)));
  return cf;
}

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
    lines: [{ product_id: PROD.id, qty: 80, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF8-STOCK",
  });
  if (si?.data?.id) rec("补库存", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- Y1：两行各 2，分三次发 2/2/1 ----------
  console.log("\n=== Y1：两行各 2 件，依次发 2 → 2 → 1 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id },
        { product_id: PROD.id, qty: 2, price: 90, unit_id: UNIT?.id },
      ], remark: "FULF8-Y1",
    });
    const sod = rec("Y1a-源订单", so);
    if (sod?.id) {
      rec("Y1b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      await shipAndCheck("Y1-1", sod, 2);
      await shipAndCheck("Y1-2", sod, 2);
      await shipAndCheck("Y1-3", sod, 1);
    }
  }

  // ---------- Y2：两行 2+3，一次发 5 ----------
  console.log("\n=== Y2：两行 2+3，一次发 5 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id },
        { product_id: PROD.id, qty: 3, price: 90, unit_id: UNIT?.id },
      ], remark: "FULF8-Y2",
    });
    const sod = rec("Y2a-源订单", so);
    if (sod?.id) {
      rec("Y2b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      await shipAndCheck("Y2", sod, 5);
    }
  }

  // ---------- Y3：两行 2+3，一次发 4 ----------
  console.log("\n=== Y3：两行 2+3，一次发 4 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id },
        { product_id: PROD.id, qty: 3, price: 90, unit_id: UNIT?.id },
      ], remark: "FULF8-Y3",
    });
    const sod = rec("Y3a-源订单", so);
    if (sod?.id) {
      rec("Y3b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      await shipAndCheck("Y3", sod, 4);
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-fulfillment-round8-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 同商品多行delivered分配语义取证", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round8-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
