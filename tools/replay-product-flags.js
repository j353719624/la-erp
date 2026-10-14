#!/usr/bin/env node
// 第 8 项审计第十轮：商品标志分支（plainProduct 守卫）取证
// P1 cost_method=fifo 商品出入库
// P2 is_batch=1 商品：带批次入库/出库、无批次出库
// P3 is_serial=1 商品：带序列号出入库
// P4 is_combo=1 商品入库
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

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  const unit = ((await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [])[0];
  const stamp = Date.now() % 100000;

  async function makeProduct(tag, extra) {
    const r = await call("POST", "/api/v1/products", {
      code: `P${stamp}${tag}`, name: `审计商品-${tag}`, unit_id: unit?.id,
      sale_price: 100, purchase_price: 60, ...extra,
    });
    return rec(`建商品-${tag}`, r, r?.data ? { cost_method: r.data.cost_method, is_batch: r.data.is_batch, is_serial: r.data.is_serial, is_combo: r.data.is_combo } : undefined);
  }
  async function stockIn(tag, productId, line) {
    const r = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: productId, qty: 5, unit_cost: 50, ...line }], remark: `PROD-${tag}` });
    const d = rec(`${tag}-入库`, r);
    if (d?.id) rec(`${tag}-入库confirm`, await call("POST", `/api/v1/stock-ins/${d.id}/confirm`, {}));
    return d;
  }
  async function stockOut(tag, productId, line) {
    const r = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, type: "other", lines: [{ product_id: productId, qty: 1, unit_cost: 100, ...line }], remark: `PROD-${tag}` });
    const d = rec(`${tag}-出库`, r);
    if (d?.id) rec(`${tag}-出库confirm`, await call("POST", `/api/v1/stock-outs/${d.id}/confirm`, {}));
    return d;
  }

  // ---------- P1 FIFO ----------
  console.log("=== P1：cost_method=fifo 商品 ===");
  {
    const p = await makeProduct("FIFO", { cost_method: "fifo" });
    if (p?.id) { await stockIn("P1", p.id, {}); await stockOut("P1", p.id, {}); }
  }

  // ---------- P2 批次 ----------
  console.log("\n=== P2：is_batch=1 商品 ===");
  {
    const p = await makeProduct("BATCH", { is_batch: true });
    if (p?.id) {
      await stockIn("P2a", p.id, { batch_no: "BATCH-P2-001" });
      await stockOut("P2b", p.id, { batch_no: "BATCH-P2-001" });
      await stockOut("P2c-无批次", p.id, {});
    }
  }

  // ---------- P3 序列号 ----------
  console.log("\n=== P3：is_serial=1 商品 ===");
  {
    const p = await makeProduct("SERIAL", { is_serial: true });
    if (p?.id) {
      await stockIn("P3a", p.id, { serial_nos: ["SN-P3-001", "SN-P3-002", "SN-P3-003", "SN-P3-004", "SN-P3-005"] });
      await stockOut("P3b", p.id, { serial_nos: ["SN-P3-001"] });
    }
  }

  // ---------- P4 组合 ----------
  console.log("\n=== P4：is_combo=1 商品 ===");
  {
    const p = await makeProduct("COMBO", { is_combo: true });
    if (p?.id) { await stockIn("P4", p.id, {}); }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-product-flags-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 商品标志分支取证（fifo/批次/序列号/组合）", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-product-flags-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
