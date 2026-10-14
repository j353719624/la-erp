#!/usr/bin/env node
// 第 8 项审计第十一轮：商品标志在订单路径与序列号细节
// Q1-Q6 fifo/batch/serial 商品在销售/采购订单行
// Q7 批次商品无批次 type=sales 出库
// Q8 序列号商品无序列号出库
// Q9 序列号重复入库（唯一性）
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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 80)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 200)}` : ""));
  return resp?.data;
}

let CUST, SUP, UNIT;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  CUST = ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0];
  SUP = ((await call("GET", "/api/v1/suppliers?page_size=5"))?.data?.list || [])[0];
  UNIT = ((await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [])[0];
  const stamp = Date.now() % 100000;

  async function makeProduct(tag, extra) {
    const r = await call("POST", "/api/v1/products", {
      code: `Q${stamp}${tag}`, name: `审计商品Q-${tag}`, unit_id: UNIT?.id, sale_price: 100, purchase_price: 60, ...extra,
    });
    return rec(`建商品-${tag}`, r);
  }
  async function orderLine(tag, doc, partyField, partyId, productId) {
    const r = await call("POST", `/api/v1/${doc}`, {
      [partyField]: partyId, warehouse_id: WAREHOUSE,
      lines: [{ product_id: productId, qty: 1, price: 100, unit_id: UNIT?.id }], remark: `PRODQ-${tag}`,
    });
    rec(`${tag}-${doc}`, r);
  }

  // ---------- Q1-Q6 订单路径 ----------
  console.log("=== Q1：fifo 商品进销售订单 ===");
  {
    const p = await makeProduct("FIFO", { cost_method: "fifo" });
    if (p?.id) await orderLine("Q1", "sales-orders", "customer_id", CUST.id, p.id);
  }
  console.log("\n=== Q2：fifo 商品进采购订单 ===");
  {
    const p = await makeProduct("FIFO2", { cost_method: "fifo" });
    if (p?.id) await orderLine("Q2", "purchase-orders", "supplier_id", SUP.id, p.id);
  }
  console.log("\n=== Q3：批次商品进销售订单 ===");
  {
    const p = await makeProduct("BATCH", { is_batch: true });
    if (p?.id) await orderLine("Q3", "sales-orders", "customer_id", CUST.id, p.id);
  }
  console.log("\n=== Q4：批次商品进采购订单 ===");
  {
    const p = await makeProduct("BATCH2", { is_batch: true });
    if (p?.id) await orderLine("Q4", "purchase-orders", "supplier_id", SUP.id, p.id);
  }
  console.log("\n=== Q5：序列号商品进销售订单 ===");
  {
    const p = await makeProduct("SERIAL", { is_serial: true });
    if (p?.id) await orderLine("Q5", "sales-orders", "customer_id", CUST.id, p.id);
  }
  console.log("\n=== Q6：序列号商品进采购订单 ===");
  {
    const p = await makeProduct("SERIAL2", { is_serial: true });
    if (p?.id) await orderLine("Q6", "purchase-orders", "supplier_id", SUP.id, p.id);
  }

  // ---------- Q7 批次商品无批次 type=sales 出库 ----------
  console.log("\n=== Q7：批次商品无批次 type=sales 出库 ===");
  {
    const p = await makeProduct("BATCH3", { is_batch: true });
    if (p?.id) {
      const si = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p.id, qty: 5, unit_cost: 50, batch_no: "BQ7" }], remark: "PRODQ-Q7" });
      if (si?.data?.id) rec("Q7-入库confirm", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, type: "sales", lines: [{ product_id: p.id, qty: 1, unit_cost: 100 }], remark: "PRODQ-Q7" });
      const outd = rec("Q7-无批次出库", out);
      if (outd?.id) rec("Q7-出库confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
    }
  }

  // ---------- Q8 序列号商品无序列号出库 ----------
  console.log("\n=== Q8：序列号商品无序列号出库 ===");
  {
    const p = await makeProduct("SERIAL3", { is_serial: true });
    if (p?.id) {
      const si = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p.id, qty: 3, unit_cost: 50, serial_nos: ["SQ8-1", "SQ8-2", "SQ8-3"] }], remark: "PRODQ-Q8" });
      if (si?.data?.id) rec("Q8-入库confirm", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, type: "other", lines: [{ product_id: p.id, qty: 1, unit_cost: 100 }], remark: "PRODQ-Q8" });
      const outd = rec("Q8-无序列号出库", out);
      if (outd?.id) rec("Q8-出库confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
    }
  }

  // ---------- Q9 序列号重复入库 ----------
  console.log("\n=== Q9：序列号重复入库 ===");
  {
    const p = await makeProduct("SERIAL4", { is_serial: true });
    if (p?.id) {
      const si = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p.id, qty: 2, unit_cost: 50, serial_nos: ["SQ9-1", "SQ9-2"] }], remark: "PRODQ-Q9A" });
      if (si?.data?.id) rec("Q9a-入库confirm", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));
      const si2 = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p.id, qty: 2, unit_cost: 50, serial_nos: ["SQ9-2", "SQ9-3"] }], remark: "PRODQ-Q9B" });
      const d2 = rec("Q9b-重复序列号入库", si2);
      if (d2?.id) rec("Q9b-入库confirm", await call("POST", `/api/v1/stock-ins/${d2.id}/confirm`, {}));
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-product-flags-round2-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 商品标志订单路径与序列号细节取证", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-product-flags-round2-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
