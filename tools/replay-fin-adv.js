#!/usr/bin/env node
// 清单第 3 项：财务高级组合
//   交接文档第 32 行：非CNY发票、折扣、价税分离、多税率、部分收付后删除分别回放；
//   确认原版允许还是拒绝，再实现或匹配实际业务错误。
//
// 恢复端对应拒绝分支：
//   invoices.go:65/69/72  status 非 draft/cancelled、或 received_amount>0、或 paid_amount>0 → ErrUnsupported
//
// 本轮逐项实测，每个都记录原版真实 code/message，再对照恢复端。
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
  console.log(`  [${step}] HTTP=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 60)}`);
  return resp;
}
const show = (d) => d && typeof d === "object"
  ? JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !["created_at", "updated_at", "tenant_id", "edges"].includes(k)))).slice(0, 320)
  : "";

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  const cust = (await call("GET", "/api/v1/customers?page_size=5"))?.data?.list?.[0];

  // ============ G1：非 CNY 发票创建 ============
  console.log("=== G1：非 CNY 应收发票（USD）===");
  const g1 = rec("G1-创建USD发票", "POST", "/ar-invoices", {
    customer_id: cust.id, amount: "500", currency_code: "USD", exchange_rate: "7.2",
    remark: "REC-AUDIT6-usd-invoice",
  }, await call("POST", "/api/v1/ar-invoices", {
    customer_id: cust.id, amount: "500", currency_code: "USD", exchange_rate: "7.2",
    remark: "REC-AUDIT6-usd-invoice",
  }));
  if (g1?.code === 0) console.log("     ->", show(g1.data));

  // ============ G2：折扣字段 ============
  console.log("\n=== G2：发票折扣字段 ===");
  const g2body = { customer_id: cust.id, amount: "500", discount_amount: "50", remark: "REC-AUDIT6-discount" };
  const g2 = rec("G2-创建带折扣发票", "POST", "/ar-invoices", g2body, await call("POST", "/api/v1/ar-invoices", g2body));
  if (g2?.code === 0) console.log("     ->", show(g2.data));

  // ============ G3：价税分离 + 多税率 ============
  console.log("\n=== G3：价税分离 / 多税率 ===");
  for (const [tag, body] of [
    ["G3a-价税分离", { customer_id: cust.id, amount: "113", tax_rate: "0.13", tax_amount: "13", amount_excluding_tax: "100", remark: "REC-AUDIT6-taxsep" }],
    ["G3b-多税率行", { customer_id: cust.id, amount: "113", tax_rate: "0.13", lines: [{ product_id: null, qty: 1, price: 100, tax_rate: "0.13" }, { product_id: null, qty: 1, price: 50, tax_rate: "0.09" }], remark: "REC-AUDIT6-multirate" }],
  ]) {
    const r = rec(tag, "POST", "/ar-invoices", body, await call("POST", "/api/v1/ar-invoices", body));
    if (r?.code === 0) console.log("     ->", show(r.data));
  }

  // ============ G4：部分收款后删除 ============
  console.log("\n=== G4：部分收款后删除发票（恢复端 invoices.go:65/69/72 拒绝）===");
  const ars = (await call("GET", "/api/v1/ar-invoices?page_size=50"))?.data || [];
  const target = ars.find((a) => a.status === "unpaid" && Number(a.balance) >= 40);
  if (!target) { console.log("  无合适应收单，跳过 G4"); }
  else {
    console.log(`  目标应收 ${target.invoice_no} 余额 ${target.balance}`);
    const acc = (await call("GET", "/api/v1/accounts?page_size=200"))?.data?.list?.find((a) => a.code === "1002");
    const half = (Number(target.balance) / 2).toFixed(2);

    const rcBody = {
      customer_id: target.customer_id, cash_account_code: "1002", amount: half,
      lines: [{ ar_invoice_id: target.id, amount: half }],
      remark: "REC-AUDIT6-partial-receipt",
    };
    const rc = rec("G4a-创建部分收款", "POST", "/payment-receipts", rcBody, await call("POST", "/api/v1/payment-receipts", rcBody));
    if (rc?.code === 0) {
      rec("G4b-confirm", "POST", `/payment-receipts/${rc.data.id}/confirm`, {}, await call("POST", `/api/v1/payment-receipts/${rc.data.id}/confirm`, {}));
      const mid = await call("GET", `/api/v1/ar-invoices/${target.id}`);
      console.log(`     部分收款后：余额 ${mid?.data?.balance} 已收 ${mid?.data?.received_amount} 状态 ${mid?.data?.status}`);

      const del = rec("G4c-删除(已部分收款)", "DELETE", `/ar-invoices/${target.id}`, null, await call("DELETE", `/api/v1/ar-invoices/${target.id}`));
      const after = await call("GET", `/api/v1/ar-invoices/${target.id}`);
      console.log(`     删除后：HTTP=${del?.status} code=${del?.code}；单据 status=${after?.data?.status ?? "(查询失败)"} 余额=${after?.data?.balance ?? "-"}`);
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-finance-advanced-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "清单第3项 财务高级组合", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-finance-advanced-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });