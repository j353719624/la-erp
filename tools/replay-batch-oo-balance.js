#!/usr/bin/env node
// 批次 OO · 科目余额成功态的受控对照（2026-10-15）。
//
// ## 待验证的假设
// 恢复端 `account_balances` 表为空时 AccountBalance 返回 null。原版也一样
// （12 个科目里 7 个返回 null），所以「返回 null」**不是缺口**。
// 但发现了新的疑点，两端格式可能不一致：
//   · AccountBalance 用 accountingPeriod(now()) 查，格式 = 2026-10-01T00:00:00+08:00
//   · SetOpeningBalances 写入的 period 是入参原样，格式 = 2026-10
// 两者对不上 → 期初余额写进去却查不出来。本脚本用受控对照验证。
//
// ## 受控对照设计
// 两端各建一个**新科目**（名称/code 互不相同），写入同一金额，再读回 balance。
// 若原版能读出而恢复端读不出，就是恢复端的 period 格式缺陷；
// 若两端都读不出，那是原版行为，恢复端无需改（也不能自造）。
//
// 用法：ERP_PASSWORD=xxx [OO_RECOVERED=url] node tools/replay-batch-oo-balance.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.OO_RECOVERED ?? "http://127.0.0.1:18903";
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
const origToken = await token(ORIG, true);
const recToken = await token(RECOVERED, false);

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json };
}

const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function run(tag, base, tk, code) {
  say(`\n===== ${tag} =====`);
  // 1) 建科目
  const created = await call(base, tk, "POST", "/api/v1/accounts", {
    code, name: code + "余额测试科目", category: "asset",
  });
  say(`建科目 ${code}: http${created.http} code=${created.json?.code} ${created.json?.message ?? ""}`);
  if (created.http !== 200 || created.json?.code !== 0) return null;
  const id = created.json.data?.id ?? created.json.data?.data?.id;
  if (!id) { say("  取不到科目 id：" + JSON.stringify(created.json).slice(0, 200)); return null; }
  say(`  id=${id}`);

  // 2) 读 balance（写入前）
  const before = await call(base, tk, "GET", `/api/v1/accounts/${id}/balance`);
  say(`写入前 balance: http${before.http} code=${before.json?.code} data=${JSON.stringify(before.json?.data)}`);

  // 3) 写期初余额
  const period = "2026-10";
  const set = await call(base, tk, "POST", "/api/v1/accounting-periods/opening-balances", {
    period, entries: [{ account_id: id, begin_balance: 123 }],
  });
  say(`写期初 ${period} begin=123: http${set.http} code=${set.json?.code} ${set.json?.message ?? ""}`);

  // 4) 再读 balance（不带 period 参数，走默认当期）
  const after = await call(base, tk, "GET", `/api/v1/accounts/${id}/balance`);
  say(`写入后 balance（默认期间）: http${after.http} code=${after.json?.code} data=${JSON.stringify(after.json?.data)}`);

  // 5) 带 period 参数再读两种格式
  for (const p of [period, "2026-10-01T00:00:00+08:00"]) {
    const r = await call(base, tk, "GET", `/api/v1/accounts/${id}/balance?period=${encodeURIComponent(p)}`);
    say(`写入后 balance?period=${p}: http${r.http} data=${JSON.stringify(r.json?.data)}`);
  }
  return { id, before, set, after };
}

await run("原版", ORIG, origToken, "OO-BAL-ORIG");
await run("恢复端", RECOVERED, recToken, "OO-BAL-REC");

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-oo-balance-20261015.txt",
  log.join("\n") + "\n",
);
