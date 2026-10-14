#!/usr/bin/env node
// 批次 II 第三轮回放：走完「确认订单 → 生成应收 → 收款核销」链路，
// 确定销售合同 paid_amount / receipt_rate 是否随关联订单的已收款联动。
//
// 前两轮已确定 order_count / ordered_amount / executed_amount / progress_rate / sku_count
// 的口径；paid_amount 至今在原版实例上只见过 0，无法判断是「关联订单 paid_amount 之和」
// 还是「合同级收款单之和」，本轮用有库存的商品走通收款链路来定论。
//
//   用法：ERP_PASSWORD=xxx node tools/replay-batch-ii3.js
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

// 选一个**有可用库存**的商品，否则确认订单时会因锁库失败而卡住
const products = list(await call("GET", "/api/v1/products?page=1&page_size=200"));
const stocked = products.filter((p) => Number(p.stock_qty ?? 0) > 0);
console.log(`商品 ${products.length} 个，其中有库存 ${stocked.length} 个`);
if (!stocked.length) { console.error("没有可用库存的商品，无法走收款链路"); process.exit(1); }
const product = stocked[0];
const customers = list(await call("GET", "/api/v1/customers?page=1&page_size=5"));
const warehouses = list(await call("GET", "/api/v1/warehouses?page=1&page_size=5"));
const units = list(await call("GET", "/api/v1/units?page=1&page_size=5"));
const accounts = list(await call("GET", "/api/v1/accounts?page=1&page_size=50"));
const cashAccount = accounts.find((a) => /银行|现金/.test(String(a.name ?? ""))) ?? accounts[0];
console.log(`商品=${product.name}(库存 ${product.stock_qty}) 客户=${customers[0].name} 仓库=${warehouses[0].name} 资金科目=${cashAccount?.name}`);

const stamp = Date.now().toString().slice(-6);
const scRes = await call("POST", "/api/v1/sales-contracts", {
  customer_id: customers[0].id, customer_name: customers[0].name,
  contract_date: "2026-10-14T00:00:00+08:00", total_amount: "300", remark: "II3回放",
});
rec("II3-1", "创建销售合同 total=300", scRes, { id: scRes.data?.id });
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
  customer_id: customers[0].id, warehouse_id: warehouses[0].id,
  order_date: "2026-10-14T00:00:00+08:00", sales_contract_id: scId,
  lines: [{
    product_id: product.id, product_code: product.code, product_name: product.name,
    spec: product.spec ?? "", unit_id: units[0]?.id ?? "", unit_name: units[0]?.name ?? "",
    qty: 1, price: 100, discount: 0, amount: 100, tax_rate: 0, tax_amount: 0, remark: "", is_gift: false,
  }],
  total_amount: 100,
});
rec("II3-2", "挂 100 元销售订单", soRes, { id: soRes.data?.id, order_no: soRes.data?.order_no });
const soId = soRes.data?.id;
await readSC("II3-3");

if (!soId) { console.error("订单创建失败，放弃"); process.exit(1); }
rec("II3-4", "确认订单", await call("POST", `/api/v1/sales-orders/${soId}/confirm`, {}));
await readSC("II3-5");

// 找该订单生成的应收单
const ars = list(await call("GET", "/api/v1/ar-invoices?page=1&page_size=200"));
const ar = ars.find((r) => r.source_id === soId);
rec("II3-6", "查应收单", { status: 200, code: 0 }, { found: !!ar, id: ar?.id, total_amount: ar?.total_amount, received_amount: ar?.received_amount });

if (ar?.id) {
  const rcRes = await call("POST", "/api/v1/payment-receipts", {
    customer_id: customers[0].id,
    receipt_date: "2026-10-14T00:00:00+08:00",
    amount: 40,
    receipt_type: "银行转账",
    cash_account_id: cashAccount?.id ?? "",
    currency_code: "CNY",
    exchange_rate: 1,
    lines: [{ invoice_id: ar.id, amount: 40 }],
    remark: "II3回放",
  });
  rec("II3-7", "创建 40 元收款单", rcRes, { id: rcRes.data?.id, message: rcRes.message });
  const rcId = rcRes.data?.id;
  if (rcId) {
    rec("II3-8", "确认收款单", await call("POST", `/api/v1/payment-receipts/${rcId}/confirm`, {}));
    const rows = list(await call("GET", "/api/v1/sales-orders?page=1&page_size=200"));
    const so = rows.find((r) => r.id === soId) ?? {};
    rec("II3-9", "读该订单 paid_amount", { status: 200, code: 0 }, { status: so.status, paid_amount: so.paid_amount, payment_status: so.payment_status });
    await readSC("II3-10"); // 关键：合同的 paid_amount / receipt_rate 是否联动到 40 / 13.33
  }
}

// 清理
rec("II3-C", "删除订单", await call("DELETE", `/api/v1/sales-orders/${soId}`));
if (scId) rec("II3-C", "删除合同", await call("DELETE", `/api/v1/sales-contracts/${scId}`));

writeFileSync(new URL("../evidence/backend-runtime/audit-batch-ii3-20261014.json", import.meta.url), JSON.stringify(log, null, 2));
console.log(`\n已写出 ${log.length} 条 → evidence/backend-runtime/audit-batch-ii3-20261014.json`);
