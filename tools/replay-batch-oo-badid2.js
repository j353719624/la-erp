#!/usr/bin/env node
// 批次 OO · 「路由不存在」资源的补取证（2026-10-15）。
//
// 上一轮 6 个资源在非法 ID 下两端都回 404「路由不存在」：
//   equipment-maintenances, production-team-members, approval-records,
//   tax-accruals, crm-activities, employee-changes
// 需确认：是「非法 ID 才 404」还是「该路由根本不存在」（用合法 UUID 再探一次）。
// 若是后者，修复时守卫必须放在路由存在性判断之后，否则会误吐「无效的XXID」。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-oo-badid2.js
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

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json: json };
}

const RES = [
  "equipment-maintenances", "production-team-members", "approval-records",
  "tax-accruals", "crm-activities", "employee-changes",
];
// 合法但不存在的 UUID（各条互不相同）
const UUIDS = RES.map((_, i) =>
  `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);

const log = [];
const say = (s) => { log.push(s); console.log(s); };
let diff = 0, total = 0;

say("=== 合法但不存在的 UUID（判断路由是否存在）===");
for (let i = 0; i < RES.length; i++) {
  for (const method of ["GET", "PUT", "DELETE"]) {
    total++;
    const path = `/api/v1/${RES[i]}/${UUIDS[i]}`;
    const body = method === "PUT" ? { name: "probe" } : undefined;
    const o = await call(ORIG, oTk, method, path, body);
    const r = await call(RECOVERED, rTk, method, path, body);
    const of = `${o.http}|${o.json?.code ?? "-"} | ${o.json?.message ?? ""}`;
    const rf = `${r.http}|${r.json?.code ?? "-"} | ${r.json?.message ?? ""}`;
    const same = of === rf;
    if (!same) diff++;
    say(`${same ? "  " : "!!"} ${method.padEnd(6)} ${path}`);
    say(`     原版 : ${of}`);
    say(`     恢复端: ${rf}`);
  }
}
say(`\n不一致 = ${diff} / ${total}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-badid2-20261015.txt",
  log.join("\n") + "\n",
);
