#!/usr/bin/env node
// 批次 OO · 通用资源「非法 ID」形态全量取证（2026-10-15）。
//
// ## 背景
// 恢复端通用 GET/PUT /api/v1/{res}/{id} 没有 UUID 格式守卫，非法 ID 直接漏到业务层：
//   GET  → 404「<Label>不存在」          原版 → 400「无效的ID格式」/「无效的商品ID」...
//   PUT  → 400「record not found」       原版 → 400「无效的ID格式」...（且恢复端泄漏 ORM 原文）
// 原版文案**逐资源不同**，故必须全量取证，不得统一成一套。
//
// ## 取证矩阵
//   42 个资源 × {GET, PUT, DELETE}
//   每条用互不相同的非法 ID，避免相互干扰。
//
// ## 铁律
//   只记录原版**实际返回**，不推测、不补齐。原版 500 不作语义证据。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-oo-badid.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const ACTUAL = process.env.OO_ACTUAL ?? "http://127.0.0.1:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

async function token(base, withCompany) {
  const payload = { username: "admin", password: PASS };
  if (withCompany) payload.company = "default";
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  return (await r.json())?.data?.access_token ?? "";
}
const oTk = await token(ORIG, true);
const rTk = await token(ACTUAL, false);
if (!oTk || !rTk) { console.error("登录失败"); process.exit(1); }

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json };
}

const RESOURCES = [
  "products", "customers", "suppliers", "units", "warehouses", "categories",
  "departments", "users", "roles", "permissions", "locations", "racks",
  "production-equipments", "equipment-maintenances", "toolings", "production-teams",
  "production-team-members", "product-documents", "assemblies", "employees",
  "labor-contracts", "attendance-requests", "recruitment-positions", "recruitment-candidates",
  "training-records", "perf-templates", "perf-assessments", "piecework-rates",
  "piecework-records", "approval-flows", "approval-records", "payrolls",
  "payment-plans", "tax-accruals", "crm-opportunities", "crm-activities",
  "expense-claims", "fixed-assets", "loan-orders", "consignments",
  "leads", "employee-changes", "accounting-periods",
];

const results = [];
const log = [];
const say = (s) => { log.push(s); console.log(s); };

let n = 0;
for (const res of RESOURCES) {
  for (const method of ["GET", "PUT", "DELETE"]) {
    n++;
    const badId = `not-a-uuid-${String(n).padStart(3, "0")}`;
    const path = `/api/v1/${res}/${badId}`;
    const body = method === "PUT" ? { name: "probe" } : undefined;
    const o = await call(ORIG, oTk, method, path, body);
    const r = await call(ACTUAL, rTk, method, path, body);
    const of = `${o.http}|${o.json?.code ?? "-"} | ${o.json?.message ?? ""}`;
    const rf = `${r.http}|${r.json?.code ?? "-"} | ${r.json?.message ?? ""}`;
    const same = of === rf;
    results.push({ res, method, path, orig: of, actual: rf, same });
    say(`${same ? "  " : "!!"} ${method.padEnd(6)} ${path}`);
    say(`     原版 : ${of}`);
    say(`     恢复端: ${rf}`);
  }
}

const diff = results.filter((x) => !x.same);
say(`\n==== 汇总 ====`);
say(`总计 ${results.length} 条，不一致 ${diff.length} 条`);

// 原版逐资源的 GET 文案（用于生成 Go 映射）
const byRes = {};
for (const x of results) {
  if (x.method !== "GET") continue;
  byRes[x.res] = x.orig;
}
say(`\n==== 原版 GET 非法 ID 文案（逐资源）====`);
for (const [k, v] of Object.entries(byRes)) say(`  ${k.padEnd(26)} ${v}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-badid-20261015.txt",
  log.join("\n") + "\n",
);
writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-badid-20261015.json",
  JSON.stringify(results, null, 2),
);
