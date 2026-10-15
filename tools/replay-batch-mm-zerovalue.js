#!/usr/bin/env node
// 决定性取证：「缺 start_date/end_date」时原版判重叠还是放行（批次 MM，2026-10-15）。
//
// ## 为什么要单独测
// 仓库里两份证据对同一现象给出了相反结论：
//   crosscheck  （基准 2260-01 = 01-01T00:00 .. 01-31T00:00）→ 原版判「重叠」
//   granularity （基准 2210-01 = 00:00:00 .. 23:59:59）    → 原版判「放行」
//
// ## 本脚本查清的是什么
// 假设：差异来自**基准区间形态**，而不是「零值是否参与相交」。
// 方法：同一份「只有 period、不带任何日期」的请求，在四种库状态下各打一次 ——
//   A 空库            → 没有基准期可比
//   B 宽区间基准      → 与 crosscheck 同形
//   C 全天区间基准    → 与 granularity 同形
//   D 单日区间基准    → 退化为一个点
//
// ## 三条硬约束（都是本轮踩过的坑）
//   ① period 必须是 `YYYY-MM`，月份**恰好两位**。序号写死成两位，
//      不要用 `30 + seq` 这类可能溢出到三位的算法。
//   ② 基准与被测请求的 period **必须不同**，否则被测会撞 UNIQUE 索引，
//      表现为「基准未建成：该期间与已存在的会计期间重叠」——极具误导性。
//   ③ 原版**没有 DELETE /accounting-periods/{id}**，故每次必须用未占用的年份
//      （MM_YEAR），基准期会永久留在原版库里。
//
// 用法：ERP_PASSWORD=xxx MM_YEAR=2340 node tools/replay-batch-mm-zerovalue.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = "http://127.0.0.1:18899";
const PASS = process.env.ERP_PASSWORD;
const YEAR = Number(process.env.MM_YEAR ?? 2340);
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
const [origToken, recToken] = [await token(ORIG, true), await token(RECOVERED, false)];
if (!origToken || !recToken) { console.error("两端登录失败"); process.exit(1); }

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { http: res.status, json: await res.json() };
}

// period 必须是 `YYYY-MM`（月份恰好两位）。
//
// 四组各用**不同的两位月份**：基准 01/02/03/04，被测固定 09。
// 早前一版所有组共用 `-01`，B 组建的基准会留在原版库（无 DELETE），
// 导致 C/D 组报「基准未建成：该期间与已存在的会计期间重叠」——
// 那不是重叠规则的问题，是自己的基准撞了自己。
const BASE_MONTHS = ["01", "02", "03", "04"];
const probePeriod = `${YEAR}-09`;
let groupIndex = 0;

const rows = [];
const norm = (x) => (x.json.code === 0 ? "放行" : x.json.code === 10000 ? "重叠" : `其他(${x.json.code})`);

async function probeZeroValue(label, baseBody) {
  const basePeriod = `${YEAR}-${BASE_MONTHS[groupIndex] ?? "04"}`;
  if (baseBody) {
    const r = await call(ORIG, origToken, "POST", "/api/v1/accounting-periods", { ...baseBody, period: basePeriod });
    if (r.json.code !== 0) {
      console.log(`  ! 基准未建成：${JSON.stringify(r.json.message)}`);
      console.log(`    （${basePeriod} 可能已被往轮占用 —— 原版无 DELETE 路由，请换 MM_YEAR）`);
      groupIndex++;
      return;
    }
    await call(RECOVERED, recToken, "POST", "/api/v1/accounting-periods", { ...baseBody, period: basePeriod });
  }
  groupIndex++;
  // 被测请求：只有 period，不带任何日期 → 原版落 Go 零值时间
  const req = { period: probePeriod };
  const a = await call(ORIG, origToken, "POST", "/api/v1/accounting-periods", req);
  const r = await call(RECOVERED, recToken, "POST", "/api/v1/accounting-periods", req);
  const same = norm(a) === norm(r);
  rows.push({
    label,
    base: baseBody ? { start: baseBody.start_date, end: baseBody.end_date } : null,
    request: req,
    original: { http: a.http, code: a.json.code, message: a.json.message, norm: norm(a) },
    recovered: { http: r.http, code: r.json.code, message: r.json.message, norm: norm(r) },
    same,
  });
  console.log(`  ${same ? "✓" : "✗"} ${label.padEnd(30)} 原版=${norm(a).padEnd(8)} 恢复端=${norm(r)}`);
  if (!same) {
    console.log(`      ${" ".repeat(30)} 原版原文=${JSON.stringify(a.json.message)}`);
    console.log(`      ${" ".repeat(30)} 恢复端原文=${JSON.stringify(r.json.message)}`);
  }
}

console.log(`=== 基准年份 ${YEAR}（基准 period 依次用 ${BASE_MONTHS.join("/" .replace("/", "/"))}，被测固定 ${probePeriod}）===\n`);

console.log("=== A. 空库（无基准期）===");
await probeZeroValue("库内无任何期间", null);

console.log("\n=== B. 宽区间基准（与 crosscheck 同形）===");
await probeZeroValue("基准 01-01T00:00 .. 01-31T00:00", {
  start_date: `${YEAR}-01-01T00:00:00+08:00`,
  end_date: `${YEAR}-01-31T00:00:00+08:00`,
});

console.log("\n=== C. 全天区间基准（与 granularity 同形）===");
await probeZeroValue("基准 01-15T00:00 .. 01-15T23:59:59", {
  start_date: `${YEAR}-01-15T00:00:00+08:00`,
  end_date: `${YEAR}-01-15T23:59:59+08:00`,
});

console.log("\n=== D. 单日区间基准（退化为一点）===");
await probeZeroValue("基准 01-20T00:00 .. 01-20T00:00", {
  start_date: `${YEAR}-01-20T00:00:00+08:00`,
  end_date: `${YEAR}-01-20T00:00:00+08:00`,
});

const same = rows.filter((r) => r.same).length;
console.log(`\n两端一致 ${same}｜不一致 ${rows.length - same}`);
writeFileSync(
  "evidence/backend-runtime/audit-batch-mm-zerovalue-20261015.json",
  JSON.stringify({
    generated: new Date().toISOString(),
    base: { original: ORIG, recovered: RECOVERED },
    note: `「缺 start_date/end_date」在四种库状态下的原版行为。period 固定两位月份：基准依次用 ${BASE_MONTHS.join("/")}、被测固定 ${probePeriod}。原版无 DELETE 路由，基准期（YEAR=${YEAR}）永久留在原版库中作为残数据。`,
    summary: { total: rows.length, same, differ: rows.length - same },
    rows,
  }, null, 2)
);
console.log("已写出 → evidence/backend-runtime/audit-batch-mm-zerovalue-20261015.json");