#!/usr/bin/env node
// 批次 JJ 第三轮：钉死日期区间、单号模糊、keyword 字段的语义。
//
// 第二轮（jj2）已知原版按表支持不同过滤参数，本轮解决三个「知道生效、但不知怎么生效」：
//   JJ3-A order_no 是精确匹配还是 LIKE（销售订单列表页把关键字框映射到 order_no）
//   JJ3-B start_date / end_date 的作用列与边界（单给 end_date 时行为反常，需查清）
//   JJ3-C keyword 在各表上到底匹配哪些字段
//
//   用法：ERP_PASSWORD=xxx node tools/replay-batch-jj3.js
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
let TOKEN = "";
async function call(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 150) }; }
}
async function probe(step, path, note) {
  const r = await call(path);
  const rows = r?.data?.list ?? [];
  const row = { step, note, path, total: r?.data?.total, n: rows.length, sample: rows.slice(0, 3).map((x) => x.order_no ?? x.code ?? x.serial_no ?? x.name ?? x.title ?? x.id) };
  log.push(row);
  console.log(`[${step}] ${note}\n      ${path}\n      total=${row.total} n=${row.n} ${JSON.stringify(row.sample)}`);
  return r;
}

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: PASS }),
});
TOKEN = (await login.json())?.data?.access_token ?? "";
if (!TOKEN) { console.error("登录失败"); process.exit(1); }
console.log("登录成功\n");

console.log("=== JJ3-A order_no 精确还是 LIKE ===");
await probe("A1", "/api/v1/sales-orders?page=1&page_size=3", "基线");
await probe("A2", "/api/v1/sales-orders?order_no=SO202610140035&page=1&page_size=3", "完整单号");
await probe("A3", "/api/v1/sales-orders?order_no=SO20261014003&page=1&page_size=3", "去掉末位（前缀）");
await probe("A4", "/api/v1/sales-orders?order_no=202610140035&page=1&page_size=3", "去掉 SO 前缀（中缀）");
await probe("A5", "/api/v1/sales-orders?order_no=so202610140035&page=1&page_size=3", "小写");

console.log("\n=== JJ3-B start_date / end_date ===");
await probe("B1", "/api/v1/sales-orders?start_date=2026-10-13&page=1&page_size=3", "仅 start=10-13");
await probe("B2", "/api/v1/sales-orders?start_date=2026-10-15&page=1&page_size=3", "仅 start=今天(10-15)");
await probe("B3", "/api/v1/sales-orders?end_date=2026-10-13&page=1&page_size=3", "仅 end=10-13");
await probe("B4", "/api/v1/sales-orders?end_date=2026-10-14&page=1&page_size=3", "仅 end=10-14");
await probe("B5", "/api/v1/sales-orders?start_date=2026-10-13&end_date=2026-10-14&page=1&page_size=3", "start=10-13 end=10-14");
await probe("B6", "/api/v1/sales-orders?start_date=2026-10-14&end_date=2026-10-15&page=1&page_size=3", "start=10-14 end=10-15");
await probe("B7", "/api/v1/sales-orders?start_date=2026-10-15&end_date=2026-10-15&page=1&page_size=3", "start=end=今天");

console.log("\n=== JJ3-C keyword 命中哪些字段 ===");
await probe("C1", "/api/v1/stock-movements?keyword=1&page=1&page_size=3", "库存流水 keyword=1");
await probe("C2", "/api/v1/serial-numbers?keyword=1&page=1&page_size=3", "序列号 keyword=1");
await probe("C3", "/api/v1/toolings?keyword=1&page=1&page_size=3", "工装 keyword=1");
await probe("C4", "/api/v1/work-centers?keyword=1&page=1&page_size=3", "工作中心 keyword=1");
await probe("C5", "/api/v1/subcontract-orders?keyword=1&page=1&page_size=3", "外协单 keyword=1");
await probe("C6", "/api/v1/rework-orders?keyword=1&page=1&page_size=3", "返工单 keyword=1");

writeFileSync(new URL("../evidence/backend-runtime/audit-batch-jj3-20261014.json", import.meta.url), JSON.stringify(log, null, 2));
console.log("\n已写出 → evidence/backend-runtime/audit-batch-jj3-20261014.json");
