#!/usr/bin/env node
// 第 8 项审计第五轮：带 type=sales 重测 deliverLine 全部分支（前轮未传 type 导致结论混淆）
// V1 同商品多行源订单的分配（fulfillment.go:55 matches!=1）
// V2 超发（deliverLine 剩余量校验）
// V3 source_no 不一致（source() 编号校验）
// V4 源订单草稿（deliverLine 状态校验）
// V5 仓库不一致（source() 仓库校验）
// V6 单位不一致（fulfillment.go:68）
// V7 type=other + source 是否也回写
// V8 采购侧对称性：purchase order + stock-in type=purchase
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad"; // 边库
const WAREHOUSE2 = "477cf8fd-7940-4ff4-b484-6a21de2535d5"; // 默认仓库
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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 76)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 240)}` : ""));
  return resp?.data;
}
function pick(list) { return (list?.list || list || [])[0]; }
function linesOf(d) { return d?.edges?.lines || d?.lines || []; }

// 建源订单（可选重复行）并确认，返回订单对象
async function makeSourceOrder(tag, lines, wh = WAREHOUSE) {
  const so = await call("POST", "/api/v1/sales-orders", { customer_id: CUST.id, warehouse_id: wh, lines, remark: `FULF5-${tag}-SRC` });
  const sod = rec(`${tag}a-源订单`, so);
  if (!sod?.id) return null;
  rec(`${tag}b-confirm`, await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
  return sod;
}
async function tryOut(tag, sod, outBody) {
  const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, ...outBody });
  const outd = rec(`${tag}c-出库`, out);
  if (!outd?.id) return;
  rec(`${tag}d-confirm`, await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
  const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
  rec(`${tag}e-源订单行delivered`, { code: 0 }, linesOf(g?.data).map((l) => ({ line_no: l.line_no, qty: l.qty, delivered_qty: l.delivered_qty })));
}

let CUST, PROD, UNIT, UNIT2;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  CUST = pick((await call("GET", "/api/v1/customers?page_size=5"))?.data);
  PROD = pick((await call("GET", "/api/v1/products?page_size=5"))?.data);
  const units = (await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [];
  UNIT = units[0]; UNIT2 = units[1] || units[0];
  console.log("前置:", CUST?.name, "|", PROD?.name, "\n");

  // 补库存，保证后续 confirm 不被库存不足干扰
  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WAREHOUSE, type: "purchase",
    lines: [{ product_id: PROD.id, qty: 40, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF5-STOCK",
  });
  if (si?.data?.id) rec("补库存", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- V1 同商品两行 ----------
  console.log("\n=== V1：同商品两行源订单，type=sales 出库 1 件 ===");
  {
    const sod = await makeSourceOrder("V1", [
      { product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id },
      { product_id: PROD.id, qty: 3, price: 90, unit_id: UNIT?.id },
    ]);
    if (sod) await tryOut("V1", sod, { type: "sales", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }] });
  }

  // ---------- V2 超发 ----------
  console.log("\n=== V2：源订单 2 件，type=sales 出库 5 件 ===");
  {
    const sod = await makeSourceOrder("V2", [{ product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id }]);
    if (sod) await tryOut("V2", sod, { type: "sales", lines: [{ product_id: PROD.id, qty: 5, unit_cost: 100, unit_id: UNIT?.id }] });
  }

  // ---------- V3 source_no 不一致 ----------
  console.log("\n=== V3：type=sales 出库但 source_no 错误 ===");
  {
    const sod = await makeSourceOrder("V3", [{ product_id: PROD.id, qty: 1, price: 100, unit_id: UNIT?.id }]);
    if (sod) await tryOut("V3", sod, { type: "sales", source_no: "SO000000000000", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }] });
  }

  // ---------- V4 源订单草稿 ----------
  console.log("\n=== V4：源订单保持草稿，type=sales 出库 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", { customer_id: CUST.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 1, price: 100, unit_id: UNIT?.id }], remark: "FULF5-V4-SRC" });
    const sod = rec("V4a-源订单(草稿)", so);
    if (sod?.id) await tryOut("V4", sod, { type: "sales", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }] });
  }

  // ---------- V5 仓库不一致 ----------
  console.log("\n=== V5：type=sales 出库到另一仓库 ===");
  {
    const sod = await makeSourceOrder("V5", [{ product_id: PROD.id, qty: 1, price: 100, unit_id: UNIT?.id }]);
    if (sod) {
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE2, source_id: sod.id, source_no: sod.order_no, type: "sales", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF5-V5" });
      const outd = rec("V5c-异仓出库", out);
      if (outd?.id) {
        rec("V5d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("V5e-源订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
      }
    }
  }

  // ---------- V6 单位不一致 ----------
  console.log("\n=== V6：type=sales 出库但单位不一致 ===");
  {
    const sod = await makeSourceOrder("V6", [{ product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id }]);
    if (sod) await tryOut("V6", sod, { type: "sales", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT2?.id }] });
  }

  // ---------- V7 type=other + source ----------
  console.log("\n=== V7：type=other 出库带 source ===");
  {
    const sod = await makeSourceOrder("V7", [{ product_id: PROD.id, qty: 1, price: 100, unit_id: UNIT?.id }]);
    if (sod) await tryOut("V7", sod, { type: "other", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }] });
  }

  // ---------- V8 采购侧对称 ----------
  console.log("\n=== V8：采购订单 + type=purchase 入库 ===");
  {
    const sup = pick((await call("GET", "/api/v1/suppliers?page_size=5"))?.data);
    const po = await call("POST", "/api/v1/purchase-orders", { supplier_id: sup.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 3, price: 60, unit_id: UNIT?.id }], remark: "FULF5-V8-SRC" });
    const pod = rec("V8a-采购订单", po);
    if (pod?.id) {
      rec("V8b-confirm", await call("POST", `/api/v1/purchase-orders/${pod.id}/confirm`, {}));
      const si2 = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, source_id: pod.id, source_no: pod.order_no, type: "purchase", lines: [{ product_id: PROD.id, qty: 2, unit_cost: 60, unit_id: UNIT?.id }], remark: "FULF5-V8" });
      const sid = rec("V8c-引采购单入库", si2);
      if (sid?.id) {
        rec("V8d-confirm", await call("POST", `/api/v1/stock-ins/${sid.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/purchase-orders/${pod.id}`);
        rec("V8e-采购订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
      }
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-fulfillment-round5-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 带type=sales重测deliverLine全部分支", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round5-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
