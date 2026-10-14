#!/usr/bin/env node
// 批次 H：库存与生产剩余分支
//
// HH1 checks.go:50/145/153/297 盘点单（表头 location 无列 / 明细高级字段 / 重复材料 / 动作白名单）
// HH2 photos.go:103/112 照片库位与仓库/货架归属
// HH3 adjustments.go:196/245 调整单 cost 型与库存更新
// HH4 batch_allocation.go:18 批次分配策略
// HH5 transfers.go:66/208 调拨单 location 与动作
// HH6 assemblies.go:34 / toolings.go:59 / reworks.go:69/153 动作白名单
// HH7 routings.go:157 sequence 非整数
// HH8 productionmasters.go:12 / productionreceipt.go:25
// HH9 workprocesses.go:89/108 工序动作与负数
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 100)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 240)}` : ""));
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
  const loc = ((await call("GET", "/api/v1/locations?page_size=50"))?.data?.list || [])[0];
  const rack = ((await call("GET", "/api/v1/racks?page_size=50"))?.data?.list || [])[0];
  console.log("前置:", P.name, "| location:", loc?.id?.slice(0, 8), "| rack:", rack?.id?.slice(0, 8), "\n");

  const si = rec("备料", await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WH, type: "purchase", lines: [{ product_id: P.id, qty: 300, unit_cost: 40 }],
    remark: "BATCHH",
  }));
  if (si?.data?.id) rec("确认备料", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- HH1 盘点单 ----------
  console.log("\n=== HH1 盘点单 ===");
  {
    rec("HH1 表头 location_id", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WH, location_id: loc?.id, lines: [{ product_id: P.id }],
    }));
    rec("HH1 表头 rack_id", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WH, rack_id: rack?.id, lines: [{ product_id: P.id }],
    }));
    const dup = rec("HH1 同商品两行", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WH, lines: [{ product_id: P.id }, { product_id: P.id }],
    }));
    if (dup?.id) {
      const got = await call("GET", `/api/v1/inventory-checks/${dup.id}`);
      rec("HH1 两行回读", undefined, { n: (got?.data?.edges?.lines || []).length });
      rec("HH1 start", await call("POST", `/api/v1/inventory-checks/${dup.id}/start`, {}));
      rec("HH1 complete", await call("POST", `/api/v1/inventory-checks/${dup.id}/complete`, {}));
      const done = await call("GET", `/api/v1/inventory-checks/${dup.id}`);
      rec("HH1 完成后", done, { profit_items: done?.data?.profit_items, loss_items: done?.data?.loss_items });
      rec("HH1 完成后 cancel", await call("POST", `/api/v1/inventory-checks/${dup.id}/cancel`, {}));
    }
    const empty = rec("HH1 空明细", await call("POST", "/api/v1/inventory-checks", { warehouse_id: WH, lines: [] }));
    const bad = rec("HH1 不存在仓库", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: "00000000-0000-0000-0000-0000000000aa", lines: [{ product_id: P.id }],
    }));
    rec("HH1 结果", undefined, { emptyCreated: !!empty?.id, badCreated: !!bad?.id });
  }

  // ---------- HH2 照片库位 ----------
  console.log("\n=== HH2 照片库位 ===");
  {
    const si2 = rec("建入库单", await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WH, lines: [{ product_id: P.id, qty: 2, unit_cost: 5 }], remark: "HH2",
    }));
    rec("确认", await call("POST", `/api/v1/stock-ins/${si2?.id}/confirm`, {}));
    rec("照片带 location", await call("POST", `/api/v1/stock-ins/${si2?.id}/photos`, {
      photos: [{ url: "/uploads/images/h1.png", location_id: loc?.id }],
    }));
    rec("照片带 rack", await call("POST", `/api/v1/stock-ins/${si2?.id}/photos`, {
      photos: [{ url: "/uploads/images/h2.png", rack_id: rack?.id }],
    }));
    rec("照片带位置字符串", await call("POST", `/api/v1/stock-ins/${si2?.id}/photos`, {
      photos: [{ url: "/uploads/images/h3.png", location: "A-01-02" }],
    }));
    rec("照片带不存在的 location", await call("POST", `/api/v1/stock-ins/${si2?.id}/photos`, {
      photos: [{ url: "/uploads/images/h4.png", location_id: "00000000-0000-0000-0000-0000000000bb" }],
    }));
    // 跨仓库位
    const wh2 = ((await call("GET", "/api/v1/warehouses?page_size=50"))?.data?.list || []).find((w) => w.id !== WH);
    const loc2 = await call("POST", "/api/v1/locations", { name: "HH2-LOC", warehouse_id: wh2?.id });
    rec("照片带他仓 location", await call("POST", `/api/v1/stock-ins/${si2?.id}/photos`, {
      photos: [{ url: "/uploads/images/h5.png", location_id: loc2?.data?.id }],
    }));
  }

  // ---------- HH3 调整单 ----------
  console.log("\n=== HH3 库存调整 ===");
  {
    const loss = rec("loss 型", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, adjust_type: "loss", lines: [{ product_id: P.id, qty: 999 }],
    }));
    if (loss?.id) rec("confirm(超量 loss)", await call("POST", `/api/v1/inventory-adjusts/${loss.id}/confirm`, {}));
    const gain = rec("gain 型", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, adjust_type: "gain", lines: [{ product_id: P.id, qty: 5 }],
    }));
    if (gain?.id) rec("confirm", await call("POST", `/api/v1/inventory-adjusts/${gain.id}/confirm`, {}));
    rec("未知类型 confirm", await call("POST", `/api/v1/inventory-adjusts/${gain?.id}/confirm`, {}));
    rec("已确认后 delete", await call("DELETE", `/api/v1/inventory-adjusts/${gain?.id}`, undefined));
  }

  // ---------- HH4 批次分配策略 ----------
  console.log("\n=== HH4 批次策略 ===");
  {
    rec("读设置", await call("GET", "/api/v1/settings"), undefined);
    for (const s of ["fefo", "lifo", "garbage"]) {
      const r = await call("PUT", "/api/v1/settings", { inventory: { batch_strategy: s } });
      rec("设 " + s, r);
    }
    rec("读回设置", await call("GET", "/api/v1/settings"), undefined);
    await call("PUT", "/api/v1/settings", { inventory: { batch_strategy: "fifo" } });
  }

  // ---------- HH5 调拨 ----------
  console.log("\n=== HH5 调拨 ===");
  {
    const whs = (await call("GET", "/api/v1/warehouses?page_size=50"))?.data?.list || [];
    const target = whs.find((w) => w.id !== WH);
    const tr = rec("建调拨", await call("POST", "/api/v1/stock-transfers", {
      from_warehouse_id: WH, to_warehouse_id: target?.id,
      lines: [{ product_id: P.id, qty: 2 }],
    }));
    if (tr?.id) {
      for (const a of ["dispatch", "complete", "cancel", "delete"]) {
        rec("HH5 " + a, await call("POST", `/api/v1/stock-transfers/${tr.id}/${a}`, {}));
      }
    }
    rec("同进同出仓", await call("POST", "/api/v1/stock-transfers", {
      from_warehouse_id: WH, to_warehouse_id: WH, lines: [{ product_id: P.id, qty: 1 }],
    }));
  }

  // ---------- HH6 动作白名单 ----------
  console.log("\n=== HH6 动作白名单 ===");
  {
    const asm = rec("建装配单", await call("POST", "/api/v1/assemblies", {
      warehouse_id: WH, product_id: P.id, qty: 1,
      items: [{ product_id: P.id, qty: 1 }],
    }));
    if (asm?.id) for (const a of ["confirm", "start", "complete", "cancel", "delete"]) {
      rec("HH6 装配 " + a, await call("POST", `/api/v1/assemblies/${asm.id}/${a}`, {}));
    }
    const tl = rec("建工装", await call("POST", "/api/v1/toolings", { tooling_no: "HH-TL", name: "HH 工装" }));
    if (tl?.id) for (const a of ["maintain", "scrap", "check", "repair", "delete", "cancel"]) {
      rec("HH6 工装 " + a, await call("POST", `/api/v1/toolings/${tl.id}/${a}`, {}));
    }
    const wo = rec("建工单", await call("POST", "/api/v1/work-orders", {
      product_id: P.id, qty: 3, warehouse_id: WH, remark: "HH6",
    }));
    const rw = rec("建返工单", await call("POST", "/api/v1/rework-orders", {
      work_order_id: wo?.id, qty_rework: 1, reason: "HH", remark: "HH6",
    }));
    if (rw?.id) for (const a of ["confirm", "start", "complete", "cancel", "delete"]) {
      rec("HH6 返工 " + a, await call("POST", `/api/v1/rework-orders/${rw.id}/${a}`, {}));
    }
    // 对已取消工单建返工单
    rec("取消工单", await call("POST", `/api/v1/work-orders/${wo?.id}/cancel`, {}));
    rec("HH6 已取消工单建返工单", await call("POST", "/api/v1/rework-orders", {
      work_order_id: wo?.id, qty_rework: 1, reason: "HH", remark: "HH6b",
    }));
  }

  // ---------- HH7 工艺 sequence ----------
  console.log("\n=== HH7 工艺 sequence ===");
  {
    rec("HH7 sequence 小数", await call("POST", "/api/v1/routings", {
      name: "HH seq 小数", product_id: P.id,
      steps: [{ sequence: 1.5, process_code: "P1", process_name: "工序1" }],
    }));
    rec("HH7 sequence 字符串数字", await call("POST", "/api/v1/routings", {
      name: "HH seq 字符串", product_id: P.id,
      steps: [{ sequence: "2", process_code: "P1", process_name: "工序1" }],
    }));
    rec("HH7 sequence 负数", await call("POST", "/api/v1/routings", {
      name: "HH seq 负数", product_id: P.id,
      steps: [{ sequence: -1, process_code: "P1", process_name: "工序1" }],
    }));
    rec("HH7 空 steps", await call("POST", "/api/v1/routings", {
      name: "HH 空工序", product_id: P.id, steps: [],
    }));
  }

  // ---------- HH8 生产主数据/完工入库 ----------
  console.log("\n=== HH8 生产主数据与完工入库 ===");
  {
    const D = "00000000-0000-0000-0000-000000000000";
    rec("删不存在的工时", await call("DELETE", `/api/v1/time-records/${D}`, undefined));
    rec("删不存在的工艺", await call("DELETE", `/api/v1/routings/${D}`, undefined));
    rec("删不存在的工作中心", await call("DELETE", `/api/v1/work-centers/${D}`, undefined));
    rec("删不存在的设备", await call("DELETE", `/api/v1/production-equipments/${D}`, undefined));
  }

  // ---------- HH9 工序 ----------
  console.log("\n=== HH9 工序 ===");
  {
    const wo = rec("建工单", await call("POST", "/api/v1/work-orders", {
      product_id: P.id, qty: 3, warehouse_id: WH, remark: "HH9",
    }));
    rec("工单详情(含工序)", await call("GET", `/api/v1/work-orders/${wo?.id}`), undefined);
    for (const r of ["work-order-processes", "work-orders/" + wo?.id + "/processes"]) {
      rec("GET " + r, await call("GET", `/api/v1/${r}`), undefined);
    }
  }

  writeFileSync("evidence/backend-runtime/audit-batch-h-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次H：库存与生产剩余分支", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-h-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });