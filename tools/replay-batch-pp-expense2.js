#!/usr/bin/env node
// 批次 PP · 费用报销状态机补取证（2026-10-15）。
//
// 承接 audit-batch-pp-expense：已确认 5 个动作的**文案**全部不一致。
// 本轮确认 cancel 是否存在**逻辑差异**（不只是文案）：
//   恢复端代码 `status != "draft" && status != "submitted"` → 允许 draft/submitted 取消
//   原版文案说「只有草稿状态的报销单才能取消」→ 但行为是否真只允许 draft？
//
// 用例（各用独立单据）：
//   E9  submit → cancel            submitted 能否取消
//   E10 submit → reject → cancel   rejected 能否取消
//   E11 submit → approve → paid    完整成功链路（两次过账：审批 + 付款）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-expense2.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const ACTUAL = process.env.OO_ACTUAL ?? "http://127.0.0.1:18886";
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
const rTk = await token(ACTUAL, false);
if (!oTk || !rTk) { console.error("登录失败"); process.exit(1); }

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
const stamp = Date.now().toString().slice(-6);

async function newClaim(base, tk, suffix) {
  const r = await call(base, tk, "POST", "/api/v1/expense-claims", {
    employee_name: "取证员工",
    claim_date: "2026-04-10T00:00:00+08:00",
    total_amount: 100,
    remark: suffix,
    lines: [{ expense_date: "2026-04-10T00:00:00+08:00", category: "差旅费", amount: 100 }],
  });
  return r.json?.data?.id;
}

const CASES = [
  ["E9  submit→cancel", [["submit"], ["cancel"]]],
  ["E10 submit→reject→cancel", [["submit"], ["reject"], ["cancel"]]],
  ["E11 submit→approve→paid", [["submit"], ["approve"], ["paid"]]],
];

for (const [name, steps] of CASES) {
  say(`\n=== ${name} ===`);
  for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", ACTUAL, rTk]]) {
    const id = await newClaim(base, tk, tag + stamp + name.replace(/\W/g, ""));
    const out = [];
    for (const [a, body] of steps) {
      const r = await call(base, tk, "POST", `/api/v1/expense-claims/${id}/${a}`, body);
      out.push(`${a}: http${r.http} code=${r.json?.code} ${r.json?.message ?? "success"} status=${r.json?.data?.status ?? "-"}`);
    }
    say(`  [${tag}] ${out.join(" | ")}`);
  }
}

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-expense2-20261015.txt",
  log.join("\n") + "\n",
);
say("\n证据已落盘。");
