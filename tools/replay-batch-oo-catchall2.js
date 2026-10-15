#!/usr/bin/env node
// 批次 OO · 兜底 / 非法 ID 形态的完整取证（2026-10-15）。
//
// ## 背景
// 抽查时发现两类差异，需逐条递增取证后才能动手（避免凭直觉排列）：
//   A. 未注册 /api/ 路径：原版 404「路由不存在」，恢复端 501「该业务接口尚未实现：...」
//   B. GET /accounts/{非UUID}：原版 400「无效的ID格式」，恢复端 404「科目不存在」
//
// ## 取证设计
//   A 组：不同层级、不同方法的未注册路径（原版一律 404「路由不存在」？）
//   B 组：accounts 资源各方法 × 非 UUID / 合法但不存在的 UUID
//   C 组：非 /api/ 前缀（原版回 200 空 body？）
//
// 各条路径 / ID 互不相同，避免相互干扰。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-oo-catchall2.js
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

const log = [];
const say = (s) => { log.push(s); console.log(s); };
let diff = 0, total = 0;

async function cmp(method, path, body) {
  total++;
  const o = await call(ORIG, oTk, method, path, body);
  const r = await call(ACTUAL, rTk, method, path, body);
  const of = `${o.http}|${o.json?.code ?? "-"} | ${o.json?.message ?? ""}`;
  const rf = `${r.http}|${r.json?.code ?? "-"} | ${r.json?.message ?? ""}`;
  const same = of === rf;
  if (!same) diff++;
  say(`${same ? "  " : "!!"} ${method} ${path}`);
  say(`     原版 : ${of}`);
  say(`     恢复端: ${rf}`);
}

// ============ A 组：未注册路径 ============
say("=== A 组：未注册 /api/ 路径 ===");
await cmp("GET", "/api/v1/nope-resource-aa");
await cmp("GET", "/api/v1/nope-resource-bb");
await cmp("POST", "/api/v1/nope-resource-cc", {});
await cmp("PUT", "/api/v1/nope-resource-dd/xyz", {});
await cmp("DELETE", "/api/v1/nope-resource-ee/xyz");
await cmp("GET", "/api/v1/accounts/nope-subpath-ff/child/deeper");
await cmp("GET", "/api/v2/nope-version-gg");
await cmp("GET", "/api/nope-no-version-hh");

// ============ B 组：accounts 非法 ID ============
say("\n=== B 组：accounts 各方法 × 非法 ID ===");
await cmp("GET", "/api/v1/accounts/not-a-uuid-01");
await cmp("PUT", "/api/v1/accounts/not-a-uuid-02", { name: "x" });
await cmp("DELETE", "/api/v1/accounts/not-a-uuid-03");
await cmp("GET", "/api/v1/accounts/not-a-uuid-04/balance");
await cmp("GET", "/api/v1/accounts/00000000-0000-0000-0000-000000000000");
await cmp("GET", "/api/v1/accounts/00000000-0000-0000-0000-000000000000/balance");
await cmp("PUT", "/api/v1/accounts/00000000-0000-0000-0000-000000000000", { name: "x" });

// ============ C 组：其他资源的非法 ID（看是否同一套规则） ============
say("\n=== C 组：其他资源 × 非法 ID（确认是否同一套规则）===");
await cmp("GET", "/api/v1/vouchers/not-a-uuid-05");
await cmp("GET", "/api/v1/products/not-a-uuid-06");
await cmp("GET", "/api/v1/customers/not-a-uuid-07");
await cmp("GET", "/api/v1/warehouses/not-a-uuid-08");

// ============ D 组：非 /api/ 前缀 ============
say("\n=== D 组：非 /api/ 前缀 ===");
for (const p of ["/nope-root-ii", "/health", "/nope/deep/jj"]) {
  total++;
  const o = await call(ORIG, oTk, "GET", p);
  const r = await call(ACTUAL, rTk, "GET", p);
  const ob = JSON.stringify(o.json);
  const rb = JSON.stringify(r.json);
  const of = `${o.http}|${ob.slice(0, 80)}`;
  const rf = `${r.http}|${rb.slice(0, 80)}`;
  const same = of === rf;
  if (!same) diff++;
  say(`${same ? "  " : "!!"} GET ${p}`);
  say(`     原版 : ${of}`);
  say(`     恢复端: ${rf}`);
}

say(`\n不一致 = ${diff} / ${total}`);
writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-catchall2-20261015.txt",
  log.join("\n") + "\n",
);
