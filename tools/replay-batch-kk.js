#!/usr/bin/env node
// 批次 KK 回放：为 4 组「后端 501 尚未恢复」的写路径取回原版完整行为。
//
// 起因（2026-10-15）：批次 KK 把路由对账从「只看存在性」升级为「逐方法语义比对」，
// 暴露出 4 组写路径在恢复端完全没有实现：
//   ① price-lists                 ② permissions
//   ③ shareholders / console/companies   ④ purchase-reconciliations / import-processes
//
// 本脚本对每组都走「空载荷 → 逐字段补齐 → 成功 → 读回 → 改 → 删」，
// 取回原版的必填校验文案、编号规则、状态机与删除响应形状，
// 供实现时逐字照抄（项目铁律：原版有文案就逐字照抄，原版无文案不得自造）。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-kk.js
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
let TOKEN = "";
async function call(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await r.text();
  let value;
  try { value = JSON.parse(text); } catch { value = text.slice(0, 200); }
  return { status: r.status, ...(typeof value === "object" && value !== null ? value : { raw: value }) };
}
function rec(step, note, resp, extra = {}) {
  log.push({ step, note, http_status: resp.status, code: resp.code, message: resp.message ?? "", data: resp.data ?? null, ...extra });
  const d = resp.data == null ? "" : " data=" + JSON.stringify(resp.data).slice(0, 160);
  console.log(`[${step}] ${note}\n      http=${resp.status} code=${resp.code ?? "-"}${JSON.stringify(resp.message ?? "")}${d}`);
  return resp;
}
const list = (r) => (r.data && Array.isArray(r.data.list) ? r.data.list : []);

// 原版在公司数 > 1 时要求登录必须带 company 字段（回放 KK 造出第 2 家公司后
// 无 company 参数会返回 400「请选择公司后再登录」）。带上默认公司即可。
const login = await call("POST", "/api/v1/auth/login", { username: "admin", password: PASS, company: "default" });
TOKEN = login.data?.access_token ?? "";
if (!TOKEN) { console.error("登录失败"); process.exit(1); }
console.log("登录成功\n");

const Z = "00000000-0000-0000-0000-000000000000";
const stamp = Date.now().toString().slice(-6);

// ─────────────── ① price-lists ───────────────
console.log("========== ① price-lists ==========");
rec("KK-1", "POST {} 空载荷", await call("POST", "/api/v1/price-lists", {}));
rec("KK-2", "POST {name}", await call("POST", "/api/v1/price-lists", { name: "KK价目表" + stamp }));
rec("KK-3", "POST {name} 重复", await call("POST", "/api/v1/price-lists", { name: "KK价目表" + stamp }));
rec("KK-4", "GET 列表", await call("GET", "/api/v1/price-lists?page=1&page_size=3"));
const pls = list(await call("GET", "/api/v1/price-lists?page=1&page_size=100"));
const pl = pls[0];
if (pl) {
  rec("KK-5", "GET 详情", await call("GET", `/api/v1/price-lists/${pl.id}`), { id: pl.id, code: pl.code });
  rec("KK-6", "PUT 改名称", await call("PUT", `/api/v1/price-lists/${pl.id}`, { name: "KK改名" + stamp }), { id: pl.id });
  rec("KK-7", "PUT 不存在 id", await call("PUT", `/api/v1/price-lists/${Z}`, { name: "x" }));
  rec("KK-8", "DELETE 不存在 id", await call("DELETE", `/api/v1/price-lists/${Z}`));
  rec("KK-9", "PUT /price-lists/price 空 id", await call("PUT", "/api/v1/price-lists/price", { price: 1 }));
  rec("KK-10", "DELETE /price-lists/price 空 id", await call("DELETE", "/api/v1/price-lists/price"));
  rec("KK-11", "DELETE 真实 id", await call("DELETE", `/api/v1/price-lists/${pl.id}`), { id: pl.id });
} else {
  console.log("      （列表为空，跳过详情相关步骤）");
}

// ─────────────── ② permissions ───────────────
console.log("\n========== ② permissions ==========");
rec("KK-12", "POST {} 空载荷", await call("POST", "/api/v1/permissions", {}));
rec("KK-13", "POST 只给 code", await call("POST", "/api/v1/permissions", { code: "kk_test" + stamp }));
rec("KK-14", "POST code+name", await call("POST", "/api/v1/permissions", { code: "kk_test" + stamp, name: "KK测试权限" }));
rec("KK-15", "POST code+name+module", await call("POST", "/api/v1/permissions", { code: "kk_test" + stamp, name: "KK测试权限", module: "test" }));
const permRes = await call("POST", "/api/v1/permissions", { code: "kk_test" + stamp, name: "KK测试权限", module: "test", type: "menu" });
rec("KK-16", "POST 全字段（type=menu）", permRes);
const perms = list(await call("GET", "/api/v1/permissions?page=1&page_size=5"));
console.log(`      权限列表 total=${(await call("GET", "/api/v1/permissions?page=1&page_size=1")).data?.total}，样本=${JSON.stringify(perms[0] ?? {}).slice(0, 200)}`);
if (permRes.data?.id) {
  const pid = permRes.data.id;
  rec("KK-17", "PUT 改名称", await call("PUT", `/api/v1/permissions/${pid}`, { name: "KK改名" }), { id: pid });
  rec("KK-18", "DELETE", await call("DELETE", `/api/v1/permissions/${pid}`), { id: pid });
}
rec("KK-19", "PUT 不存在", await call("PUT", `/api/v1/permissions/${Z}`, { name: "x" }));
rec("KK-20", "DELETE 不存在", await call("DELETE", `/api/v1/permissions/${Z}`));
// type 取值探测
for (const t of ["button", "action", "api", "page", "menu", "invalid_type"]) {
  rec("KK-t-" + t, `POST type=${t}`, await call("POST", "/api/v1/permissions", { code: "kk_" + t + stamp, name: "x", module: "test", type: t }));
}

// ─────────────── ③ shareholders / companies ───────────────
console.log("\n========== ③ shareholders / console-companies ==========");
rec("KK-21", "POST /shareholders {}", await call("POST", "/api/v1/shareholders", {}));
rec("KK-22", "POST /shareholders {name}", await call("POST", "/api/v1/shareholders", { name: "KK股东" + stamp }));
rec("KK-23", "POST /shareholders 重复", await call("POST", "/api/v1/shareholders", { name: "KK股东" + stamp }));
const shRes = list(await call("GET", "/api/v1/shareholders?page=1&page_size=100"));
console.log(`      股东 total=${(await call("GET", "/api/v1/shareholders?page=1&page_size=1")).data?.total}，样本=${JSON.stringify(shRes[0] ?? {}).slice(0, 220)}`);
if (shRes[0]) {
  rec("KK-24", "PUT 改股东", await call("PUT", `/api/v1/shareholders/${shRes[0].id}`, { name: "KK改" }), { id: shRes[0].id });
  rec("KK-25", "DELETE 股东", await call("DELETE", `/api/v1/shareholders/${shRes[0].id}`), { id: shRes[0].id });
}
rec("KK-26", "PUT /shareholders 不存在", await call("PUT", `/api/v1/shareholders/${Z}`, { name: "x" }));
rec("KK-27", "DELETE /shareholders 不存在", await call("DELETE", `/api/v1/shareholders/${Z}`));
rec("KK-28", "GET /console/companies", await call("GET", "/api/v1/console/companies"));
rec("KK-29", "POST /console/companies {}", await call("POST", "/api/v1/console/companies", {}));
for (const code of ["Abc", "A", "ab", "KK公司" + stamp, "kk_company_" + stamp, "k1", "kk-company"]) {
  rec("KK-code-" + code, `POST companies code=${code}`, await call("POST", "/api/v1/console/companies", { code, name: "KK公司" + stamp }), { code });
}
rec("KK-30", "POST /console/companies 合法", await call("POST", "/api/v1/console/companies", { code: "kk_ok_" + stamp, name: "KK公司OK" + stamp }));
rec("KK-31", "PUT /console/companies 不存在", await call("PUT", `/api/v1/console/companies/${Z}`, { name: "x" }));

// ─────────────── ④ purchase-reconciliations / import-processes ───────────────
console.log("\n========== ④ purchase-reconciliations / import-processes ==========");
rec("KK-32", "POST /purchase-reconciliations/generate {}", await call("POST", "/api/v1/purchase-reconciliations/generate", {}));
for (const period of ["2026-10", "2026-10-01", "2026/10", "abc", "2026-13-45"]) {
  rec("KK-p-" + period, `POST generate period=${period}`, await call("POST", "/api/v1/purchase-reconciliations/generate", { period }));
}
rec("KK-33", "GET /purchase-reconciliations", await call("GET", "/api/v1/purchase-reconciliations?page=1&page_size=3"));
const prs = list(await call("GET", "/api/v1/purchase-reconciliations?page=1&page_size=100"));
console.log(`      对账单 total=${(await call("GET", "/api/v1/purchase-reconciliations?page=1&page_size=1")).data?.total}，样本=${JSON.stringify(prs[0] ?? {}).slice(0, 240)}`);
rec("KK-34", "POST /piecework-records/import-processes {}", await call("POST", "/api/v1/piecework-records/import-processes", {}));
rec("KK-35", "POST /piecework-records/import-processes 空数组", await call("POST", "/api/v1/piecework-records/import-processes", { process_ids: [] }));
rec("KK-36", "POST /piecework-records/importable-processes", await call("POST", "/api/v1/piecework-records/importable-processes", {}));

// 清理
console.log("\n========== 清理 ==========");
const plsNow = list(await call("GET", "/api/v1/price-lists?page=1&page_size=200"));
for (const p of plsNow.filter((x) => String(x.name ?? "").startsWith("KK"))) rec("KK-C", "删价目表 " + p.id, await call("DELETE", `/api/v1/price-lists/${p.id}`));
const shsNow = list(await call("GET", "/api/v1/shareholders?page=1&page_size=200"));
for (const s of shsNow.filter((x) => String(x.name ?? "").startsWith("KK"))) rec("KK-C", "删股东 " + s.id, await call("DELETE", `/api/v1/shareholders/${s.id}`));
const permsNow = list(await call("GET", "/api/v1/permissions?page=1&page_size=500"));
for (const p of permsNow.filter((x) => String(x.code ?? "").startsWith("kk_"))) rec("KK-C", "删权限 " + p.id, await call("DELETE", `/api/v1/permissions/${p.id}`));

writeFileSync(new URL("../evidence/backend-runtime/audit-batch-kk-20261015.json", import.meta.url), JSON.stringify(log, null, 2));
console.log(`\n已写出 ${log.length} 条 → evidence/backend-runtime/audit-batch-kk-20261015.json`);
