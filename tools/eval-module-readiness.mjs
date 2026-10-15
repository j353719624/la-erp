#!/usr/bin/env node
// 产品完成度评估：对 README 早期标注「继续恢复」的模块（MRP / 审批流 / 门户 / 多公司），
// 探测**两端实际返回**，区分「已实现」「501 占位」「两端都没有」。
//
// README（10-08 快照）写「MRP、自定义审批、门户、多公司及其他高级业务继续恢复」，
// 但后续批次可能已落地 —— 不能照 README 下结论，故实测。
//
// 用法：ERP_PASSWORD=xxx node tools/eval-module-readiness.mjs

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

async function probe(base, tk, method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { json = {}; }
  return { http: r.status, code: json?.code, msg: json?.message ?? "" };
}

const CASES = [
  ["MRP", "POST", "/api/v1/mrp/run", { product_ids: [] }],
  ["MRP", "GET", "/api/v1/mrp/requirements?page=1&page_size=5"],
  ["审批流", "GET", "/api/v1/approval-flows?page=1&page_size=5"],
  ["审批流", "GET", "/api/v1/approval-flows/"],
  ["门户", "POST", "/api/v1/portal/login", { username: "portal-probe", password: "x" }],
  ["门户", "GET", "/api/v1/portal/categories?page=1&page_size=5"],
  ["多公司", "GET", "/api/v1/companies?page=1&page_size=5"],
];

console.log("模块".padEnd(10), "方法".padEnd(6), "原版".padEnd(34), "恢复端".padEnd(34), "判定");
console.log("-".repeat(115));
let bad = 0;
for (const [mod, method, path, body] of CASES) {
  const o = await probe(ORIG, oTk, method, path, body);
  const r = await probe(ACTUAL, rTk, method, path, body);
  const fmt = (x) => `http${x.http} code=${x.code ?? "-"} ${x.msg || "success"}`;
  // 只比「形态」：http 状态 + 业务 code + 文案；数据内容两端必然不同
  const same = o.http === r.http && o.code === r.code && o.msg === r.msg;
  if (!same) bad++;
  console.log(
    mod.padEnd(10), method.padEnd(6), fmt(o).padEnd(34), fmt(r).padEnd(34),
    same ? "一致" : "不一致",
  );
}
console.log("-".repeat(115));
console.log(`不一致 ${bad} / ${CASES.length}`);
console.log("注：501 = 原版也未实现或恢复端保留的保守拒绝；两端一致即视为对齐原版，不计为缺口。");
