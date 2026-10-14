#!/usr/bin/env node
// 批次 C：主数据一致性守卫
//
// CC1 checks.go:74 编辑盘点单改仓库
// CC2 checks.go:134/142 盘点明细高级字段 / 单位
// CC3 routings.go:28 编辑工艺改 code
// CC4 routings.go:118 已关联工单的工艺删除
// CC5 routings.go:153 sequence 非整数
// CC6 edit.go:52 编辑改单据 type
// CC7 accounts.go:133 科目树成环
// CC8 boms.go:125 qty<=0 或 scrap_rate<0
// CC9 mrp.go:232/239 默认仓不唯一 / 同一产品多张 active BOM
// CC10 transfers.go:66 调拨单编辑态
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 110)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 220)}` : ""));
  return resp?.data;
}
async function findPlainProduct() {
  const list = (await call("GET", "/api/v1/products?page_size=200"))?.data?.list || [];
  for (const p of list) {
    if (p.is_serial !== true && p.is_batch !== true && p.is_combo !== true) return p;
  }
  throw new Error("没有普通商品");
}

let PROD;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  PROD = await findPlainProduct();
  console.log("前置:", PROD.name, "\n");

  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WH, type: "purchase", lines: [{ product_id: PROD.id, qty: 400, unit_cost: 50 }],
    remark: "BATCHC-STOCK",
  });
  if (si?.data?.id) rec("备货", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- CC1/CC2 盘点单 ----------
  console.log("\n=== CC1/CC2 盘点单编辑与明细 ===");
  {
    const wh2 = rec("建第二仓", await call("POST", "/api/v1/warehouses", { code: "BATCHC-WH2", name: "BATCHC-WH2" }));
    const chk = rec("建盘点单", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WH, lines: [{ product_id: PROD.id }], remark: "BATCHC-CC1",
    }));
    if (chk?.id) {
      rec("CC1 编辑改仓库", await call("PUT", `/api/v1/inventory-checks/${chk.id}`, {
        warehouse_id: wh2?.id, lines: [{ product_id: PROD.id }],
      }));
      rec("CC1 回读", await call("GET", `/api/v1/inventory-checks/${chk.id}`), undefined);
      rec("CC1 start", await call("POST", `/api/v1/inventory-checks/${chk.id}/start`, {}));
      rec("CC1 start 后再编辑", await call("PUT", `/api/v1/inventory-checks/${chk.id}`, {
        warehouse_id: WH, lines: [{ product_id: PROD.id }],
      }));
      rec("CC1 completed 后编辑", await call("POST", `/api/v1/inventory-checks/${chk.id}/complete`, {}));
      rec("CC1 completed 后再编辑", await call("PUT", `/api/v1/inventory-checks/${chk.id}`, {
        warehouse_id: WH, lines: [{ product_id: PROD.id }],
      }));
    }
    // 明细高级字段
    const loc = ((await call("GET", "/api/v1/locations?page_size=50"))?.data?.list || [])[0];
    const withLoc = rec("CC2 明细带 location_id", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WH, lines: [{ product_id: PROD.id, location_id: loc?.id || "00000000-0000-0000-0000-000000000009" }],
    }));
    if (withLoc?.id) {
      const got = await call("GET", `/api/v1/inventory-checks/${withLoc.id}`);
      rec("CC2 回读明细", undefined, { lines: JSON.stringify((got?.data?.edges?.lines || []).map((l) => ({ unit: l.unit_id, loc: l.location_id }))) });
    }
    const withBatch = rec("CC2 明细带 batch_no", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WH, lines: [{ product_id: PROD.id, batch_no: "BATCHC-B1" }],
    }));
    const withSerial = rec("CC2 明细带 serial_nos", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WH, lines: [{ product_id: PROD.id, serial_nos: ["BATCHC-S1"] }],
    }));
    rec("CC2 草稿回读", undefined, {
      batchOk: !!withBatch?.id, serialOk: !!withSerial?.id,
    });
  }

  // ---------- CC3/CC4/CC5 工艺 ----------
  console.log("\n=== CC3/CC4/CC5 工艺 ===");
  {
    const rt = rec("建工艺", await call("POST", "/api/v1/routings", {
      code: "BATCHC-RT", name: "BATCHC 工艺", product_id: PROD.id,
      steps: [{ sequence: 1, process_code: "P1", process_name: "工序1" }],
    }));
    if (rt?.id) {
      rec("CC3 编辑改 code", await call("PUT", `/api/v1/routings/${rt.id}`, {
        code: "BATCHC-RT2", name: "BATCHC 工艺", product_id: PROD.id,
        steps: [{ sequence: 1, process_code: "P1", process_name: "工序1" }],
      }));
      rec("CC3 回读", await call("GET", `/api/v1/routings/${rt.id}`), undefined);
      rec("CC4 删已建工艺(未关联)", await call("DELETE", `/api/v1/routings/${rt.id}`, undefined));
    }
    // 已关联工单的工艺
    const wo = rec("建工单(带工艺)", await call("POST", "/api/v1/work-orders", {
      product_id: PROD.id, qty: 5, warehouse_id: WH, routing_id: rt?.id, remark: "BATCHC-CC4",
    }));
    rec("CC4 关联后删工艺", await call("DELETE", `/api/v1/routings/${rt?.id}`, undefined));
    const woAfter = await call("GET", `/api/v1/work-orders/${wo?.id}`);
    rec("CC4 工单回读", undefined, {
      routing_id: woAfter?.data?.routing_id,
      processes: JSON.stringify(woAfter?.data?.edges?.processes || []).slice(0, 150),
    });
    // sequence 非整数
    rec("CC5 sequence 小数", await call("POST", "/api/v1/routings", {
      code: "BATCHC-RT3", name: "BATCHC seq 小数", product_id: PROD.id,
      steps: [{ sequence: 1.5, process_code: "P1", process_name: "工序1" }],
    }));
    rec("CC5 sequence 字符串", await call("POST", "/api/v1/routings", {
      code: "BATCHC-RT4", name: "BATCHC seq 字符串", product_id: PROD.id,
      steps: [{ sequence: "2", process_code: "P1", process_name: "工序1" }],
    }));
  }

  // ---------- CC6 单据编辑改 type ----------
  console.log("\n=== CC6 编辑改单据 type ===");
  {
    const so = rec("建销售单", await call("POST", "/api/v1/sales-orders", {
      customer_id: ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0].id,
      warehouse_id: WH, lines: [{ product_id: PROD.id, qty: 2, price: 60 }],
    }));
    rec("CC6 改 order_type", await call("PUT", `/api/v1/sales-orders/${so?.id}`, {
      customer_id: ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0].id,
      warehouse_id: WH, source_type: "x", lines: [{ product_id: PROD.id, qty: 2, price: 60 }],
    }));
    rec("CC6 回读", await call("GET", `/api/v1/sales-orders/${so?.id}`), undefined);
  }

  // ---------- CC7 科目树成环 ----------
  console.log("\n=== CC7 科目树成环 ===");
  {
    const parent = rec("建父科目", await call("POST", "/api/v1/accounts", {
      code: "BATCHC-P1", name: "BATCHC 父", direction: "debit", category: "asset",
    }));
    const child = rec("建子科目", await call("POST", "/api/v1/accounts", {
      code: "BATCHC-C1", name: "BATCHC 子", direction: "debit", category: "asset", parent_id: parent?.id,
    }));
    rec("CC7 子改父=孙", await call("PUT", `/api/v1/accounts/${child?.id}`, { parent_id: child?.id }));
    rec("CC7 子改父=自己", await call("PUT", `/api/v1/accounts/${child?.id}`, { parent_id: child?.id }));
    rec("CC7 科目树", await call("GET", "/api/v1/accounts/tree"), undefined);
  }

  // ---------- CC8 BOM ----------
  console.log("\n=== CC8 BOM 负数/零 ===");
  {
    rec("CC8 qty=0", await call("POST", "/api/v1/boms", {
      name: "BATCHC BOM0", product_id: PROD.id, items: [{ product_id: PROD.id, qty_per: 0 }],
    }));
    rec("CC8 qty=-1", await call("POST", "/api/v1/boms", {
      name: "BATCHC BOMN", product_id: PROD.id, items: [{ product_id: PROD.id, qty_per: -1 }],
    }));
    rec("CC8 scrap=-0.1", await call("POST", "/api/v1/boms", {
      name: "BATCHC BOMS", product_id: PROD.id, items: [{ product_id: PROD.id, qty_per: 1, scrap_rate: -0.1 }],
    }));
    const okBom = rec("CC8 正常 BOM", await call("POST", "/api/v1/boms", {
      name: "BATCHC BOMOK", product_id: PROD.id, items: [{ product_id: PROD.id, qty_per: 2 }],
    }));
    // CC9 同产品多张 active BOM
    rec("CC9 同产品再建一张 active BOM", await call("POST", "/api/v1/boms", {
      name: "BATCHC BOMOK2", product_id: PROD.id, items: [{ product_id: PROD.id, qty_per: 5 }],
    }));
    const list = await call("GET", "/api/v1/boms?product_id=" + PROD.id);
    rec("CC9 该产品 BOM 数", undefined, { total: list?.data?.total, ids: JSON.stringify((list?.data?.list || []).map((b) => b.id)) });
    const wo = rec("CC9 建工单触发 MRP", await call("POST", "/api/v1/work-orders", {
      product_id: PROD.id, qty: 4, warehouse_id: WH, bom_id: okBom?.id, remark: "BATCHC-CC9",
    }));
    rec("CC9 工单回读", undefined, { bom_id: wo?.bom_id, materials: JSON.stringify(wo?.edges?.materials || wo?.edges || {}).slice(0, 180) });
    rec("CC9 MRP 需求", await call("GET", "/api/v1/mrp/requirements?page_size=3"), undefined);
  }

  // ---------- CC10 调拨编辑 ----------
  console.log("\n=== CC10 调拨单编辑 ===");
  {
    const whs = (await call("GET", "/api/v1/warehouses?page_size=50"))?.data?.list || [];
    const target = whs.find((w) => w.id !== WH);
    const tr = rec("建调拨单", await call("POST", "/api/v1/stock-transfers", {
      from_warehouse_id: WH, to_warehouse_id: target?.id, lines: [{ product_id: PROD.id, qty: 2 }],
    }));
    if (tr?.id) {
      rec("CC10 编辑改商品", await call("PUT", `/api/v1/stock-transfers/${tr.id}`, {
        from_warehouse_id: WH, to_warehouse_id: target?.id, lines: [{ product_id: PROD.id, qty: 5 }],
      }));
      rec("CC10 dispatch 后编辑", await call("POST", `/api/v1/stock-transfers/${tr.id}/dispatch`, {}));
      rec("CC10 dispatch 后再编辑", await call("PUT", `/api/v1/stock-transfers/${tr.id}`, {
        from_warehouse_id: WH, to_warehouse_id: target?.id, lines: [{ product_id: PROD.id, qty: 9 }],
      }));
    }
  }

  writeFileSync("evidence/backend-runtime/audit-batch-c-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次C：主数据一致性守卫", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-c-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
