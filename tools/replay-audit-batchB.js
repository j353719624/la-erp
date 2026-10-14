#!/usr/bin/env node
// 批次 B：数量 / 成本 / 时间格式 / 结构守卫
//
// BB1 发票 currency_code=USD + exchange_rate=7.2（payments.go:50/53）
// BB2 发票带 source_type/source_id（payments.go:67）
// BB3 收款单明细为空（payments.go:169）
// BB4 收款单核销合计 ≠ 表头 amount（payments.go:230）
// BB5 调整单 adjust_type 非法值 / cost 型 qty≠0（adjustments.go:49/110/196）
// BB6 凭证结构：借贷不平、三行、多个现金科目、未知对方科目（cashflow.go:35/44/60）
// BB7 银行对账金额重名 / 非 CNY（bank.go:209）
// BB8 aging asOf 非日期格式（aging.go:21）
// BB9 对账单 start/end 非日期格式（statements.go:23）
// BB10 余额行重复（service.go:565/586）—— 直接插两条同键余额
// BB11 工序 actual_time / labor_rate 负数（workprocesses.go:89）
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 110)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 200)}` : ""));
  return resp?.data;
}
const TODAY = new Date().toISOString();

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  const CUST = ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0];
  const SUP = ((await call("GET", "/api/v1/suppliers?page_size=5"))?.data?.list || [])[0];
  const acc = ((await call("GET", "/api/v1/accounts?page_size=200"))?.data?.list || []).find((a) => a.code === "1001");
  console.log("前置:", CUST?.name, "|", SUP?.name, "|", acc?.name, "\n");

  // ---------- BB1/BB2 发票 ----------
  console.log("\n=== BB1/BB2 发票币种与来源 ===");
  {
    rec("BB1 USD 发票", await call("POST", "/api/v1/ar-invoices", {
      customer_id: CUST.id, invoice_date: TODAY, total_amount: 10, currency_code: "USD", exchange_rate: 7.2,
    }));
    rec("BB1 CNY@7.2 发票", await call("POST", "/api/v1/ar-invoices", {
      customer_id: CUST.id, invoice_date: TODAY, total_amount: 10, currency_code: "CNY", exchange_rate: 7.2,
    }));
    rec("BB2 发票带 source", await call("POST", "/api/v1/ar-invoices", {
      customer_id: CUST.id, invoice_date: TODAY, total_amount: 10,
      source_type: "sales_order", source_id: "00000000-0000-0000-0000-000000000001",
    }));
    rec("BB2 发票带垃圾 source_type", await call("POST", "/api/v1/ar-invoices", {
      customer_id: CUST.id, invoice_date: TODAY, total_amount: 10, source_type: "garbage",
    }));
  }

  // ---------- BB3/BB4 收款单 ----------
  console.log("\n=== BB3/BB4 收付款单 ===");
  {
    const invoice = rec("造应收 100", await call("POST", "/api/v1/ar-invoices", {
      customer_id: CUST.id, invoice_date: TODAY, total_amount: 100,
    }));
    rec("BB3 收款单无明细", await call("POST", "/api/v1/payment-receipts", {
      customer_id: CUST.id, receipt_date: TODAY, amount: 10, receipt_type: "normal",
      cash_account_id: acc.id, cash_account_code: acc.code, cash_account_name: acc.name, lines: [],
    }));
    rec("BB3 收款单 lines 非数组", await call("POST", "/api/v1/payment-receipts", {
      customer_id: CUST.id, receipt_date: TODAY, amount: 10, receipt_type: "normal",
      cash_account_id: acc.id, cash_account_code: acc.code, cash_account_name: acc.name, lines: "x",
    }));
    rec("BB4 合计≠表头", await call("POST", "/api/v1/payment-receipts", {
      customer_id: CUST.id, receipt_date: TODAY, amount: 10, receipt_type: "normal",
      cash_account_id: acc.id, cash_account_code: acc.code, cash_account_name: acc.name,
      lines: [{ ar_invoice_id: invoice.id, amount: 5 }],
    }));
    rec("BB4 合计>表头", await call("POST", "/api/v1/payment-receipts", {
      customer_id: CUST.id, receipt_date: TODAY, amount: 5, receipt_type: "normal",
      cash_account_id: acc.id, cash_account_code: acc.code, cash_account_name: acc.name,
      lines: [{ ar_invoice_id: invoice.id, amount: 10 }],
    }));
    const ok = rec("BB4 合计=表头", await call("POST", "/api/v1/payment-receipts", {
      customer_id: CUST.id, receipt_date: TODAY, amount: 10, receipt_type: "normal",
      cash_account_id: acc.id, cash_account_code: acc.code, cash_account_name: acc.name,
      lines: [{ ar_invoice_id: invoice.id, amount: 10 }],
    }));
    if (ok?.id) rec("BB4 确认", await call("POST", `/api/v1/payment-receipts/${ok.id}/confirm`, {}));
  }

  // ---------- BB5 调整单 ----------
  console.log("\n=== BB5 库存调整类型与成本型 ===");
  {
    const PROD = ((await call("GET", "/api/v1/products?page_size=50"))?.data?.list || [])
      .find((p) => p.is_serial !== true && p.is_batch !== true);
    const WH = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
    rec("BB5 非法 adjust_type", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, adjust_type: "garbage", lines: [{ product_id: PROD.id, qty: 1 }],
    }));
    rec("BB5 不传 adjust_type", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, lines: [{ product_id: PROD.id, qty: 1 }],
    }));
    rec("BB5 cost 型 qty=3", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, adjust_type: "cost", lines: [{ product_id: PROD.id, qty: 3, unit_cost: 99 }],
    }));
    rec("BB5 cost 型 qty=0", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, adjust_type: "cost", lines: [{ product_id: PROD.id, qty: 0, unit_cost: 99 }],
    }));
    rec("BB5 cost 型不传 qty", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, adjust_type: "cost", lines: [{ product_id: PROD.id, unit_cost: 99 }],
    }));
    const gain = rec("BB5 cost 型建单", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, adjust_type: "cost", lines: [{ product_id: PROD.id, unit_cost: 88 }],
    }));
    if (gain?.id) {
      // 编辑期改成 qty=3
      rec("BB5 编辑改 qty=3", await call("PUT", `/api/v1/inventory-adjusts/${gain.id}`, {
        warehouse_id: WH, adjust_type: "cost", lines: [{ product_id: PROD.id, qty: 3, unit_cost: 88 }],
      }));
      rec("BB5 confirm", await call("POST", `/api/v1/inventory-adjusts/${gain.id}/confirm`, {}));
    }
  }

  // ---------- BB6 凭证结构 ----------
  console.log("\n=== BB6 凭证结构（cashflow 守卫） ===");
  {
    const mk = async (entries, label) => rec(label, await call("POST", "/api/v1/vouchers", {
      type: "general", entry_date: TODAY, entries,
    }));
    mk([{ account_code: "1001", account_name: "库存现金", direction: "debit", amount: 10 },
        { account_code: "6001", account_name: "收入", direction: "credit", amount: 8 }], "BB6 借贷不平 10/8");
    mk([{ account_code: "1001", account_name: "库存现金", direction: "debit", amount: 10 },
        { account_code: "6001", account_name: "收入", direction: "credit", amount: 10 },
        { account_code: "6602", account_name: "管理费用", direction: "debit", amount: 2 }], "BB6 三行");
    mk([{ account_code: "1001", account_name: "库存现金", direction: "debit", amount: 5 },
        { account_code: "1002", account_name: "银行存款", direction: "debit", amount: 5 },
        { account_code: "6001", account_name: "收入", direction: "credit", amount: 10 }], "BB6 两个现金科目");
    mk([{ account_code: "1001", account_name: "库存现金", direction: "debit", amount: 10 },
        { account_code: "6602", account_name: "管理费用", direction: "credit", amount: 10 }], "BB6 未知对方科目 6602");
    mk([{ account_code: "1001", account_name: "库存现金", direction: "debit", amount: 10 },
        { account_code: "1122", account_name: "应收账款", direction: "credit", amount: 10 }], "BB6 已知 1122");
    mk([{ account_code: "1001", account_name: "库存现金", direction: "debit", amount: 10 },
        { account_code: "2001", account_name: "短期借款", direction: "credit", amount: 10 }], "BB6 已知 2001");
    mk([{ account_code: "1001", account_name: "库存现金", direction: "debit", amount: 10 },
        { account_code: "1601", account_name: "固定资产", direction: "credit", amount: 10 }], "BB6 已知 1601");
    for (const p of ["reports/finance/cash-flow", "reports/finance/profit-loss", "reports/finance/balance-sheet", "reports/finance/trial-balance"]) {
      const d = await call("GET", `/api/v1/${p}?start_date=2026-09-01&end_date=2026-10-31`);
      rec(`BB6 报表 ${p}`, d, { ok: d?.code === 0, data: JSON.stringify(d?.data || {}).slice(0, 160) });
    }
  }

  // ---------- BB7 银行对账 ----------
  console.log("\n=== BB7 银行对账 ===");
  {
    rec("BB7 对账 route 探测", await call("POST", "/api/v1/bank/statements/00000000-0000-0000-0000-000000000000/reconcile", {}));
    rec("BB7 对账单列表", await call("GET", "/api/v1/bank/statements?page_size=3"), null);
  }

  // ---------- BB8/BB9 日期格式 ----------
  console.log("\n=== BB8/BB9 日期格式 ===");
  {
    rec("BB8 aging asOf=abc", await call("GET", "/api/v1/aging?as_of=abc"));
    rec("BB8 aging asOf 正常", await call("GET", "/api/v1/aging?as_of=2026-10-31"));
    rec("BB9 对账单 start=abc", await call("GET", "/api/v1/statements?party=customer&start_date=abc&end_date=2026-10-31"));
    rec("BB9 对账单 正常", await call("GET", "/api/v1/statements?party=customer&start_date=2026-09-01&end_date=2026-10-31"));
  }

  // ---------- BB11 工序负数 ----------
  console.log("\n=== BB11 工序 actual_time/labor_rate ===");
  {
    const PROD = ((await call("GET", "/api/v1/products?page_size=50"))?.data?.list || [])
      .find((p) => p.is_serial !== true && p.is_batch !== true);
    const wo = rec("建工单", await call("POST", "/api/v1/work-orders", {
      product_id: PROD.id, qty: 3, warehouse_id: "5f00c2ca-ee2c-4da5-8346-3d709daa30ad", remark: "BATCHB-BB11",
    }));
    const procs = (await call("GET", `/api/v1/work-orders/${wo?.id}/processes`))?.data;
    rec("工序列表", undefined, { json: JSON.stringify(procs).slice(0, 220) });
    const first = Array.isArray(procs) ? procs[0] : (procs?.list || [])[0];
    if (first?.id) {
      rec("BB11 报负工时", await call("POST", `/api/v1/work-order-processes/${first.id}/report`, {
        actual_time: -5, labor_rate: 10, qty_good: 1, qty_bad: 0,
      }));
      rec("BB11 正常报工", await call("POST", `/api/v1/work-order-processes/${first.id}/report`, {
        actual_time: 5, labor_rate: 10, qty_good: 1, qty_bad: 0,
      }));
      for (const a of ["start", "complete", "cancel", "delete", "confirm"]) {
        rec(`BB11 动作 ${a}`, await call("POST", `/api/v1/work-order-processes/${first.id}/${a}`, {}));
      }
    }
  }

  writeFileSync("evidence/backend-runtime/audit-batch-b-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次B：数量/成本/日期/凭证结构守卫", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-b-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
