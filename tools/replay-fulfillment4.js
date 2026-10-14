#!/usr/bin/env node
// 第 8 项审计第四轮：先补库存，再观察 deliverLine 分配与来源校验边界
// U1 同商品多行源订单的 delivered_qty 分配（fulfillment.go:55 matches!=1）
// U2 超发（deliverLine 剩余量校验）
// U3 source_no 不一致（source() 编号校验）
// U4 源订单为草稿（deliverLine 状态校验）
// U5 源订单仓库不一致（source() 仓库校验）
// U6 异单位出库的 delivered_qty（fulfillment.go:68 单位校验）
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

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  const cust = pick((await call("GET", "/api/v1/customers?page_size=5"))?.data);
  const prod = pick((await call("GET", "/api/v1/products?page_size=5"))?.data);
  const units = (await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [];
  const unit = units[0], unit2 = units[1] || units[0];
  console.log("前置:", cust?.name, "|", prod?.name, "\n");

  // ---------- U0 补库存 ----------
  console.log("=== U0：入库补库存 30 件 ===");
  {
    const c = await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WAREHOUSE, type: "purchase",
      lines: [{ product_id: prod.id, qty: 30, unit_cost: 50, unit_id: unit?.id }], remark: "FULF4-U0",
    });
    const d = rec("U0-入库30", c);
    if (d?.id) rec("U0-confirm", await call("POST", `/api/v1/stock-ins/${d.id}/confirm`, {}));
  }

  // ---------- U1 同商品多行源订单出库 1 件 ----------
  console.log("\n=== U1：同商品两行源订单出库 1 件 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id },
        { product_id: prod.id, qty: 3, price: 90, unit_id: unit?.id },
      ], remark: "FULF4-U1-SRC",
    });
    const sod = rec("U1a-源订单", so);
    if (sod?.id) {
      rec("U1b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, unit_cost: 100, unit_id: unit?.id }], remark: "FULF4-U1",
      });
      const outd = rec("U1c-出库1件", out);
      if (outd?.id) {
        rec("U1d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("U1e-源订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ line_no: l.line_no, qty: l.qty, delivered_qty: l.delivered_qty })));
        const og = await call("GET", `/api/v1/stock-outs/${outd.id}`);
        rec("U1f-出库单状态", { code: 0 }, { status: og?.data?.status, source_no: og?.data?.source_no });
      }
    }
  }

  // ---------- U2 超发 ----------
  console.log("\n=== U2：源订单 2 件，出库 5 件（超发） ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id }], remark: "FULF4-U2-SRC",
    });
    const sod = rec("U2a-源订单", so);
    if (sod?.id) {
      rec("U2b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 5, unit_cost: 100, unit_id: unit?.id }], remark: "FULF4-U2",
      });
      const outd = rec("U2c-超发出库单", out);
      if (outd?.id) {
        rec("U2d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("U2e-源订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
      }
    }
  }

  // ---------- U3 source_no 不一致 ----------
  console.log("\n=== U3：source_no 与源订单不符 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF4-U3-SRC",
    });
    const sod = rec("U3a-源订单", so);
    if (sod?.id) {
      rec("U3b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: "SO000000000000",
        lines: [{ product_id: prod.id, qty: 1, unit_cost: 100, unit_id: unit?.id }], remark: "FULF4-U3",
      });
      rec("U3c-错编号出库", out, out?.data ? { source_no: out.data.source_no } : undefined);
      if (out?.data?.id) {
        rec("U3d-confirm", await call("POST", `/api/v1/stock-outs/${out.data.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("U3e-源订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
      }
    }
  }

  // ---------- U4 源订单为草稿 ----------
  console.log("\n=== U4：源订单未确认（草稿） ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF4-U4-SRC",
    });
    const sod = rec("U4a-源订单(草稿)", so);
    if (sod?.id) {
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, unit_cost: 100, unit_id: unit?.id }], remark: "FULF4-U4",
      });
      const outd = rec("U4b-引草稿源单出库", out);
      if (outd?.id) rec("U4c-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
    }
  }

  // ---------- U5 源订单仓库不一致 ----------
  console.log("\n=== U5：源订单仓库与出库仓库不一致 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF4-U5-SRC",
    });
    const sod = rec("U5a-源订单(边库)", so);
    if (sod?.id) {
      rec("U5b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE2, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, unit_cost: 100, unit_id: unit?.id }], remark: "FULF4-U5",
      });
      const outd = rec("U5c-异仓出库", out);
      if (outd?.id) {
        rec("U5d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("U5e-源订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
      }
    }
  }

  // ---------- U6 异单位出库 ----------
  console.log("\n=== U6：异单位出库 1 件 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id }], remark: "FULF4-U6-SRC",
    });
    const sod = rec("U6a-源订单", so);
    if (sod?.id) {
      rec("U6b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, unit_cost: 100, unit_id: unit2?.id }], remark: "FULF4-U6",
      });
      const outd = rec("U6c-异单位出库", out);
      if (outd?.id) {
        rec("U6d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("U6e-源订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
      }
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-fulfillment-round4-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 deliverLine分配与来源校验边界取证", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round4-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
