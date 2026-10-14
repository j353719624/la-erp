#!/usr/bin/env node
// 批次 N：动作白名单对齐（11 处 default 守卫）
//
// 恢复端 11 个 *Action 函数的 `default: return ErrUnsupported` 分支，
// 静态分析显示 API 层已用 []string{...} 限定了动作白名单，default 不可达。
// 本批逐一**对照原版实际支持的动作集**，确认白名单既不漏也不多。
//
// NN1 expense-claims   恢复端: submit/approve/paid/reject/cancel
// NN2 toolings         恢复端: use/maintain/scrap
// NN3 stock-transfers  恢复端: dispatch/complete/cancel/delete
// NN4 assembly-orders  恢复端: confirm/cancel
// NN5 inventory-checks 恢复端: start/complete/cancel/delete
// NN6 rework-orders    恢复端: confirm/complete/cancel/delete
// NN7 subcontract-orders 恢复端: confirm/complete/cancel/delete
// NN8 work-orders      恢复端: confirm/approve/complete/cancel
// NN9 vouchers         恢复端: approve/post/cancel + HTTP DELETE
// NN10 attendance      恢复端: submit/approve/reject/cancel
// NN11 inventory-adjusts 恢复端: confirm/cancel/delete
// NN12 work-order-processes 恢复端: start/complete/revert
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
const code = (r) => (r?.code === 404 || r?.message === "路由不存在" ? "-" : String(r?.code ?? r?.status));

// probeActions 对一组候选动作探测：404=原版不存在，非 404=原版存在
async function probeActions(label, basePath, actions) {
  const row = { step: label, basePath, actions: {} };
  for (const a of actions) {
    const r = await call("POST", `${basePath}/${a}`, {});
    row.actions[a] = { http: r.status, code: r.code, message: String(r.message ?? "").slice(0, 60) };
  }
  const exists = Object.entries(row.actions).filter(([, v]) => v.http !== 404).map(([k]) => k);
  const absent = Object.entries(row.actions).filter(([, v]) => v.http === 404).map(([k]) => k);
  log.push(row);
  console.log(`  ${label}`);
  console.log(`    原版存在: ${exists.length ? exists.join(", ") : "(无)"}`);
  console.log(`    原版 404 : ${absent.length ? absent.join(", ") : "(无)"}`);
  return { exists, absent };
}

const D = "00000000-0000-0000-0000-000000000000";
const ALL = ["submit", "approve", "paid", "reject", "cancel", "use", "maintain", "scrap",
             "dispatch", "complete", "delete", "confirm", "start", "post", "revert", "approve"];

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  const P = ((await call("GET", "/api/v1/products?page_size=50"))?.data?.list || []).find((p) => p.is_serial !== true && p.is_batch !== true);

  const groups = [
    ["NN1 expense-claims", `/api/v1/expense-claims/${D}`],
    ["NN2 toolings", `/api/v1/toolings/${D}`],
    ["NN3 stock-transfers", `/api/v1/stock-transfers/${D}`],
    ["NN4 assemblies", `/api/v1/assemblies/${D}`],
    ["NN5 inventory-checks", `/api/v1/inventory-checks/${D}`],
    ["NN6 rework-orders", `/api/v1/rework-orders/${D}`],
    ["NN7 subcontract-orders", `/api/v1/subcontract-orders/${D}`],
    ["NN8 work-orders", `/api/v1/work-orders/${D}`],
    ["NN9 vouchers", `/api/v1/vouchers/${D}`],
    ["NN10 attendance", `/api/v1/attendance/${D}`],
    ["NN11 inventory-adjusts", `/api/v1/inventory-adjusts/${D}`],
    ["NN12 work-order-processes", `/api/v1/work-order-processes/${D}`],
  ];

  console.log("=== 各单据的动作路由面（原版 404 vs 存在）===\n");
  const summary = {};
  for (const [label, base] of groups) {
    summary[label] = await probeActions(label, base, ALL);
  }

  // 额外：HTTP DELETE 形态
  console.log("\n=== HTTP DELETE 形态 ===");
  for (const base of ["/api/v1/stock-transfers", "/api/v1/inventory-checks", "/api/v1/rework-orders",
                      "/api/v1/subcontract-orders", "/api/v1/inventory-adjusts", "/api/v1/vouchers",
                      "/api/v1/toolings", "/api/v1/expense-claims", "/api/v1/attendance"]) {
    const r = await call("DELETE", `${base}/${D}`, undefined);
    log.push({ step: "DELETE " + base, http: r.status, code: r.code, message: String(r.message ?? "") });
    console.log(`  DELETE ${base.padEnd(30)} http=${r.status} code=${r.code} ${String(r.message ?? "").slice(0, 50)}`);
  }

  // attendance 实际路由前缀
  console.log("\n=== 考勤实际路由前缀探测 ===");
  for (const p of ["attendance", "attendances", "attendance-records", "employee-attendance", "attendance-applications", "leave-applications"]) {
    const r = await call("GET", "/api/v1/" + p);
    const c = await call("POST", `/api/v1/${p}/${D}/approve`, {});
    console.log(`  ${p.padEnd(26)} GET=${r.status}/${r.code}  POST approve=${c.status}/${c.code}`);
  }

  void P; void WH;
  writeFileSync("evidence/backend-runtime/audit-batch-n-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次N：动作白名单对齐", summary, records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-n-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });