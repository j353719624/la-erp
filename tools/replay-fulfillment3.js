#!/usr/bin/env node
// 第 8 项审计第三轮：delivered_qty 分配、rack_id、合同外键、type+source 组合、采购单币种
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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 72)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 240)}` : ""));
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
  const sup = pick((await call("GET", "/api/v1/suppliers?page_size=5"))?.data);
  const prod = pick((await call("GET", "/api/v1/products?page_size=5"))?.data);
  const units = (await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [];
  const unit = units[0], unit2 = units[1] || units[0];
  const loc = pick((await call("GET", "/api/v1/locations?page_size=5"))?.data);
  const racks = (await call("GET", "/api/v1/racks?page_size=5"))?.data;
  const rack = pick(racks);
  console.log("前置:", cust?.name, "|", sup?.name, "| rack:", rack?.id ?? "(none)", "\n");

  // ---------- S1 同商品两行源订单，出库 1 件的分配 ----------
  console.log("=== S1：同商品两行源订单出库 1 件 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id },
        { product_id: prod.id, qty: 3, price: 90, unit_id: unit?.id },
      ], remark: "FULF3-S1-SRC",
    });
    const sod = rec("S1a-源订单", so);
    if (sod?.id) {
      rec("S1b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, unit_cost: 100, unit_id: unit?.id }], remark: "FULF3-S1",
      });
      const outd = rec("S1c-出库1件", out);
      if (outd?.id) {
        rec("S1d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("S1e-源订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ line_no: l.line_no, qty: l.qty, delivered_qty: l.delivered_qty })));
      }
    }
  }

  // ---------- S2 异单位出库 1 件 ----------
  console.log("\n=== S2：异单位出库 1 件 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id }], remark: "FULF3-S2-SRC",
    });
    const sod = rec("S2a-源订单", so);
    if (sod?.id) {
      rec("S2b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, unit_cost: 100, unit_id: unit2?.id }], remark: "FULF3-S2",
      });
      const outd = rec("S2c-异单位出库", out);
      if (outd?.id) {
        rec("S2d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        rec("S2e-源订单行delivered", { code: 0 }, linesOf(g?.data).map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
        const og = await call("GET", `/api/v1/stock-outs/${outd.id}`);
        rec("S2f-出库行单位", { code: 0 }, linesOf(og?.data).map((l) => ({ unit_id: l.unit_id, qty: l.qty })));
      }
    }
  }

  // ---------- S3 rack_id 落库 ----------
  console.log("\n=== S3：入库单带 rack_id ===");
  if (rack?.id) {
    const c = await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WAREHOUSE, rack_id: rack.id,
      lines: [{ product_id: prod.id, qty: 1, unit_cost: 50, unit_id: unit?.id }], remark: "FULF3-S3",
    });
    rec("S3-带rack入库", c, c?.data ? { rack_id: c.data.rack_id } : undefined);
  } else {
    console.log("  （无货架，跳过）");
  }

  // ---------- S4 合同外键落库 ----------
  console.log("\n=== S4：合同外键 ===");
  {
    const sc = await call("POST", "/api/v1/sales-contracts", {
      contract_no: "FULF3-SC-1013", customer_id: cust.id, contract_date: "2026-10-14T00:00:00+08:00", total_amount: 500,
    });
    const scd = rec("S4a-建销售合同", sc);
    if (scd?.id) {
      const c = await call("POST", "/api/v1/sales-orders", {
        customer_id: cust.id, warehouse_id: WAREHOUSE, sales_contract_id: scd.id,
        lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF3-S4",
      });
      rec("S4b-订单带合同", c, c?.data ? { sales_contract_id: c.data.sales_contract_id } : undefined);
    }
    const pc = await call("POST", "/api/v1/purchase-contracts", {
      contract_no: "FULF3-PC-1013", supplier_id: sup.id, contract_date: "2026-10-14T00:00:00+08:00", total_amount: 500,
    });
    const pcd = rec("S4c-建采购合同", pc);
    if (pcd?.id) {
      const c = await call("POST", "/api/v1/purchase-orders", {
        supplier_id: sup.id, warehouse_id: WAREHOUSE, contract_id: pcd.id,
        lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF3-S4P",
      });
      rec("S4d-采购单带合同", c, c?.data ? { contract_id: c.data.contract_id } : undefined);
    }
  }

  // ---------- S5 type=other + source 组合 ----------
  console.log("\n=== S5：type=other 且带 source 的出库 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF3-S5-SRC",
    });
    const sod = rec("S5a-源订单", so);
    if (sod?.id) {
      rec("S5b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no, type: "other",
        lines: [{ product_id: prod.id, qty: 1, unit_cost: 100, unit_id: unit?.id }], remark: "FULF3-S5",
      });
      rec("S5c-type=other+source出库", out, out?.data ? { type: out.data.type, source_no: out.data.source_no } : undefined);
    }
  }

  // ---------- S6 采购单 USD ----------
  console.log("\n=== S6：采购单 currency=USD ===");
  {
    const c = await call("POST", "/api/v1/purchase-orders", {
      supplier_id: sup.id, warehouse_id: WAREHOUSE, currency: "USD",
      lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF3-S6",
    });
    rec("S6-USD采购单", c, c?.data ? { currency: c.data.currency } : undefined);
  }

  writeFileSync(
    "evidence/backend-runtime/audit-fulfillment-round3-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 delivered分配/rack_id/合同外键/type+source/采购币种", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round3-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
