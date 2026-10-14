#!/usr/bin/env node
// 第 8 项审计第十轮：补齐恢复端遗漏分支的取证
// CA1 stock-ins/{id}/cancel 路由是否存在（原版）——恢复端 business.go 跳过 stock cancel 路由
// CA2 stock-outs/{id}/cancel 路由是否存在
// CA3 草稿库存单取消后状态与再次取消
// CA4 库存单取消是否回滚已回写的 delivered_qty
// CA5 出库单取消后是否可再次 confirm（状态复位）
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 110)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 220)}` : ""));
  return resp?.data;
}
function pick(list) { return (list?.list || list || [])[0]; }
function linesOf(d) { return d?.edges?.lines || d?.lines || []; }
function brief(ls) { return linesOf(ls).map((l) => `L${l.line_no}:${l.delivered_qty}/${l.qty}`).join(" "); }

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

  // ---------- CA1/CA2 路由存在性 ----------
  console.log("=== CA1/CA2：库存单 cancel 路由是否存在 ===");
  const dummy = "00000000-0000-0000-0000-000000000000";
  rec("stock-ins/{假ID}/cancel", await call("POST", `/api/v1/stock-ins/${dummy}/cancel`, {}));
  rec("stock-outs/{假ID}/cancel", await call("POST", `/api/v1/stock-outs/${dummy}/cancel`, {}));
  rec("stock-ins/{假ID}/approve", await call("POST", `/api/v1/stock-ins/${dummy}/approve`, {}));
  rec("sales-orders/{假ID}/cancel", await call("POST", `/api/v1/sales-orders/${dummy}/cancel`, {}));

  // ---------- 准备库存 ----------
  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WAREHOUSE, type: "purchase",
    lines: [{ product_id: PROD.id, qty: 200, unit_cost: 50, unit_id: UNIT?.id }], remark: "FULF10-STOCK",
  });
  if (si?.data?.id) rec("补库存", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- CA3/CA4 入库单取消：已回写 delivered_qty 是否回滚 ----------
  console.log("\n=== CA3/CA4：草稿入库单取消 + delivered_qty 回滚 ===");
  {
    const po = rec("采购订单", await call("POST", "/api/v1/purchase-orders", {
      supplier_id: SUP.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: PROD.id, qty: 5, price: 60, unit_id: UNIT?.id }], remark: "FULF10-CA4",
    }));
    rec("确认采购单", await call("POST", `/api/v1/purchase-orders/${po.id}/confirm`, {}));
    const inDoc = rec("草稿入库单", await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WAREHOUSE, type: "purchase", source_id: po.id, source_no: po.order_no,
      lines: [{ product_id: PROD.id, qty: 2, unit_cost: 60, unit_id: UNIT?.id }], remark: "FULF10-CA4",
    }));
    const cancel1 = await call("POST", `/api/v1/stock-ins/${inDoc.id}/cancel`, {});
    rec("草稿入库单取消", cancel1, { status: cancel1?.data?.status });
    const again = await call("POST", `/api/v1/stock-ins/${inDoc.id}/cancel`, {});
    rec("重复取消", again, { status: again?.data?.status });
    const reGet = await call("GET", `/api/v1/stock-ins/${inDoc.id}`);
    rec("取消后详情", reGet, { status: reGet?.data?.status, remark: reGet?.data?.remark });
    const poAfter = await call("GET", `/api/v1/purchase-orders/${po.id}`);
    rec("采购单 delivered", poAfter, { lines: brief(poAfter) });
    // 已取消单能否再次 confirm
    const reconfirm = await call("POST", `/api/v1/stock-ins/${inDoc.id}/confirm`, {});
    rec("取消后 confirm", reconfirm, { status: reconfirm?.data?.status });
    const poAfter2 = await call("GET", `/api/v1/purchase-orders/${po.id}`);
    rec("再确认后采购单", poAfter2, { lines: brief(poAfter2) });
  }

  // ---------- CA5 出库单取消：草稿可取消、已确认不可、取消后能否恢复 ----------
  console.log("\n=== CA5：出库单取消规则 ===");
  {
    const so = rec("销售订单", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: PROD.id, qty: 4, price: 80, unit_id: UNIT?.id }], remark: "FULF10-CA5",
    }));
    rec("确认销售单", await call("POST", `/api/v1/sales-orders/${so.id}/confirm`, {}));
    const outDoc = rec("草稿出库单", await call("POST", "/api/v1/stock-outs", {
      warehouse_id: WAREHOUSE, type: "sales", source_id: so.id, source_no: so.order_no,
      lines: [{ product_id: PROD.id, qty: 1, unit_cost: 80, unit_id: UNIT?.id }], remark: "FULF10-CA5",
    }));
    const c1 = await call("POST", `/api/v1/stock-outs/${outDoc.id}/cancel`, {});
    rec("草稿出库单取消", c1, { status: c1?.data?.status });
    const c2 = await call("POST", `/api/v1/stock-outs/${outDoc.id}/cancel`, {});
    rec("重复取消", c2, { status: c2?.data?.status });
    const back = await call("POST", `/api/v1/stock-outs/${outDoc.id}/confirm`, {});
    rec("取消后 confirm", back, { status: back?.data?.status });
    const soAfter = await call("GET", `/api/v1/sales-orders/${so.id}`);
    rec("销售单 delivered", soAfter, { lines: brief(soAfter), status: soAfter?.data?.status });
    // 已确认出库单再取消
    const c3 = await call("POST", `/api/v1/stock-outs/${outDoc.id}/cancel`, {});
    rec("已确认出库单取消", c3, { status: c3?.data?.status });
    const c4 = await call("POST", `/api/v1/stock-outs/${outDoc.id}/cancel`, {});
    rec("再次取消", c4, { status: c4?.data?.status });
  }

  writeFileSync("evidence/backend-runtime/audit-fulfillment-round10-20261013.json",
    JSON.stringify({ round: 10, capturedAt: new Date().toISOString(), base: BASE, log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round10-20261013.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
