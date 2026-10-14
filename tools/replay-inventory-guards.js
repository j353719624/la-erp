#!/usr/bin/env node
// 第 8 项第十四轮：库存调整 / 盘点 / 调拨三处 unit_id 守卫取证
// 恢复端 adjustments.go:125、checks.go:143、transfers.go:156 均以
// 「明细 unit_id 与商品主数据 unit_id 不一致 → ErrUnsupported」拒绝明细。
// V6 已证明通用单据路径原版放行异单位发货，本轮验证这三处是否同样放行。
//
// UA1 inventory-adjusts 明细 unit_id 与商品不一致
// UC1 inventory-checks 明细 unit_id 与商品不一致
// UT1 stock-transfers 明细 unit_id 与商品不一致
// UA2 inventory-adjusts 高级字段（location_id 等）
// UC2 inventory-checks 高级字段
// UT2 stock-transfers from_location_id/to_location_id
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 110)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 240)}` : ""));
  return resp?.data;
}
async function findPlainProduct() {
  const list = (await call("GET", "/api/v1/products?page_size=200"))?.data?.list || [];
  for (const p of list) {
    if (p.is_serial !== true && p.is_batch !== true && p.is_combo !== true && p.unit_id) return p;
  }
  throw new Error("没有带单位的普通商品");
}
let PROD, UNIT_A, UNIT_B;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  PROD = await findPlainProduct();
  const units = (await call("GET", "/api/v1/units?page_size=50"))?.data?.list || [];
  UNIT_A = PROD.unit_id;
  UNIT_B = units.map((u) => u.id).find((id) => id !== UNIT_A);
  console.log("前置:", PROD.name, "主单位:", UNIT_A, "| 异单位:", UNIT_B, "\n");

  // 备货
  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WAREHOUSE, type: "purchase",
    lines: [{ product_id: PROD.id, qty: 500, unit_cost: 50, unit_id: UNIT_A }], remark: "FULF14-STOCK",
  });
  if (si?.data?.id) rec("补库存", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- UA1 调整单异单位 ----------
  console.log("\n=== UA1：库存调整明细异单位 ===");
  {
    const adj = rec("建调整单", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WAREHOUSE, adjustment_type: "quantity", remark: "FULF14-UA1",
      lines: [{ product_id: PROD.id, qty: -1, unit_id: UNIT_B, remark: "异单位" }],
    }));
    if (adj?.id) {
      rec("confirm", await call("POST", `/api/v1/inventory-adjusts/${adj.id}/confirm`, {}));
      const got = await call("GET", `/api/v1/inventory-adjusts/${adj.id}`);
      rec("详情", got, { lines: (got?.data?.edges?.lines || got?.data?.lines || []).map((l) => `unit=${l.unit_id} qty=${l.qty}`) });
      rec("cancel", await call("POST", `/api/v1/inventory-adjusts/${adj.id}/cancel`, {}));
    }
    // 对照：同单位
    const ok = rec("建调整单(同单位)", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WAREHOUSE, adjustment_type: "quantity", remark: "FULF14-UA1B",
      lines: [{ product_id: PROD.id, qty: 1, unit_id: UNIT_A }],
    }));
    if (ok?.id) {
      rec("confirm", await call("POST", `/api/v1/inventory-adjusts/${ok.id}/confirm`, {}));
      rec("cancel", await call("POST", `/api/v1/inventory-adjusts/${ok.id}/cancel`, {}));
    }
  }

  // ---------- UC1 盘点单异单位 ----------
  console.log("\n=== UC1：盘点单明细异单位 ===");
  {
    const chk = rec("建盘点单", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WAREHOUSE, remark: "FULF14-UC1",
      lines: [{ product_id: PROD.id, unit_id: UNIT_B, remark: "异单位" }],
    }));
    if (chk?.id) {
      rec("start", await call("POST", `/api/v1/inventory-checks/${chk.id}/start`, {}));
      rec("complete", await call("POST", `/api/v1/inventory-checks/${chk.id}/complete`, {}));
      const got = await call("GET", `/api/v1/inventory-checks/${chk.id}`);
      rec("详情", got, { lines: (got?.data?.edges?.lines || got?.data?.lines || []).map((l) => `unit=${l.unit_id} book=${l.book_qty} diff=${l.diff_qty}`) });
    }
  }

  // ---------- UT1 调拨单异单位 ----------
  console.log("\n=== UT1：调拨单明细异单位 ===");
  {
    const target = rec("建目标仓", await call("POST", "/api/v1/warehouses", { code: "FULF14-WH", name: "FULF14-WH" }));
    const tr = rec("建调拨单", await call("POST", "/api/v1/stock-transfers", {
      from_warehouse_id: WAREHOUSE, to_warehouse_id: target?.id, remark: "FULF14-UT1",
      lines: [{ product_id: PROD.id, qty: 2, unit_id: UNIT_B }],
    }));
    if (tr?.id) {
      rec("dispatch", await call("POST", `/api/v1/stock-transfers/${tr.id}/dispatch`, {}));
      rec("complete", await call("POST", `/api/v1/stock-transfers/${tr.id}/complete`, {}));
      const got = await call("GET", `/api/v1/stock-transfers/${tr.id}`);
      rec("详情", got, { lines: (got?.data?.edges?.lines || got?.data?.lines || []).map((l) => `unit=${l.unit_id} qty=${l.qty}`) });
    }
  }

  // ---------- 高级字段三处 ----------
  console.log("\n=== UA2/UC2/UT2：高级字段 ===");
  const loc = ((await call("GET", "/api/v1/locations?page_size=50"))?.data?.list || [])[0];
  const rack = ((await call("GET", "/api/v1/racks?page_size=50"))?.data?.list || [])[0];
  const wh2 = ((await call("GET", "/api/v1/warehouses?page_size=50"))?.data?.list || [])[0];
  rec("locations 存在", undefined, { location: loc?.id });
  rec("racks 存在", undefined, { rack: rack?.id });
  if (loc?.id) {
    rec("UA2 调整单带 location_id", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WAREHOUSE, location_id: loc.id, adjustment_type: "quantity",
      lines: [{ product_id: PROD.id, qty: 1, unit_id: UNIT_A }],
    }), { headerLocation: loc.id });
  }
  if (rack?.id) {
    rec("UC2 盘点单带 location_id", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WAREHOUSE, location_id: rack.id,
      lines: [{ product_id: PROD.id, unit_id: UNIT_A }],
    }));
  }
  {
    const target = ((await call("GET", "/api/v1/warehouses?page_size=50"))?.data?.list || [])[0];
    rec("UT2 调拨单带 location 字段", await call("POST", "/api/v1/stock-transfers", {
      from_warehouse_id: WAREHOUSE, to_warehouse_id: target?.id,
      from_location_id: loc?.id, to_location_id: rack?.id,
      lines: [{ product_id: PROD.id, qty: 1, unit_id: UNIT_A }],
    }));
    const got = target ? await call("GET", `/api/v1/stock-transfers`) : undefined;
    if (got?.data?.list?.length) {
      const last = got.data.list[0];
      rec("调拨单回读", undefined, { from_location_id: last.from_location_id, to_location_id: last.to_location_id, location_id: last.location_id });
    }
  }
  void wh2;

  writeFileSync("evidence/backend-runtime/audit-inventory-guards-20261013.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "调整/盘点/调拨的单位守卫与高级字段", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-inventory-guards-20261013.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
