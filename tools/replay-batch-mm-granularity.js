#!/usr/bin/env node
// 会计期间重叠：确定原版按「时刻」还是按「天（date()）」比较（批次 MM，2026-10-15）。
//
// 背景：单日基准（start == end == D）下逐点探测出一个无法用纯时刻比较解释的现象：
//
//	被测起点 = D - 1 天（终点固定 D）  → 原版**放行**
//	被测终点 = D + 1 天（起点固定 D）  → 原版**重叠**
//
// 若按时刻比较，区间 [D-1天, D] 与 [D, D] 显然相交（应判重叠），但原版放行；
// 而 [D, D+1天] 判重叠。两者不对称 → 比较前很可能做了**日期截断**。
//
// 本脚本用「全天区间」作基准（同一天内的不同时刻 + 相邻日 + 零值），
// 逐条比对两端，判定原版的时间粒度。
//
// 用法：ERP_PASSWORD=xxx MM_YEAR=2210 node tools/replay-batch-mm-granularity.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const ACTUAL = "http://127.0.0.1:18899";
const PASS = process.env.ERP_PASSWORD;
const YEAR = Number(process.env.MM_YEAR ?? 2210);
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

async function token(base, withCompany) {
  const payload = { username: "admin", password: PASS };
  if (withCompany) payload.company = "default";
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await r.json())?.data?.access_token ?? "";
}
const [origToken, recToken] = [await token(ORIG, true), await token(ACTUAL, false)];
if (!origToken || !recToken) { console.error("两端登录失败"); process.exit(1); }

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { http: res.status, json: await res.json() };
}

// 基准：全天区间（00:00:00 → 23:59:59），这样「同一天内」与「相邻日」可分别探测
const DAY = `${YEAR}-01-15`;
const baseBody = {
  period: `${YEAR}-01`,
  start_date: `${DAY}T00:00:00+08:00`,
  end_date: `${DAY}T23:59:59+08:00`,
};
const bO = await call(ORIG, origToken, "POST", "/api/v1/accounting-periods", baseBody);
const bR = await call(ACTUAL, recToken, "POST", "/api/v1/accounting-periods", baseBody);
console.log(`基准（${DAY} 全天 00:00:00..23:59:59）：原版=${bO.json.code} 恢复端=${bR.json.code}`);
if (bO.json.code !== 0 || bR.json.code !== 0) {
  console.error("基准期未建成 —— 改 MM_YEAR 换一个未占用的年份（原版无 DELETE 路由）");
  process.exit(2);
}

const rows = [];
let seq = 1;
async function probe(label, startDate, endDate) {
  const body = { period: `${YEAR}-${String(seq++).padStart(2, "0")}`, start_date: startDate, end_date: endDate };
  const a = await call(ORIG, origToken, "POST", "/api/v1/accounting-periods", body);
  const r = await call(ACTUAL, recToken, "POST", "/api/v1/accounting-periods", body);
  const norm = (x) => (x.json.code === 0 ? "放行" : "重叠");
  const same = norm(a) === norm(r);
  rows.push({
    label, start: startDate, end: endDate,
    original: { http: a.http, code: a.json.code, message: a.json.message, norm: norm(a) },
    actual: { http: r.http, code: r.json.code, message: r.json.message, norm: norm(r) },
    same,
  });
  console.log(`  ${same ? "✓" : "✗"} ${label.padEnd(30)} 原版=${norm(a).padEnd(4)} 恢复端=${norm(r)}`);
  if (r.json.data?.id) await call(ACTUAL, recToken, "DELETE", `/api/v1/accounting-periods/${r.json.data.id}`);
}

console.log("\n=== A. 同一天内的时刻（基准覆盖全天，结果应与时刻无关）===");
await probe("同日 12:00 单点", `${DAY}T12:00:00+08:00`, `${DAY}T12:00:00+08:00`);
await probe("同日 00:00..23:59（与基准同）", `${DAY}T00:00:00+08:00`, `${DAY}T23:59:59+08:00`);
await probe("同日 06:00..18:00", `${DAY}T06:00:00+08:00`, `${DAY}T18:00:00+08:00`);

console.log("\n=== B. 相邻日 ===");
await probe("前一日全天", `${YEAR}-01-14T00:00:00+08:00`, `${YEAR}-01-14T23:59:59+08:00`);
await probe("后一日全天", `${YEAR}-01-16T00:00:00+08:00`, `${YEAR}-01-16T23:59:59+08:00`);
await probe("前一日23:59:59 → 基准00:00", `${YEAR}-01-14T23:59:59+08:00`, `${DAY}T00:00:00+08:00`);
await probe("基准23:59:59 → 后一日00:00", `${DAY}T23:59:59+08:00`, `${YEAR}-01-16T00:00:00+08:00`);

console.log("\n=== C. 零值（缺日期时原版落 0001-01-01T00:00:00Z）===");
await probe("两端皆零值", "0001-01-01T00:00:00Z", "0001-01-01T00:00:00Z");
await probe("起点零值 → 基准日末", "0001-01-01T00:00:00Z", `${DAY}T23:59:59+08:00`);
await probe("基准日初 → 终点零值", `${DAY}T00:00:00+08:00`, "0001-01-01T00:00:00Z");

if (bR.json.data?.id) await call(ACTUAL, recToken, "DELETE", `/api/v1/accounting-periods/${bR.json.data.id}`);

const same = rows.filter((r) => r.same).length;
console.log(`\n两端一致 ${same}｜不一致 ${rows.length - same}`);
writeFileSync(
  "evidence/backend-runtime/audit-batch-mm-period-granularity-20261015.json",
  JSON.stringify({
    generated: new Date().toISOString(),
    base: { original: ORIG, actual: ACTUAL },
    note: `基准为全天区间 ${DAY} 00:00:00..23:59:59。原版无 DELETE 路由，基准期（YEAR=${YEAR}）留在原版库中作为残数据。`,
    summary: { total: rows.length, same, differ: rows.length - same },
    rows,
  }, null, 2)
);
console.log("已写出 → evidence/backend-runtime/audit-batch-mm-period-granularity-20261015.json");