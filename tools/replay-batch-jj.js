#!/usr/bin/env node
// 批次 JJ 回放：通用读资源「列表查询契约」取证。
//
// 恢复端 backend/internal/database/database.go 的 Store.List 是照惯例写的：
//   page 默认 1、page_size 默认 10 上限 1000、ORDER BY created_at DESC、
//   精确过滤 17 个字段、LIKE 模糊 5 个字段、另有 keyword 按表分派。
// 这些数值与方向此前**没有原版实据**，本轮逐条取回真实值。
//
// 选取原版上数据量充足的资源做样本：sales-orders(101) / stock-movements(217) /
// notifications(127) / accounts(47) / work-orders(79)。
//
//   用法：ERP_PASSWORD=xxx node tools/replay-batch-jj.js
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
let TOKEN = "";
async function call(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await r.text();
  let value;
  try { value = JSON.parse(text); } catch { value = text.slice(0, 200); }
  return { status: r.status, ...(typeof value === "object" && value !== null ? value : { raw: value }) };
}
function rec(step, note, resp, extra = {}) {
  log.push({ step, note, http_status: resp.status, code: resp.code, message: resp.message ?? "", ...extra });
  console.log(`[${step}] ${note} → ${JSON.stringify(extra)}`);
  return resp;
}
const list = (r) => (r.data && Array.isArray(r.data.list) ? r.data.list : []);

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: PASS }),
});
TOKEN = (await login.json())?.data?.access_token ?? "";
if (!TOKEN) { console.error("登录失败"); process.exit(1); }
console.log("登录成功");

async function probe(step, path, note, pick) {
  const r = await call(path);
  const rows = list(r);
  rec(step, note, r, { http: r.status, total: r.data?.total, n: rows.length, ...(pick ? pick(rows, r.data) : {}) });
  return r;
}

const first = (rows, key) => (rows[0] ? rows[0][key] : undefined);

// ① 默认 page_size（不带 page_size 参数）
await probe("JJ-1", "/api/v1/sales-orders?page=1", "销售订单 不带 page_size", (rows, d) => ({ n: rows.length, total: d.total }));
await probe("JJ-2", "/api/v1/stock-movements?page=1", "库存流水 不带 page_size", (rows, d) => ({ n: rows.length, total: d.total }));
await probe("JJ-3", "/api/v1/notifications?page=1", "通知 不带 page_size", (rows, d) => ({ n: rows.length, total: d.total }));

// ② page_size 上限
await probe("JJ-4", "/api/v1/sales-orders?page=1&page_size=5000", "page_size=5000", (rows, d) => ({ n: rows.length, total: d.total }));
await probe("JJ-5", "/api/v1/sales-orders?page=1&page_size=1000", "page_size=1000", (rows, d) => ({ n: rows.length, total: d.total }));
await probe("JJ-6", "/api/v1/sales-orders?page=1&page_size=200", "page_size=200", (rows, d) => ({ n: rows.length, total: d.total }));
await probe("JJ-7", "/api/v1/sales-orders?page=1&page_size=0", "page_size=0", (rows, d) => ({ n: rows.length, total: d.total }));
await probe("JJ-8", "/api/v1/sales-orders?page=1&page_size=-5", "page_size=-5", (rows, d) => ({ n: rows.length, total: d.total }));

// ③ 排序方向：取首页首条与末页末条
await probe("JJ-9", "/api/v1/sales-orders?page=1&page_size=3", "首页前 3 条", (rows) => ({ first: rows.map((r) => r.order_no), created_at: rows.map((r) => r.created_at) }));
await probe("JJ-10", "/api/v1/sales-orders?page=34&page_size=3", "末页", (rows) => ({ first: rows.map((r) => r.order_no), created_at: rows.map((r) => r.created_at) }));
await probe("JJ-11", "/api/v1/notifications?page=1&page_size=3", "通知首页", (rows) => ({ created_at: rows.map((r) => r.created_at) }));

// ④ 过滤参数是否生效
await probe("JJ-12", "/api/v1/sales-orders?status=draft&page=1&page_size=1", "status=draft", (rows, d) => ({ total: d.total }));
await probe("JJ-13", "/api/v1/sales-orders?status=confirmed&page=1&page_size=1", "status=confirmed", (rows, d) => ({ total: d.total }));
await probe("JJ-14", "/api/v1/sales-orders?status=nonexistent&page=1&page_size=1", "status=不存在的值", (rows, d) => ({ total: d.total }));
await probe("JJ-15", "/api/v1/sales-orders?customer_id=00000000-0000-0000-0000-000000000000&page=1&page_size=1", "customer_id=零UUID", (rows, d) => ({ total: d.total }));

// ⑤ keyword 模糊搜索（销售订单的表里没有 name/code 列，看 keyword 是否仍生效）
await probe("JJ-16", "/api/v1/sales-orders?keyword=SO202610140035&page=1&page_size=5", "keyword=单号", (rows, d) => ({ total: d.total, first: first(rows, "order_no") }));
await probe("JJ-17", "/api/v1/accounts?keyword=银行&page=1&page_size=5", "keyword=银行（accounts 有 name）", (rows, d) => ({ total: d.total, first: first(rows, "name") }));
await probe("JJ-18", "/api/v1/accounts?name=银行&page=1&page_size=5", "name=银行（LIKE 字段）", (rows, d) => ({ total: d.total, first: first(rows, "name") }));

// ⑥ sort_order 参数是否改变排序
await probe("JJ-19", "/api/v1/accounts?page=1&page_size=3", "accounts 默认序", (rows) => ({ codes: rows.map((r) => r.code) }));
await probe("JJ-20", "/api/v1/accounts?page=1&page_size=3&sort_order=asc", "accounts sort_order=asc", (rows) => ({ codes: rows.map((r) => r.code) }));

// ⑦ page 越界
await probe("JJ-21", "/api/v1/sales-orders?page=9999&page_size=10", "page 越界", (rows, d) => ({ total: d.total, n: rows.length }));
await probe("JJ-22", "/api/v1/sales-orders?page=abc&page_size=10", "page 非数字", (rows, d) => ({ total: d.total, n: rows.length }));

writeFileSync(new URL("../evidence/backend-runtime/audit-batch-jj-20261014.json", import.meta.url), JSON.stringify(log, null, 2));
console.log(`\n已写出 ${log.length} 条 → evidence/backend-runtime/audit-batch-jj-20261014.json`);
