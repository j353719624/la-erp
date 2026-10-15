#!/usr/bin/env node
// 批次 PP · 业务单据状态机文案的批量取证（2026-10-15）。
//
// ## 起因
// 报销状态机的 5 个动作文案**全部**与原版不符（原版「只有<状态>的报销单才能<动作>」，
// 恢复端是简写）。排查发现代码里还有一批同类简写形态，需逐条取证，
// **不能凭报销一条推广**，因为各单据的原版措辞未必同构。
//
// ## 可疑清单（缺「的」的简写形态）
//   attendance.go:25/30/35/40   考勤申请 submit/approve/reject/cancel
//   assemblies.go:27/32         装配单 confirm/cancel
//   performance.go:21           绩效考核 finalize
//   payroll_confirm.go:19       工资批次 confirm
//
// ## 设计
// 每个用例用独立新建单据，状态互不污染。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-statemachine.js
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

// ── 建单辅助 ──────────────────────────────────────────────────────────
async function newDoc(base, tk, route, payload) {
  const r = await call(base, tk, "POST", "/api/v1/" + route, payload);
  return r.json?.data?.id;
}

// 考勤：employee_name / request_type / start_date 必填
async function newAttendance(base, tk, suffix) {
  return newDoc(base, tk, "attendance-requests", {
    employee_name: "考勤取证" + suffix,
    request_type: "leave",
    start_date: "2026-04-10T00:00:00+08:00",
    days: 1,
    reason: "取证" + suffix,
  });
}
// 装配单：assembly_no / warehouse_id / product_id 必填；
// **lines 必填**（原版缺明细回 200+10000「组件明细不能为空」，字段名实测只有 lines）。
async function newAssembly(base, tk, suffix) {
  const w = await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=1");
  const p = await call(base, tk, "GET", "/api/v1/products?page=1&page_size=1");
  const wl = w.json?.data?.list ?? [];
  const pl = p.json?.data?.list ?? [];
  return newDoc(base, tk, "assemblies", {
    assembly_no: "AS" + suffix,
    warehouse_id: wl[0]?.id,
    product_id: pl[0]?.id,
    qty: 1,
    lines: [{ product_id: pl[0]?.id, qty: 1, unit_cost: 1 }],
  });
}
// 绩效：code / employee_name / period 必填；**items 必填**（原版缺明细回
// 「考核指标不能为空（可选择模板或录入指标）」）。
async function newPerf(base, tk, suffix) {
  return newDoc(base, tk, "perf-assessments", {
    code: "PA" + suffix,
    employee_name: "绩效取证" + suffix,
    period: "2026-04",
    score: 90,
    items: [{ name: "指标一", weight: 50, score: 45 }, { name: "指标二", weight: 50, score: 45 }],
  });
}
// 工资：period + items
async function newPayroll(base, tk, suffix) {
  return newDoc(base, tk, "payrolls", {
    period: "2026-05",
    remark: "取证" + suffix,
    items: [{ employee_name: "取证员工", base_salary: 3000, bonus: 0, allowance: 0, deduction: 0 }],
  });
}

async function act(base, tk, route, id, action) {
  return call(base, tk, "POST", `/api/v1/${route}/${id}/${action}`, {});
}

const CASES = [
  { name: "A1 考勤 draft→approve", route: "attendance-requests", mk: newAttendance, steps: ["approve"] },
  { name: "A2 考勤 draft→reject", route: "attendance-requests", mk: newAttendance, steps: ["reject"] },
  { name: "A3 考勤 draft→cancel", route: "attendance-requests", mk: newAttendance, steps: ["cancel"] },
  { name: "A4 考勤 submit→submit", route: "attendance-requests", mk: newAttendance, steps: ["submit", "submit"] },
  { name: "A5 考勤 submit→cancel", route: "attendance-requests", mk: newAttendance, steps: ["submit", "cancel"] },
  { name: "A6 考勤 submit→approve→approve", route: "attendance-requests", mk: newAttendance, steps: ["submit", "approve", "approve"] },
  { name: "B1 装配 draft→confirm", route: "assemblies", mk: newAssembly, steps: ["confirm"] },
  { name: "B2 装配 confirm→confirm", route: "assemblies", mk: newAssembly, steps: ["confirm", "confirm"] },
  { name: "B3 装配 confirm→cancel", route: "assemblies", mk: newAssembly, steps: ["confirm", "cancel"] },
  { name: "C1 绩效 draft→finalize", route: "perf-assessments", mk: newPerf, steps: ["finalize"] },
  { name: "C2 绩效 finalize→finalize", route: "perf-assessments", mk: newPerf, steps: ["finalize", "finalize"] },
  { name: "D1 工资 draft→confirm", route: "payrolls", mk: newPayroll, steps: ["confirm"] },
  { name: "D2 工资 confirm→confirm", route: "payrolls", mk: newPayroll, steps: ["confirm", "confirm"] },
];

let diff = 0;
for (const tc of CASES) {
  say(`\n=== ${tc.name} ===`);
  const results = {};
  for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]]) {
    const id = await tc.mk(base, tk, stamp + tc.name.replace(/\W/g, ""));
    const out = [];
    for (const a of tc.steps) {
      if (!id) { out.push(`${a}: 建单失败`); continue; }
      const r = await act(base, tk, tc.route, id, a);
      out.push(`${a}: http${r.http} code=${r.json?.code} ${r.json?.message ?? "success"}`);
    }
    results[tag] = out;
  }
  for (let i = 0; i < tc.steps.length; i++) {
    const of = results["原版"][i] ?? "-";
    const rf = results["恢复端"][i] ?? "-";
    const same = of === rf;
    if (!same) diff++;
    say(`${same ? "  " : "!!"} ${tc.steps[i]}`);
    say(`     原版 : ${of}`);
    say(`     恢复端: ${rf}`);
  }
}
say(`\n不一致步数 = ${diff}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-statemachine-20261015.txt",
  log.join("\n") + "\n",
);
