#!/usr/bin/env node
// 批次 OO · 过账链路的受控对照（2026-10-15）。
//
// ## 目的
// 验证「凭证过账后科目余额是否按原版口径累加」。这是财务模块的实质功能：
// 期初余额之前已能写能查，但**过账是否真正驱动 account_balances** 还没验证过。
//
// ## 流程（两端各做一遍，科目 code / 凭证 remark 互不相同）
//   建科目 → 建凭证（借 新科目 / 贷 现金科目）→ approve → post → 读 balance
//
// 三处要对照：
//   ① 过账后 balance 是否不再是 null
//   ② debit/credit/end_balance 的数值口径（end = begin + debit - credit？）
//   ③ 跨月结转：上月 end_balance 是否成为本月 begin_balance
//
// 用法：ERP_PASSWORD=xxx [OO_RECOVERED=url] node tools/replay-batch-oo-posting.js
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
const origToken = await token(ORIG, true);
const recToken = await token(RECOVERED, false);
if (!origToken || !recToken) { console.error("两端登录失败"); process.exit(1); }

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
const brief = (d) => d
  ? `period=${d.period} begin=${d.begin_balance} debit=${d.debit_amount} credit=${d.credit_amount} end=${d.end_balance}`
  : "null";

// 找一个现金/银行类科目当贷方
async function pickCash(base, tk) {
  const r = await call(base, tk, "GET", "/api/v1/accounts?page=1&page_size=100");
  const list = r.json?.data?.list ?? r.json?.data ?? [];
  for (const a of list) {
    if (["1001", "1002"].includes(String(a.code))) return a;
  }
  return list.find((a) => a.category === "asset") ?? list[0];
}

async function scenario(tag, base, tk, code) {
  say(`\n===== ${tag} =====`);
  const cash = await pickCash(base, tk);
  say(`贷方科目: ${cash?.code} ${cash?.name} (${cash?.id})`);

  // 1) 建借方科目
  const acc = await call(base, tk, "POST", "/api/v1/accounts", {
    code, name: code + "过账测试科目", category: "expense",
  });
  const aid = acc.json?.data?.id;
  if (!aid) { say("建科目失败: " + JSON.stringify(acc.json).slice(0, 200)); return; }
  say(`借方科目 ${code} = ${aid}`);

  // 2) 建凭证（10 月）
  const v = await call(base, tk, "POST", "/api/v1/vouchers", {
    voucher_date: "2026-10-05T00:00:00+08:00",
    type: "general",
    remark: code + "-10月",
    entries: [
      { account_id: aid, account_name: code + "过账测试科目", direction: "debit", amount: 100 },
      { account_id: cash.id, account_name: cash.name, direction: "credit", amount: 100 },
    ],
  });
  const vid = v.json?.data?.id;
  say(`建凭证: http${v.http} code=${v.json?.code} ${v.json?.message ?? ""} id=${vid}`);
  if (!vid) return;

  // 3) approve → post
  const ap = await call(base, tk, "POST", `/api/v1/vouchers/${vid}/approve`, {});
  say(`approve: http${ap.http} code=${ap.json?.code} ${ap.json?.message ?? ""}`);
  const po = await call(base, tk, "POST", `/api/v1/vouchers/${vid}/post`, {});
  say(`post:    http${po.http} code=${po.json?.code} ${po.json?.message ?? ""}`);

  // 4) 读 balance
  const b1 = await call(base, tk, "GET", `/api/v1/accounts/${aid}/balance`);
  say(`过账后 balance: ${brief(b1.json?.data)}`);

  // 5) 再过账一张 11 月的凭证（同一科目），看是否新增行/累加
  const v2 = await call(base, tk, "POST", "/api/v1/vouchers", {
    voucher_date: "2026-11-05T00:00:00+08:00",
    type: "general",
    remark: code + "-11月",
    entries: [
      { account_id: aid, account_name: code + "过账测试科目", direction: "debit", amount: 50 },
      { account_id: cash.id, account_name: cash.name, direction: "credit", amount: 50 },
    ],
  });
  const vid2 = v2.json?.data?.id;
  if (vid2) {
    await call(base, tk, "POST", `/api/v1/vouchers/${vid2}/approve`, {});
    const p2 = await call(base, tk, "POST", `/api/v1/vouchers/${vid2}/post`, {});
    say(`11月 post: http${p2.http} code=${p2.json?.code} ${p2.json?.message ?? ""}`);
    const b2 = await call(base, tk, "GET", `/api/v1/accounts/${aid}/balance`);
    say(`11月过账后 balance（应仍是最早期间那条）: ${brief(b2.json?.data)}`);
  }
  return aid;
}

const stamp = Date.now().toString().slice(-6);
await scenario("原版", ORIG, origToken, "OOP"+stamp+"A");
await scenario("恢复端", RECOVERED, recToken, "OOP"+stamp+"B");

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-oo-posting-20261015.txt",
  log.join("\n") + "\n",
);
