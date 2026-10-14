#!/usr/bin/env node
// 批次 II 第五轮回放：用正确的明细字段名（ar_invoice_id）走完收款核销，
// 确定销售合同的 paid_amount / receipt_rate 是否随关联订单的已收款联动。
//
// 第四轮用的 `invoice_id` 是错的（前端 PaymentReceiptLine 的字段是 ar_invoice_id），
// 所以收款单确认成功但没有任何核销效果（received_amount 仍为 0）。本轮修正字段名。
//
//   用法：ERP_PASSWORD=xxx node tools/replay-batch-ii5.js
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
  try { value = JSON.parse(text); } catch { value = text.slice(0, 250); }
  return { status: r.status, ...(typeof value === "object" && value !== null ? value : { raw: value }) };
}
function rec(step, note, resp, extra = {}) {
  log.push({ step, note, http_status: resp.status, code: resp.code, message: resp.message ?? "", ...extra });
  console.log(`[${step}] ${note} → http=${resp.status} code=${resp.code ?? "-"} ${JSON.stringify(resp.message ?? "")} ${JSON.stringify(extra)}`);
  return resp;
}
const list = (r) => (r.data && Array.isArray(r.data.list) ? r.data.list : Array.isArray(r.data) ? r.data : []);

const login = await call("POST", "/api/v1/auth/login", { username: "admin", password: PASS });
TOKEN = login.data?.access_token ?? "";
if (!TOKEN) { console.error("登录失败"); process.exit(1); }
console.log("登录成功");

const customers = list(await call("GET", "/api/v1/customers?page=1&page_size=5"));
const products = list(await call("GET", "/api/v1/products?page=1&page_size=5"));
const warehouses = list(await call("GET", "/api/v1/warehouses?page=1&page_size=5"));
const units = list(await call("GET", "/api/v1/units?page=1&page_size=5"));
const accounts = list(await call("GET", "/api/v1/accounts?page=1&page_size=50"));
const customer = customers[0];
const cashAccount = accounts.find((a) => /银行|现金/.test(String(a.name ?? ""))) ?? accounts[0];

const scRes = await call("POST", "/api/v1/sales-contracts", {
  customer_id: customer.id, customer_name: customer.name,
  contract_date: "2026-10-14T00:00:00+08:00", total_amount: "300", remark: "II5回放",
});
rec("II5-1", "创建销售合同 total=300", scRes, { id: scRes.data?.id });
const scId = scRes.data?.id;

async function readSC(tag) {
  const rows = list(await call("GET", "/api/v1/sales-contracts?page=1&page_size=200"));
  const mine = rows.find((r) => r.id === scId) ?? {};
  rec(tag, "读合同列表", { status: 200, code: 0 }, {
    order_count: mine.order_count, ordered_amount: mine.ordered_amount,
    paid_amount: mine.paid_amount, progress_rate: mine.progress_rate, receipt_rate: mine.receipt_rate,
  });
  return mine;
}

const soRes = await call("POST", "/api/v1/sales-orders", {
  customer_id: customer.id, warehouse_id: warehouses[0]?.id ?? "",
  order_date: "2026-10-14T00:00:00+08:00", sales_contract_id: scId,
  lines: [{
    product_id: products[0].id, product_code: products[0].code, product_name: products[0].name,
    spec: "", unit_id: units[0]?.id ?? "", unit_name: units[0]?.name ?? "",
    qty: 1, price: 100, discount: 0, amount: 100, tax_rate: 0, tax_amount: 0, remark: "", is_gift: false,
  }],
  total_amount: 100,
});
rec("II5-2", "挂 100 元草稿订单", soRes, { id: soRes.data?.id, order_no: soRes.data?.order_no });
const soId = soRes.data?.id;
await readSC("II5-3");

const arRes = await call("POST", "/api/v1/ar-invoices", {
  customer_id: customer.id, customer_name: customer.name,
  invoice_date: "2026-10-14T00:00:00+08:00",
  total_amount: 100,
  source_type: "sales_order", source_id: soId, source_no: soRes.data?.order_no ?? "",
  remark: "II5回放",
});
rec("II5-4", "登记应收单（source_id=订单）", arRes, { id: arRes.data?.id, invoice_no: arRes.data?.invoice_no });
const arId = arRes.data?.id;

if (arId) {
  const rcRes = await call("POST", "/api/v1/payment-receipts", {
    customer_id: customer.id,
    receipt_date: "2026-10-14T00:00:00+08:00",
    amount: 40,
    receipt_type: "银行转账",
    cash_account_id: cashAccount?.id ?? "",
    currency_code: "CNY",
    exchange_rate: 1,
    lines: [{ ar_invoice_id: arId, ar_invoice_no: arRes.data?.invoice_no ?? "", amount: 40 }],
    remark: "II5回放",
  });
  rec("II5-5", "创建 40 元收款单（ar_invoice_id）", rcRes, { id: rcRes.data?.id });
  const rcId = rcRes.data?.id;
  if (rcId) {
    rec("II5-6", "确认收款单", await call("POST", `/api/v1/payment-receipts/${rcId}/confirm`, {}));
    const ars = list(await call("GET", "/api/v1/ar-invoices?page=1&page_size=200"));
    const ar = ars.find((r) => r.id === arId) ?? {};
    rec("II5-7", "读该应收单", { status: 200, code: 0 }, { received_amount: ar.received_amount, balance: ar.balance, status: ar.status });
    const rows = list(await call("GET", "/api/v1/sales-orders?page=1&page_size=200"));
    const so = rows.find((r) => r.id === soId) ?? {};
    rec("II5-8", "读该订单", { status: 200, code: 0 }, { status: so.status, paid_amount: so.paid_amount, payment_status: so.payment_status });
    // 关键：合同 paid_amount / receipt_rate 是否联动（40/300 = 13.33）
    await readSC("II5-9");
  }
}

if (soId) rec("II5-C", "删除订单", await call("DELETE", `/api/v1/sales-orders/${soId}`));
if (scId) rec("II5-C", "删除合同", await call("DELETE", `/api/v1/sales-contracts/${scId}`));

writeFileSync(new URL("../evidence/backend-runtime/audit-batch-ii5-20261014.json", import.meta.url), JSON.stringify(log, null, 2));
console.log(`\n已写出 ${log.length} 条 → evidence/backend-runtime/audit-batch-ii5-20261014.json`);
