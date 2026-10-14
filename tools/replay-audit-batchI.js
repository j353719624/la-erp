#!/usr/bin/env node
// 批次 I：银行对账与外协/MRP 剩余分支
//
// bank.go:209 ReconcileBank —— 同一金额有多张付款单（candidates>1）或非 CNY 时，
//   原实现直接 ErrUnsupported，会让**整批对账失败**。需确认原版是拒绝、跳过还是取首条。
// bank.go:98  DeleteBankRecord —— 删不存在记录的返回形态。
//
// II1 金额重名的付款单（两张同额）
// II2 非 CNY 付款单参与对账
// II3 删除不存在的银行账户/流水
// II4 有对账单时删除银行账户
// II5 外协 subcontracts.go:218/245
// II6 MRP mrp.go:58/299 负损耗率展开
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
function rec(step, resp, extra) {
  log.push({ step, code: resp?.code, message: resp?.message ?? "", status: resp?.status, ...(extra ? { detail: extra } : {}) });
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 110)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 260)}` : ""));
  return resp?.data;
}
const TODAY = new Date().toISOString();

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  const SUP = ((await call("GET", "/api/v1/suppliers?page_size=5"))?.data?.list || [])[0];
  const cash = ((await call("GET", "/api/v1/accounts?page_size=200"))?.data?.list || []).find((a) => a.code === "1001");
  console.log("前置:", SUP?.name, "| 现金科目:", cash?.name, "\n");

  // ---------- II1 金额重名 ----------
  console.log("=== II1 同额多张付款单 ===");
  {
    const inv1 = rec("应付发票 A (100)", await call("POST", "/api/v1/ap-invoices", {
      customer_id: SUP.id, invoice_date: TODAY, total_amount: 100,
    }));
    const inv2 = rec("应付发票 B (100)", await call("POST", "/api/v1/ap-invoices", {
      customer_id: SUP.id, invoice_date: TODAY, total_amount: 100,
    }));
    // 两张 100 的付款单，金额完全相同
    rec("付款单1(100)", await call("POST", "/api/v1/payments", {
      supplier_id: SUP.id, payment_date: TODAY, amount: 100, payment_type: "normal",
      cash_account_id: cash.id, cash_account_code: cash.code, cash_account_name: cash.name,
      lines: [{ ap_invoice_id: inv1?.id, amount: 100 }],
    }));
    rec("付款单2(100)", await call("POST", "/api/v1/payments", {
      supplier_id: SUP.id, payment_date: TODAY, amount: 100, payment_type: "normal",
      cash_account_id: cash.id, cash_account_code: cash.code, cash_account_name: cash.name,
      lines: [{ ap_invoice_id: inv2?.id, amount: 100 }],
    }));
    // 一条 100 的对账单，触发「同额候选 >1」
    const acc = rec("建银行账户", await call("POST", "/api/v1/bank/accounts", {
      name: "II1 银行", code: "II1-BANK", account_no: "6222000000000001",
    }));
    const st = rec("建对账单100", await call("POST", "/api/v1/bank/statements", {
      account_id: acc?.id, statement_date: TODAY, amount: 100, direction: "debit", remark: "II1",
    }));
    if (st?.id) {
      rec("II1 确认付款单1", await call("POST", `/api/v1/payments/${(await call("GET", "/api/v1/payments?page_size=5"))?.data?.list?.[0]?.id}/confirm`, {}));
      const r = rec("II1 对账", await call("POST", `/api/v1/bank/statements/${st.id}/reconcile`, {}));
      const after = await call("GET", `/api/v1/bank/statements/${st.id}`);
      rec("II1 对账后", after, { reconciled: after?.data?.reconciled, matched_ref: after?.data?.matched_ref });
    }
  }

  // ---------- II2 非 CNY ----------
  console.log("\n=== II2 非 CNY 付款单参与对账 ===");
  {
    const inv = rec("应付发票 C (55)", await call("POST", "/api/v1/ap-invoices", {
      customer_id: SUP.id, invoice_date: TODAY, total_amount: 100,
    }));
    rec("EUR 付款单", await call("POST", "/api/v1/payments", {
      supplier_id: SUP.id, payment_date: TODAY, amount: 55, payment_type: "normal",
      currency_code: "EUR", exchange_rate: 7.8,
      cash_account_id: cash.id, cash_account_code: cash.code, cash_account_name: cash.name,
      lines: [{ ap_invoice_id: inv?.id, amount: 55 }],
    }));
    const accs = (await call("GET", "/api/v1/bank/accounts?page_size=50"))?.data?.list || [];
    const acc = accs[0];
    const st = rec("建对账单55", await call("POST", "/api/v1/bank/statements", {
      account_id: acc?.id, statement_date: TODAY, amount: 55, direction: "debit", remark: "II2",
    }));
    if (st?.id) {
      const pays = (await call("GET", "/api/v1/payments?page_size=20"))?.data?.list || [];
      const eur = pays.find((p) => p.currency_code === "EUR");
      if (eur?.id) rec("确认 EUR 付款单", await call("POST", `/api/v1/payments/${eur.id}/confirm`, {}));
      rec("II2 对账", await call("POST", `/api/v1/bank/statements/${st.id}/reconcile`, {}));
      const after = await call("GET", `/api/v1/bank/statements/${st.id}`);
      rec("II2 对账后", after, { reconciled: after?.data?.reconciled, matched_ref: after?.data?.matched_ref });
    }
  }

  // ---------- II3/II4 删除银行记录 ----------
  console.log("\n=== II3/II4 银行记录删除 ===");
  {
    const D = "00000000-0000-0000-0000-000000000000";
    rec("II3 删不存在账户", await call("DELETE", `/api/v1/bank/accounts/${D}`, undefined));
    rec("II3 删不存在流水", await call("DELETE", `/api/v1/bank/statements/${D}`, undefined));
    const accs = (await call("GET", "/api/v1/bank/accounts?page_size=50"))?.data?.list || [];
    if (accs[0]?.id) {
      rec("II4 删有流水的账户", await call("DELETE", `/api/v1/bank/accounts/${accs[0].id}`, undefined));
      rec("II4 回读", await call("GET", `/api/v1/bank/accounts/${accs[0].id}`), undefined);
    }
  }

  // ---------- II5 外协 ----------
  console.log("\n=== II5 外协动作 ===");
  {
    const so = rec("建纯外协单", await call("POST", "/api/v1/subcontract-orders", {
      supplier_id: SUP.id, product_id: null, qty: 2, mode: "pure", remark: "II5",
    }));
    rec("II5 非法 mode", await call("POST", "/api/v1/subcontract-orders", {
      supplier_id: SUP.id, qty: 2, mode: "garbage", remark: "II5b",
    }));
    rec("II5 无供应商", await call("POST", "/api/v1/subcontract-orders", {
      qty: 2, mode: "pure", remark: "II5c",
    }));
    rec("II5 数量为 0", await call("POST", "/api/v1/subcontract-orders", {
      supplier_id: SUP.id, qty: 0, mode: "pure", remark: "II5d",
    }));
    if (so?.id) {
      rec("II5 取消纯外协单", await call("POST", `/api/v1/subcontract-orders/${so.id}/cancel`, {}));
      rec("II5 再次取消", await call("POST", `/api/v1/subcontract-orders/${so.id}/cancel`, {}));
    }
  }

  // ---------- II6 MRP 负损耗率 ----------
  console.log("\n=== II6 MRP 负损耗率展开 ===");
  {
    const P = ((await call("GET", "/api/v1/products?page_size=50"))?.data?.list || [])
      .find((p) => p.is_serial !== true && p.is_batch !== true);
    const bad = rec("建 scrap<0 BOM", await call("POST", "/api/v1/boms", {
      name: "II6-BAD", product_id: P.id, items: [{ product_id: P.id, qty: 4, scrap_rate: -0.1 }],
    }));
    const w = rec("按该 BOM 建工单 qty=10", await call("POST", "/api/v1/work-orders", {
      product_id: P.id, qty: 10, warehouse_id: "5f00c2ca-ee2c-4da5-8346-3d709daa30ad", bom_id: bad?.id,
    }));
    const m = await call("GET", `/api/v1/work-orders/${w?.id}/materials`);
    rec("II6 材料需求", m, { json: JSON.stringify((m?.data || []).map((x) => x.qty_required)) });
    rec("II6 MRP 需求", await call("GET", "/api/v1/mrp/requirements?page_size=3"), undefined);
  }

  writeFileSync("evidence/backend-runtime/audit-batch-i-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次I：银行对账/外协/MRP", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-i-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });