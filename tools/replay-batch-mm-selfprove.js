#!/usr/bin/env node
// 会计期间零值争议的**收口取证**（批次 MM，2026-10-15）。
//
// ## 为什么需要这个脚本
// 四份会计期间 evidence（crosscheck / boundary / granularity / zerovalue）
// **全部缺「运行前库状态清单」**，导致四方各执一词、互相推翻至少 8 次：
//   · crosscheck 说「零值 → 重叠」，据以推翻 37.11
//   · 37.12/37.13 说「是残数据假象」，据以宣布 100% 对齐
//   · fix-bank-adj 说 crosscheck 的 period 未被占用、归因不成立
//   · fix-period 说「缺省 vs 显式零值走不同分支」
//
// 根因：跨文件比较「原版判 X」在**原版无 DELETE 路由**的表上无效 ——
// 各份 evidence 的库状态不同。
//
// ## 本脚本补齐缺失的三件事
//   ① **运行前**把两端 `GET /accounting-periods?page_size=500` 全量落盘
//   ② 每条探测记录 `periodOccupiedBefore`（该 period 在运行前是否已存在于两端）
//   ③ 每条探测用**互不相同**的 period，且与基准、与彼此都不撞
//
// ## 已定位的触发条件（37.14）
// 库中存在**跨年区间**记录（如 `01-31T00:00 .. 次年01-31T00:00`）时，
// 原版把零值区间判为重叠；库中只有单点/同月区间记录时放行。
// 本脚本用「跨年区间」与「单点」两组对照验证这一条件。
//
// 用法：ERP_PASSWORD=xxx MM_YEAR=2480 node tools/replay-batch-mm-selfprove.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const ACTUAL = "http://127.0.0.1:18899";
const PASS = process.env.ERP_PASSWORD;
const YEAR = Number(process.env.MM_YEAR ?? 2480);
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

async function snapshot(base, tk) {
  const r = await call(base, tk, "GET", "/api/v1/accounting-periods?page=1&page_size=500");
  const rows = r.json?.data?.list ?? [];
  return {
    total: r.json?.data?.total ?? rows.length,
    periods: rows.map((x) => ({
      period: x.period,
      start: String(x.start_date ?? ""),
      end: String(x.end_date ?? ""),
    })),
  };
}

// ── ① 运行前的两端库状态清单 ──
const snapBefore = {
  original: await snapshot(ORIG, origToken),
  actual: await snapshot(ACTUAL, recToken),
};
console.log(`=== 运行前库状态 ===`);
console.log(`  原版   ${snapBefore.original.total} 条`);
console.log(`  恢复端 ${snapBefore.actual.total} 条`);
for (const p of [...snapBefore.original.periods, ...snapBefore.actual.periods]) {
  if (String(p.period).startsWith(String(YEAR))) {
    console.log(`  ⚠ ${YEAR} 年已有占用：${p.period}  ${p.start.slice(0, 19)} → ${p.end.slice(0, 19)}`);
  }
}
if (snapBefore.original.periods.some((p) => String(p.period).startsWith(String(YEAR)))
  || snapBefore.actual.periods.some((p) => String(p.period).startsWith(String(YEAR)))) {
  console.error(`\n${YEAR} 年已被占用 —— 本轮结论不可信，请换 MM_YEAR（原版无 DELETE 路由）`);
  process.exit(2);
}
console.log(`  ✓ ${YEAR} 年两端均无占用\n`);

// ── ② ② period 是否在运行前已被占用 ──
const occupiedBefore = (period, side) =>
  snapBefore[side].periods.some((p) => p.period === period);

const rows = [];
// 两组对照：跨年区间 vs 单点。
//
// ⚠ 两组**必须各用一个未占用的年份**：原版没有 DELETE /accounting-periods/{id}，
// A 组建的基准会永久留在原版库中，使 B 组的「库中只有一条单点记录」这个前提
// 不成立（实际变成「一条跨年 + 一条单点」）。早前一版正是因此把 B 组测成了
// A+B 混合状态，两组结论互相污染。
// 故 YEAR 传偶数年（A 组）、YEAR+10 传奇数年（B 组），两组互不干扰。
const GROUP_B_YEAR = YEAR + 10;
const GROUPS = [
  {
    year: YEAR,
    name: "A. 库中仅一条跨年区间记录",
    base: { period: `${YEAR}-05`, start_date: `${YEAR}-01-31T00:00:00+08:00`, end_date: `${YEAR + 1}-01-31T00:00:00+08:00` },
  },
  {
    year: GROUP_B_YEAR,
    name: "B. 库中仅一条同月单点记录",
    base: { period: `${GROUP_B_YEAR}-06`, start_date: `${GROUP_B_YEAR}-01-01T00:00:00+08:00`, end_date: `${GROUP_B_YEAR}-01-01T00:00:00+08:00` },
  },
];

const norm = (x) => (x.json.code === 0 ? "放行" : x.json.code === 10000 ? "重叠" : `其他(${x.json.code})`);

for (const group of GROUPS) {
  const Y = group.year;
  const pre = group.year === YEAR ? snapBefore.original.periods : snapBefore.original.periods;
  const stillFree = !pre.some((p) => String(p.period).startsWith(String(Y)));
  if (!stillFree) {
    console.log(`=== ${group.name} ===`);
    console.log(`  ! ${Y} 年已被占用，跳过（换 MM_YEAR / 调整 GROUP_B_YEAR）`);
    continue;
  }
  console.log(`=== ${group.name}（${Y} 年）===`);
  console.log(`  基准 ${group.base.period}  ${group.base.start_date.slice(0, 19)} → ${group.base.end_date.slice(0, 19)}`);
  const bo = await call(ORIG, origToken, "POST", "/api/v1/accounting-periods", group.base);
  await call(ACTUAL, recToken, "POST", "/api/v1/accounting-periods", group.base);
  console.log(`  建基准 → 原版 ${bo.json.code}${bo.json.code !== 0 ? " " + bo.json.message : ""}\n`);

  // 四条探测：period 各不相同，且都不与基准撞
  const probes = [
    ["① 字段缺省（落零值）", `${Y}-10`, {}],
    ["② 显式传零值", `${Y}-11`, { start_date: "0001-01-01T00:00:00Z", end_date: "0001-01-01T00:00:00Z" }],
    ["③ 真实日期不重叠", `${Y}-12`, { start_date: `${Y + 1}-06-05T00:00:00+08:00`, end_date: `${Y + 1}-06-06T00:00:00+08:00` }],
    ["④ 真实日期与基准相交", `${Y}-02`, { start_date: `${Y}-01-10T00:00:00+08:00`, end_date: `${Y}-01-11T00:00:00+08:00` }],
  ];
  for (const [label, period, extra] of probes) {
    const req = { period, ...extra };
    const a = await call(ORIG, origToken, "POST", "/api/v1/accounting-periods", req);
    const r = await call(ACTUAL, recToken, "POST", "/api/v1/accounting-periods", req);
    const row = {
      group: group.name,
      label,
      request: req,
      periodOccupiedBefore: { original: occupiedBefore(period, "original"), actual: occupiedBefore(period, "actual") },
      original: { http: a.http, code: a.json.code, message: a.json.message, norm: norm(a) },
      actual: { http: r.http, code: r.json.code, message: r.json.message, norm: norm(r) },
      same: norm(a) === norm(r),
    };
    rows.push(row);
    console.log(`  ${row.same ? "✓" : "✗"} ${label.padEnd(22)} 原版=${row.original.norm.padEnd(8)} 恢复端=${row.actual.norm}  (period 运行前未被占用)`);
  }
  console.log("");
}

const same = rows.filter((r) => r.same).length;
console.log(`两端一致 ${same}｜不一致 ${rows.length - same}`);

writeFileSync(
  "evidence/backend-runtime/audit-batch-mm-selfprove-20261015.json",
  JSON.stringify({
    generated: new Date().toISOString(),
    base: { original: ORIG, actual: ACTUAL },
    year: YEAR,
    snapshotBefore: snapBefore,
    note: "本文件含运行前两端库状态清单与每条探测的 periodOccupiedBefore，"
        + "用于判定每条差异是语义差异还是污染产物 —— 前四份 evidence 均缺这两个字段。",
    summary: { total: rows.length, same, differ: rows.length - same },
    rows,
  }, null, 2)
);
console.log("已写出 → evidence/backend-runtime/audit-batch-mm-selfprove-20261015.json");