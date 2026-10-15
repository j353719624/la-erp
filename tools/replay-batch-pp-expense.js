#!/usr/bin/env node
// 批次 PP · 费用报销状态机文案的逐动作取证（2026-10-15）。
//
// 已发现一处差异：draft → approve 时
//   原版 10000「只有已提交的报销单才能审批」
//   恢复端 10000「只有已提交报销才能审批」
// 恢复端 expense_claims.go 共 5 个动作，需逐条取证，**不能凭 approve 一条推广**。
//
// ## 设计
// 每个用例用**独立的新建报销单**，避免状态互相污染。
// 用例编号即单据 claim_no 后缀，互不重复。
//
// 用例：
//   E1 draft → approve         取 approve 文案（已知有差异）
//   E2 draft → reject          取 reject 文案
//   E3 draft → paid            取 paid 文案
//   E4 draft → cancel          应成功（draft 可取消）
//   E5 draft → submit → submit 取第二个 submit 的文案
//   E6 draft → submit → paid   取 paid 文案（submitted 状态下）
//   E7 draft → submit → approve → approve  取 approve 文案（approved 状态下）
//   E8 draft → approve → cancel 取 cancel 文案（approved 不可取消）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-expense.js
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
    remark: "状态机取证" + suffix,
    lines: [{ expense_date: "2026-04-10T00:00:00+08:00", category: "差旅费", amount: 100, remark: "明细" }],
  });
  return r.json?.data?.id;
}
async function act(base, tk, id, action, body) {
  return call(base, tk, "POST", `/api/v1/expense-claims/${id}/${action}`, body);
}

// steps: [[action, body]]，依次执行；返回每步的形态
async function runCase(base, tk, suffix, steps) {
  const id = await newClaim(base, tk, suffix);
  if (!id) return [{ step: "new", text: "建单失败" }];
  const out = [];
  for (const [action, body] of steps) {
    const r = await act(base, tk, id, action, body);
    out.push({
      step: action,
      text: `http${r.http} code=${r.json?.code} ${r.json?.message ?? "success"}`,
    });
  }
  return out;
}

const CASES = [
  ["E1", [["approve"]]],
  ["E2", [["reject"]]],
  ["E3", [["paid"]]],
  ["E4", [["cancel"]]],
  ["E5", [["submit"], ["submit"]]],
  ["E6", [["submit"], ["paid"]]],
  ["E7", [["submit"], ["approve"], ["approve"]]],
  ["E8", [["submit"], ["approve"], ["cancel"]]],
];

let diff = 0;
for (const [name, steps] of CASES) {
  say(`\n=== ${name}: ${steps.map((s) => s[0]).join(" → ")} ===`);
  const o = await runCase(ORIG, oTk, "O" + stamp + name, steps);
  const r = await runCase(RECOVERED, rTk, "R" + stamp + name, steps);
  for (let i = 0; i < steps.length; i++) {
    const of = o[i]?.text ?? "-";
    const rf = r[i]?.text ?? "-";
    const same = of === rf;
    if (!same) diff++;
    say(`${same ? "  " : "!!"} ${steps[i][0].padEnd(8)}`);
    say(`     原版 : ${of}`);
    say(`     恢复端: ${rf}`);
  }
}
say(`\n不一致步数 = ${diff}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-expense-20261015.txt",
  log.join("\n") + "\n",
);
