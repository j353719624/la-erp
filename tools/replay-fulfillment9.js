#!/usr/bin/env node
// 第 8 项审计第九轮：deliverLine 文案与状态机补证
// Z1 两行 2+3 一次发 6：多行超额文案（剩余是否按合计）
// Z2 向已取消订单发货：文案
// Z3 采购侧：草稿采购单收货 / 已关闭采购单收货 文案
// Z4 采购侧多行超额文案
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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 90)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 200)}` : ""));
  return resp?.data;
}
function pick(list) { return (list?.list || list || [])[0]; }
function linesOf(d) { return d?.edges?.lines || d?.lines || []; }
function brief(ls) { return ls.map((l) => `L${l.line_no}:${l.delivered_qty}/${l.qty}`).join(" "); }

let CUST, SUP, PROD, UNIT;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  CUST = pick((await call("GET", "/api/v1/customers?page_size=5"))?.data);
  SUP = pick((await call("GET", "/api/v1/suppliers?page_size=5"))?.data);
  PROD = pick((await call("GET", "/api/v1/products?page_size=5"))?.data);
  UNIT = ((await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [])[0];
  console.log("前置:", CUST?.name, "|", SUP?.name, "|", PROD?.name, "\n");

  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WAREHOUSE, type: "purchase",
    lines: [{ product_id: PROD.id, qty: 90, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF9-STOCK",
  });
  if (si?.data?.id) rec("补库存", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- Z1 多行超额 ----------
  console.log("\n=== Z1：两行 2+3，一次发 6 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id },
        { product_id: PROD.id, qty: 3, price: 90, unit_id: UNIT?.id },
      ], remark: "FULF9-Z1",
    });
    const sod = rec("Z1a-源订单", so);
    if (sod?.id) {
      rec("Z1b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "sales",
        lines: [{ product_id: PROD.id, qty: 6, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF9-Z1",
      });
      const outd = rec("Z1c-出库6", out);
      if (outd?.id) rec("Z1d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
    }
  }

  // ---------- Z2 向已取消订单发货 ----------
  console.log("\n=== Z2：向已取消的销售订单发货 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id }], remark: "FULF9-Z2",
    });
    const sod = rec("Z2a-源订单", so);
    if (sod?.id) {
      rec("Z2b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      rec("Z2c-cancel", await call("POST", `/api/v1/sales-orders/${sod.id}/cancel`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "sales",
        lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF9-Z2",
      });
      const outd = rec("Z2d-出库", out);
      if (outd?.id) rec("Z2e-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
    }
  }

  // ---------- Z3 采购侧状态文案 ----------
  console.log("\n=== Z3a：草稿采购单 + type=purchase 入库 ===");
  {
    const po = await call("POST", "/api/v1/purchase-orders", { supplier_id: SUP.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 2, price: 60, unit_id: UNIT?.id }], remark: "FULF9-Z3A" });
    const pod = rec("Z3a-采购订单(草稿)", po);
    if (pod?.id) {
      const si2 = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, source_id: pod.id, source_no: pod.order_no, type: "purchase", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 60, unit_id: UNIT?.id }], remark: "FULF9-Z3A" });
      const sid = rec("Z3a-入库", si2);
      if (sid?.id) rec("Z3a-confirm", await call("POST", `/api/v1/stock-ins/${sid.id}/confirm`, {}));
    }
  }
  console.log("\n=== Z3b：已关闭采购单 + type=purchase 入库 ===");
  {
    const po = await call("POST", "/api/v1/purchase-orders", { supplier_id: SUP.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 2, price: 60, unit_id: UNIT?.id }], remark: "FULF9-Z3B" });
    const pod = rec("Z3b-采购订单", po);
    if (pod?.id) {
      rec("Z3b-confirm", await call("POST", `/api/v1/purchase-orders/${pod.id}/confirm`, {}));
      const si2 = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, source_id: pod.id, source_no: pod.order_no, type: "purchase", lines: [{ product_id: PROD.id, qty: 2, unit_cost: 60, unit_id: UNIT?.id }], remark: "FULF9-Z3B" });
      if (si2?.data?.id) {
        rec("Z3b-全量入库confirm", await call("POST", `/api/v1/stock-ins/${si2.data.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/purchase-orders/${pod.id}`);
        rec("Z3b-订单状态", { code: 0 }, { status: g?.data?.status, lines: brief(linesOf(g?.data)) });
        const si3 = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, source_id: pod.id, source_no: pod.order_no, type: "purchase", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 60, unit_id: UNIT?.id }], remark: "FULF9-Z3B2" });
        const sid3 = rec("Z3b-再入库1", si3);
        if (sid3?.id) rec("Z3b-再入库confirm", await call("POST", `/api/v1/stock-ins/${sid3.id}/confirm`, {}));
      }
    }
  }

  // ---------- Z4 采购多行超额 ----------
  console.log("\n=== Z4：采购两行 2+3，一次收 6 ===");
  {
    const po = await call("POST", "/api/v1/purchase-orders", {
      supplier_id: SUP.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: PROD.id, qty: 2, price: 60, unit_id: UNIT?.id },
        { product_id: PROD.id, qty: 3, price: 60, unit_id: UNIT?.id },
      ], remark: "FULF9-Z4",
    });
    const pod = rec("Z4a-采购订单", po);
    if (pod?.id) {
      rec("Z4b-confirm", await call("POST", `/api/v1/purchase-orders/${pod.id}/confirm`, {}));
      const si2 = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, source_id: pod.id, source_no: pod.order_no, type: "purchase", lines: [{ product_id: PROD.id, qty: 6, unit_cost: 60, unit_id: UNIT?.id }], remark: "FULF9-Z4" });
      const sid = rec("Z4c-入库6", si2);
      if (sid?.id) rec("Z4d-confirm", await call("POST", `/api/v1/stock-ins/${sid.id}/confirm`, {}));
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-fulfillment-round9-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 deliverLine 文案与状态机补证（多行超额/取消态/采购侧）", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round9-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
