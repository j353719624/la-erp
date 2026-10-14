#!/usr/bin/env node
// 第 8 项审计第六轮：deliverLine 剩余边界与取消回滚
// W1 全量发货后订单状态（closeDelivered 对齐）
// W2 出库商品不在源订单中
// W3 已审批（approved）源订单能否发货
// W4 采购超收文案（incoming 对称）
// W5 取消已发货的出库单：delivered_qty 是否回滚（对照 service.go:632 ErrUnsupported）
// W6 取消已发货的销售订单（对照 service.go:632）
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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 76)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 240)}` : ""));
  return resp?.data;
}
function pick(list) { return (list?.list || list || [])[0]; }
function linesOf(d) { return d?.edges?.lines || d?.lines || []; }

let CUST, SUP, PROD, PROD2, UNIT;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  CUST = pick((await call("GET", "/api/v1/customers?page_size=5"))?.data);
  SUP = pick((await call("GET", "/api/v1/suppliers?page_size=5"))?.data);
  const prods = (await call("GET", "/api/v1/products?page_size=10"))?.data?.list || [];
  PROD = prods[0]; PROD2 = prods[1] || prods[0];
  UNIT = ((await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [])[0];
  console.log("前置:", CUST?.name, "|", PROD?.name, "|", PROD2?.name, "\n");

  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WAREHOUSE, type: "purchase",
    lines: [
      { product_id: PROD.id, qty: 50, unit_cost: 50, unit_id: UNIT?.id },
      { product_id: PROD2.id, qty: 50, unit_cost: 50, unit_id: UNIT?.id },
    ], remark: "FULF6-STOCK",
  });
  if (si?.data?.id) rec("补库存", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- W1 全量发货闭环 ----------
  console.log("\n=== W1：全量发货后订单状态 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", { customer_id: CUST.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id }], remark: "FULF6-W1" });
    const sod = rec("W1a-源订单", so);
    if (sod?.id) {
      rec("W1b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "sales", lines: [{ product_id: PROD.id, qty: 2, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF6-W1" });
      const outd = rec("W1c-全量出库", out);
      if (outd?.id) {
        rec("W1d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("W1e-订单状态", { code: 0 }, { status: g?.data?.status, customer_progress: g?.data?.customer_progress, shipped_at: g?.data?.shipped_at ? "set" : null });
        log[log.length - 1].detail.lines = linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty }));
      }
    }
  }

  // ---------- W2 订单外商品 ----------
  console.log("\n=== W2：type=sales 出库订单外商品 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", { customer_id: CUST.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 1, price: 100, unit_id: UNIT?.id }], remark: "FULF6-W2" });
    const sod = rec("W2a-源订单", so);
    if (sod?.id) {
      rec("W2b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "sales", lines: [{ product_id: PROD2.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF6-W2" });
      const outd = rec("W2c-订单外出库", out);
      if (outd?.id) rec("W2d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
    }
  }

  // ---------- W3 已审批订单发货 ----------
  console.log("\n=== W3：approved 源订单发货 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", { customer_id: CUST.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 1, price: 100, unit_id: UNIT?.id }], remark: "FULF6-W3" });
    const sod = rec("W3a-源订单", so);
    if (sod?.id) {
      rec("W3b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      rec("W3c-approve", await call("POST", `/api/v1/sales-orders/${sod.id}/approve`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "sales", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF6-W3" });
      const outd = rec("W3d-出库", out);
      if (outd?.id) {
        rec("W3e-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("W3f-delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
      }
    }
  }

  // ---------- W4 采购超收 ----------
  console.log("\n=== W4：采购订单 3 件，type=purchase 入库 5 件 ===");
  {
    const po = await call("POST", "/api/v1/purchase-orders", { supplier_id: SUP.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 3, price: 60, unit_id: UNIT?.id }], remark: "FULF6-W4" });
    const pod = rec("W4a-采购订单", po);
    if (pod?.id) {
      rec("W4b-confirm", await call("POST", `/api/v1/purchase-orders/${pod.id}/confirm`, {}));
      const si2 = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, source_id: pod.id, source_no: pod.order_no, type: "purchase", lines: [{ product_id: PROD.id, qty: 5, unit_cost: 60, unit_id: UNIT?.id }], remark: "FULF6-W4" });
      const sid = rec("W4c-超收入库", si2);
      if (sid?.id) rec("W4d-confirm", await call("POST", `/api/v1/stock-ins/${sid.id}/confirm`, {}));
    }
  }

  // ---------- W5 取消已发货出库单 ----------
  console.log("\n=== W5：取消已发货的出库单 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", { customer_id: CUST.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id }], remark: "FULF6-W5" });
    const sod = rec("W5a-源订单", so);
    if (sod?.id) {
      rec("W5b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "sales", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF6-W5" });
      const outd = rec("W5c-出库", out);
      if (outd?.id) {
        rec("W5d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        rec("W5e-取消出库单", await call("POST", `/api/v1/stock-outs/${outd.id}/cancel`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("W5f-源订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
        const og = await call("GET", `/api/v1/stock-outs/${outd.id}`);
        log[log.length - 1].detail.outStatus = og?.data?.status;
      }
    }
  }

  // ---------- W6 取消已发货销售订单 ----------
  console.log("\n=== W6：取消已发货的销售订单 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", { customer_id: CUST.id, warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id, qty: 2, price: 100, unit_id: UNIT?.id }], remark: "FULF6-W6" });
    const sod = rec("W6a-源订单", so);
    if (sod?.id) {
      rec("W6b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "sales", lines: [{ product_id: PROD.id, qty: 1, unit_cost: 100, unit_id: UNIT?.id }], remark: "FULF6-W6" });
      const outd = rec("W6c-出库", out);
      if (outd?.id) {
        rec("W6d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        rec("W6e-取消销售订单", await call("POST", `/api/v1/sales-orders/${sod.id}/cancel`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("W6f-订单状态", { code: 0 }, { status: g?.data?.status });
        log[log.length - 1].detail.lines = linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty }));
      }
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-fulfillment-round6-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 全量发货闭环/订单外商品/approved发货/超收/取消回滚", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round6-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
