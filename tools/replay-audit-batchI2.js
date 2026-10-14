#!/usr/bin/env node
// 批次 I 修正轮：银行对账（契约已探明）
//   对账路由 = POST /api/v1/bank/reconcile?account_id=<uuid>（整账户批量）
//   汇总路由 = GET  /api/v1/bank/reconcile-summary?account_id=<uuid>
//   应付发票字段 = supplier_id（不是 customer_id）
//
// II1 同一账户两张对账单金额相同（会撞上「同额候选>1」守卫）
// II2 非 CNY 付款单能否被对账匹配
// II3 删除不存在的银行账户 / 流水
// II4 有对账单时删除银行账户
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
  console.log("前置:", SUP?.name, "\n");

  // 建专用银行账户
  const acc = rec("建银行账户", await call("POST", "/api/v1/bank/accounts", {
    name: "II 银行", account_no: "6222" + Date.now().toString().slice(-8),
  }));
  if (!acc?.id) { console.log("无法建账户，终止"); return; }

  // ---------- II1 同额两张付款单 ----------
  console.log("\n=== II1 同额多张付款单（触发 candidates>1 守卫） ===");
  {
    const inv1 = rec("应付发票 A (100)", await call("POST", "/api/v1/ap-invoices", {
      supplier_id: SUP.id, invoice_date: TODAY, total_amount: 100,
    }));
    const inv2 = rec("应付发票 B (100)", await call("POST", "/api/v1/ap-invoices", {
      supplier_id: SUP.id, invoice_date: TODAY, total_amount: 100,
    }));
    const mkPay = async (inv, label) => rec(label, await call("POST", "/api/v1/payments", {
      supplier_id: SUP.id, payment_date: TODAY, amount: 100, payment_type: "normal",
      cash_account_id: cash.id, cash_account_code: cash.code, cash_account_name: cash.name,
      lines: [{ ap_invoice_id: inv?.id, amount: 100 }],
    }));
    const p1 = mkPay(inv1, "付款单1(100)");
    const p2 = mkPay(inv2, "付款单2(100)");
    if (p1?.id) rec("确认付款单1", await call("POST", `/api/v1/payments/${p1.id}/confirm`, {}));
    if (p2?.id) rec("确认付款单2", await call("POST", `/api/v1/payments/${p2.id}/confirm`, {}));

    const st1 = rec("建对账单 debit100", await call("POST", "/api/v1/bank/statements", {
      account_id: acc.id, statement_date: TODAY, amount: 100, direction: "debit", remark: "II1-A",
    }));
    rec("II1 对账(整账户)", await call("POST", `/api/v1/bank/reconcile?account_id=${acc.id}`, {}));
    if (st1?.id) {
      const a = await call("GET", `/api/v1/bank/statements/${st1.id}`);
      rec("II1 对账单状态", a, { reconciled: a?.data?.reconciled, matched_ref: a?.data?.matched_ref });
    }
    rec("II1 汇总", await call("GET", `/api/v1/bank/reconcile-summary?account_id=${acc.id}`));
    {
      const sts = (await call("GET", `/api/v1/bank/statements?account_id=${acc.id}`))?.data?.list || [];
      rec("II1 对账后全部流水", undefined, {
        n: sts.length,
        rows: sts.map((x) => ({ amt: x.amount, dir: x.direction, rec: x.reconciled, ref: x.matched_ref })),
      });
      const pays2 = (await call("GET", "/api/v1/payments?page_size=10"))?.data?.list || [];
      rec("II1 付款单状态", undefined, {
        rows: pays2.slice(0, 4).map((x) => ({ amt: x.amount, st: x.status, cur: x.currency_code })),
      });
    }
  }

  // ---------- II2 非 CNY ----------
  console.log("\n=== II2 非 CNY 付款单参与对账 ===");
  {
    const inv = rec("应付发票 C (100)", await call("POST", "/api/v1/ap-invoices", {
      supplier_id: SUP.id, invoice_date: TODAY, total_amount: 100,
    }));
    rec("EUR 付款单(7.8 折算 78)", await call("POST", "/api/v1/payments", {
      supplier_id: SUP.id, payment_date: TODAY, amount: 10, payment_type: "normal",
      currency_code: "EUR", exchange_rate: 7.8,
      cash_account_id: cash.id, cash_account_code: cash.code, cash_account_name: cash.name,
      lines: [{ ap_invoice_id: inv?.id, amount: 10 }],
    }));
    const pays = (await call("GET", "/api/v1/payments?page_size=20"))?.data?.list || [];
    const eur = pays.find((p) => p.currency_code === "EUR");
    if (eur?.id) {
      rec("确认 EUR 付款单", await call("POST", `/api/v1/payments/${eur.id}/confirm`, {}));
      rec("回读 EUR 付款单", await call("GET", `/api/v1/payments/${eur.id}`));
    }
    const st = rec("建对账单 debit78", await call("POST", "/api/v1/bank/statements", {
      account_id: acc.id, statement_date: TODAY, amount: 78, direction: "debit", remark: "II2",
    }));
    rec("II2 对账", await call("POST", `/api/v1/bank/reconcile?account_id=${acc.id}`, {}));
    {
      const sts = (await call("GET", `/api/v1/bank/statements?account_id=${acc.id}`))?.data?.list || [];
      rec("II2 对账后全部流水", undefined, {
        rows: sts.map((x) => ({ amt: x.amount, dir: x.direction, rec: x.reconciled, ref: x.matched_ref })),
      });
      const pays3 = (await call("GET", "/api/v1/payments?page_size=10"))?.data?.list || [];
      rec("II2 付款单状态", undefined, {
        rows: pays3.slice(0, 5).map((x) => ({ amt: x.amount, st: x.status, cur: x.currency_code })),
      });
    }
    if (st?.id) {
      const a = await call("GET", `/api/v1/bank/statements/${st.id}`);
      rec("II2 对账单状态", a, { reconciled: a?.data?.reconciled, matched_ref: a?.data?.matched_ref });
    }
  }

  // ---------- II3/II4 删除 ----------
  console.log("\n=== II3/II4 删除银行记录 ===");
  {
    const D = "00000000-0000-0000-0000-000000000000";
    rec("II3 删不存在账户", await call("DELETE", `/api/v1/bank/accounts/${D}`, undefined));
    rec("II3 删不存在流水", await call("DELETE", `/api/v1/bank/statements/${D}`, undefined));
    const spare = rec("建空账户", await call("POST", "/api/v1/bank/accounts", {
      name: "II 空账户", account_no: "6223" + Date.now().toString().slice(-8),
    }));
    if (spare?.id) rec("II4 删空账户(无流水)", await call("DELETE", `/api/v1/bank/accounts/${spare.id}`, undefined));
    rec("II4 删有流水的账户", await call("DELETE", `/api/v1/bank/accounts/${acc.id}`, undefined));
    const still = await call("GET", `/api/v1/bank/accounts/${acc.id}`);
    rec("II4 回读账户", still, { code: still?.code });
  }

  writeFileSync("evidence/backend-runtime/audit-batch-i2-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次I修正轮：银行对账", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-i2-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });