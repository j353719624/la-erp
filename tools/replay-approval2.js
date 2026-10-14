#!/usr/bin/env node
// 清单第 6 项关键验证：审批流是否按 biz_type 生效
//
// 首轮发现：活动流 REC-PERSONAL-FLOW-1013 的 biz_type=sales_order，
// 退货审批仍然成功（code:0）。恢复端 returns.go:22 是**不区分 biz_type**
// 地统计所有 is_active=1 的流程后拒绝。
//
// 本轮构造 biz_type=sales_return 的活动流，再测退货审批，
// 以判定原版是「按业务类型匹配」还是「有流就拦」。
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
const TIE = "809d1ff9-da79-44fb-98f1-3053398c5818";
const ADMIN = "ae62f757-6855-4070-ab2c-01bdb35b880b";

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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 64)}`);
  return resp?.data;
}

// 完整跑一遍：创建退货 -> confirm -> approve
async function tryReturn(tag) {
  const c1 = (await call("GET", "/api/v1/customers?page_size=5"))?.data;
  const cust = (c1.list || c1)[0];
  const r = await call("POST", "/api/v1/sales-returns", {
    customer_id: cust.id, warehouse_id: WAREHOUSE,
    lines: [{ product_id: TIE, qty: 1, price: 11 }],
    remark: `REC-AUDIT9-${tag}`,
  });
  const d = rec(`${tag}-创建`, r);
  if (!d?.id) return null;
  await call("POST", `/api/v1/sales-returns/${d.id}/confirm`, {});
  const ap = await call("POST", `/api/v1/sales-returns/${d.id}/approve`, {});
  rec(`${tag}-approve`, ap);
  return ap;
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  const flows0 = (await call("GET", "/api/v1/approval-flows"))?.data || [];
  console.log("前置活动流:", flows0.map((f) => `${f.code}(${f.biz_type})`).join(", "), "\n");

  console.log("=== J1：仅有 sales_order 流时的退货审批（基线）===");
  await tryReturn("J1");

  // ---- 创建 sales_return 类型的活动流 ----
  console.log("\n=== J2：新建 biz_type=sales_return 的活动流后再测 ===");
  const nf = await call("POST", "/api/v1/approval-flows", {
    code: "REC-AUDIT9-RETURN-FLOW", name: "退货审批回放", biz_type: "sales_return",
    steps: [{ step_no: 1, name: "管理员步骤", approver_type: "user", approver_id: ADMIN, action: "approve" }],
  });
  const nfd = rec("J2a-创建退货流程", nf);

  if (nfd?.id) {
    await tryReturn("J2b");
    // 停用该流，再测一次，确认是「按类型匹配」而非「有流就拦」
    console.log("\n=== J3：停用 sales_return 流后再测 ===");
    rec("J3a-停用", await call("POST", `/api/v1/approval-flows/${nfd.id}/deactivate`, {}));
    await tryReturn("J3b");
    // 清理：删除本轮创建的流程
    console.log("\n=== 清理：删除本轮创建的退货流程 ===");
    rec("J4-删除", await call("DELETE", `/api/v1/approval-flows/${nfd.id}`));
  }

  writeFileSync(
    "evidence/backend-runtime/audit-approval-biztype-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "清单第6项 审批流是否按 biz_type 生效", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-approval-biztype-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });