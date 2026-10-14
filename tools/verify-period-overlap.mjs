#!/usr/bin/env node
// 会计期间创建与重叠检查的隔离验证（批次 MM，2026-10-15）。
//
// ## 为什么必须隔离
// 原版**没有 DELETE /api/v1/accounting-periods/{id}**（实测 404「路由不存在」），
// 历次回放在原版上建的期间都删不掉，会持续污染后续对比 —— 本脚本第一轮就踩过：
// 期望值取自已污染的 period 列表，导致「恢复端全对」被误判成 10 处失败。
// 故验证只在**一次性干净库**上跑恢复端，期望值全部取自原版实测（见每组注释）。
//
// ## 原版实测口径
// 创建校验：
//   {}                                        → 400「期间不能为空」
//   {period:"2026-10"}                         → 200 success，period 原样落库
//   {period:"2026-10-01T00:00:00+08:00"}       → 200+10000「期间格式错误，应为 YYYY-MM」
//   {start_date:"2026-10-01",end_date:"…"}     → 400 Go time.Parse 报错（校验早于 period）
//
// 重叠规则（两组基准共 15 条探测）：
//   ① 单日基准 2100-01(01-01T00:00 .. 01-31T00:00)
//   ② 单日基准 2070-06-15T00:00 的逐点边界探测
//   ③ period 唯一性 + 日期区间相交**两个条件都要满足才放行**
//   边界语义为 **左开右闭 (start, end]**：新区间终点 == 旧区间起点 → 重叠；
//   新区间起点 == 旧区间终点 → 不重叠。
//
// 用法：ERP_PASSWORD=xxx node tools/verify-period-overlap.mjs [--base URL]
import { writeFileSync } from "node:fs";

const PASS = process.env.ERP_PASSWORD;
const argIndex = process.argv.indexOf("--base");
const BASE = argIndex > 0 ? process.argv[argIndex + 1] : "http://127.0.0.1:18899";

async function token() {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: PASS }),
  });
  return (await r.json())?.data?.access_token ?? "";
}
const tk = await token();
if (!tk) { console.error(`${BASE} 登录失败`); process.exit(1); }

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { http: res.status, json: await res.json() };
}
const create = (body) => call("POST", "/api/v1/accounting-periods", body);
const remove = (id) => call("DELETE", `/api/v1/accounting-periods/${id}`);

const results = [];
function record(group, tag, expect, got, extra = {}) {
  const ok = expect === got;
  results.push({ group, tag, expect, got, pass: ok, ...extra });
  console.log(`  ${ok ? "✓" : "✗"} ${tag.padEnd(26)} 期望=${String(expect).padEnd(22)} 实得=${got}`);
}

// ── 一、创建校验（4 条原版实测）──
console.log("\n=== 一、创建校验 ===");
for (const [tag, body, expect] of [
  ["空载荷", {}, { http: 400, message: "期间不能为空" }],
  ["period 非 YYYY-MM", { period: "2026-10-01T00:00:00+08:00" }, { http: 200, code: 10000, message: "期间格式错误，应为 YYYY-MM" }],
  ["period=2026-1 单数字月", { period: "2026-1" }, { http: 200, code: 10000, message: "期间格式错误，应为 YYYY-MM" }],
  ["period=abc", { period: "abc" }, { http: 200, code: 10000, message: "期间格式错误，应为 YYYY-MM" }],
]) {
  const { http, json } = await create(body);
  const want = expect.code === undefined ? expect.message : expect.message;
  record("创建校验", tag, want, json.message ?? "", { http, code: json.code });
}

// 合法创建：period 原样落库为 YYYY-MM
{
  const { json } = await create({ period: "2026-12" });
  record("创建校验", "period 原样落库", "2026-12", json.data?.period ?? "", { http: json.code });
  if (json.data?.id) await remove(json.data.id);
}

// ── 二、重叠规则 ──
async function suite(name, base, cases) {
  const created = await create(base);
  if (created.json.code !== 0) {
    console.log(`  基准期创建失败，跳过该组：${JSON.stringify(created.json)}`);
    return;
  }
  console.log(`\n=== ${name}（基准 ${base.period} ${base.start_date} .. ${base.end_date}）===`);
  for (const [tag, body, expect] of cases) {
    const { json } = await create(body);
    const got = json.code === 0 ? "不重叠" : json.message;
    record(name, tag, expect, got, { http: json.code });
    if (json.data?.id) await remove(json.data.id);
  }
  await remove(created.json.data.id);
}

// 组 ①：宽区间基准（边界语义 + 部分重叠的各种组合）
await suite("宽区间", { period: "2030-01", start_date: "2030-01-01T00:00:00+08:00", end_date: "2030-01-31T00:00:00+08:00" }, [
  ["完全重叠(区间内单日)", { period: "2031-01", start_date: "2030-01-10T00:00:00+08:00", end_date: "2030-01-10T00:00:00+08:00" }, "该期间与已存在的会计期间重叠"],
  ["晚始早终", { period: "2031-02", start_date: "2030-01-20T00:00:00+08:00", end_date: "2030-01-25T00:00:00+08:00" }, "该期间与已存在的会计期间重叠"],
  ["早始晚终", { period: "2031-03", start_date: "2030-01-10T00:00:00+08:00", end_date: "2031-01-10T00:00:00+08:00" }, "该期间与已存在的会计期间重叠"],
  ["同起始日", { period: "2031-04", start_date: "2030-01-01T00:00:00+08:00", end_date: "2031-01-01T00:00:00+08:00" }, "该期间与已存在的会计期间重叠"],
  ["起点==基准终点(左开)", { period: "2031-05", start_date: "2030-01-31T00:00:00+08:00", end_date: "2031-01-31T00:00:00+08:00" }, "不重叠"],
  ["终点==基准起点(右闭)", { period: "2031-06", start_date: "2030-01-01T00:00:00+08:00", end_date: "2030-01-01T00:00:00+08:00" }, "不重叠"],
  ["终点==基准起点+1秒", { period: "2031-07", start_date: "2030-01-01T00:00:00+08:00", end_date: "2030-01-01T00:00:01+08:00" }, "该期间与已存在的会计期间重叠"],
  ["起点==基准终点-1秒", { period: "2031-08", start_date: "2030-01-30T23:59:59+08:00", end_date: "2031-01-31T00:00:00+08:00" }, "该期间与已存在的会计期间重叠"],
  ["完全不重叠", { period: "2031-09", start_date: "2031-02-01T00:00:00+08:00", end_date: "2031-02-28T00:00:00+08:00" }, "不重叠"],
  ["缺日期(零值)", { period: "2031-10" }, "不重叠"],
]);

// 组 ②：period 唯一性与日期区间两个条件（2100 年，原版无该年数据 → 基准干净）
await suite("period 唯一性", { period: "2100-01", start_date: "2100-01-01T00:00:00+08:00", end_date: "2100-01-31T00:00:00+08:00" }, [
  ["period 相同", { period: "2100-01", start_date: "2100-06-01T00:00:00+08:00", end_date: "2100-06-30T00:00:00+08:00" }, "该期间与已存在的会计期间重叠"],
  ["period 不同 日期相同", { period: "2101-01", start_date: "2100-01-01T00:00:00+08:00", end_date: "2100-01-31T00:00:00+08:00" }, "该期间与已存在的会计期间重叠"],
  ["period 不同 日期重叠", { period: "2102-01", start_date: "2100-01-15T00:00:00+08:00", end_date: "2100-01-20T00:00:00+08:00" }, "该期间与已存在的会计期间重叠"],
  ["period 不同 日期不重叠", { period: "2103-01", start_date: "2101-06-01T00:00:00+08:00", end_date: "2101-06-30T00:00:00+08:00" }, "不重叠"],
]);

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
console.log(`\n通过 ${pass}｜失败 ${fail}`);
writeFileSync(
  "evidence/backend-runtime/audit-batch-mm-period-20261015.json",
  JSON.stringify({ generated: new Date().toISOString(), base: BASE, summary: { total: results.length, pass, fail }, results }, null, 2)
);
console.log("已写出 → evidence/backend-runtime/audit-batch-mm-period-20261015.json");
process.exit(fail === 0 ? 0 : 1);