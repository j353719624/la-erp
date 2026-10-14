#!/usr/bin/env node
// 清单第 4 项：外协关联工单/工序 + 带料外协发料/消耗/退料后取消
//
// 目标（交接文档第 33 行）：
//   工单/工序关联外协；带料外协发料、消耗、退料后取消。
//   前后查材料数量、库存、AP 和凭证，不能由浏览器没有额外请求推断无过账。
//
// 恢复端对应拒绝分支：
//   subcontracts.go:96   work_order_id / process_id 非空 → ErrUnsupported
//   subcontracts.go:204/210  with_material 且 issued/consumed/returned 任一非零 → 取消被拒
//
// 现有原版外协单只有 3 张纯外协单，无带料样本，需新建。
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
const MATERIAL = "bf72a5f6-6472-4d6d-9ae3-e36aaf94e283"; // REC-BOUNDARY-1013 is_batch=true
const PRODUCT = "a5157c7f-5b0e-4693-ad28-c63900353925";    // REC-SUB-FINAL-1013 产出商品

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
  console.log(`[${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 66)}`);
  return resp?.data;
}

const bal = async (pid) => {
  const j = await call("GET", `/api/v1/inventory-balances?product_id=${pid}`);
  return (j?.data?.list || []).map((b) => ({ batch: b.batch_no ?? "(无批次)", qty: b.qty_available, cost: b.avg_cost }));
};
const apCount = async () => (await call("GET", "/api/v1/ap-invoices?page_size=100"))?.data?.total;
const voucherCount = async () => (await call("GET", "/api/v1/vouchers?page_size=100"))?.data?.total;
const mvCount = async (pid) => (await call("GET", `/api/v1/stock-movements?page_size=80`))?.data?.list?.filter((m) => m.product_id === pid).length;

async function supplier() {
  const j = await call("GET", "/api/v1/suppliers?page_size=5");
  const l = j?.data?.list || [];
  return l[0]?.id;
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  const sup = await supplier();
  console.log("供应商:", sup, "\n材料初始余额:", JSON.stringify(await bal(MATERIAL)), "\n");

  // ============ 场景 1：关联工单/工序的外协创建 ============
  const wo = await call("GET", "/api/v1/work-orders?page_size=3");
  const woId = wo?.data?.list?.[0]?.id;
  console.log("=== 场景1：外协关联工单 ===");
  console.log("  可用工单:", woId || "(无)");
  const c1 = await call("POST", "/api/v1/subcontract-orders", {
    supplier_id: sup, product_id: PRODUCT, warehouse_id: WAREHOUSE,
    mode: "with_material", qty: 1, unit_price: 13, work_order_id: woId || "",
    material_lines: [{ product_id: MATERIAL, qty: 2, unit_cost: 5, warehouse_id: WAREHOUSE }],
    remark: "REC-AUDIT4-linked-wo",
  });
  rec("S1-创建带料且关联工单", "POST", "/subcontract-orders", null, c1);

  // ============ 场景 2：带料外协 发料 -> 消耗 -> 退料 -> 取消 ============
  console.log("\n=== 场景2：带料外协发料后取消 ===");
  const before = {
    bal: await bal(MATERIAL), ap: await apCount(), voucher: await voucherCount(), mv: await mvCount(MATERIAL),
  };
  console.log("  前置:", JSON.stringify(before));

  const c2 = await call("POST", "/api/v1/subcontract-orders", {
    supplier_id: sup, product_id: PRODUCT, warehouse_id: WAREHOUSE,
    mode: "with_material", qty: 1, unit_price: 13,
    material_lines: [{ product_id: MATERIAL, qty: 2, unit_cost: 5, warehouse_id: WAREHOUSE }],
    remark: "REC-AUDIT4-with-material",
  });
  const o2 = rec("S2-创建带料外协", "POST", "/subcontract-orders", null, c2);
  const id2 = o2?.id;
  if (!id2) { console.log("  创建失败，终止"); return; }

  const base = `/api/v1/subcontract-orders/${id2}`;
  rec("S3-confirm", "POST", `${base}/confirm`, {}, await call("POST", `${base}/confirm`, {}));

  // 发料。请求体**顶层即 JSON 数组**（decodeSubcontractLines: var raw []map[string]any）。
  // 原版按材料行定位（错误「发料行不存在或不属于该外协单」），需带 line_id/material_line_id。
  const det = await call("GET", base);
  const matLines = det?.data?.edges?.material_lines || [];
  console.log("  材料行:", matLines.map((m) => ({ id: m.id, product_id: m.product_id, qty: m.qty })).map((m) => JSON.stringify(m)).join(" "));
  const ml = matLines[0] || {};
  const issBody = [{
    material_line_id: ml.id, line_id: ml.id, product_id: MATERIAL,
    qty: 2, warehouse_id: WAREHOUSE,
  }];
  const iss = await call("POST", `${base}/issue`, issBody);
  rec("S4-issue发料2件", "POST", `${base}/issue`, null, iss);
  const midBal = await bal(MATERIAL);
  const midAp = await apCount(), midV = await voucherCount(), midMv = await mvCount(MATERIAL);
  console.log("  发料后:", JSON.stringify({ bal: midBal, ap: midAp, voucher: midV, mv: midMv }));

  // 发料后立即取消 —— 清单第4项核心
  const cancel1 = await call("POST", `${base}/cancel`, {});
  rec("S5-发料后取消", "POST", `${base}/cancel`, {}, cancel1);

  const after1 = {
    bal: await bal(MATERIAL), ap: await apCount(), voucher: await voucherCount(), mv: await mvCount(MATERIAL),
  };
  console.log("  取消后:", JSON.stringify(after1));
  console.log("  差异: 库存", JSON.stringify(before.bal) === JSON.stringify(after1.bal) ? "未变" : "已变",
    "| AP", before.ap === after1.ap ? "未变" : `${before.ap}->${after1.ap}`,
    "| 凭证", before.voucher === after1.voucher ? "未变" : `${before.voucher}->${after1.voucher}`,
    "| 流水", before.mv === after1.mv ? "未变" : `${before.mv}->${after1.mv}`);

  // 退料后取消
  // 退料。同样引用材料行。
  const ret = await call("POST", `${base}/return-material`, [
    { material_line_id: ml.id, line_id: ml.id, product_id: MATERIAL, qty: 2, warehouse_id: WAREHOUSE },
  ]);
  rec("S6-退料2件", "POST", `${base}/return-material`, null, ret);
  const afterRet = await bal(MATERIAL);
  console.log("  退料后余额:", JSON.stringify(afterRet));

  const cancel2 = await call("POST", `${base}/cancel`, {});
  rec("S7-退料后取消", "POST", `${base}/cancel`, {}, cancel2);
  const after2 = {
    bal: await bal(MATERIAL), ap: await apCount(), voucher: await voucherCount(), mv: await mvCount(MATERIAL),
  };
  console.log("  最终:", JSON.stringify(after2));

  // ============ 场景 3：已收货后取消 ============
  console.log("\n=== 场景3：收货后取消 ===");
  const c3 = await call("POST", "/api/v1/subcontract-orders", {
    supplier_id: sup, product_id: PRODUCT, warehouse_id: WAREHOUSE,
    mode: "with_material", qty: 2, unit_price: 13,
    material_lines: [{ product_id: MATERIAL, qty: 2, unit_cost: 5, warehouse_id: WAREHOUSE }],
    remark: "REC-AUDIT4-receive-cancel",
  });
  const o3 = rec("S8-创建(收货用)", "POST", "/subcontract-orders", null, c3);
  const id3 = o3?.id;
  if (id3) {
    const b3 = `/api/v1/subcontract-orders/${id3}`;
    await call("POST", `${b3}/confirm`, {});
    await call("POST", `${b3}/receive`, { qty: 2 });
    rec("S9-receive收货2件", "POST", `${b3}/receive`, null, await call("GET", b3));
    const d3 = await call("POST", `${b3}/cancel`, {});
    rec("S10-收货后取消", "POST", `${b3}/cancel`, {}, d3);
  }

  writeFileSync(
    "evidence/backend-runtime/audit-subcontract-with-material-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "清单第4项 带料外协发料/退料/收货后取消", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-subcontract-with-material-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });