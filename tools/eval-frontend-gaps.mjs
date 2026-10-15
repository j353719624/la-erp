#!/usr/bin/env node
// 产品完成度评估：对「前端调用但恢复端不可用」的端点，逐一确认**原版是否支持**。
//
// audit-frontend-contract.mjs 只判「恢复端能不能访问」，不判「原版有没有」。
// 前端源码从 source map 原样提取，可能包含原版也没有的冗余调用 ——
// 那些不是恢复端的缺口。故这里对两端跑同一组请求做对照。
//
// 用法：ERP_PASSWORD=xxx node tools/eval-frontend-gaps.mjs

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
  const j = await r.json();
  return j?.data?.access_token ?? "";
}
const oTk = await token(ORIG, true);
const rTk = await token(ACTUAL, false);
if (!oTk || !rTk) { console.error("登录失败", { oTk: !!oTk, rTk: !!rTk }); process.exit(1); }

async function probe(base, tk, method, path) {
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify({}),
  });
  let msg = "";
  try { msg = (await r.json())?.message ?? ""; } catch { /* 非 JSON */ }
  return { http: r.status, msg };
}

// 来自 audit-frontend-contract.mjs 的「不可用」清单（2026-10-15）
const GAPS = [
  ["crm-activities", "DELETE", "/api/v1/crm-activities/00000000-0000-0000-0000-000000000000"],
  ["crm-opportunities", "GET", "/api/v1/crm-opportunities?page=1&page_size=1"],
  ["crm-opportunities", "POST", "/api/v1/crm-opportunities"],
  ["crm-opportunities", "PUT", "/api/v1/crm-opportunities/00000000-0000-0000-0000-000000000000"],
  ["crm-opportunities", "DELETE", "/api/v1/crm-opportunities/00000000-0000-0000-0000-000000000000"],
  ["piecework-rates", "PUT", "/api/v1/piecework-rates/00000000-0000-0000-0000-000000000000"],
  ["piecework-rates", "DELETE", "/api/v1/piecework-rates/00000000-0000-0000-0000-000000000000"],
  ["piecework-records", "PUT", "/api/v1/piecework-records/00000000-0000-0000-0000-000000000000"],
  ["piecework-records", "DELETE", "/api/v1/piecework-records/00000000-0000-0000-0000-000000000000"],
  ["purchase-reconciliations", "GET", "/api/v1/purchase-reconciliations?page=1&page_size=1"],
  ["purchase-reconciliations", "POST", "/api/v1/purchase-reconciliations"],
  ["purchase-reconciliations", "PUT", "/api/v1/purchase-reconciliations/00000000-0000-0000-0000-000000000000"],
  ["purchase-reconciliations", "DELETE", "/api/v1/purchase-reconciliations/00000000-0000-0000-0000-000000000000"],
  ["print-templates", "GET", "/api/v1/print-templates/00000000-0000-0000-0000-000000000000"],
  ["work-order-processes", "POST", "/api/v1/work-order-processes"],
];

const is404 = (r) => r.http === 404 || r.msg === "路由不存在";
console.log("资源 / 方法".padEnd(40), "原版".padEnd(28), "恢复端".padEnd(28), "判定");
console.log("-".repeat(120));
let realGap = 0;
for (const [res, method, path] of GAPS) {
  const o = await probe(ORIG, oTk, method, path);
  const r = await probe(ACTUAL, rTk, method, path);
  const oAbsent = is404(o), rAbsent = is404(r);
  const tag = !oAbsent && rAbsent ? "真实缺口（原版有，恢复端无）"
    : oAbsent && rAbsent ? "非缺口（两端都没有）"
    : !oAbsent && !rAbsent ? "两端都有"
    : "异常（恢复端有，原版无）";
  if (tag.startsWith("真实缺口")) realGap++;
  const fmt = (x) => `http${x.http} ${x.msg || "-"}`;
  console.log(`${(res + " " + method).padEnd(40)} ${fmt(o).padEnd(28)} ${fmt(r).padEnd(28)} ${tag}`);
}
console.log("-".repeat(120));
console.log(`真实缺口 ${realGap} / ${GAPS.length}`);
