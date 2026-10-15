#!/usr/bin/env node
// 批次 OO 复验（2026-10-15）：对第二段/第三段取证里定位到的差异，在**改完之后**
// 再跑一遍两端对照，确认恢复端形态已与原版逐字一致。
//
// 每条都写明「修复前恢复端的形态」，便于日后回溯当初为什么要改。
// 运行前请先把改动后的二进制起在 OO_RECOVERED（默认 18901）。
//
// 用法：ERP_PASSWORD=xxx [OO_RECOVERED=url] node tools/replay-batch-oo-verify.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.OO_RECOVERED ?? "http://127.0.0.1:18901";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }
const NIL = "00000000-0000-0000-0000-000000000001";

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
function shape(r) {
  const d = r.json?.data;
  return {
    http: r.http, code: r.json?.code ?? null,
    message: r.json?.message ?? r.json?.error ?? "",
    keys: d && typeof d === "object" && !Array.isArray(d) ? Object.keys(d).sort().join("|") : Array.isArray(d) ? `[${d.length}]` : String(d ?? ""),
  };
}
const fmt = (s) => `http${s.http}/code${s.code} "${s.message}" data=${s.keys}`;
const same = (a, b) => a.http === b.http && a.code === b.code && a.message === b.message;

const CASES = [
  { g: "accounts", n: "DELETE /accounts/tree", m: "DELETE", p: "/api/v1/accounts/tree", was: "恢复端 200/code0（会真的删）" },
  { g: "accounts", n: `DELETE /accounts/${NIL}`, m: "DELETE", p: `/api/v1/accounts/${NIL}`, was: "恢复端 200/code0" },
  { g: "accounts", n: `GET /accounts/${NIL}/balance`, m: "GET", p: `/api/v1/accounts/${NIL}/balance`, was: "恢复端 404「记录不存在」" },

  { g: "invoices", n: `POST /ap-invoices/${NIL}/issue`, m: "POST", p: `/api/v1/ap-invoices/${NIL}/issue`, b: {}, was: "恢复端 404「记录不存在」" },
  { g: "invoices", n: `POST /ar-invoices/${NIL}/issue`, m: "POST", p: `/api/v1/ar-invoices/${NIL}/issue`, b: {}, was: "恢复端 404「记录不存在」" },

  { g: "flows", n: "POST /approval-flows {}", m: "POST", p: "/api/v1/approval-flows", b: {}, was: "恢复端 200/10000 + NOT NULL 约束原文" },
  { g: "flows", n: "POST /approval-flows {code}", m: "POST", p: "/api/v1/approval-flows", b: { code: "OOV1" }, was: "同上" },

  { g: "bom", n: "GET /assemblies/bom-components（无参）", m: "GET", p: "/api/v1/assemblies/bom-components", was: "恢复端 200/10000「产品不能为空」" },
  { g: "bom", n: "GET /assemblies/bom-components?product_id=bad", m: "GET", p: "/api/v1/assemblies/bom-components?product_id=bad", was: "恢复端 200/code0 空数组" },
  { g: "bom", n: `GET /assemblies/bom-components?product_id=${NIL}`, m: "GET", p: `/api/v1/assemblies/bom-components?product_id=${NIL}`, was: "两端一致（回归）" },
  { g: "bom", n: "PUT /assemblies/bom-components", m: "PUT", p: "/api/v1/assemblies/bom-components", b: {}, was: "恢复端 404「装配单不存在」" },
  { g: "bom", n: "DELETE /assemblies/bom-components", m: "DELETE", p: "/api/v1/assemblies/bom-components", was: "恢复端 404「装配单不存在」" },

  { g: "attendance", n: "POST /attendance-requests {}", m: "POST", p: "/api/v1/attendance-requests", b: {}, was: "恢复端 400「code 为必填字段」" },
  { g: "attendance", n: "POST /attendance-requests {request_type}", m: "POST", p: "/api/v1/attendance-requests", b: { employee_name: "OO复验甲", request_type: "leave" }, was: "同上（走不到日期校验）" },
  { g: "attendance", n: "POST /attendance-requests {+start_date 非法}", m: "POST", p: "/api/v1/attendance-requests", b: { employee_name: "OO复验乙", request_type: "leave", start_date: "2026-10-01" }, was: "同上" },
  { g: "attendance", n: "GET /attendance-requests/summary?period=BAD", m: "GET", p: "/api/v1/attendance-requests/summary?period=BAD", was: "恢复端「period 必须为 YYYY-MM」" },
  { g: "attendance", n: "PUT /attendance-requests/summary", m: "PUT", p: "/api/v1/attendance-requests/summary", b: {}, was: "恢复端 200/10000「考勤申请不存在」" },
  { g: "attendance", n: "DELETE /attendance-requests/summary", m: "DELETE", p: "/api/v1/attendance-requests/summary", was: "恢复端 200/10000「考勤申请不存在」" },

  { g: "opening", n: "POST /opening-balances {}", m: "POST", p: "/api/v1/accounting-periods/opening-balances", b: {}, was: "恢复端 400「period 和 entries 必填」" },
  { g: "opening", n: "POST /opening-balances {period:BAD}", m: "POST", p: "/api/v1/accounting-periods/opening-balances", b: { period: "BAD" }, was: "同上" },
  { g: "opening", n: "POST /opening-balances {period:2099-12}", m: "POST", p: "/api/v1/accounting-periods/opening-balances", b: { period: "2099-12" }, was: "同上" },
  { g: "opening", n: "POST /opening-balances {+entries:[NIL]}", m: "POST", p: "/api/v1/accounting-periods/opening-balances", b: { period: "2099-12", entries: [{ account_id: NIL, begin_balance: 1 }] }, was: "恢复端 10000「sql: no rows in result set」" },

  { g: "auth", n: "POST /auth/refresh {}", m: "POST", p: "/api/v1/auth/refresh", b: {}, was: "恢复端 401「刷新令牌无效或已过期」" },
  { g: "auth", n: "POST /auth/refresh {refresh_token:bad}", m: "POST", p: "/api/v1/auth/refresh", b: { refresh_token: "bad" }, was: "两端一致（回归）" },

  { g: "portal", n: "GET /portal/categories（无 token）", m: "GET", p: "/api/v1/portal/categories", anon: true, was: "恢复端 200/code0 直接给数据" },
  { g: "portal", n: "GET /portal/categories（主 token）", m: "GET", p: "/api/v1/portal/categories", was: "恢复端 200/code0 直接给数据" },
  { g: "portal", n: "GET /portal/products（无 token）", m: "GET", p: "/api/v1/portal/products", anon: true, was: "恢复端 200/code0 直接给数据" },
  { g: "portal", n: "GET /portal/products（主 token）", m: "GET", p: "/api/v1/portal/products", was: "恢复端 200/code0 直接给数据" },
  { g: "portal", n: `GET /portal/products/${NIL}（主 token）`, m: "GET", p: `/api/v1/portal/products/${NIL}`, was: "恢复端 404「product not found」" },
  { g: "portal", n: "POST /portal/login {}", m: "POST", p: "/api/v1/portal/login", b: {}, anon: true, was: "恢复端 401「客户账号或密码错误」" },
  { g: "portal", n: "POST /portal/login {account+password}", m: "POST", p: "/api/v1/portal/login", b: { account: "oo-none", password: "x" }, anon: true, was: "恢复端 401「客户账号或密码错误」" },
];

const rows = [];
for (const c of CASES) {
  const o = await call(ORIG, c.anon ? "" : origToken, c.m, c.p, c.b);
  const r = await call(RECOVERED, c.anon ? "" : recToken, c.m, c.p, c.b);
  const so = shape(o), sr = shape(r);
  rows.push({ ...c, orig: so, rec: sr, same: same(so, sr) });
  process.stdout.write(".");
}
console.log("");

const out = [];
let pass = 0;
for (const r of rows) {
  if (r.same) pass++;
  out.push(`${r.same ? "==" : "!="} [${r.g}] ${r.n}`);
  out.push(`      原版: ${fmt(r.orig)}`);
  out.push(`      恢复端: ${fmt(r.rec)}`);
  if (!r.same) out.push(`      修复前: ${r.was}`);
}
const text =
  `批次 OO 复验：改完之后的两端对照\n` +
  `原版=${ORIG} 恢复端=${RECOVERED}  共 ${rows.length} 条，一致 ${pass} 条，仍不一致 ${rows.length - pass} 条\n\n` +
  out.join("\n") + "\n";
console.log(text);
writeFileSync("C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-oo-verify-20261015.txt", text);
writeFileSync("C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-oo-verify-20261015.json", JSON.stringify(rows, null, 2));
