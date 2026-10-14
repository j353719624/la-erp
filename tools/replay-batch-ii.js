#!/usr/bin/env node
// 批次 II 回放：为 3 组「列表侧计算字段」向原版取证。
//
// 起因：批次 HH 比对 69 条读资源的返回字段集时发现，原版列表返回但恢复端没有的
// 计算字段共 3 组（work_orders 的那组恢复端已实现，属列比对误报）：
//   ① product_spus.sku_count
//   ② sales_contracts: order_count / ordered_amount / paid_amount / progress_rate / receipt_rate
//   ③ purchase_contracts: order_count / executed_amount / progress_rate
// 前端在合同列表、SPU 列表、工单看板里直接展示这些字段，属用户可见缺口。
//
// 本脚本在原版上建受控数据，逐个确定计算口径（是否含草稿、取整位数、软删是否计入）。
//
// 安全约定：口令只经环境变量传入，不落盘。
//   用法：ERP_PASSWORD=xxx node tools/replay-batch-ii.js
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
  const row = { step, note, http_status: resp.status, code: resp.code, message: resp.message ?? "", ...extra };
  log.push(row);
  console.log(`[${step}] ${note} → http=${resp.status} code=${resp.code ?? "-"} ${JSON.stringify(resp.message ?? "")} ${JSON.stringify(extra)}`);
  return resp;
}
const data = (r) => r.data;
const list = (r) => (r.data && Array.isArray(r.data.list) ? r.data.list : []);

const login = await call("POST", "/api/v1/auth/login", { username: "admin", password: PASS });
TOKEN = login.data?.access_token ?? "";
if (!TOKEN) { console.error("登录失败"); process.exit(1); }
console.log("登录成功");

const stamp = Date.now().toString().slice(-6);
const customers = list(await call("GET", "/api/v1/customers?page=1&page_size=5"));
const suppliers = list(await call("GET", "/api/v1/suppliers?page=1&page_size=5"));
const products = list(await call("GET", "/api/v1/products?page=1&page_size=5"));
const warehouses = list(await call("GET", "/api/v1/warehouses?page=1&page_size=5"));
const units = list(await call("GET", "/api/v1/units?page=1&page_size=5"));
if (!customers.length || !products.length || !warehouses.length) { console.error("基础数据不足", { c: customers.length, p: products.length, w: warehouses.length }); process.exit(1); }
const customer = customers[0];
const supplier = suppliers[0];
const product = products[0];
const warehouse = warehouses[0];
const unit = units[0];
console.log(`基础数据: 客户=${customer.name} 供应商=${supplier?.name} 商品=${product.name} 仓库=${warehouse.name}`);

const line = (qty, price) => ({
  product_id: product.id,
  product_code: product.code,
  product_name: product.name,
  spec: product.spec ?? "",
  unit_id: unit?.id ?? "",
  unit_name: unit?.name ?? "",
  qty,
  price,
  discount: 0,
  amount: qty * price,
  tax_rate: 0,
  tax_amount: 0,
  remark: "",
  is_gift: false,
});

// ─────────── ① 销售合同执行进度 ───────────
console.log("\n=== ① 销售合同 ===");
const scRes = await call("POST", "/api/v1/sales-contracts", {
  customer_id: customer.id,
  customer_name: customer.name,
  contract_date: "2026-10-14T00:00:00+08:00",
  total_amount: "300",
  remark: "II回放",
});
rec("II-1", "创建销售合同 total=300", scRes);
const sc = scRes.data ?? {};
const scId = sc.id;

async function readSC(tag) {
  const rows = list(await call("GET", "/api/v1/sales-contracts?page=1&page_size=100"));
  const mine = rows.find((r) => r.id === scId) ?? {};
  rec("II-" + tag, "读销售合同列表", { status: 200, code: 0 }, {
    order_count: mine.order_count,
    ordered_amount: mine.ordered_amount,
    paid_amount: mine.paid_amount,
    progress_rate: mine.progress_rate,
    receipt_rate: mine.receipt_rate,
  });
  return mine;
}
await readSC("2");

async function newSO(amount) {
  const r = await call("POST", "/api/v1/sales-orders", {
    customer_id: customer.id,
    warehouse_id: warehouse.id,
    order_date: "2026-10-14T00:00:00+08:00",
    sales_contract_id: scId,
    lines: [line(1, amount)],
    total_amount: amount,
  });
  return r;
}
const so1 = await newSO(100);
rec("II-3", "挂 100 元销售订单（草稿）", so1, { id: so1.data?.id, order_no: so1.data?.order_no });
await readSC("4"); // 期望 100/300 = 33.333…

const so2 = await newSO(50);
rec("II-5", "再挂 50 元销售订单（草稿）", so2, { id: so2.data?.id, order_no: so2.data?.order_no });
await readSC("6"); // 期望 150/300 = 50

const so3 = await newSO(100);
rec("II-7", "再挂 100 元销售订单（草稿）", so3, { id: so3.data?.id, order_no: so3.data?.order_no });
await readSC("8"); // 期望 250/300 = 83.333…

// 删掉一张草稿订单，看 order_count / ordered_amount 是否回落
if (so3.data?.id) {
  const del = await call("DELETE", "/api/v1/sales-orders/" + so3.data.id);
  rec("II-9", "删除第三张草稿订单", del);
  await readSC("10");
}

// ─────────── ② 采购合同执行进度 ───────────
console.log("\n=== ② 采购合同 ===");
const pcRes = await call("POST", "/api/v1/purchase-contracts", {
  supplier_id: supplier?.id ?? "",
  supplier_name: supplier?.name ?? "",
  contract_date: "2026-10-14T00:00:00+08:00",
  total_amount: "300",
  remark: "II回放",
});
rec("II-11", "创建采购合同 total=300", pcRes);
const pc = pcRes.data ?? {};
const pcId = pc.id;

async function readPC(tag) {
  const rows = list(await call("GET", "/api/v1/purchase-contracts?page=1&page_size=100"));
  const mine = rows.find((r) => r.id === pcId) ?? {};
  rec("II-" + tag, "读采购合同列表", { status: 200, code: 0 }, {
    order_count: mine.order_count,
    executed_amount: mine.executed_amount,
    progress_rate: mine.progress_rate,
  });
  return mine;
}
await readPC("12");
const po1 = await call("POST", "/api/v1/purchase-orders", {
  supplier_id: supplier?.id ?? "",
  warehouse_id: warehouse.id,
  order_date: "2026-10-14T00:00:00+08:00",
  contract_id: pcId,
  lines: [line(1, 100)],
  total_amount: 100,
});
rec("II-13", "挂 100 元采购订单（草稿）", po1, { id: po1.data?.id, order_no: po1.data?.order_no });
await readPC("14"); // 期望 100/300 = 33.333…
const po2 = await call("POST", "/api/v1/purchase-orders", {
  supplier_id: supplier?.id ?? "",
  warehouse_id: warehouse.id,
  order_date: "2026-10-14T00:00:00+08:00",
  contract_id: pcId,
  lines: [line(1, 50)],
  total_amount: 50,
});
rec("II-15", "再挂 50 元采购订单（草稿）", po2, { id: po2.data?.id, order_no: po2.data?.order_no });
await readPC("16"); // 期望 150/300 = 50

// ─────────── ③ SPU 的 sku_count ───────────
console.log("\n=== ③ SPU sku_count ===");
const spuRes = await call("POST", "/api/v1/spus", {
  code: "II-SPU" + stamp,
  name: "II回放款" + stamp,
  dims: [
    { code: "color", name: "颜色", values: ["红", "蓝"] },
    { code: "size", name: "尺码", values: ["S", "L"] },
  ],
});
rec("II-17", "创建商品款", spuRes, { id: spuRes.data?.id, code: spuRes.data?.code });
const spu = spuRes.data ?? {};
async function readSPU(tag) {
  const rows = list(await call("GET", "/api/v1/spus?page=1&page_size=100"));
  const mine = rows.find((r) => r.id === spu.id) ?? {};
  rec("II-" + tag, "读商品款列表", { status: 200, code: 0 }, { sku_count: mine.sku_count });
  return mine;
}
await readSPU("18"); // 新款，期望 0
if (spu.id) {
  const gen = await call("POST", `/api/v1/spus/${spu.id}/skus`, { skip_existing: true });
  rec("II-19", "生成 2×2 = 4 个 SKU", gen, { created: gen.data?.created ?? gen.data?.count });
  await readSPU("20"); // 期望 4
}

// ─────────── 清理 ───────────
console.log("\n=== 清理 ===");
for (const [label, id] of [["销售合同", scId], ["采购合同", pcId]]) {
  if (!id) continue;
  const r = await call("DELETE", `/api/v1/${label === "销售合同" ? "sales-contracts" : "purchase-contracts"}/` + id);
  rec("II-C", `删除${label}`, r);
}
if (spu.id) rec("II-C", "删除商品款", await call("DELETE", "/api/v1/spus/" + spu.id));
for (const id of [so1.data?.id, so2.data?.id, po1.data?.id, po2.data?.id]) {
  if (!id) continue;
  // 订单端点不同，逐个试
  for (const route of ["sales-orders", "purchase-orders"]) {
    const r = await call("DELETE", `/api/v1/${route}/${id}`);
    if (r.code === 0) { rec("II-C", `删除订单 ${route}/${id}`, r); break; }
  }
}

writeFileSync(new URL("../evidence/backend-runtime/audit-batch-ii-20261014.json", import.meta.url), JSON.stringify(log, null, 2));
console.log(`\n已写出 ${log.length} 条 → evidence/backend-runtime/audit-batch-ii-20261014.json`);
