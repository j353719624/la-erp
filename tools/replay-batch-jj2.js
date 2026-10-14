#!/usr/bin/env node
// 批次 JJ 第二轮：逐个探测原版通用列表到底支持哪些查询参数。
//
// 方法：对每个有数据的资源先取基线 total，再逐个带上「不可能命中的值」请求；
// total 掉到 0 说明该参数**被当作过滤条件**，total 不变则说明原版不认这个参数。
//
// 恢复端 backend/internal/database/database.go 的 Store.List 目前认 17 个精确字段 +
// 5 个 LIKE 字段 + keyword，全是照惯例写的，本轮给出原版实据。
//
//   用法：ERP_PASSWORD=xxx node tools/replay-batch-jj2.js
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const ZERO = "00000000-0000-0000-0000-000000000000";
let TOKEN = "";
async function call(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { status: r.status, raw: text.slice(0, 120) }; }
}
const listOf = (r) => (r?.data && Array.isArray(r.data.list) ? r.data.list : []);

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: PASS }),
});
TOKEN = (await login.json())?.data?.access_token ?? "";
if (!TOKEN) { console.error("登录失败"); process.exit(1); }
console.log("登录成功");

const ev = JSON.parse(readFileSync(new URL("../evidence/backend-runtime/audit-batch-hh-20261014.json", import.meta.url), "utf8"));
const routes = ev.filter((r) => (r.list.shape.total ?? 0) >= 4).map((r) => ({ route: r.route, table: r.table, total: r.list.shape.total }));
console.log(`样本资源 ${routes.length} 个（原版 total >= 4）`);

const idParams = ["customer_id", "supplier_id", "product_id", "warehouse_id", "category_id", "department_id",
  "created_by", "parent_id", "location_id", "applicable_product_id", "source_id", "contract_id",
  "sales_contract_id", "work_order_id", "bom_id", "employee_id", "unit_id", "entity_id", "equipment_id", "account_id"];
const textParams = ["status", "type", "type_code", "entity_code", "product_type", "module", "shift", "period",
  "source_type", "payment_status", "direction", "currency", "currency_code", "role_code", "receipt_type", "cost_method"];
const likeParams = ["name", "code", "username", "order_no", "mrp_no", "suggestion_no", "serial_no", "contract_no", "rfq_no"];
const dateParams = ["start_date", "end_date", "date_from", "date_to", "begin_date", "finish_date"];
const otherParams = ["keyword", "sort_order", "only_current", "nearing_days", "expiring_days", "include_deleted"];

const allParams = [...idParams, ...textParams, ...likeParams, ...dateParams, ...otherParams];

function valueFor(param) {
  if (param.endsWith("_id")) return ZERO;
  if (param.includes("date") || param === "period") return "2099-12-31";
  if (param === "nearing_days" || param === "expiring_days") return "1";
  if (param === "sort_order") return "asc";
  if (param === "only_current" || param === "include_deleted") return "true";
  return "ZZZ_NOT_EXIST_ZZZ";
}

// 每个资源：[参数] = 过滤后的 total；只记录「生效」的（total 与基线不同）
const supported = {};
const out = [];
for (const { route, table, total } of routes) {
  const base = await call(`/api/v1/${route}?page=1&page_size=1`);
  const baseTotal = base?.data?.total ?? 0;
  const hits = [];
  const drop = [];
  for (const param of allParams) {
    const r = await call(`/api/v1/${route}?page=1&page_size=1&${param}=${encodeURIComponent(valueFor(param))}`);
    const t = r?.data?.total;
    if (t === undefined) continue;
    if (t !== baseTotal) {
      hits.push(`${param}(${baseTotal}→${t})`);
      if (t === 0) drop.push(param);
    }
  }
  supported[table] = drop;
  out.push({ route, table, baseTotal, changed: hits });
  console.log(`[${route}] 基线 ${baseTotal}｜生效: ${hits.join(", ") || "（无）"}`);
}

// 汇总：按参数统计有多少张表认它
const tally = {};
for (const [, params] of Object.entries(supported)) {
  for (const p of params) tally[p] = (tally[p] ?? 0) + 1;
}
console.log("\n=== 按参数汇总（生效的表数）===");
for (const [p, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${p.padEnd(24)} ${n}`);
}

writeFileSync(new URL("../evidence/backend-runtime/audit-batch-jj2-20261014.json", import.meta.url),
  JSON.stringify({ samples: out, supportedByTable: supported, tally }, null, 2));
console.log("\n已写出 → evidence/backend-runtime/audit-batch-jj2-20261014.json");
