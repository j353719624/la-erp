#!/usr/bin/env node
// 批次 OO · 兜底路由形态取证（2026-10-15）。
//
// 现象：抽查时误打 /api/v1/periods/2026-09/opening-balances，
//   原版 → 404「路由不存在」
//   恢复端 → 501「该业务接口尚未实现：...」
// 若原版对所有未注册 /api/ 路径都是 404「路由不存在」，则恢复端兜底 501 属差异，需对齐。
//
// 用例设计（各路径互不相同，取原版绝不存在的名字）：
//   ① /api/v1/ 下不存在的资源
//   ② 存在的资源 + 不存在的子路径
//   ③ 不存在的资源 + 存在的子动作
//   ④ 非 /api/ 前缀
//   ⑤ /api/ 裸路径
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-oo-catchall.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.OO_RECOVERED ?? "http://127.0.0.1:18886";
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
const rTk = await token(RECOVERED, false);

async function call(base, tk, method, path) {
  const res = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json };
}

const cases = [
  ["GET", "/api/v1/definitely-not-a-resource-oo"],
  ["GET", "/api/v1/accounts/not-a-real-subpath"],
  ["POST", "/api/v1/definitely-not-a-resource-oo/approve"],
  ["GET", "/api/"],
  ["GET", "/api/v1"],
  ["GET", "/not-api-path-oo"],
  ["DELETE", "/api/v1/zzz-nonexistent-resource"],
];

const log = [];
const say = (s) => { log.push(s); console.log(s); };
let diff = 0;

say("=== 兜底路由形态对照 ===");
for (const [method, path] of cases) {
  const o = await call(ORIG, oTk, method, path);
  const r = await call(RECOVERED, rTk, method, path);
  const of = `${o.http}|${o.json?.code ?? "-"} | ${o.json?.message ?? ""}`;
  const rf = `${r.http}|${r.json?.code ?? "-"} | ${r.json?.message ?? ""}`;
  const same = of === rf;
  if (!same) diff++;
  say(`${same ? "  " : "!!"} ${method} ${path}`);
  say(`     原版 : ${of}`);
  say(`     恢复端: ${rf}`);
}
say(`\n不一致条数 = ${diff} / ${cases.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-catchall-20261015.txt",
  log.join("\n") + "\n",
);
