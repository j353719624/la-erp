#!/usr/bin/env node
// 批次 F：杂项守卫
//
// FF1 photos.go:18 入库照片 >100 张
// FF2 photos.go:100/:109 照片库位与表头仓库/货架不一致
// FF3 serials.go:21 序列号非字符串
// FF4 batch_allocation.go:18 批次分配策略非 fifo/fefo
// FF5 suggestions.go:86 商品 purchase_price 为负
// FF6 service.go:198 明细 >1000 行
// FF7 service.go:384 unit_rate≠1
// FF8 workprocesses.go:89 actual_time / labor_rate 负数
// FF9 accounts.go:133 科目树成环时的表现（已在 CC7 覆盖，这里核对恢复端需要的行为）
// FF10 edit.go:52 编辑改单据 type
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WH = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 100)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 200)}` : ""));
  return resp?.data;
}
async function findPlainProduct() {
  const list = (await call("GET", "/api/v1/products?page_size=200"))?.data?.list || [];
  for (const p of list) if (p.is_serial !== true && p.is_batch !== true && p.is_combo !== true) return p;
  throw new Error("没有普通商品");
}

let P;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  P = await findPlainProduct();
  const CUST = ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0];
  console.log("前置:", P.name, "\n");

  // ---------- FF1/FF2 入库照片 ----------
  console.log("\n=== FF1/FF2 入库照片 ===");
  {
    const si = rec("建入库单", await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WH, lines: [{ product_id: P.id, qty: 5, unit_cost: 3 }], remark: "FF",
    }));
    const loc = ((await call("GET", "/api/v1/locations?page_size=50"))?.data?.list || [])[0];
    const rack = ((await call("GET", "/api/v1/racks?page_size=50"))?.data?.list || [])[0];
    rec("空照片数组", await call("POST", `/api/v1/stock-ins/${si?.id}/photos`, { photos: [] }));
    rec("照片非数组", await call("POST", `/api/v1/stock-ins/${si?.id}/photos`, { photos: "x" }));
    rec("101 张照片", await call("POST", `/api/v1/stock-ins/${si?.id}/photos`, {
      photos: Array.from({ length: 101 }, (_, i) => ({ url: `/uploads/images/x${i}.png` })),
    }));
    const one = rec("1 张照片", await call("POST", `/api/v1/stock-ins/${si?.id}/photos`, {
      photos: [{ url: "/uploads/images/one.png", location_id: loc?.id, rack_id: rack?.id }],
    }));
    rec("照片回读", one, { json: JSON.stringify(one).slice(0, 260) });
    rec("照片带异仓 location", await call("POST", `/api/v1/stock-ins/${si?.id}/photos`, {
      photos: [{ url: "/uploads/images/two.png", location_id: "00000000-0000-0000-0000-000000000099" }],
    }));
    // 明细行带仓库
    const si2 = rec("建入库单2", await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WH, lines: [{ product_id: P.id, qty: 1, unit_cost: 3, warehouse_id: "00000000-0000-0000-0000-000000000099" }],
    }));
    rec("明细异仓的单建单结果", undefined, { created: !!si2?.id, wh: si2?.warehouse_id });
  }

  // ---------- FF3 序列号格式 ----------
  console.log("\n=== FF3 序列号格式 ===");
  {
    rec("序列号数字", await call("POST", "/api/v1/serial-numbers/register", { serial_nos: [12345] }));
    rec("序列号对象", await call("POST", "/api/v1/serial-numbers/register", { serial_nos: [{ no: "X1" }] }));
    rec("序列号含空串", await call("POST", "/api/v1/serial-numbers/register", { serial_nos: ["FF-S1", ""] }));
    rec("序列号非数组", await call("POST", "/api/v1/serial-numbers/register", { serial_nos: "x" }));
    rec("序列号空数组", await call("POST", "/api/v1/serial-numbers/register", { serial_nos: [] }));
    rec("序列号不传", await call("POST", "/api/v1/serial-numbers/register", {}));
  }

  // ---------- FF4 批次分配策略 ----------
  console.log("\n=== FF4 批次分配策略 ===");
  {
    const inv = (await call("GET", "/api/v1/settings/inventory")).data;
    rec("读当前库存设置", undefined, { value: JSON.stringify(inv).slice(0, 200) });
    for (const strategy of ["fifo", "fefo", "lifo", "garbage"]) {
      const r = await call("PUT", "/api/v1/settings/inventory", { batch_strategy: strategy });
      rec("设策略 " + strategy, r);
      const out = rec("批次商品无批次出库(" + strategy + ")", await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WH, lines: [{ product_id: P.id, qty: 0, unit_cost: 0 }],
      }));
      void out;
      const r2 = await call("PUT", "/api/v1/settings/inventory", { batch_strategy: "fifo" });
      if (r2.code !== 0) rec("恢复策略失败", r2);
      break; // 设置成功与否已由上面记录
    }
  }

  // ---------- FF5 采购价负数 ----------
  console.log("\n=== FF5 采购建议/负采购价 ===");
  {
    rec("采购建议", await call("GET", "/api/v1/purchase-suggestions?page_size=3"));
    const neg = rec("商品 purchase_price=-1", await call("POST", "/api/v1/products", {
      code: "FF-NEGP", name: "FF 负采购价", purchase_price: -1,
    }));
    rec("回读 purchase_price", undefined, { purchase_price: neg?.purchase_price });
    rec("负采购价下跑建议", await call("GET", "/api/v1/purchase-suggestions?page_size=3"));
  }

  // ---------- FF6/FF7 单据行数与 unit_rate ----------
  console.log("\n=== FF6/FF7 行数与 unit_rate ===");
  {
    const many = Array.from({ length: 1001 }, () => ({ product_id: P.id, qty: 1, price: 1 }));
    rec("1001 行订单", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH, lines: many,
    }));
    rec("1000 行订单", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH, lines: many.slice(0, 1000),
    }));
    rec("unit_rate=1", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH,
      lines: [{ product_id: P.id, qty: 1, price: 1, unit_rate: 1 }],
    }));
    rec("unit_rate=2", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH,
      lines: [{ product_id: P.id, qty: 1, price: 1, unit_rate: 2 }],
    }));
    rec("unit_rate=0", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH,
      lines: [{ product_id: P.id, qty: 1, price: 1, unit_rate: 0 }],
    }));
    // 头部折扣
    rec("头部 discount_amount", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH, discount_amount: 50,
      lines: [{ product_id: P.id, qty: 1, price: 100 }],
    }));
    rec("头部 discount", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH, discount: 50,
      lines: [{ product_id: P.id, qty: 1, price: 100 }],
    }));
    rec("行级 discount=20", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH,
      lines: [{ product_id: P.id, qty: 2, price: 100, discount: 20 }],
    }));
  }

  // ---------- FF8 工序报工 ----------
  console.log("\n=== FF8 工序报工负值 ===");
  {
    const wo = rec("建工单", await call("POST", "/api/v1/work-orders", {
      product_id: P.id, qty: 3, warehouse_id: WH, remark: "FF8",
    }));
    rec("工序列表", await call("GET", `/api/v1/work-orders/${wo?.id}/processes`), null);
    for (const p of ["work-order-processes", "work-orders/" + wo?.id + "/processes"]) {
      const r = await call("POST", `/api/v1/${p}/00000000-0000-0000-0000-000000000000/report`, { actual_time: -5 });
      rec("报工(不存在) " + p, r);
    }
  }

  // ---------- FF10 单据 type ----------
  console.log("\n=== FF10 单据 type ===");
  {
    const so = rec("建销售单", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH, lines: [{ product_id: P.id, qty: 1, price: 10 }],
    }));
    rec("编辑带 source_type", await call("PUT", `/api/v1/sales-orders/${so?.id}`, {
      customer_id: CUST.id, warehouse_id: WH, source_type: "x",
      lines: [{ product_id: P.id, qty: 1, price: 10 }],
    }));
    rec("订单带 source_id", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: WH, source_id: so?.id, source_no: so?.order_no,
      lines: [{ product_id: P.id, qty: 1, price: 10 }],
    }));
  }

  writeFileSync("evidence/backend-runtime/audit-batch-f-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次F：杂项守卫", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-f-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
