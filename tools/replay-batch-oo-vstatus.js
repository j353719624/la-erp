#!/usr/bin/env node
// 批次 OO · 凭证状态机取证（2026-10-15）。
//
// ## 背景
// 恢复端 business/vouchers.go 的 VoucherAction 状态判定：
//   approve: 要求 status == "posted"  → 新建凭证是 draft，故 approve 永远失败（死代码）
//   post:    要求 status == "draft"
// 正常链路应为 draft → approve(approved) → post(posted)。
//
// 原版 POST /vouchers 目前一律 400（实例退化，见台账 44.3），
// 无法用「新建凭证」做对照，故改用**原版存量凭证**只读探测 + 最小破坏动作探测。
//
// ## 取证顺序（先只读，确有必要时才动作）
//   ① GET /vouchers 拿状态分布
//   ② 对一条 draft 凭证调 approve（会改状态，但这是唯一能确定顺序的手段）
//   ③ 对一条 approved 凭证调 post
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-oo-vstatus.js
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

// ---------- ① 状态分布（只读） ----------
async function distribution(tag, base, tk) {
  const r = await call(base, tk, "GET", "/api/v1/vouchers?page=1&page_size=200");
  const list = r.json?.data?.list ?? r.json?.data ?? [];
  const byStatus = {};
  for (const v of list) byStatus[v.status ?? "?"] = (byStatus[v.status ?? "?"] ?? 0) + 1;
  say(`[${tag}] GET /vouchers http${r.http} 总数=${list.length} 分布=${JSON.stringify(byStatus)}`);
  return list;
}
const oList = await distribution("原版", ORIG, oTk);
const rList = await distribution("恢复端", RECOVERED, rTk);

// ---------- ② 原版：对 draft 凭证 approve ----------
say("\n=== ② 原版：draft → approve ===");
const oDraft = oList.find((v) => v.status === "draft");
if (oDraft) {
  say(`  选中 draft 凭证 ${oDraft.id} (${oDraft.voucher_no ?? oDraft.remark ?? ""})`);
  const a = await call(ORIG, oTk, "POST", `/api/v1/vouchers/${oDraft.id}/approve`, {});
  say(`  approve → http${a.http} code=${a.json?.code} "${a.json?.message ?? ""}"`);
  const g = await call(ORIG, oTk, "GET", `/api/v1/vouchers/${oDraft.id}`);
  say(`  approve 后状态 = ${g.json?.data?.status}`);
  if (String(g.json?.data?.status) === "approved") {
    const p = await call(ORIG, oTk, "POST", `/api/v1/vouchers/${oDraft.id}/post`, {});
    say(`  approved → post → http${p.http} code=${p.json?.code} "${p.json?.message ?? ""}"`);
    const g2 = await call(ORIG, oTk, "GET", `/api/v1/vouchers/${oDraft.id}`);
    say(`  post 后状态 = ${g2.json?.data?.status}`);
  }
} else {
  say("  原版无 draft 凭证");
}

// ---------- ③ 原版：对 approved 凭证 post ----------
say("\n=== ③ 原版：approved → post ===");
const oApproved = oList.find((v) => v.status === "approved");
if (oApproved) {
  say(`  选中 approved 凭证 ${oApproved.id}`);
  const p = await call(ORIG, oTk, "POST", `/api/v1/vouchers/${oApproved.id}/post`, {});
  say(`  post → http${p.http} code=${p.json?.code} "${p.json?.message ?? ""}"`);
  const g = await call(ORIG, oTk, "GET", `/api/v1/vouchers/${oApproved.id}`);
  say(`  post 后状态 = ${g.json?.data?.status}`);
} else {
  say("  原版无 approved 凭证");
}

// ---------- ④ 原版：对 posted 凭证 approve（验证恢复端逻辑是否来自原版） ----------
say("\n=== ④ 原版：posted → approve（恢复端要求 posted 才能审批，验证是否原版如此）===");
const oPosted = oList.find((v) => v.status === "posted");
if (oPosted) {
  say(`  选中 posted 凭证 ${oPosted.id}`);
  const a = await call(ORIG, oTk, "POST", `/api/v1/vouchers/${oPosted.id}/approve`, {});
  say(`  approve → http${a.http} code=${a.json?.code} "${a.json?.message ?? ""}"`);
  const g = await call(ORIG, oTk, "GET", `/api/v1/vouchers/${oPosted.id}`);
  say(`  approve 后状态 = ${g.json?.data?.status}`);
} else {
  say("  原版无 posted 凭证");
}

// ---------- ⑤ 原版：对 draft 凭证 post（恢复端允许 draft→post） ----------
say("\n=== ⑤ 原版：draft → post（恢复端允许，验证原版）===");
const oDraft2 = oList.filter((v) => v.status === "draft")[1] ?? oList.find((v) => v.status === "draft");
if (oDraft2 && oDraft2.id !== oDraft?.id) {
  say(`  选中 draft 凭证 ${oDraft2.id}`);
  const p = await call(ORIG, oTk, "POST", `/api/v1/vouchers/${oDraft2.id}/post`, {});
  say(`  post → http${p.http} code=${p.json?.code} "${p.json?.message ?? ""}"`);
  const g = await call(ORIG, oTk, "GET", `/api/v1/vouchers/${oDraft2.id}`);
  say(`  post 后状态 = ${g.json?.data?.status}`);
} else {
  say("  无第二条 draft 凭证可测");
}

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-oo-vstatus-20261015.txt",
  log.join("\n") + "\n",
);
say("\n证据已落盘。");
