#!/usr/bin/env node
// 批次 OO 取证 · 第三段（2026-10-15）：对第二段里**原版返回 500**或**参数名存疑**的入口
// 做递进取证，拿到可逐字对齐的文案。
//
// ## 为什么还要第三段
// 第二段里 ap/ar-invoices、approval-flows 的 POST 空载荷在原版一律 500 —— 按铁律④
// 500 不作语义证据，不能据此改代码。必须用**接近合法的载荷**再探，看原版真实形态。
// 另外第二段的 /assemblies/bom-components 用了我猜的 assembly_id，前端实际调用的是
// product_id（frontend/src/api/production.ts:36），参数名错了会导致结论全错。
//
// ## 写库风险控制
//   · opening-balances 一律用 2099-12（必然不存在的期间），避免覆盖真实期初余额
//   · 创建类载荷统一 OO 前缀，period/名称互不相同，便于事后识别清理
//   · 不存在的 id 用 NIL，两端都命中「不存在」分支，形态可比且无副作用
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-oo-shapes2.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.OO_RECOVERED ?? "http://127.0.0.1:18900";
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

// 两端各自取一个真实科目 id，用于 /accounts/{id}/balance 的**成功态**对照
async function firstAccount(base, tk) {
  const r = await call(base, tk, "GET", "/api/v1/accounts?page=1&page_size=1");
  const list = r.json?.data?.list ?? r.json?.data ?? [];
  return Array.isArray(list) && list[0]?.id ? list[0].id : "";
}
const origAcc = await firstAccount(ORIG, origToken);
const recAcc = await firstAccount(RECOVERED, recToken);

const CASES = [
  // ---- 应付/应收发票：空载荷原版 500，用近合法载荷再探 ----
  { g: "invoices", n: "POST /ap-invoices {supplier_id:NIL}", m: "POST", p: "/api/v1/ap-invoices", b: { supplier_id: NIL } },
  { g: "invoices", n: "POST /ap-invoices {invoice_date+amount}", m: "POST", p: "/api/v1/ap-invoices", b: { invoice_date: "2026-10-01", total_amount: 1 } },
  { g: "invoices", n: "POST /ap-invoices {supplier_id:NIL,invoice_date:bad}", m: "POST", p: "/api/v1/ap-invoices", b: { supplier_id: NIL, invoice_date: "bad" } },
  { g: "invoices", n: "POST /ar-invoices {customer_id:NIL}", m: "POST", p: "/api/v1/ar-invoices", b: { customer_id: NIL } },
  { g: "invoices", n: "POST /ar-invoices {invoice_date+amount}", m: "POST", p: "/api/v1/ar-invoices", b: { invoice_date: "2026-10-01", total_amount: 1 } },

  // ---- 审批流：空载荷原版 500 且恢复端暴露 SQL 原文，必须拿到原版真实形态 ----
  { g: "flows", n: "POST /approval-flows 全字段", m: "POST", p: "/api/v1/approval-flows", b: { code: "OOFLOW1", name: "OO流程一", biz_type: "purchase_order" } },
  { g: "flows", n: "POST /approval-flows 缺 name/biz_type", m: "POST", p: "/api/v1/approval-flows", b: { code: "OOFLOW2" } },
  { g: "flows", n: "POST /approval-flows 缺 code", m: "POST", p: "/api/v1/approval-flows", b: { name: "OO流程三", biz_type: "purchase_order" } },
  { g: "flows", n: "POST /approval-flows 缺 biz_type", m: "POST", p: "/api/v1/approval-flows", b: { code: "OOFLOW4", name: "OO流程四" } },
  { g: "flows", n: `POST /approval-flows/${NIL}/activate（已探）`, m: "POST", p: `/api/v1/approval-flows/${NIL}/activate`, b: {} },

  // ---- BOM 组件：第二段参数名猜错，前端实际用 product_id ----
  { g: "bom", n: `GET /assemblies/bom-components?product_id=${NIL}`, m: "GET", p: `/api/v1/assemblies/bom-components?product_id=${NIL}` },
  { g: "bom", n: "GET /assemblies/bom-components?product_id=bad", m: "GET", p: "/api/v1/assemblies/bom-components?product_id=bad" },
  { g: "bom", n: `PUT /assemblies/bom-components?assembly_id=${NIL}`, m: "PUT", p: `/api/v1/assemblies/bom-components?assembly_id=${NIL}`, b: {} },
  { g: "bom", n: `DELETE /assemblies/bom-components?assembly_id=${NIL}`, m: "DELETE", p: `/api/v1/assemblies/bom-components?assembly_id=${NIL}` },
  { g: "bom", n: `PUT /assemblies/bom-components?product_id=${NIL}`, m: "PUT", p: `/api/v1/assemblies/bom-components?product_id=${NIL}`, b: {} },

  // ---- 考勤申请 ----
  { g: "attendance", n: "POST /attendance-requests 合法最小", m: "POST", p: "/api/v1/attendance-requests", b: { employee_name: "OO员工甲", request_type: "leave", start_date: "2026-10-01" } },
  { g: "attendance", n: "POST /attendance-requests request_type=BAD", m: "POST", p: "/api/v1/attendance-requests", b: { employee_name: "OO员工乙", request_type: "BAD", start_date: "2026-10-01" } },
  { g: "attendance", n: "POST /attendance-requests 缺 start_date", m: "POST", p: "/api/v1/attendance-requests", b: { employee_name: "OO员工丙", request_type: "leave" } },
  { g: "attendance", n: "GET /attendance-requests/summary?period=2026-10", m: "GET", p: "/api/v1/attendance-requests/summary?period=2026-10" },
  { g: "attendance", n: "GET /attendance-requests/summary?period=BAD", m: "GET", p: "/api/v1/attendance-requests/summary?period=BAD" },

  // ---- 期初余额：用 2099-12 避免覆盖真实数据 ----
  { g: "opening", n: "POST /opening-balances {period:BAD}", m: "POST", p: "/api/v1/accounting-periods/opening-balances", b: { period: "BAD" } },
  { g: "opening", n: "POST /opening-balances {period:2099-12}", m: "POST", p: "/api/v1/accounting-periods/opening-balances", b: { period: "2099-12" } },
  { g: "opening", n: "POST /opening-balances {period:2099-12,entries:[NIL]}", m: "POST", p: "/api/v1/accounting-periods/opening-balances", b: { period: "2099-12", entries: [{ account_id: NIL, begin_balance: 1 }] } },
  { g: "opening", n: "GET /opening-balances?period=2026-10", m: "GET", p: "/api/v1/accounting-periods/opening-balances?period=2026-10" },

  // ---- 鉴权与门户 ----
  { g: "auth", n: "POST /auth/refresh {refresh_token:bad}", m: "POST", p: "/api/v1/auth/refresh", b: { refresh_token: "bad" } },
  { g: "portal", n: "POST /portal/login {account:oo-none}", m: "POST", p: "/api/v1/portal/login", b: { account: "oo-none", password: "x" }, anon: true },
  { g: "portal", n: "POST /portal/login 缺 password", m: "POST", p: "/api/v1/portal/login", b: { account: "oo-none" }, anon: true },

  // ---- 科目余额成功态 ----
  { g: "accounts", n: "GET /accounts/{真实id}/balance（成功态）", m: "GET", p: `/api/v1/accounts/${origAcc}/balance`, pRec: `/api/v1/accounts/${recAcc}/balance` },
];

const rows = [];
for (const c of CASES) {
  const o = await call(ORIG, c.anon ? "" : origToken, c.m, c.p, c.b);
  const r = await call(RECOVERED, c.anon ? "" : recToken, c.m, c.pRec ?? c.p, c.b);
  const so = shape(o), sr = shape(r);
  rows.push({ ...c, orig: so, rec: sr, same: same(so, sr) });
  process.stdout.write(".");
}
console.log("");

const out = [];
let diff = 0;
for (const r of rows) {
  if (!r.same) diff++;
  out.push(`${r.same ? "==" : "!="} [${r.g}] ${r.n}`);
  out.push(`      原版: ${fmt(r.orig)}`);
  out.push(`      恢复端: ${fmt(r.rec)}`);
}
const text =
  `批次 OO 第三段：递进取证（正确参数名 + 近合法载荷）\n` +
  `原版=${ORIG} 恢复端=${RECOVERED}  共 ${rows.length} 条，不一致 ${diff} 条\n` +
  `原版首个科目=${origAcc} 恢复端首个科目=${recAcc}\n\n` + out.join("\n") + "\n";
console.log(text);
writeFileSync("C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-shapes2-20261015.txt", text);
writeFileSync("C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-shapes2-20261015.json", JSON.stringify(rows, null, 2));
