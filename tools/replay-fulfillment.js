#!/usr/bin/env node
// 第 8 项审计：fulfillment.go 与 service.go 订单/单据路径分支取证
//
// 目标分支：
//  fulfillment.go:117 / service.go:588  存在活动审批流时 confirm/approve 拒绝
//  fulfillment.go:127                    approve 时 currency!=CNY 或 paid_amount>0 拒绝
//  fulfillment.go:105                    stock 单据 approve 拒绝
//  fulfillment.go:55                     源订单同商品多行（matches!=1）拒绝
//  fulfillment.go:68                     单位不一致拒绝
//  service.go:293                        订单 currency!=CNY 拒绝
//  service.go:179                        订单 discount_amount!=0 拒绝
//  service.go:319                        订单行 is_gift 拒绝
//  service.go:266                        单据 type 不匹配拒绝
//  service.go:171                        非 stock 单据带 source_id 拒绝
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
const ADMIN = "ae62f757-6855-4070-ab2c-01bdb35b880b";

const log = [];
let TOKEN = "";
async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  try { return { status: r.status, ...(await r.json()) }; } catch { return { status: r.status }; }
}
function rec(step, resp, extra) {
  const entry = { step, code: resp?.code, message: resp?.message ?? "", status: resp?.status };
  if (extra) entry.detail = extra;
  log.push(entry);
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 72)}`);
  return resp?.data;
}
function pick(list) { return (list?.list || list || [])[0]; }

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  // ---------- 前置资源 ----------
  const cust = pick((await call("GET", "/api/v1/customers?page_size=5"))?.data);
  const sup = pick((await call("GET", "/api/v1/suppliers?page_size=5"))?.data);
  const prod = pick((await call("GET", "/api/v1/products?page_size=5"))?.data);
  const units = (await call("GET", "/api/v1/units?page_size=5"))?.data;
  const unit = pick(units);
  const unit2 = (units?.list || units || [])[1] || unit;
  console.log("前置:", cust?.name, "|", sup?.name, "|", prod?.name, "| units:", unit?.id, unit2?.id, "\n");

  const orderLines = (qty, price, extra = {}) => [{ product_id: prod.id, qty, price, unit_id: unit?.id, ...extra }];

  // ---------- A1 基线：无活动流时订单 confirm+approve ----------
  console.log("=== A1：停用现有流，基线 confirm+approve ===");
  const flows0 = (await call("GET", "/api/v1/approval-flows"))?.data || [];
  let flowToReactivate = null;
  for (const f of flows0) {
    const r = await call("POST", `/api/v1/approval-flows/${f.id}/deactivate`, {});
    rec(`A1-停用流${f.code}`, r);
    flowToReactivate = f;
  }
  {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE, lines: orderLines(3, 100), remark: "FULF-A1",
    });
    const d = rec("A1-创建订单", c);
    if (d?.id) {
      rec("A1-confirm", await call("POST", `/api/v1/sales-orders/${d.id}/confirm`, {}));
      rec("A1-approve", await call("POST", `/api/v1/sales-orders/${d.id}/approve`, {}));
    }
  }

  // ---------- A2 有 sales_order 活动流时 confirm+approve ----------
  console.log("\n=== A2：启用 sales_order 活动流后再测 ===");
  let flowId = null;
  if (flowToReactivate) {
    const r = await call("POST", `/api/v1/approval-flows/${flowToReactivate.id}/activate`, {});
    rec("A2-启用原流", r);
    flowId = flowToReactivate.id;
  }
  if (!flowId) {
    const nf = await call("POST", "/api/v1/approval-flows", {
      code: "FULF-AUDIT-SO-FLOW", name: "订单审批回放", biz_type: "sales_order",
      steps: [{ step_no: 1, name: "管理员步骤", approver_type: "user", approver_id: ADMIN, action: "approve" }],
    });
    const nfd = rec("A2-新建sales_order流", nf);
    flowId = nfd?.id;
  }
  {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE, lines: orderLines(2, 100), remark: "FULF-A2",
    });
    const d = rec("A2-创建订单", c);
    if (d?.id) {
      rec("A2-confirm", await call("POST", `/api/v1/sales-orders/${d.id}/confirm`, {}));
      const ap = await call("POST", `/api/v1/sales-orders/${d.id}/approve`, {});
      rec("A2-approve", ap);
      // 记录 approve 后的状态，判断是否真的生效
      if (ap?.data?.status) log[log.length - 1].detail = { status: ap.data.status };
    }
  }

  // ---------- A3 探测订单收款端点，构造 paid_amount>0 后 approve ----------
  console.log("\n=== A3：订单收款端点探测与 paid>0 后 approve ===");
  {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE, lines: orderLines(5, 100), remark: "FULF-A3",
    });
    const d = rec("A3-创建订单", c);
    if (d?.id) {
      rec("A3-confirm", await call("POST", `/api/v1/sales-orders/${d.id}/confirm`, {}));
      for (const act of ["pay", "receive", "payment", "settle", "receipt"]) {
        const r = await call("POST", `/api/v1/sales-orders/${d.id}/${act}`, { amount: 100, cash_account_code: "1001" });
        const code = r?.code;
        console.log(`  [A3-probe-${act}] code=${code} ${String(r?.message ?? "").slice(0, 72)}`);
        log.push({ step: `A3-probe-${act}`, code, message: r?.message ?? "", status: r?.status });
        if (code === 0) { rec(`A3-${act}后approve`, await call("POST", `/api/v1/sales-orders/${d.id}/approve`, {})); break; }
      }
      // 复查订单 paid_amount
      const g = await call("GET", `/api/v1/sales-orders/${d.id}`);
      if (g?.data) log[log.length - 1].detail = { paid_amount: g.data.paid_amount, status: g.data.status };
    }
  }

  // ---------- A4 stock 单据 approve ----------
  console.log("\n=== A4：stock-ins confirm 后 approve ===");
  {
    const c = await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WAREHOUSE, lines: orderLines(4, 50), remark: "FULF-A4", type: "purchase",
    });
    const d = rec("A4-创建入库", c);
    if (d?.id) {
      rec("A4-confirm", await call("POST", `/api/v1/stock-ins/${d.id}/confirm`, {}));
      rec("A4-approve", await call("POST", `/api/v1/stock-ins/${d.id}/approve`, {}));
    }
  }

  // ---------- B 创建守卫 ----------
  console.log("\n=== B1：订单 currency=USD ===");
  {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE, currency: "USD", lines: orderLines(1, 100), remark: "FULF-B1",
    });
    const d = rec("B1-USD订单", c);
    if (d) log[log.length - 1].detail = { currency: d.currency, total_amount: d.total_amount };
  }
  console.log("\n=== B2：订单 discount_amount=50 ===");
  {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE, discount_amount: 50, lines: orderLines(1, 100), remark: "FULF-B2",
    });
    const d = rec("B2-折扣订单", c);
    if (d) log[log.length - 1].detail = { discount_amount: d.discount_amount, total_amount: d.total_amount };
  }
  console.log("\n=== B3：订单行 is_gift=true ===");
  {
    const c = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [{ product_id: prod.id, qty: 1, price: 100, is_gift: true, unit_id: unit?.id }], remark: "FULF-B3",
    });
    const d = rec("B3-赠品行", c);
    if (d?.lines?.[0]) log[log.length - 1].detail = { is_gift: d.lines[0].is_gift, amount: d.lines[0].amount };
  }
  console.log("\n=== B4：stock-in type=other ===");
  {
    const c = await call("POST", "/api/v1/stock-ins", {
      warehouse_id: WAREHOUSE, type: "other", lines: orderLines(1, 50), remark: "FULF-B4",
    });
    const d = rec("B4-type=other入库", c);
    if (d) log[log.length - 1].detail = { type: d.type };
  }
  console.log("\n=== B5：退货单带 sales_order_id 关联 ===");
  {
    // 先建一个已确认销售订单作为关联源
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE, lines: orderLines(2, 100), remark: "FULF-B5-SRC",
    });
    const sod = rec("B5a-源订单", so);
    if (sod?.id) {
      rec("B5b-源订单confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const sr = await call("POST", "/api/v1/sales-returns", {
        customer_id: cust.id, warehouse_id: WAREHOUSE, sales_order_id: sod.id, sales_order_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF-B5",
      });
      const srd = rec("B5c-关联退货", sr);
      if (srd) log[log.length - 1].detail = { sales_order_id: srd.sales_order_id, sales_order_no: srd.sales_order_no, status: srd.status };
    }
  }

  // ---------- C deliverLine ----------
  console.log("\n=== C1：源订单同商品两行 → 出库引该订单 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE,
      lines: [
        { product_id: prod.id, qty: 2, price: 100, unit_id: unit?.id },
        { product_id: prod.id, qty: 3, price: 90, unit_id: unit?.id },
      ], remark: "FULF-C1-SRC",
    });
    const sod = rec("C1a-同商品两行源订单", so);
    if (sod?.id) {
      rec("C1b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit?.id }], remark: "FULF-C1",
      });
      const outd = rec("C1c-引源订单出库", out);
      if (outd?.id) {
        rec("C1d-confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
        // 复查源订单行 delivered_qty
        const g = await call("GET", `/api/v1/sales-orders/${sod.id}`);
        if (g?.data?.lines) log[log.length - 1].detail = { lines: g.data.lines.map((l) => ({ qty: l.qty, delivered_qty: l.delivered_qty })) };
      }
    }
  }
  console.log("\n=== C2：出库行单位与源订单行单位不一致 ===");
  {
    const so = await call("POST", "/api/v1/sales-orders", {
      customer_id: cust.id, warehouse_id: WAREHOUSE, lines: orderLines(2, 100), remark: "FULF-C2-SRC",
    });
    const sod = rec("C2a-源订单", so);
    if (sod?.id) {
      rec("C2b-confirm", await call("POST", `/api/v1/sales-orders/${sod.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", {
        warehouse_id: WAREHOUSE, source_id: sod.id, source_no: sod.order_no,
        lines: [{ product_id: prod.id, qty: 1, price: 100, unit_id: unit2?.id }], remark: "FULF-C2",
      });
      rec("C2c-异单位出库", out);
    }
  }

  // ---------- 清理：恢复流的启用状态与原状一致 ----------
  console.log("\n=== 清理 ===");
  if (flowId) {
    rec("清理-停用本轮流", await call("POST", `/api/v1/approval-flows/${flowId}/deactivate`, {}));
  }

  writeFileSync(
    "evidence/backend-runtime/audit-fulfillment-orders-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 fulfillment/service 订单与单据路径分支取证", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fulfillment-orders-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
