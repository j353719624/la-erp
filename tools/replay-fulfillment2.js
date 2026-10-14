#!/usr/bin/env node
// 第 8 项审计第二轮：fulfillment/service 分支补充取证
//
// R1 赠品行 price=0（原版 B3 要求「赠品行单价必须为 0」，验证 0 价可通过）
// R2 USD 订单 confirm+approve（fulfillment.go:127 的 currency 部分）
// R3 stock-in/stock-out 的 type 变体（service.go:266）
// R4 源订单同商品多行/异单位出库的 delivered_qty 分配细节（fulfillment.go:55/68）
// R5 订单行折扣对 amount/total 的影响（对照恢复端行折扣实现）
// R6 销售订单带 sales_contract_id（rejectAdvanced 是否误拒）
// R7 入库单带 location_id（stock_ins 有该列，验证原版是否落库）
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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 72)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 200)}` : ""));
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
  const unit = pick((await call("GET", "/api/v1/units?page_size=5"))?.data);
  const unit2 = ((await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [])[1] || unit;
  const loc = pick((await call("GET", "/api/v1/locations?page_size=5"))?.data);
  const contract = pick((await call("GET", "/api/v1/sales-contracts?page_size=5"))?.data);
  console.log("前置:", cust?.name, "|", prod?.name, "| loc:", loc?.id ?? "(none)", "| contract:", contract?.id ?? "(none)", "\n");

  // ---------- R1 赠品行 price=0 ----------
  console.log("=== R1：赠品行 price=0 ===");
  {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id },
        { product_id: prod.id, qty: 1, price: 0, is_gift: true, unit_id: unit?.id },
      ], remark: "FULF2-R1",
    });
    const d = rec("R1-零价赠品", c);
    if (d) {
      const ls = linesOf(d);
      rec("R1-行明细", { code: 0 }, ls.map((l) => ({ qty: l.qty, price: l.price, is_gift: l.is_gift, amount: l.amount })));
      log[log.length - 1].detail = { total_amount: d.total_amount, total_qty: d.total_qty };
    }
  }

  // ---------- R2 USD 订单 confirm+approve ----------
  console.log("\n=== R2：USD 订单 confirm+approve ===");
  {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE, currency: "USD",
      lines: [{ product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id }], remark: "FULF2-R2",
    });
    const d = rec("R2-创建USD订单", c);
    if (d?.id) {
      rec("R2-confirm", await call("POST", `/api/v1/sales-orders/${d.id}/confirm`, {}));
      const ap = await call("POST", `/api/v1/sales-orders/${d.id}/approve`, {});
      rec("R2-approve", ap, ap?.data ? { status: ap.data.status, currency: ap.data.currency } : undefined);
    }
  }

  // ---------- R3 type 变体 ----------
  console.log("\n=== R3：单据 type 变体 ===");
  for (const [doc, t] of [["stock-ins", "sales"], ["stock-ins", "garbage"], ["stock-outs", "purchase"], ["stock-outs", "garbage"]]) {
    const c = await call("POST", `/api/v1/${doc}`, {
      warehouse_id: WAREHOUSE, type: t,
      lines: [{ product_id: prod.id, qty: 1, unit_cost: 50, unit_id: unit?.id }], remark: `FULF2-R3-${t}`,
    });
    rec(`R3-${doc}-type=${t}`, c, c?.data ? { type: c.data.type } : undefined);
  }

  // ---------- R4 delivered_qty 分配 ----------
  console.log("\n=== R4：源订单同商品多行的出库分配 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id },
        { product_id: prod.id, qty: 3, price: 90, unit_id: unit?.id },
      ], remark: "FULF2-R4-SRC",
    });
    const sod = rec("R4a-源订单", so);
    if (sod?.id) {
      await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {});
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 4, unit_cost: 100, unit_id: unit?.id }], remark: "FULF2-R4",
      });
      const outd = rec("R4b-出库4件", out);
      if (outd?.id) {
        rec("R4c-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        const ls = linesOf(g?.data);
        rec("R4d-源订单行delivered", { code: 0 }, ls.map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })));
      }
    }
  }
  console.log("\n=== R4e：异单位出库的 delivered 分配 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id }], remark: "FULF2-R4E-SRC",
    });
    const sod = rec("R4e1-源订单", so);
    if (sod?.id) {
      await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {});
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, unit_cost: 100, unit_id: unit2?.id }], remark: "FULF2-R4E",
      });
      const outd = rec("R4e2-异单位出库", out);
      if (outd?.id) {
        rec("R4e3-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        const ls = linesOf(g?.data);
        rec("R4e4-源订单行delivered", { code: 0 }, ls.map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty, unit_id: l.unit_id })));
      }
    }
  }

  // ---------- R5 行折扣 ----------
  console.log("\n=== R5：订单行折扣 ===");
  {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 2, price: 100, discount: 20, unit_id: unit?.id }], remark: "FULF2-R5",
    });
    const d = rec("R5-行折扣20", c);
    if (d) {
      const ls = linesOf(d);
      rec("R5-行明细", { code: 0 }, ls.map((l) => ({ qty: l.qty, price: l.price, discount: l.discount, amount: l.amount })));
      log[log.length - 1].detail = { total_amount: d.total_amount };
    }
  }

  // ---------- R6 sales_contract_id ----------
  console.log("\n=== R6：订单带 sales_contract_id ===");
  if (contract?.id) {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE, sales_contract_id: contract.id,
      lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF2-R6",
    });
    rec("R6-带合同订单", c, c?.data ? { sales_contract_id: c.data.sales_contract_id } : undefined);
  } else {
    console.log("  （无销售合同，跳过）");
  }

  // ---------- R7 location_id 落库 ----------
  console.log("\n=== R7：入库单带 location_id ===");
  if (loc?.id) {
    const c = await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WAREHOUSE, location_id: loc.id,
      lines: [{ product_id: prod.id, qty: 1, unit_cost: 50, unit_id: unit?.id }], remark: "FULF2-R7",
    });
    rec("R7-带location入库", c, c?.data ? { location_id: c.data.location_id } : undefined);
  } else {
    console.log("  （无库位，跳过）");
  }

  writeFileSync(
    "evidence/backend-runtime/audit-fulfillment-round2-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 fulfillment/service 分支补充取证（赠品/USD/type/分配/折扣/合同/库位）", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round2-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
