#!/usr/bin/env node
// 通用读资源契约探测：对指定 base 跑一遍 read_resources.json 的列表 + 详情不存在，
// 输出结构化结果，用于原版 / 恢复端逐条 diff。
//
//   用法：ERP_PASSWORD=xxx node tools/probe-read-contract.js <base> <outfile>
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2];
const OUT = process.argv[3];
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!BASE || !OUT) { console.error("用法: node tools/probe-read-contract.js <base> <outfile>"); process.exit(1); }
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const ZERO = "00000000-0000-0000-0000-000000000000";
const resources = JSON.parse(readFileSync(new URL("../backend/internal/api/read_resources.json", import.meta.url), "utf8"));

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS }),
});
const loginBody = await login.json();
const TOKEN = loginBody?.data?.access_token ?? "";
if (!TOKEN) { console.error("登录失败 " + BASE); process.exit(1); }

async function call(method, path) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await r.text();
  let value;
  try { value = JSON.parse(text); } catch { value = text.slice(0, 200); }
  return { status: r.status, ...(typeof value === "object" && value !== null ? value : { raw: value }) };
}

function shapeOf(data) {
  if (Array.isArray(data)) return { kind: "array", len: data.length, itemKeys: data[0] ? Object.keys(data[0]).sort() : [] };
  if (data && typeof data === "object") {
    const list = Array.isArray(data.list) ? data.list : null;
    return {
      kind: "object",
      keys: Object.keys(data).sort(),
      total: data.total,
      listLen: list ? list.length : undefined,
      itemKeys: list && list[0] ? Object.keys(list[0]).sort() : undefined,
    };
  }
  return { kind: typeof data };
}

const result = [];
for (const res of resources) {
  const list = await call("GET", `/api/v1/${res.route}?page=1&page_size=2`);
  const detail = await call("GET", `/api/v1/${res.route}/${ZERO}`);
  result.push({
    route: res.route,
    table: res.table,
    list: { http: list.status, code: list.code, message: list.message ?? "", shape: shapeOf(list.data) },
    detail: { http: detail.status, code: detail.code, message: detail.message ?? "" },
  });
}
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`${BASE}: 已写出 ${result.length} 条 → ${OUT}`);
