#!/usr/bin/env node
// 批次 J：通用单据 source 字段与库存单缺失记录
//
// JJ1 订单传 source_id + source_no（恢复端原先 return ErrUnsupported）
// JJ2 已确认订单编辑
// JJ3 库存单 GET 不存在记录的返回形态
// JJ4 退货单传 source 字段
// JJ5 订单 source 取值（manual/sales/purchase/garbage/空）
// JJ6 库存单传 source_id/source_no
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WH = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 100)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 220)}` : ""));
  return resp?.data;
}
async function findPlainProduct() {
  const list = (await call("GET", "/api/v1/products?page_size=200"))?.data?.list || [];
  for (const p of list) if (p.is_serial !== true && p.is_batch !== true && p.is_combo !== true) return p;
  throw new Error("没有普通商品");
}

let P, C;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  P = await findPlainProduct();
  C = ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0];
  console.log("前置:", P.name, "|", C?.name, "\n");

  // ---------- JJ1 ----------
  console.log("=== JJ1 订单 source_id / source_no ===");
  const so = rec("源订单", await call("POST", "/api/v1/sales-orders", {
    customer_id: C.id, warehouse_id: WH,
    lines: [{ product_id: P.id, qty: 2, price: 30 }],
  }));
  const linked = rec("订单带 source_id+source_no", await call("POST", "/api/v1/sales-orders", {
    customer_id: C.id, warehouse_id: WH, source_id: so?.id, source_no: so?.order_no,
    lines: [{ product_id: P.id, qty: 1, price: 30 }],
  }));
  if (linked?.id) {
    const g = await call("GET", `/api/v1/sales-orders/${linked.id}`);
    rec("回读", undefined, { source_id: g?.data?.source_id, source_no: g?.data?.source_no, source: g?.data?.source });
  }

  // ---------- JJ2 ----------
  console.log("\n=== JJ2 已确认订单编辑 ===");
  rec("confirm 源订单", await call("POST", `/api/v1/sales-orders/${so?.id}/confirm`, {}));
  rec("编辑已确认订单", await call("PUT", `/api/v1/sales-orders/${so?.id}`, {
    customer_id: C.id, warehouse_id: WH, lines: [{ product_id: P.id, qty: 99, price: 30 }],
  }));

  // ---------- JJ3 ----------
  console.log("\n=== JJ3 库存单不存在时的 GET ===");
  const D = "00000000-0000-0000-0000-000000000000";
  rec("GET stock-ins 不存在", await call("GET", `/api/v1/stock-ins/${D}`));
  rec("GET stock-outs 不存在", await call("GET", `/api/v1/stock-outs/${D}`));
  rec("GET sales-orders 不存在", await call("GET", `/api/v1/sales-orders/${D}`));

  // ---------- JJ4 ----------
  console.log("\n=== JJ4 退货单 source 字段 ===");
  rec("退货带 source_id", await call("POST", "/api/v1/sales-returns", {
    customer_id: C.id, warehouse_id: WH, source_id: so?.id, source_no: so?.order_no,
    lines: [{ product_id: P.id, qty: 1, price: 30 }],
  }));
  rec("退货带 sales_order_id", await call("POST", "/api/v1/sales-returns", {
    customer_id: C.id, warehouse_id: WH, sales_order_id: so?.id, sales_order_no: so?.order_no,
    lines: [{ product_id: P.id, qty: 1, price: 30 }],
  }));

  // ---------- JJ5 ----------
  console.log("\n=== JJ5 订单 source 取值 ===");
  for (const v of ["manual", "sales", "purchase", "garbage", ""]) {
    const r = rec(`source=${JSON.stringify(v)}`, await call("POST", "/api/v1/sales-orders", {
      customer_id: C.id, warehouse_id: WH, source: v,
      lines: [{ product_id: P.id, qty: 1, price: 10 }],
    }));
    if (r?.id) {
      const g = await call("GET", `/api/v1/sales-orders/${r.id}`);
      rec(`  回读 source=${JSON.stringify(v)}`, undefined, { persisted: g?.data?.source });
    }
  }

  // ---------- JJ6 ----------
  console.log("\n=== JJ6 库存单 source 字段 ===");
  rec("stock-in 带 source_id", await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WH, source_id: "00000000-0000-0000-0000-000000000001", source_no: "X",
    lines: [{ product_id: P.id, qty: 1, unit_cost: 1 }],
  }));
  const anyIn = rec("stock-in 带垃圾 source_id", await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WH, source_id: "not-a-uuid",
    lines: [{ product_id: P.id, qty: 1, unit_cost: 1 }],
  }));
  rec("回读", undefined, { source_id: anyIn?.source_id, source_no: anyIn?.source_no });

  writeFileSync("evidence/backend-runtime/audit-batch-j-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次J：通用单据 source 字段", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-j-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });