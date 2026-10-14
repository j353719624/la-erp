#!/usr/bin/env node
// 清单第 6 项：活动审批流组合
//   交接文档第 35 行：有活动流程时退货审批和工单动作；
//   普通/个人模式、多步骤与重复审批的实际结果。
//   现存 flows>0 拒绝不能默认等同原版。
//
// 恢复端对应拒绝分支：
//   returns.go:22    approveReturn 中 flows>0 → ErrUnsupported
//   workorders.go:220 工单动作中 flows>0 → ErrUnsupported
//
// 原版当前有活动审批流 REC-PERSONAL-FLOW-1013（biz_type=sales_order，1 步 user 类型）。
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
const TIE = "809d1ff9-da79-44fb-98f1-3053398c5818";

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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 62)}`);
  return resp?.data;
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  // ---- 前置：确认活动审批流存在 ----
  const flows = (await call("GET", "/api/v1/approval-flows"))?.data || [];
  console.log("=== 前置：当前活动审批流 ===");
  for (const f of flows) {
    console.log(`  ${f.code} biz=${f.biz_type} steps=${(f.edges?.steps || []).length}`);
  }
  if (flows.length === 0) { console.log("  无活动审批流，需先创建"); }

  // ============ I1：有活动审批流时销售退货的审批 ============
  console.log("\n=== I1：有活动审批流时退货审批 ===");
  const cust = (await call("GET", "/api/v1/customers?page_size=5"))?.data;
  const c1 = (cust.list || cust)[0];

  const r1 = await call("POST", "/api/v1/sales-returns", {
    customer_id: c1.id, warehouse_id: WAREHOUSE,
    lines: [{ product_id: TIE, qty: 1, price: 11 }],
    remark: "REC-AUDIT8-return-with-flow",
  });
  const rd = rec("I1a-创建退货", "POST", "/sales-returns", null, r1);
  if (rd?.id) {
    rec("I1b-confirm", "POST", `/sales-returns/${rd.id}/confirm`, {}, await call("POST", `/api/v1/sales-returns/${rd.id}/confirm`, {}));
    const ap = rec("I1c-approve(有活动流)", "POST", `/sales-returns/${rd.id}/approve`, {}, await call("POST", `/api/v1/sales-returns/${rd.id}/approve`, {}));
    if (ap) console.log("     -> status:", ap.status, "| 金额:", ap.total_amount);
    // 重复审批
    rec("I1d-重复approve", "POST", `/sales-returns/${rd.id}/approve`, {}, await call("POST", `/api/v1/sales-returns/${rd.id}/approve`, {}));
  }

  // ============ I2：有活动审批流时工单动作 ============
  console.log("\n=== I2：有活动审批流时工单动作 ===");
  const wos = (await call("GET", "/api/v1/work-orders?page_size=5"))?.data;
  const wo = (wos.list || wos)?.[0];
  if (!wo) {
    console.log("  无工单，先建一张");
    const prod = (await call("GET", "/api/v1/products?page_size=5"))?.data;
    const p = (prod.list || prod).find((x) => !x.is_batch);
    const nw = await call("POST", "/api/v1/work-orders", {
      product_id: p.id, qty: 1, warehouse_id: WAREHOUSE, remark: "REC-AUDIT8-wo",
    });
    rec("I2a-创建工单", "POST", "/work-orders", null, nw);
  }
  const woId = wo?.id || log.find((r) => r.step === "I2a-创建工单")?.data?.id;
  if (woId) {
    const d = await call("GET", `/api/v1/work-orders/${woId}`);
    console.log(`  工单 ${d?.data?.order_no} status=${d?.data?.status}`);
    rec("I2b-confirm(有活动流)", "POST", `/work-orders/${woId}/confirm`, {}, await call("POST", `/api/v1/work-orders/${woId}/confirm`, {}));
    rec("I2c-重复confirm", "POST", `/work-orders/${woId}/confirm`, {}, await call("POST", `/api/v1/work-orders/${woId}/confirm`, {}));
    const d2 = await call("GET", `/api/v1/work-orders/${woId}`);
    console.log(`     -> 工单状态: ${d2?.data?.status}`);
  }

  writeFileSync(
    "evidence/backend-runtime/audit-approval-flow-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "清单第6项 活动审批流组合", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-approval-flow-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });