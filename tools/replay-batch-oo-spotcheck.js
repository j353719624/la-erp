#!/usr/bin/env node
// 批次 OO · 18886 实例抽查（2026-10-15）。
//
// ## 目的
// 确认用户实际访问的 18886 实例已经跑在最新二进制（la-erp-oo6.exe / fa373ef），
// 且本轮两处修复在线上实例上真实生效：
//   ① POST /vouchers 缺 type → 400「系统内部错误，请稍后重试或联系管理员」（不是 SQL 约束原文）
//   ② 建凭证 → approve → post → balance 应拿到 end=100
//   ③ 科目余额 period 语义：升序取首条
//   ④ 期初余额写入后能查回
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-oo-spotcheck.js
import { writeFileSync } from "node:fs";

const BASE = process.env.OO_ACTUAL ?? "http://127.0.0.1:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function call(tk, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: tk ? `Bearer ${tk}` : "",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json };
}

// ---------- 0) 登录 ----------
const lr = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: PASS }),
});
const lj = await lr.json();
const tk = lj?.data?.access_token ?? "";
say(`[0] 登录 http${lr.status} code=${lj?.code} token=${tk ? tk.slice(0, 12) + "..." : "无"}`);
if (!tk) { say("登录失败，终止"); writeFileSync("C:/Users/35371/AppData/Local/Temp/oo-spotcheck.txt", log.join("\n")); process.exit(1); }

// ---------- 1) 凭证缺 type ----------
say("\n[1] POST /vouchers 缺 type（应 400 + 系统内部错误，不应出现 SQL 原文）");
const cash = await (async () => {
  const r = await call(tk, "GET", "/api/v1/accounts?page=1&page_size=100");
  const list = r.json?.data?.list ?? r.json?.data ?? [];
  for (const a of list) if (["1001", "1002"].includes(String(a.code))) return a;
  return list.find((a) => a.category === "asset") ?? list[0];
})();
const stamp = Date.now().toString().slice(-6);

const acc = await call(tk, "POST", "/api/v1/accounts", {
  code: "SPOT" + stamp, name: "抽查科目" + stamp, category: "expense",
});
const aid = acc.json?.data?.id;
say(`  建科目 http${acc.http} id=${aid}`);

const vNoType = await call(tk, "POST", "/api/v1/vouchers", {
  voucher_date: "2026-10-05T00:00:00+08:00",
  remark: "SPOT-" + stamp + "-缺type",
  entries: [
    { account_id: aid, account_name: "抽查科目" + stamp, direction: "debit", amount: 100 },
    { account_id: cash.id, account_name: cash.name, direction: "credit", amount: 100 },
  ],
});
const msgNoType = vNoType.json?.message ?? "";
say(`  http=${vNoType.http} code=${vNoType.json?.code} message="${msgNoType}"`);
const leakSQL = /constraint|NOT NULL|SQL|sqlite/i.test(msgNoType);
say(`  判定: ${vNoType.http === 400 && msgNoType === "系统内部错误，请稍后重试或联系管理员"
  ? "PASS（与原版一致的通用 500 文案下压到 400）"
  : leakSQL ? "FAIL（仍在泄漏 SQL 原文）" : "FAIL（形态不符）"}`);

// ---------- 2) 完整过账链路 ----------
say("\n[2] 建凭证 → approve → post → balance");
const v = await call(tk, "POST", "/api/v1/vouchers", {
  voucher_date: "2026-10-05T00:00:00+08:00",
  type: "general",
  remark: "SPOT-" + stamp + "-过账",
  entries: [
    { account_id: aid, account_name: "抽查科目" + stamp, direction: "debit", amount: 100 },
    { account_id: cash.id, account_name: cash.name, direction: "credit", amount: 100 },
  ],
});
const vid = v.json?.data?.id;
say(`  建凭证 http${v.http} code=${v.json?.code} ${v.json?.message ?? ""} id=${vid}`);
if (vid) {
  const ap = await call(tk, "POST", `/api/v1/vouchers/${vid}/approve`, {});
  say(`  approve http${ap.http} code=${ap.json?.code} ${ap.json?.message ?? ""}`);
  const po = await call(tk, "POST", `/api/v1/vouchers/${vid}/post`, {});
  say(`  post    http${po.http} code=${po.json?.code} ${po.json?.message ?? ""}`);
  const b = await call(tk, "GET", `/api/v1/accounts/${aid}/balance`);
  const d = b.json?.data;
  say(`  balance: ${d ? `period=${d.period} begin=${d.begin_balance} debit=${d.debit_amount} credit=${d.credit_amount} end=${d.end_balance}` : "null"}`);
  const ok = d && Number(d.end_balance) === 100 && String(d.period).startsWith("2026-10-01");
  say(`  判定: ${ok ? "PASS（end=begin+debit-credit=100，period=2026-10-01）" : "FAIL"}`);
}

// ---------- 3) 期初余额 ----------
say("\n[3] 期初余额写入 → 查回");
const ob = await call(tk, "POST", "/api/v1/periods/2026-09/opening-balances", {
  entries: [{ account_id: aid, begin_balance: 500, direction: "debit" }],
});
say(`  写入 http${ob.http} code=${ob.json?.code} ${ob.json?.message ?? ""} total=${ob.json?.data?.total}`);
const obg = await call(tk, "GET", "/api/v1/periods/2026-09/opening-balances");
const list = obg.json?.data?.list ?? [];
say(`  查回 http${obg.http} total=${obg.json?.data?.total} 首条=${list[0] ? JSON.stringify(list[0]).slice(0, 160) : "无"}`);
const hit = list.find((x) => String(x.account_id) === String(aid));
say(`  命中本科目: ${hit ? JSON.stringify(hit).slice(0, 160) : "否"}`);

// ---------- 4) 门户鉴权 ----------
say("\n[4] 门户分类/商品鉴权（匿名应 401 登录状态无效）");
for (const p of ["/api/v1/portal/categories", "/api/v1/portal/products"]) {
  const r = await call("", "GET", p);
  say(`  匿名 GET ${p} → http${r.http} code=${r.json?.code} ${r.json?.message ?? ""}`);
}

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-spotcheck-20261015.txt",
  log.join("\n") + "\n",
);
say("\n证据已落盘。");
