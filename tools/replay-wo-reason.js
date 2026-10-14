#!/usr/bin/env node
// 清单第 5 项续：退料 reason 字段要求（恢复端 productionstock.go:84 强制 reason=="excess"）
// 需先造一个「已领未退」的工单。
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
function rec(step, resp) {
  log.push({ step, code: resp?.code, message: resp?.message ?? "", data: resp?.data ?? null });
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 62)}`);
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
  const material = bom.edges.items[0];

  // 备料
  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: wh.id, type: "other",
    lines: [{ product_id: material.product_id, qty: 80, unit_cost: 2 }],
  });
  if (si?.data?.id) await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {});

  // 工单 + 领料 10 件（留足退料空间）
  const wo = await call("POST", "/api/v1/work-orders", {
    product_id: bom.product_id, qty: 5, warehouse_id: wh.id, bom_id: bom.id, remark: "REC-AUDIT14-wo",
  });
  const woId = wo?.data?.id;
  console.log("工单", wo?.data?.order_no);
  await call("POST", `/api/v1/work-orders/${woId}/confirm`, {});
  const pick = await call("POST", "/api/v1/production-pickings", {
    work_order_id: woId, warehouse_id: wh.id, picking_date: "2026-10-13T00:00:00Z",
    lines: [{ product_id: material.product_id, qty: 10, unit_cost: 2 }],
  });
  if (pick?.data?.id) await call("POST", `/api/v1/production-pickings/${pick.data.id}/confirm`, {});
  const m0 = ((await call("GET", `/api/v1/work-orders/${woId}/materials`))?.data || [])[0];
  console.log(`  领料后: required=${m0.qty_required} issued=${m0.qty_issued} returned=${m0.qty_returned}\n`);

  const mk = (extra) => ({
    work_order_id: woId, warehouse_id: wh.id, return_date: "2026-10-13T00:00:00Z",
    lines: [{ product_id: material.product_id, qty: 1, unit_cost: 2 }],
    remark: "REC-AUDIT14-probe", ...extra,
  });

  console.log("=== M1：reason 字段要求（各退 1 件）===");
  rec("M1a-不传reason", await call("POST", "/api/v1/production-returns", mk({})));
  rec("M1b-reason=多余", await call("POST", "/api/v1/production-returns", mk({ reason: "多余" })));
  rec("M1c-reason=other", await call("POST", "/api/v1/production-returns", mk({ reason: "other" })));
  rec("M1d-reason=excess", await call("POST", "/api/v1/production-returns", mk({ reason: "excess" })));

  // 确认其中成功的确实入库
  const m1 = ((await call("GET", `/api/v1/work-orders/${woId}/materials`))?.data || [])[0];
  console.log(`  当前: issued=${m1.qty_issued} returned=${m1.qty_returned}`);

  console.log("\n=== M2：零数量 / 负数量的 confirm 行为 ===");
  for (const [tag, qty] of [["零数量", 0], ["负数量", -1]]) {
    const body = mk({ reason: "excess", remark: "REC-AUDIT14-" + tag });
    body.lines[0].qty = qty;
    const r = await call("POST", "/api/v1/production-returns", body);
    const d = rec("M2-" + tag + "-创建", r);
    if (d?.id) rec("M2-" + tag + "-confirm", await call("POST", `/api/v1/production-returns/${d.id}/confirm`, {}));
  }
  const m2 = ((await call("GET", `/api/v1/work-orders/${woId}/materials`))?.data || [])[0];
  console.log(`  终态: issued=${m2.qty_issued} returned=${m2.qty_returned}`);

  writeFileSync(
    "evidence/backend-runtime/audit-workorder-return-reason-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "清单第5项 退料reason与数量边界", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-workorder-return-reason-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });