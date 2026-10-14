#!/usr/bin/env node
// 批次 D：自定义报表 SQL 守卫（custom_reports.go:30/43/57/75）
//
// 这是安全边界而非业务缺口：恢复端要求 SQL 以 select/with 开头且不含分号。
// 本轮确认原版实际允许到什么程度——重点是原版是否允许写语句。
// 无论结果如何，写操作不会放开（按「不复制未证实的错误行为」）。
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
let TOKEN = "";
async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  try { return { status: r.status, ...(await r.json()) }; } catch { return { status: r.status }; }
}
function rec(step, resp, extra) {
  log.push({ step, code: resp?.code, message: resp?.message ?? "", status: resp?.status, ...(extra ? { detail: extra } : {}) });
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 100)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 220)}` : ""));
  return resp?.data;
}

const CASES = [
  ["DD1 普通 select", "SELECT id, code FROM products LIMIT 3"],
  ["DD2 WITH", "WITH t AS (SELECT id FROM products) SELECT * FROM t LIMIT 3"],
  ["DD3 分号结尾", "SELECT id FROM products LIMIT 3;"],
  ["DD4 中途分号", "SELECT id FROM products LIMIT 3; SELECT 1"],
  ["DD5 前导空格", "   SELECT id FROM products LIMIT 1"],
  ["DD6 小写 select", "select id from products limit 1"],
  ["DD7 insert", "INSERT INTO products (code, name) VALUES ('SQLTEST1', 'SQLTEST1')"],
  ["DD8 update", "UPDATE products SET remark='SQLTEST' WHERE code='SQLTEST'"],
  ["DD9 delete", "DELETE FROM products WHERE code='NOPE-NOPE'"],
  ["DD10 pragma", "PRAGMA table_info(products)"],
  ["DD11 多语句 select 后 insert", "SELECT 1; INSERT INTO products (code, name) VALUES ('SQLTEST2','SQLTEST2')"],
  ["DD12 attach", "ATTACH DATABASE '/tmp/x.db' AS x"],
];

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  console.log("=== DD 建报表 ===");
  const created = {};
  for (const [label, sql] of CASES) {
    const r = await call("POST", "/api/v1/custom-reports", {
      report_code: "SQLT" + Math.floor(Math.random() * 100000), report_name: label, query_sql: sql,
    });
    rec(label, r);
    if (r?.data?.id) created[label] = r.data.id;
  }
  console.log("\n=== DD 执行报表 ===");
  for (const [label, id] of Object.entries(created)) {
    rec("run " + label, await call("POST", `/api/v1/custom-reports/${id}/run`, {}));
  }
  console.log("\n=== DD 直接跑 SQL ===");
  for (const [label, sql] of CASES) {
    rec("exec " + label, await call("POST", "/api/v1/custom-reports/run-sql", { query_sql: sql }));
  }
  console.log("\n=== DD 副作用核查 ===");
  rec("查 SQLTEST1 是否被插入", await call("GET", "/api/v1/products?page_size=5"), null);
  const list = await call("GET", "/api/v1/products?keyword=SQLTEST&page_size=10");
  rec("keyword=SQLTEST", list, { total: list?.data?.total ?? (list?.data || []).length });

  writeFileSync("evidence/backend-runtime/audit-batch-d-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次D：自定义报表 SQL 只读边界", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-d-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
