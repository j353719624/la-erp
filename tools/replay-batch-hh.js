#!/usr/bin/env node
// 批次 HH 回放：69 条通用读资源（backend/internal/api/read_resources.json）的契约核对。
//
// 核对三个契约点：
//   HH-A 列表形状：GET /api/v1/{route}?page=1&page_size=2 的 data 形状（{total,list} / 数组 / 其它）
//   HH-B 详情路由是否存在：GET /api/v1/{route}/{零UUID}，401=不存在(未注册)、其它=存在
//   HH-C 详情不存在时的状态码与文案（原版逐个取证，用于校正 recoveredTableLabels）
//
// 安全约定：口令只经环境变量传入，不落盘。
//   用法：ERP_PASSWORD=xxx node tools/replay-batch-hh.js
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const ZERO = "00000000-0000-0000-0000-000000000000";
const resources = JSON.parse(readFileSync(new URL("../backend/internal/api/read_resources.json", import.meta.url), "utf8"));

let TOKEN = "";
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
    const keys = Object.keys(data).sort();
    const list = Array.isArray(data.list) ? data.list : null;
    return {
      kind: "object",
      keys,
      total: data.total,
      listLen: list ? list.length : undefined,
      itemKeys: list && list[0] ? Object.keys(list[0]).sort() : undefined,
    };
  }
  return { kind: typeof data };
}

// 登录
const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS }),
});
const loginBody = await login.json();
TOKEN = loginBody?.data?.access_token ?? "";
if (!TOKEN) { console.error("登录失败"); process.exit(1); }
console.log("登录成功");

const result = [];
for (const res of resources) {
  const route = res.route;
  const list = await call("GET", `/api/v1/${route}?page=1&page_size=2`);
  const detail = await call("GET", `/api/v1/${route}/${ZERO}`);
  const row = {
    route,
    table: res.table,
    list: { http: list.status, code: list.code, message: list.message ?? "", shape: shapeOf(list.data) },
    detail: { http: detail.status, code: detail.code, message: detail.message ?? "" },
  };
  result.push(row);
  const s = row.list.shape;
  console.log(
    `[${route}] list http=${list.status} keys=${JSON.stringify(s.kind === "object" ? s.keys : s.kind)} total=${s.total ?? "-"} n=${s.listLen ?? "-"} | detail http=${detail.status} code=${detail.code ?? "-"} ${JSON.stringify(detail.message ?? "")}`
  );
}

writeFileSync(
  new URL("../evidence/backend-runtime/audit-batch-hh-20261014.json", import.meta.url),
  JSON.stringify(result, null, 2)
);
console.log(`\n已写出 ${result.length} 条 → evidence/backend-runtime/audit-batch-hh-20261014.json`);
