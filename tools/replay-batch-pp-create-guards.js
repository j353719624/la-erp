#!/usr/bin/env node
// 批次 PP · 建单明细校验文案的正式取证（2026-10-15）。
//
// 前几轮这两条文案只在临时脚本里跑过，未落盘，导致自造文案审计无法引用。
// 本脚本重新取证并正式留档：
//   ① POST /perf-assessments 缺 items → 原版「考核指标不能为空（可选择模板或录入指标）」
//   ② POST /perf-assessments items 缺 indicator → 原版「指标名称不能为空」
//   ③ POST /assemblies 缺 lines → 原版「组件明细不能为空」（复验，assembly 已留档）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-create-guards.js
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

const CASES = [
  {
    name: "① 绩效缺 items",
    payload: () => ({ code: "PPC" + stamp, employee_name: "取证员工", period: "2026-04" }),
    route: "perf-assessments",
  },
  {
    name: "② 绩效 items 缺 indicator",
    payload: () => ({
      code: "PPI" + stamp, employee_name: "取证员工", period: "2026-04",
      items: [{ weight: 50, score: 45 }],
    }),
    route: "perf-assessments",
  },
  {
    name: "③ 装配缺 lines",
    payload: async (base, tk) => {
      const w = await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=1");
      const p = await call(base, tk, "GET", "/api/v1/products?page=1&page_size=1");
      return {
        assembly_no: "PPA" + stamp,
        warehouse_id: (w.json?.data?.list ?? [])[0]?.id,
        product_id: (p.json?.data?.list ?? [])[0]?.id,
        qty: 1,
      };
    },
    route: "assemblies",
  },
];

let diff = 0;
for (const tc of CASES) {
  say(`\n=== ${tc.name} ===`);
  const out = {};
  for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", ACTUAL, rTk]]) {
    const payload = await tc.payload(base, tk);
    const r = await call(base, tk, "POST", "/api/v1/" + tc.route, payload);
    out[tag] = `http${r.http} code=${r.json?.code} ${r.json?.message ?? "success"}`;
  }
  const same = out["原版"] === out["恢复端"];
  if (!same) diff++;
  say(`${same ? "  " : "!!"} ${out["原版"] === out["恢复端"] ? "" : ""}`);
  say(`     原版 : ${out["原版"]}`);
  say(`     恢复端: ${out["恢复端"]}`);
}
say(`\n不一致 = ${diff} / ${CASES.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-create-guards-20261015.txt",
  log.join("\n") + "\n",
);
