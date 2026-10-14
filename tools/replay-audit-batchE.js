#!/usr/bin/env node
// 批次 E：生产 / 工单 / MRP / 外协
//
// EE1 productionstock.go:65 工单 completed/cancelled 状态新建生产单据
// EE2 productionstock.go:76/124 同材料重复行 / 已领已耗已退非零
// EE3 productionstock.go:194 明细高级字段
// EE4 productionstock.go:213 退料超过应退量
// EE5 workorders.go:132 BOM 产品与工单产品不一致
// EE6 workorders.go:188 换 BOM 后旧材料行
// EE7 workorders.go:282 未领完材料不能完成
// EE8 subcontracts.go:519/523 发料材料重复 / 商品不存在
// EE9 reworks.go:69 返工单工单状态
// EE10 mrp.go:58/279 负损耗率在 MRP 展开中的表现
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 110)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 240)}` : ""));
  return resp?.data;
}
async function twoPlainProducts() {
  const list = (await call("GET", "/api/v1/products?page_size=200"))?.data?.list || [];
  const ok = list.filter((p) => p.is_serial !== true && p.is_batch !== true && p.is_combo !== true);
  if (ok.length < 2) throw new Error("普通商品不足两个");
  return [ok[0], ok[1]];
}

let P1, P2;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  [P1, P2] = await twoPlainProducts();
  const SUP = ((await call("GET", "/api/v1/suppliers?page_size=5"))?.data?.list || [])[0];
  console.log("前置:", P1.name, "|", P2.name, "|", SUP?.name, "\n");

  // ---------- 建带 BOM 的工单 ----------
  const bom = rec("建 BOM(两材料)", await call("POST", "/api/v1/boms", {
    name: "BATCHE-BOM", product_id: P1.id,
    items: [{ product_id: P1.id, qty: 2 }, { product_id: P2.id, qty: 3 }],
  }));
  const wo = rec("建工单", await call("POST", "/api/v1/work-orders", {
    product_id: P1.id, qty: 10, warehouse_id: WH, bom_id: bom?.id, remark: "BATCHE",
  }));
  const mats0 = await call("GET", `/api/v1/work-orders/${wo?.id}/materials`);
  rec("工单材料(需求 20/30)", mats0, { json: JSON.stringify((mats0?.data || []).map((m) => ({ p: m.product_id === P1.id ? "P1" : "P2", req: m.qty_required, issued: m.qty_issued }))) });

  // ---------- EE5 BOM 产品不一致 ----------
  console.log("\n=== EE5 BOM 产品与工单产品不一致 ===");
  {
    const other = rec("建他品 BOM", await call("POST", "/api/v1/boms", {
      name: "BATCHE-BOM2", product_id: P2.id, items: [{ product_id: P2.id, qty: 5 }],
    }));
    rec("EE5 工单用他品 BOM", await call("POST", "/api/v1/work-orders", {
      product_id: P1.id, qty: 2, warehouse_id: WH, bom_id: other?.id,
    }));
  }

  // ---------- EE6 换 BOM 后旧材料行 ----------
  console.log("\n=== EE6 换 BOM 后旧材料行 ===");
  {
    const bom2 = rec("建第二张 BOM(单材料)", await call("POST", "/api/v1/boms", {
      name: "BATCHE-BOM3", product_id: P1.id, items: [{ product_id: P2.id, qty: 7 }],
    }));
    rec("EE6 改 bom_id", await call("PUT", `/api/v1/work-orders/${wo?.id}`, {
      product_id: P1.id, qty: 10, warehouse_id: WH, bom_id: bom2?.id,
    }));
    const after = await call("GET", `/api/v1/work-orders/${wo?.id}/materials`);
    rec("EE6 改后材料", after, { json: JSON.stringify((after?.data || []).map((m) => ({ p: m.product_id === P1.id ? "P1" : "P2", req: m.qty_required }))) });
    // 恢复回原 BOM
    rec("EE6 改回 bom_id", await call("PUT", `/api/v1/work-orders/${wo?.id}`, {
      product_id: P1.id, qty: 10, warehouse_id: WH, bom_id: bom?.id,
    }));
  }

  // ---------- EE1/EE2/EE3 生产单据 ----------
  console.log("\n=== EE1/EE2/EE3 领料/退料/入库 ===");
  {
    const si = rec("备料", await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WH, type: "purchase",
      lines: [{ product_id: P1.id, qty: 100, unit_cost: 5 }, { product_id: P2.id, qty: 100, unit_cost: 7 }],
      remark: "BATCHE-STOCK",
    }));
    if (si?.data?.id) rec("确认备料", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));
    const pick = rec("建领料单", await call("POST", "/api/v1/production-pickings", {
      work_order_id: wo?.id, warehouse_id: WH,
      lines: [{ product_id: P2.id, qty: 5 }],
    }));
    if (pick?.id) {
      rec("EE2 领料 confirm", await call("POST", `/api/v1/production-pickings/${pick.id}/confirm`, {}));
      const mats = await call("GET", `/api/v1/work-orders/${wo?.id}/materials`);
      rec("EE2 领料后材料", mats, { json: JSON.stringify((mats?.data || []).map((m) => ({ p: m.product_id === P1.id ? "P1" : "P2", req: m.qty_required, issued: m.qty_issued }))) });
      // EE4 退料超过应退量
      rec("EE4 退料 999", await call("POST", "/api/v1/production-returns", {
        work_order_id: wo?.id, warehouse_id: WH, lines: [{ product_id: P2.id, qty: 999 }],
      }));
      rec("EE4 退料 1", await call("POST", "/api/v1/production-returns", {
        work_order_id: wo?.id, warehouse_id: WH, lines: [{ product_id: P2.id, qty: 1 }],
      }));
      // EE3 明细高级字段
      rec("EE3 领料明细带 batch_no", await call("POST", "/api/v1/production-pickings", {
        work_order_id: wo?.id, warehouse_id: WH,
        lines: [{ product_id: P2.id, qty: 1, batch_no: "EE-B1", serial_nos: ["EE-S1"] }],
      }));
      rec("EE3 领料表头带 location_id", await call("POST", "/api/v1/production-pickings", {
        work_order_id: wo?.id, warehouse_id: WH, location_id: "00000000-0000-0000-0000-000000000009",
        lines: [{ product_id: P2.id, qty: 1 }],
      }));
    }
    // EE2 同材料重复行
    rec("EE2 同材料两行", await call("POST", "/api/v1/production-pickings", {
      work_order_id: wo?.id, warehouse_id: WH,
      lines: [{ product_id: P2.id, qty: 1 }, { product_id: P2.id, qty: 2 }],
    }));
    // EE7 未领完材料不能完成
    rec("EE7 直接 complete 工单", await call("POST", `/api/v1/work-orders/${wo?.id}/complete`, {}));
  }

  // ---------- EE8 外协发料材料 ----------
  console.log("\n=== EE8 外协发料材料 ===");
  {
    const so = rec("建带料外协单", await call("POST", "/api/v1/subcontract-orders", {
      supplier_id: SUP?.id, product_id: P1.id, qty: 5, mode: "with_material",
      materials: [{ product_id: P2.id, qty: 10 }, { product_id: P2.id, qty: 5 }],
    }));
    rec("EE8 回读 materials", undefined, { json: JSON.stringify(so?.materials || so?.edges?.materials || []).slice(0, 220) });
    const so2 = rec("建带料外协(不存在商品)", await call("POST", "/api/v1/subcontract-orders", {
      supplier_id: SUP?.id, product_id: P1.id, qty: 5, mode: "with_material",
      materials: [{ product_id: "00000000-0000-0000-0000-0000000000ff", qty: 1 }],
    }));
    rec("EE8 不存在商品结果", undefined, { created: !!so2?.id });
    // EE1 completed/cancelled 工单建单
    const doneWo = rec("建草稿工单", await call("POST", "/api/v1/work-orders", {
      product_id: P2.id, qty: 1, warehouse_id: WH, remark: "BATCHE-EE1",
    }));
    rec("EE1 取消该工单", await call("POST", `/api/v1/work-orders/${doneWo?.id}/cancel`, {}));
    rec("EE1 对 cancelled 工单领料", await call("POST", "/api/v1/production-pickings", {
      work_order_id: doneWo?.id, warehouse_id: WH, lines: [{ product_id: P1.id, qty: 1 }],
    }));
  }

  // ---------- EE9 返工单 ----------
  console.log("\n=== EE9 返工单 ===");
  {
    rec("返工单无 qty", await call("POST", "/api/v1/rework-orders", { work_order_id: wo?.id, qty: 1, reason: "BATCHE" }));
    const rw = rec("返工单 qty=1", await call("POST", "/api/v1/rework-orders", {
      work_order_id: wo?.id, qty: 1, reason: "缺陷", remark: "BATCHE-EE9",
    }));
    if (rw?.id) {
      for (const a of ["confirm", "start", "complete", "cancel", "delete"]) {
        rec(`EE9 ${a}`, await call("POST", `/api/v1/rework-orders/${rw.id}/${a}`, {}));
      }
    }
    const noWo = rec("返工单无工单", await call("POST", "/api/v1/rework-orders", { qty: 1, reason: "x" }));
    rec("EE9 无工单结果", undefined, { created: !!noWo?.id });
  }

  // ---------- EE10 负损耗率在 MRP ----------
  console.log("\n=== EE10 负损耗率 BOM 的 MRP 展开 ===");
  {
    const bad = rec("建 scrap<0 BOM", await call("POST", "/api/v1/boms", {
      name: "BATCHE-BAD", product_id: P2.id, items: [{ product_id: P1.id, qty: 4, scrap_rate: -0.1 }],
    }));
    const w2 = rec("按该 BOM 建工单 qty=10", await call("POST", "/api/v1/work-orders", {
      product_id: P2.id, qty: 10, warehouse_id: WH, bom_id: bad?.id,
    }));
    const m2 = await call("GET", `/api/v1/work-orders/${w2?.id}/materials`);
    rec("材料需求(10×4×0.9=36)", m2, { json: JSON.stringify((m2?.data || []).map((x) => x.qty_required)) });
    rec("MRP 需求", await call("GET", "/api/v1/mrp/requirements?page_size=5"), null);
  }

  writeFileSync("evidence/backend-runtime/audit-batch-e-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次E：生产/工单/MRP/外协", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-e-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
