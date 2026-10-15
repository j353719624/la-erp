#!/usr/bin/env node
// 批次 OO 取证 · 第二段（2026-10-15）：对账报告里**不含真实业务 id**的纯路由差异，
// 逐条带 token 对照两端的 http / code / message 形态。
//
// ## 为什么只取这批
// 第一段（replay-batch-oo-methods.js）已证明：报告里 22 条「原版=absent」全部是
//   ① 探针只打了 GET/PUT，而原版是 POST-only 的方法噪声；
//   ② 恢复端通用注册器多铺了原版没有的方法（前端均无调用，见 tools 注释）。
// 剩下真正可能有语义差异的是：两端路由都在、但**带 token 后形态不同**的入口。
// 含真实业务 id 的条目（15 条）两端库数据不同，形态差异不可判定，本轮剔除。
//
// ## 取证规范（沿用批次 MM/NN 铁律）
//   ① 两端都登录（原版带 company=default）
//   ② 500 一律不作为语义证据（本脚本仍记录，但结论里不引用）
//   ③ 每条记录 http / code / message / data 顶层键集合
//   ④ 写操作用「必然不存在的 id」或空载荷，避免污染；运行前落盘恢复端清单
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-oo-shapes.js
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
    http: r.http,
    code: r.json?.code ?? null,
    message: r.json?.message ?? r.json?.error ?? "",
    keys: d && typeof d === "object" && !Array.isArray(d) ? Object.keys(d).sort().join("|") : Array.isArray(d) ? `[${d.length}]` : String(d ?? ""),
  };
}
const fmt = (s) => `http${s.http}/code${s.code} "${s.message}" data=${s.keys}`;
const same = (a, b) => a.http === b.http && a.code === b.code && a.message === b.message;

const CASES = [
  // ---- 组 1：会计科目删除与余额 ----
  { g: "accounts", n: "GET /accounts/tree（基线）", m: "GET", p: "/api/v1/accounts/tree" },
  { g: "accounts", n: "DELETE /accounts/tree", m: "DELETE", p: "/api/v1/accounts/tree" },
  { g: "accounts", n: `DELETE /accounts/${NIL}（不存在）`, m: "DELETE", p: `/api/v1/accounts/${NIL}` },
  { g: "accounts", n: `GET /accounts/${NIL}/balance`, m: "GET", p: `/api/v1/accounts/${NIL}/balance` },
  { g: "accounts", n: `GET /accounts/${NIL}（基线）`, m: "GET", p: `/api/v1/accounts/${NIL}` },

  // ---- 组 2：应收/应付发票与审批流（空载荷）----
  { g: "invoices", n: "POST /ap-invoices {}", m: "POST", p: "/api/v1/ap-invoices", b: {} },
  { g: "invoices", n: "POST /ar-invoices {}", m: "POST", p: "/api/v1/ar-invoices", b: {} },
  { g: "invoices", n: "GET /ap-invoices（基线）", m: "GET", p: "/api/v1/ap-invoices?page=1&page_size=1" },
  { g: "invoices", n: `POST /ap-invoices/${NIL}/issue`, m: "POST", p: `/api/v1/ap-invoices/${NIL}/issue`, b: {} },
  { g: "invoices", n: `POST /ar-invoices/${NIL}/issue`, m: "POST", p: `/api/v1/ar-invoices/${NIL}/issue`, b: {} },

  { g: "flows", n: "POST /approval-flows {}", m: "POST", p: "/api/v1/approval-flows", b: {} },
  { g: "flows", n: `PUT /approval-flows/${NIL} {}`, m: "PUT", p: `/api/v1/approval-flows/${NIL}`, b: {} },
  { g: "flows", n: `POST /approval-flows/${NIL}/activate`, m: "POST", p: `/api/v1/approval-flows/${NIL}/activate`, b: {} },
  { g: "flows", n: `POST /approval-flows/${NIL}/deactivate`, m: "POST", p: `/api/v1/approval-flows/${NIL}/deactivate`, b: {} },
  { g: "flows", n: "GET /approval-flows（基线）", m: "GET", p: "/api/v1/approval-flows?page=1&page_size=1" },

  // ---- 组 3：组装单 BOM 组件 ----
  { g: "bom", n: "GET /assemblies/bom-components（无参）", m: "GET", p: "/api/v1/assemblies/bom-components" },
  { g: "bom", n: `GET /assemblies/bom-components?assembly_id=${NIL}`, m: "GET", p: `/api/v1/assemblies/bom-components?assembly_id=${NIL}` },
  { g: "bom", n: "PUT /assemblies/bom-components {}", m: "PUT", p: "/api/v1/assemblies/bom-components", b: {} },
  { g: "bom", n: "DELETE /assemblies/bom-components", m: "DELETE", p: "/api/v1/assemblies/bom-components" },

  // ---- 组 4：考勤申请 ----
  { g: "attendance", n: "POST /attendance-requests {}", m: "POST", p: "/api/v1/attendance-requests", b: {} },
  { g: "attendance", n: "GET /attendance-requests/summary（基线）", m: "GET", p: "/api/v1/attendance-requests/summary" },
  { g: "attendance", n: "PUT /attendance-requests/summary {}", m: "PUT", p: "/api/v1/attendance-requests/summary", b: {} },
  { g: "attendance", n: "DELETE /attendance-requests/summary", m: "DELETE", p: "/api/v1/attendance-requests/summary" },

  // ---- 组 5：期初余额 ----
  { g: "opening", n: "GET /accounting-periods/opening-balances（基线）", m: "GET", p: "/api/v1/accounting-periods/opening-balances" },
  { g: "opening", n: "POST /accounting-periods/opening-balances {}", m: "POST", p: "/api/v1/accounting-periods/opening-balances", b: {} },

  // ---- 组 6：鉴权与门户（无 token + 带 token 各一次）----
  { g: "auth", n: "POST /auth/refresh {}", m: "POST", p: "/api/v1/auth/refresh", b: {}, anon: true },
  { g: "auth", n: "POST /auth/refresh {}", m: "POST", p: "/api/v1/auth/refresh", b: {} },
  { g: "portal", n: "GET /portal/categories", m: "GET", p: "/api/v1/portal/categories", anon: true },
  { g: "portal", n: "GET /portal/categories", m: "GET", p: "/api/v1/portal/categories" },
  { g: "portal", n: "GET /portal/products", m: "GET", p: "/api/v1/portal/products", anon: true },
  { g: "portal", n: "GET /portal/products", m: "GET", p: "/api/v1/portal/products" },
  { g: "portal", n: `GET /portal/products/${NIL}`, m: "GET", p: `/api/v1/portal/products/${NIL}` },
  { g: "portal", n: "POST /portal/login {}", m: "POST", p: "/api/v1/portal/login", b: {}, anon: true },
  { g: "license", n: "GET /license/status", m: "GET", p: "/api/v1/license/status", anon: true },
  { g: "license", n: "GET /license/machine-code", m: "GET", p: "/api/v1/license/machine-code", anon: true },
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
let diff = 0;
for (const r of rows) {
  const tag = r.same ? "==" : "!=";
  if (!r.same) diff++;
  out.push(`${tag} [${r.g}] ${r.n}${r.anon ? "（无 token）" : ""}`);
  out.push(`      原版: ${fmt(r.orig)}`);
  out.push(`      恢复端: ${fmt(r.rec)}`);
}
const text =
  `批次 OO 第二段：纯路由形态对照（带 token）\n` +
  `原版=${ORIG} 恢复端=${RECOVERED}  共 ${rows.length} 条，不一致 ${diff} 条\n` +
  `注：原版 500 按铁律④不作为语义证据，仅记录形态\n\n` + out.join("\n") + "\n";
console.log(text);
writeFileSync("C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-shapes-20261015.txt", text);
writeFileSync("C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-shapes-20261015.json", JSON.stringify(rows, null, 2));
