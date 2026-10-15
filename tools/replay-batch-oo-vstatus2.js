#!/usr/bin/env node
// 批次 OO · 凭证状态机「恢复端」对照（2026-10-15）。
//
// 承接 audit-batch-oo-vstatus：原版已取证
//   draft → approve  = 400「凭证不存在或状态不允许审批」
//   posted → approve = 200 → approved
//   draft → post     = 200 → posted
// 恢复端 business/vouchers.go 的判定与之完全同形，故**不做修改**。
// 本脚本在恢复端跑同样三条，确认逐字一致后作为反向回归留档。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-oo-vstatus2.js
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
const st = async (base, tk, id) =>
  String((await call(base, tk, "GET", `/api/v1/vouchers/${id}`)).json?.data?.status ?? "?");

const log = [];
const say = (s) => { log.push(s); console.log(s); };

// 恢复端：造一条 draft 凭证（原版造不了，故用恢复端自己的），走 post → approve
const stamp = Date.now().toString().slice(-6);
say("=== 恢复端：新建 draft → post → approve（复刻原版取证路径）===");
const cash = await (async () => {
  const r = await call(RECOVERED, rTk, "GET", "/api/v1/accounts?page=1&page_size=100");
  const list = r.json?.data?.list ?? r.json?.data ?? [];
  for (const a of list) if (["1001", "1002"].includes(String(a.code))) return a;
  return list.find((a) => a.category === "asset") ?? list[0];
})();
const acc = await call(RECOVERED, rTk, "POST", "/api/v1/accounts", {
  code: "VS" + stamp, name: "状态科目" + stamp, category: "expense",
});
const aid = acc.json?.data?.id;
const v = await call(RECOVERED, rTk, "POST", "/api/v1/vouchers", {
  voucher_date: "2026-10-05T00:00:00+08:00",
  type: "general",
  remark: "VS" + stamp,
  entries: [
    { account_id: aid, account_name: "状态科目" + stamp, direction: "debit", amount: 33 },
    { account_id: cash.id, account_name: cash.name, direction: "credit", amount: 33 },
  ],
});
const vid = v.json?.data?.id;
say(`  建凭证 http${v.http} id=${vid}`);
if (vid) {
  say(`  新建后状态 = ${await st(RECOVERED, rTk, vid)}`);
  const a1 = await call(RECOVERED, rTk, "POST", `/api/v1/vouchers/${vid}/approve`, {});
  say(`  draft  → approve → http${a1.http} code=${a1.json?.code} "${a1.json?.message ?? ""}"   [原版同形: 400 凭证不存在或状态不允许审批]`);
  const p1 = await call(RECOVERED, rTk, "POST", `/api/v1/vouchers/${vid}/post`, {});
  say(`  draft  → post    → http${p1.http} code=${p1.json?.code} "${p1.json?.message ?? ""}"   [原版同形: 200 success]`);
  say(`  post 后状态 = ${await st(RECOVERED, rTk, vid)}`);
  const a2 = await call(RECOVERED, rTk, "POST", `/api/v1/vouchers/${vid}/approve`, {});
  say(`  posted → approve → http${a2.http} code=${a2.json?.code} "${a2.json?.message ?? ""}"   [原版同形: 200 success]`);
  say(`  approve 后状态 = ${await st(RECOVERED, rTk, vid)}`);
  const p2 = await call(RECOVERED, rTk, "POST", `/api/v1/vouchers/${vid}/post`, {});
  say(`  approved → post → http${p2.http} code=${p2.json?.code} "${p2.json?.message ?? ""}"`);
}

// 原版：对新造的 approved 凭证再 post（补足原版 approved→post 的一手证据）
say("\n=== 原版：approved → post（用上一步刚 approve 出来的那条）===");
const o2 = await call(ORIG, oTk, "GET", "/api/v1/vouchers?page=1&page_size=200");
const approved = (o2.json?.data?.list ?? []).find((x) => x.status === "approved");
if (approved) {
  say(`  选中 approved 凭证 ${approved.id}`);
  const p = await call(ORIG, oTk, "POST", `/api/v1/vouchers/${approved.id}/post`, {});
  say(`  post → http${p.http} code=${p.json?.code} "${p.json?.message ?? ""}"`);
  say(`  post 后状态 = ${await st(ORIG, oTk, approved.id)}`);
} else {
  say("  无 approved 凭证");
}

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-oo-vstatus2-20261015.txt",
  log.join("\n") + "\n",
);
say("\n证据已落盘。");
