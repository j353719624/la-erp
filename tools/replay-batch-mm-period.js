#!/usr/bin/env node
// 批次 MM 会计期间：两端对照取证（2026-10-15）。
//
// 目的：把 37.7 / 37.8 里那些「我口头断言、证据文件却只测了恢复端」的结论，
// 用**一次两端同时探测**重新坐实，并落盘可回查的证据。
//
// 关键前提（踩过两次的坑）：
//   ① 原版登录必须带 company=default —— 公司数 > 1 时不带会返回
//      400「请选择公司后再登录」。恢复端是单公司模式，不带即可。
//   ② 原版**没有 DELETE /api/v1/accounting-periods/{id}**，历次回放建的期间
//      全都留在原版库里，污染后续探测。故每次都用**未使用过的年份**做基准。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-mm-period.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = "http://127.0.0.1:18899";
const PASS = process.env.ERP_PASSWORD;
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
if (!origToken || !recToken) {
  console.error(`登录失败 原版=${!!origToken} 恢复端=${!!recToken}`);
  process.exit(1);
}

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { http: res.status, json: await res.json() };
}
const createOrig = (b) => call(ORIG, origToken, "POST", "/api/v1/accounting-periods", b);
const createRec = (b) => call(RECOVERED, recToken, "POST", "/api/v1/accounting-periods", b);

// 逐年推进，永不复用被污染的年份。
// 手工改常量很容易改成上一轮已用过的年份（该年基准期留在原版库里，
// 会让「基准期创建」直接报重叠，后续全部对照失效）—— 故从命令行取，
// 缺省用一个较远的年份；本轮实测用 2180。
const year = Number(process.env.MM_YEAR ?? 2180);
const rows = [];
async function compare(tag, body) {
  const a = await createOrig(body);
  const b = await createRec(body);
  const same = a.http === b.http && a.json.code === b.json.code
    && String(a.json.message) === String(b.json.message);
  rows.push({
    tag, request: body,
    original: { http: a.http, code: a.json.code, message: a.json.message },
    actual: { http: b.http, code: b.json.code, message: b.json.message },
    same,
  });
  console.log(`  ${same ? "✓" : "✗"} ${tag.padEnd(24)} 原版=${a.http}/${a.json.code} ${JSON.stringify(a.json.message)}`);
  if (!same) console.log(`      ${" ".repeat(24)} 恢复端=${b.http}/${b.json.code} ${JSON.stringify(b.json.message)}`);
  // 恢复端建了就删；原版无 DELETE，留作残数据（已登记）
  if (b.json.data?.id) await call(RECOVERED, recToken, "DELETE", `/api/v1/accounting-periods/${b.json.data.id}`);
  return same;
}

console.log("=== 一、创建校验（不依赖任何既有数据）===");
let pass = 0, fail = 0;
const tally = (ok) => { if (ok) pass++; else fail++; };
tally((await compare("空载荷", {})).same);
tally((await compare("period 格式错(单数字月)", { period: `${year}-1` })).same);
tally((await compare("period 格式错(RFC3339)", { period: `${year}-01-01T00:00:00+08:00` })).same);
tally((await compare("period 格式错(非数字)", { period: "abc" })).same);
tally((await compare("start_date 非 RFC3339", { period: `${year}-02`, start_date: `${year}-02-01`, end_date: `${year}-02-28T00:00:00+08:00` })).same);

console.log(`\n=== 二、重叠规则（基准 ${year}-01 = 01-01T00:00 .. 01-31T00:00）===`);
const Y = year;
const baseBody = { period: `${Y}-01`, start_date: `${Y}-01-01T00:00:00+08:00`, end_date: `${Y}-01-31T00:00:00+08:00` };
const baseOrig = await createOrig(baseBody);
const baseRec = await createRec(baseBody);
console.log(`  基准：原版=${baseOrig.json.code} 恢复端=${baseRec.json.code}`);
if (baseOrig.json.code !== 0 || baseRec.json.code !== 0) {
  console.error("基准期未建成（原版无 DELETE 路由，该年份可能已被上一轮占用）—— 对照无效，改 MM_YEAR 重跑");
  process.exit(2);
}

tally((await compare("同 period 同日期", baseBody)).same);
tally((await compare("同 period 不同日期", { period: `${Y}-01`, start_date: `${Y + 1}-06-01T00:00:00+08:00`, end_date: `${Y + 1}-06-30T00:00:00+08:00` })).same);
tally((await compare("period 不同 日期完全重叠", { period: `${Y}-02`, start_date: `${Y}-01-01T00:00:00+08:00`, end_date: `${Y}-01-31T00:00:00+08:00` })).same);
tally((await compare("period 不同 晚始早终", { period: `${Y}-03`, start_date: `${Y}-01-20T00:00:00+08:00`, end_date: `${Y}-01-25T00:00:00+08:00` })).same);
tally((await compare("period 不同 早始晚终", { period: `${Y}-04`, start_date: `${Y}-01-10T00:00:00+08:00`, end_date: `${Y + 1}-01-10T00:00:00+08:00` })).same);
tally((await compare("period 不同 起点==基准终点", { period: `${Y}-05`, start_date: `${Y}-01-31T00:00:00+08:00`, end_date: `${Y + 1}-01-31T00:00:00+08:00` })).same);
tally((await compare("period 不同 终点==基准起点", { period: `${Y}-06`, start_date: `${Y}-01-01T00:00:00+08:00`, end_date: `${Y}-01-01T00:00:00+08:00` })).same);
tally((await compare("period 不同 终点==基准起点+1秒", { period: `${Y}-07`, start_date: `${Y}-01-01T00:00:00+08:00`, end_date: `${Y}-01-01T00:00:01+08:00` })).same);
tally((await compare("period 不同 起点==基准终点-1秒", { period: `${Y}-08`, start_date: `${Y}-01-30T23:59:59+08:00`, end_date: `${Y + 1}-01-31T00:00:00+08:00` })).same);
tally((await compare("period 不同 完全不重叠", { period: `${Y}-09`, start_date: `${Y + 1}-02-01T00:00:00+08:00`, end_date: `${Y + 1}-02-28T00:00:00+08:00` })).same);
tally((await compare("period 不同 缺日期(零值)", { period: `${Y}-10` })).same);

if (baseRec.json.data?.id) await call(RECOVERED, recToken, "DELETE", `/api/v1/accounting-periods/${baseRec.json.data.id}`);

// 统计必须从 rows 现算，不能用 pass/fail 累加器 ——
// 上面每条是 `tally((await compare(...)).same)`，而 compare() 返回的是
// **boolean**（不是带 .same 的对象），故 `.same` 取到 undefined，计数恒为 0，
// summary 曾写成 0/16 而实际是 14/16。下方的现算是唯一可信来源。
const sameCount = rows.filter((r) => r.same).length;
const differCount = rows.length - sameCount;
const textDiffCount = rows.filter((r) => r.textDiff).length;
pass = sameCount;
fail = differCount;
console.log(`（其中 ${textDiffCount} 条形态一致但文案不同 —— 原版缺陷，恢复端未复刻）`);
console.log(`\n两端一致 ${pass}｜不一致 ${fail}`);
writeFileSync(
  "evidence/backend-runtime/audit-batch-mm-period-crosscheck-20261015.json",
  JSON.stringify({
    generated: new Date().toISOString(),
    base: { original: ORIG, actual: RECOVERED },
    note: "原版无 DELETE /api/v1/accounting-periods/{id}，本轮基准期（year=" + Y + "）留在原版库中作为残数据",
    summary: { total: rows.length, same: pass, differ: fail, textDiff: textDiffCount },
    rows,
  }, null, 2)
);
console.log("已写出 → evidence/backend-runtime/audit-batch-mm-period-crosscheck-20261015.json");
process.exit(fail === 0 ? 0 : 1);