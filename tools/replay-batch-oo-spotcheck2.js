#!/usr/bin/env node
// 批次 OO · 抽查补跑（2026-10-15）。
//
// 修正上一版两处：
//   ① 期初余额真实路径是 POST /api/v1/accounting-periods/opening-balances（不是 /periods/{p}/...）
//   ② 复查 approve 失败（400 凭证不存在或状态不允许审批）但 post 成功的现象
//
// 用法：ERP_PASSWORD=xxx [OO_RECOVERED=url] node tools/replay-batch-oo-spotcheck2.js
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
  return { http: res.status, json };
}

const log = [];
const say = (s) => { log.push(s); console.log(s); };

// ============ A) 期初余额真实路径 ============
say("=== A) 期初余额：固定路径 vs 带 period 路径（两端对照）===");
for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]]) {
  say(`\n--- ${tag} ---`);
  const p1 = await call(base, tk, "POST", "/api/v1/accounting-periods/opening-balances", {
    period: "2026-09", entries: [],
  });
  say(`  POST /api/v1/accounting-periods/opening-balances {period:2026-09, entries:[]} → http${p1.http} code=${p1.json?.code} "${p1.json?.message ?? ""}"`);
  const p2 = await call(base, tk, "POST", "/api/v1/periods/2026-09/opening-balances", {
    entries: [],
  });
  say(`  POST /api/v1/periods/2026-09/opening-balances  → http${p2.http} code=${p2.json?.code} "${p2.json?.message ?? ""}"`);
  const p3 = await call(base, tk, "GET", "/api/v1/periods/2026-09/opening-balances");
  say(`  GET  /api/v1/periods/2026-09/opening-balances  → http${p3.http} code=${p3.json?.code} "${p3.json?.message ?? ""}"`);
}

// ============ B) 期初余额写入 → 查回 ============
say("\n=== B) 期初余额写入 → 查回（恢复端）===");
const stamp = Date.now().toString().slice(-6);
const acc = await call(RECOVERED, rTk, "POST", "/api/v1/accounts", {
  code: "OB" + stamp, name: "期初科目" + stamp, category: "asset",
});
const aid = acc.json?.data?.id;
say(`  建科目 http${acc.http} id=${aid}`);
if (aid) {
  const w = await call(RECOVERED, rTk, "POST", "/api/v1/accounting-periods/opening-balances", {
    period: "2026-09",
    entries: [{ account_id: aid, begin_balance: 500, direction: "debit" }],
  });
  say(`  写入 http${w.http} code=${w.json?.code} "${w.json?.message ?? ""}" data=${JSON.stringify(w.json?.data).slice(0, 200)}`);
  const g = await call(RECOVERED, rTk, "GET", "/api/v1/accounts/" + aid + "/balance");
  say(`  查科目余额 http${g.http} data=${JSON.stringify(g.json?.data).slice(0, 200)}`);
}

// ============ C) approve / post 状态机 ============
say("\n=== C) 凭证状态机：新建后直接 approve / post（两端对照）===");
async function voucherFlow(tag, base, tk, code) {
  say(`\n--- ${tag} ---`);
  const cash = await (async () => {
    const r = await call(base, tk, "GET", "/api/v1/accounts?page=1&page_size=100");
    const list = r.json?.data?.list ?? r.json?.data ?? [];
    for (const a of list) if (["1001", "1002"].includes(String(a.code))) return a;
    return list.find((a) => a.category === "asset") ?? list[0];
  })();
  const acc2 = await call(base, tk, "POST", "/api/v1/accounts", {
    code, name: code + "状态机科目", category: "expense",
  });
  const aid2 = acc2.json?.data?.id;
  if (!aid2) { say("  建科目失败 " + JSON.stringify(acc2.json).slice(0, 160)); return; }

  const v = await call(base, tk, "POST", "/api/v1/vouchers", {
    voucher_date: "2026-10-05T00:00:00+08:00",
    type: "general",
    remark: code + "-状态机",
    entries: [
      { account_id: aid2, account_name: code + "状态机科目", direction: "debit", amount: 77 },
      { account_id: cash.id, account_name: cash.name, direction: "credit", amount: 77 },
    ],
  });
  const vid = v.json?.data?.id;
  say(`  建凭证 http${v.http} code=${v.json?.code} id=${vid}`);
  if (!vid) return;

  // 看新建出来的状态
  const gd = await call(base, tk, "GET", "/api/v1/vouchers/" + vid);
  say(`  新建后 GET 状态 = ${gd.json?.data?.status ?? "?"}`);

  const ap = await call(base, tk, "POST", `/api/v1/vouchers/${vid}/approve`, {});
  say(`  approve → http${ap.http} code=${ap.json?.code} "${ap.json?.message ?? ""}"`);

  const gd2 = await call(base, tk, "GET", "/api/v1/vouchers/" + vid);
  say(`  approve 后状态 = ${gd2.json?.data?.status ?? "?"}`);

  const po = await call(base, tk, "POST", `/api/v1/vouchers/${vid}/post`, {});
  say(`  post    → http${po.http} code=${po.json?.code} "${po.json?.message ?? ""}"`);

  const gd3 = await call(base, tk, "GET", "/api/v1/vouchers/" + vid);
  say(`  post 后状态 = ${gd3.json?.data?.status ?? "?"}`);

  const b = await call(base, tk, "GET", "/api/v1/accounts/" + aid2 + "/balance");
  const d = b.json?.data;
  say(`  balance = ${d ? JSON.stringify(d).slice(0, 200) : "null"}`);
}
await voucherFlow("恢复端", RECOVERED, rTk, "VC" + stamp + "R");
await voucherFlow("原版", ORIG, oTk, "VC" + stamp + "O");

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-spotcheck2-20261015.txt",
  log.join("\n") + "\n",
);
say("\n证据已落盘。");
