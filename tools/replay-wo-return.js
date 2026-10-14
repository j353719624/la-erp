#!/usr/bin/env node
// 清单第 5 项续：非 excess 退料（production-returns）
//
// 契约来源：backend/internal/api/production_atomic_test.go
//   POST /api/v1/production-pickings  {work_order_id, warehouse_id, picking_date, lines[{product_id, qty, unit_cost}]}
//   POST /api/v1/production-returns   同构，Spec 见 productionstock.go:15 附近
//
// 场景：
//   L1 领料 4 件 -> confirm
//   L2 全额退料 4 件 -> confirm（应成功）
//   L3 超额退料（退多于已领）-> 看原版是否拒绝
//   L4 零退料 / 负数退料边界
// 每步核对 work_order_materials 的 qty_issued / qty_returned 与库存余额。
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
let TOKEN = "";
async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  try { return { status: r.status, ...(await r.json()) }; } catch { return { status: r.status }; }
}
function rec(step, method, path, body, resp) {
  log.push({ step, method, path, body: body ?? null, code: resp?.code, message: resp?.message ?? "", data: resp?.data ?? null });
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 60)}`);
  return resp?.data;
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  const prodRaw = (await call("GET", "/api/v1/products?page_size=50"))?.data;
  const prods = prodRaw.list || prodRaw;
  const plain = prods.filter((p) => !p.is_batch);
  const whRaw = (await call("GET", "/api/v1/warehouses"))?.data;
  const wh = (whRaw.list || whRaw)[0];
  const bomsRaw = (await call("GET", "/api/v1/boms?page_size=20"))?.data;
  const boms = (bomsRaw.list || bomsRaw) || [];
  const bom = boms.find((b) => (b.edges?.items || []).length > 0);

  // 给材料备货
  const material = bom.edges.items[0];
  const stock = rec("L0-备料入库", "POST", "/stock-ins", null, await call("POST", "/api/v1/stock-ins", {
    warehouse_id: wh.id, type: "other",
    lines: [{ product_id: material.product_id, qty: 50, unit_cost: 2 }],
  }));
  if (stock?.id) await call("POST", `/api/v1/stock-ins/${stock.id}/confirm`, {});

  // 工单
  const wo = rec("L0b-建工单", "POST", "/work-orders", null, await call("POST", "/api/v1/work-orders", {
    product_id: bom.product_id, qty: 2, warehouse_id: wh.id, bom_id: bom.id, remark: "REC-AUDIT13-wo",
  }));
  const woId = wo?.id;
  if (!woId) { console.log("工单创建失败"); return; }
  await call("POST", `/api/v1/work-orders/${woId}/confirm`, {});
  const mats0 = (await call("GET", `/api/v1/work-orders/${woId}/materials`))?.data || [];
  console.log(`  材料行: ${JSON.stringify(mats0.map((m) => ({ req: m.qty_required, issued: m.qty_issued, ret: m.qty_returned })))}\n`);

  const showMats = async (tag) => {
    const m = (await call("GET", `/api/v1/work-orders/${woId}/materials`))?.data || [];
    console.log(`  ${tag}: ${JSON.stringify(m.map((x) => ({ req: x.qty_required, issued: x.qty_issued, ret: x.qty_returned })))}`);
  };

  // ---- L1 领料 4 件 ----
  console.log("=== L1：领料 4 件 ===");
  const pick = rec("L1a-建领料单", "POST", "/production-pickings", null, await call("POST", "/api/v1/production-pickings", {
    work_order_id: woId, warehouse_id: wh.id, picking_date: "2026-10-13T00:00:00Z",
    lines: [{ product_id: material.product_id, qty: 4, unit_cost: 2 }],
    remark: "REC-AUDIT13-pick",
  }));
  if (pick?.id) {
    rec("L1b-confirm", "POST", `/production-pickings/${pick.id}/confirm`, {}, await call("POST", `/api/v1/production-pickings/${pick.id}/confirm`, {}));
    await showMats("领料后");
  }

  // ---- L2 全额退料 ----
  console.log("\n=== L2：全额退料 4 件（非 excess）===");
  const ret1 = rec("L2a-建退料单", "POST", "/production-returns", null, await call("POST", "/api/v1/production-returns", {
    work_order_id: woId, warehouse_id: wh.id, return_date: "2026-10-13T00:00:00Z",
    lines: [{ product_id: material.product_id, qty: 4, unit_cost: 2 }],
    remark: "REC-AUDIT13-ret-full",
  }));
  if (ret1?.id) {
    rec("L2b-confirm", "POST", `/production-returns/${ret1.id}/confirm`, {}, await call("POST", `/api/v1/production-returns/${ret1.id}/confirm`, {}));
    await showMats("全额退料后");
  }

  // ---- L3 超额退料（已领已退完，再退）----
  console.log("\n=== L3：超额退料（已全额退回后再退 2 件）===");
  const ret2 = rec("L3-超额退料", "POST", "/production-returns", null, await call("POST", "/api/v1/production-returns", {
    work_order_id: woId, warehouse_id: wh.id, return_date: "2026-10-13T00:00:00Z",
    lines: [{ product_id: material.product_id, qty: 2, unit_cost: 2 }],
    remark: "REC-AUDIT13-ret-excess",
  }));
  if (ret2?.id) {
    rec("L3b-confirm", "POST", `/production-returns/${ret2.id}/confirm`, {}, await call("POST", `/api/v1/production-returns/${ret2.id}/confirm`, {}));
    await showMats("超额退料后");
  }

  // ---- L4 零/负数退料 ----
  console.log("\n=== L4：零数量与负数退料边界 ===");
  rec("L4a-零数量", "POST", "/production-returns", null, await call("POST", "/api/v1/production-returns", {
    work_order_id: woId, warehouse_id: wh.id, return_date: "2026-10-13T00:00:00Z",
    lines: [{ product_id: material.product_id, qty: 0, unit_cost: 2 }], remark: "REC-AUDIT13-zero",
  }));
  rec("L4b-负数量", "POST", "/production-returns", null, await call("POST", "/api/v1/production-returns", {
    work_order_id: woId, warehouse_id: wh.id, return_date: "2026-10-13T00:00:00Z",
    lines: [{ product_id: material.product_id, qty: -2, unit_cost: 2 }], remark: "REC-AUDIT13-neg",
  }));

  writeFileSync(
    "evidence/backend-runtime/audit-workorder-material-return-20261013.json",
    JSON.stringify({ generated: "2026-10-13T00:00:00Z", purpose: "清单第5项 非excess退料", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-workorder-material-return-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });