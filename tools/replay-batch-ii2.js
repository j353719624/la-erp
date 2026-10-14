#!/usr/bin/env node
// 批次 II 第二轮回放：确定销售合同 paid_amount 的来源，以及已确认/已取消订单是否计入。
//
// 第一轮（tools/replay-batch-ii.js）已确定：
//   order_count = COUNT(关联订单)（草稿计入、软删后回落）
//   ordered_amount / executed_amount = SUM(关联订单.total_amount)
//   progress_rate = 已执行金额 / 合同金额 × 100，2 位小数（33.33 / 50 / 83.33）
//   sku_count = COUNT(products WHERE spu_id = ? AND deleted_at IS NULL)
// 本轮补三个未知：
//   II2-A paid_amount 是否就是关联订单 paid_amount 之和（走完收款核销看它是否联动）
//   II2-B 已确认 / 已取消订单是否仍计入 order_count 与 ordered_amount
//   II2-C 合同金额为 0 时 progress_rate 取什么值
//
//   用法：ERP_PASSWORD=xxx node tools/replay-batch-ii2.js
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
let TOKEN = "";
async function call(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await r.text();
  let value;
  try { value = JSON.parse(text); } catch { value = text.slice(0, 200); }
  return { status: r.status, ...(typeof value === "object" && value !== null ? value : { raw: value }) };
}
function rec(step, note, resp, extra = {}) {
  log.push({ step, note, http_status: resp.status, code: resp.code, message: resp.message ?? "", ...extra });
  console.log(`[${step}] ${note} → http=${resp.status} code=${resp.code ?? "-"} ${JSON.stringify(resp.message ?? "")} ${JSON.stringify(extra)}`);
  return resp;
}
const list = (r) => (r.data && Array.isArray(r.data.list) ? r.data.list : []);

const login = await call("POST", "/api/v1/auth/login", { username: "admin", password: PASS });
TOKEN = login.data?.access_token ?? "";
if (!TOKEN) { console.error("登录失败"); process.exit(1); }
console.log("登录成功");

const customers = list(await call("GET", "/api/v1/customers?page=1&page_size=5"));
const products = list(await call("GET", "/api/v1/products?page=1&page_size=5"));
const warehouses = list(await call("GET", "/api/v1/warehouses?page=1&page_size=5"));
const units = list(await call("GET", "/api/v1/units?page=1&page_size=5"));
const customer = customers[0], product = products[0], warehouse = warehouses[0], unit = units[0];
const lineOf = (qty, price) => ({
  product_id: product.id, product_code: product.code, product_name: product.name,
  spec: product.spec ?? "", unit_id: unit?.id ?? "", unit_name: unit?.name ?? "",
  qty, price, discount: 0, amount: qty * price, tax_rate: 0, tax_amount: 0, remark: "", is_gift: false,
});
const stamp = Date.now().toString().slice(-6);

// ── II2-C：合同金额为 0 时的比率 ──
const zero = await call("POST", "/api/v1/sales-contracts", {
  customer_id: customer.id, customer_name: customer.name,
  contract_date: "2026-10-14T00:00:00+08:00", total_amount: "0", remark: "II2零额",
});
rec("II2-1", "创建金额为 0 的销售合同", zero, { id: zero.data?.id });
async function readSC(scId, tag, note) {
  const rows = list(await call("GET", "/api/v1/sales-contracts?page=1&page_size=200"));
  const mine = rows.find((r) => r.id === scId) ?? {};
  rec(tag, note, { status: 200, code: 0 }, {
    order_count: mine.order_count, ordered_amount: mine.ordered_amount,
    paid_amount: mine.paid_amount, progress_rate: mine.progress_rate, receipt_rate: mine.receipt_rate,
  });
  return mine;
}
await readSC(zero.data?.id, "II2-2", "零额合同初始比率");

// ── II2-A / II2-B：正常合同 + 确认 / 取消 / 收款 ──
const scRes = await call("POST", "/api/v1/sales-contracts", {
  customer_id: customer.id, customer_name: customer.name,
  contract_date: "2026-10-14T00:00:00+08:00", total_amount: "300", remark: "II2回放",
});
rec("II2-3", "创建销售合同 total=300", scRes, { id: scRes.data?.id });
const scId = scRes.data?.id;
await readSC(scId, "II2-4", "初始");

const mk = async (amount) => call("POST", "/api/v1/sales-orders", {
  customer_id: customer.id, warehouse_id: warehouse.id,
  order_date: "2026-10-14T00:00:00+08:00", sales_contract_id: scId,
  lines: [lineOf(1, amount)], total_amount: amount,
});
const so1 = await mk(100);
rec("II2-5", "挂 100 元草稿订单", so1, { id: so1.data?.id, order_no: so1.data?.order_no });
await readSC(scId, "II2-6", "挂 100 后");

// 确认订单：看是否仍计入
if (so1.data?.id) {
  const conf = await call("POST", "/api/v1/sales-orders/" + so1.data.id + "/confirm", {});
  rec("II2-7", "确认该订单", conf);
  await readSC(scId, "II2-8", "确认后（是否仍计入）");
  // 该订单的 paid_amount 现在是多少
  const rows = list(await call("GET", "/api/v1/sales-orders?page=1&page_size=200"));
  const so = rows.find((r) => r.id === so1.data.id) ?? {};
  rec("II2-9", "读该订单", { status: 200, code: 0 }, { status: so.status, paid_amount: so.paid_amount, total_amount: so.total_amount });
  // 找由它生成的应收单
  const ar = (await call("GET", "/api/v1/ar-invoices?page=1&page_size=200")).data ?? [];
  const mine = (Array.isArray(ar) ? ar : ar.list ?? []).filter((r) => r.source_id === so1.data.id);
  rec("II2-10", "查该订单生成的应收单", { status: 200, code: 0 }, { count: mine.length, id: mine[0]?.id, total_amount: mine[0]?.total_amount, received_amount: mine[0]?.received_amount });
}

// 取消一张草稿订单：看是否仍计入
const so2 = await mk(50);
rec("II2-11", "再挂 50 元草稿订单", so2, { id: so2.data?.id, order_no: so2.data?.order_no });
await readSC(scId, "II2-12", "挂 50 后（150/300=50）");
if (so2.data?.id) {
  const canc = await call("POST", "/api/v1/sales-orders/" + so2.data.id + "/cancel", {});
  rec("II2-13", "取消该订单", canc);
  await readSC(scId, "II2-14", "取消后（是否仍计入 150 或回落到 100）");
}

// ── 清理 ──
for (const [route, id] of [["sales-contracts", scId], ["sales-contracts", zero.data?.id]]) {
  if (!id) continue;
  rec("II2-C", "删除合同 " + id, await call("DELETE", `/api/v1/${route}/${id}`));
}
for (const id of [so1.data?.id, so2.data?.id]) {
  if (!id) continue;
  rec("II2-C", "删除订单 " + id, await call("DELETE", "/api/v1/sales-orders/" + id));
}

writeFileSync(new URL("../evidence/backend-runtime/audit-batch-ii2-20261014.json", import.meta.url), JSON.stringify(log, null, 2));
console.log(`\n已写出 ${log.length} 条 → evidence/backend-runtime/audit-batch-ii2-20261014.json`);
