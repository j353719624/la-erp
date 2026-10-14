#!/usr/bin/env node
// 第 8 项审计第十一轮：库存单不存在时的动作返回形态（补 CA1/CA2 语义）
// CB1 stock-ins/{假ID}/confirm 返回什么
// CB2 stock-outs/{假ID}/confirm 返回什么
// CB3 stock-ins/{假ID}/cancel 返回 400「入库单不存在」——与 confirm 是否同文案
// CB4 stock-outs/{假ID}/PUT 与 DELETE 对不存在记录
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 110)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 200)}` : ""));
  return resp?.data;
}
const D = "00000000-0000-0000-0000-000000000000";
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  rec("stock-ins/confirm 不存在", await call("POST", `/api/v1/stock-ins/${D}/confirm`, {}));
  rec("stock-outs/confirm 不存在", await call("POST", `/api/v1/stock-outs/${D}/confirm`, {}));
  rec("stock-ins/cancel 不存在", await call("POST", `/api/v1/stock-ins/${D}/cancel`, {}));
  rec("stock-outs/cancel 不存在", await call("POST", `/api/v1/stock-outs/${D}/cancel`, {}));
  rec("sales-orders/confirm 不存在", await call("POST", `/api/v1/sales-orders/${D}/confirm`, {}));
  rec("purchase-orders/approve 不存在", await call("POST", `/api/v1/purchase-orders/${D}/approve`, {}));
  rec("stock-ins/DELETE 不存在", await call("DELETE", `/api/v1/stock-ins/${D}`, undefined));
  rec("stock-ins/PUT 不存在", await call("PUT", `/api/v1/stock-ins/${D}`, { warehouse_id: D, lines: [] }));
  writeFileSync("evidence/backend-runtime/audit-fulfillment-round11-20261013.json",
    JSON.stringify({ round: 11, capturedAt: new Date().toISOString(), base: BASE, log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-round11-20261013.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
