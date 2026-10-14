#!/usr/bin/env node
// 第 8 项审计第七轮：取消（cancel）边界取证
// X1 取消草稿出库单（对照 service.go:610 cancel && d.Stock → ErrUnsupported）
// X2 取消已确认但无发货记录的出库单（区分是「已确认不可取消」还是「已发货不可取消」）
// X3 取消已确认入库单（对称）
// X4 取消已收货的采购订单（对照 service.go:632，对称 W6）
// X5 取消草稿采购订单（基线）
// X6 取消已关闭（全量发货）的销售订单
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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 76)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 200)}` : ""));
  return resp?.data;
}
function pick(list) { return (list?.list || list || [])[0]; }
function linesOf(d) { return d?.edges?.lines || d?.lines || []; }

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
    lines: [{ product_id: PROD.id, qty: 60, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF7-STOCK",
  });
  if (si?.data?.id) rec("补库存", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- X1 取消草稿出库单 ----------
  console.log("\n=== X1：取消草稿出库单 ===");
  {
    const out = await call("POST", "/api/v1/stock-outs", {
      warehouse_id: WAREHOUSE, type: "other",
      lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF7-X1",
    });
    const outd = rec("X1a-建草稿出库", out);
    if (outd?.id) {
      rec("X1b-取消草稿出库", await call("POST", `/api/v1/stock-outs/${outd.id}/cancel`, {}));
      const g = await call("GET", `/api/v1/stock-outs/${outd.id}`);
      log[log.length - 1].detail = { status: g?.data?.status };
    }
  }

  // ---------- X2 取消已确认（无来源）出库单 ----------
  console.log("\n=== X2：取消已确认且无来源的出库单 ===");
  {
    const out = await call("POST", "/api/v1/stock-outs", {
      warehouse_id: WAREHOUSE, type: "other",
      lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF7-X2",
    });
    const outd = rec("X2a-建出库", out);
    if (outd?.id) {
      rec("X2b-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
      rec("X2c-取消已确认出库", await call("POST", `/api/v1/stock-outs/${outd.id}/cancel`, {}));
      const g = await call("GET", `/api/v1/stock-outs/${outd.id}`);
      log[log.length - 1].detail = { status: g?.data?.status };
    }
  }

  // ---------- X3 取消已确认入库单 ----------
  console.log("\n=== X3：取消已确认入库单 ===");
  {
    const si2 = await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WAREHOUSE, type: "purchase",
      lines: [{ product_id: PROD.id, qty: 1, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF7-X3",
    });
    const sid = rec("X3a-建入库", si2);
    if (sid?.id) {
      rec("X3b-confirm", await call("POST", `/api/v1/stock-ins/${sid.id}/confirm`, {}));
      rec("X3c-取消已确认入库", await call("POST", `/api/v1/stock-ins/${sid.id}/cancel`, {}));
      const g = await call("GET", `/api/v1/stock-ins/${sid.id}`);
      log[log.length - 1].detail = { status: g?.data?.status };
    }
  }

  // ---------- X4 取消已收货采购订单 ----------
  console.log("\n=== X4：取消已部分收货的采购订单 ===");
  {
    const po = await call("POST", "/api/v1/purchase-orders", { supplier_id: SUP.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 3, price: 60, unit_id: UNIT?.id }], remark: "FULF7-X4" });
    const pod = rec("X4a-采购订单", po);
    if (pod?.id) {
      rec("X4b-confirm", await call("POST", `/api/v1/purchase-orders/${pod.id}/confirm`, {}));
      const si2 = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, source_id: pod.id, source_no: pod.order_no, type: "purchase", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 60, unit_id: UNIT?.id }], remark: "FULF7-X4" });
      if (si2?.data?.id) rec("X4c-入库1件", await call("POST", `/api/v1/stock-ins/${si2.data.id}/confirm`, {}));
      rec("X4d-取消采购订单", await call("POST", `/api/v1/purchase-orders/${pod.id}/cancel`, {}));
      const g = await call("GET", `/api/v1/purchase-orders/${pod.id}`);
      rec("X4e-订单状态", { code: 0 }, { status: g?.data?.status });
      log[log.length - 1].detail.lines = linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty }));
    }
  }

  // ---------- X5 取消草稿采购订单 ----------
  console.log("\n=== X5：取消草稿采购订单（基线） ===");
  {
    const po = await call("POST", "/api/v1/purchase-orders", { supplier_id: SUP.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 1, price: 60, unit_id: UNIT?.id }], remark: "FULF7-X5" });
    const pod = rec("X5a-采购订单", po);
    if (pod?.id) rec("X5b-取消草稿", await call("POST", `/api/v1/purchase-orders/${pod.id}/cancel`, {}));
  }

  // ---------- X6 取消已关闭销售订单 ----------
  console.log("\n=== X6：取消已关闭（全量发货）销售订单 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", { customer_id: CUST.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id }], remark: "FULF7-X6" });
    const sod = rec("X6a-源订单", so);
    if (sod?.id) {
      rec("X6b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "sales", lines: [{ product_id: PROD.id, qty: 2, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF7-X6" });
      if (out?.data?.id) rec("X6c-全量出库confirm", await call("POST", `/api/v1/stock-outs/${out.data.id}/confirm`, {}));
      const g0 = await call("GET", `/api/v1/sales-orders/${sod.id}`);
      rec("X6d-发货后状态", { code: 0 }, { status: g0?.data?.status });
      rec("X6e-取消closed订单", await call("POST", `/api/v1/sales-orders/${sod.id}/cancel`, {}));
      const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
      rec("X6f-取消后状态", { code: 0 }, { status: g?.data?.status });
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-fulfillment-round7-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 取消边界取证（草稿/已确认/已发货/已关闭）", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round7-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
