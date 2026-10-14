#!/usr/bin/env node
// 批次 B 补充取证：BB1/BB2/BB3/BB4/BB5 原版接受后「到底落库了什么」
// 批次 B 首轮发现恢复端 5 处守卫疑似误拒（发票币种/来源、收款单明细、核销合计、adjust_type、cost 型 qty），
// 但必须确认原版是「落库并生效」还是「静默忽略」，否则不能贸然移除守卫。
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 90)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 260)}` : ""));
  return resp?.data;
}
const TODAY = new Date().toISOString();
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  const CUST = ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0];
  const acc = ((await call("GET", "/api/v1/accounts?page_size=200"))?.data?.list || []).find((a) => a.code === "1001");

  // ---------- BB1b 发票币种落库核对 ----------
  console.log("\n=== BB1b 发票币种/汇率是否落库 ===");
  {
    const inv = rec("USD 发票", await call("POST", "/api/v1/ar-invoices", {
      customer_id: CUST.id, invoice_date: TODAY, total_amount: 100,
      currency_code: "USD", exchange_rate: 7.2,
    }));
    const got = await call("GET", `/api/v1/ar-invoices/${inv?.id}`);
    rec("回读发票", got, pick(got?.data || {}, [
      "invoice_no", "total_amount", "received_amount", "balance", "status",
      "currency_code", "exchange_rate", "source_id", "source_type", "source_no",
    ]));
    // 用它核销，看是否按汇率折算
    const pay = rec("核销 10（USD 发票）", await call("POST", "/api/v1/payment-receipts", {
      customer_id: CUST.id, receipt_date: TODAY, amount: 10,
      receipt_type: "normal", currency_code: "USD", exchange_rate: 7.2,
      cash_account_id: acc.id, cash_account_code: acc.code, cash_account_name: acc.name,
      lines: [{ ar_invoice_id: inv.id, amount: 10 }],
    }));
    rec("确认收款单", await call("POST", `/api/v1/payment-receipts/${pay?.id}/confirm`, {}));
    const after = await call("GET", `/api/v1/ar-invoices/${inv?.id}`);
    rec("核销后发票", after, pick(after?.data || {}, ["total_amount", "received_amount", "balance", "status"]));
  }

  // ---------- BB2b 发票 source 落库核对 ----------
  console.log("\n=== BB2b 发票 source 字段落库 ===");
  {
    const so = rec("造销售订单", await call("POST", "/api/v1/sales-orders", {
      customer_id: CUST.id, warehouse_id: "5f00c2ca-ee2c-4da5-8346-3d709daa30ad",
      lines: [{ product_id: ((await call("GET", "/api/v1/products?page_size=50"))?.data?.list || [])[0].id, qty: 1, price: 50 }],
    }));
    const inv = rec("带 source 的发票", await call("POST", "/api/v1/ar-invoices", {
      customer_id: CUST.id, invoice_date: TODAY, total_amount: 50,
      source_type: "sales_order", source_id: so?.id, source_no: so?.order_no,
    }));
    const got = await call("GET", `/api/v1/ar-invoices/${inv?.id}`);
    rec("回读发票", got, pick(got?.data || {}, ["source_id", "source_type", "source_no", "total_amount", "status"]));
    const list = await call("GET", "/api/v1/ar-invoices?source_type=sales_order&page_size=5");
    rec("按 source_type 过滤", list, { total: list?.data?.total ?? list?.data?.length });
  }

  // ---------- BB3b/BB4b 收款单明细与合计 ----------
  console.log("\n=== BB3b/BB4b 收款单明细与合计落库 ===");
  {
    const inv = rec("造应收 100", await call("POST", "/api/v1/ar-invoices", {
      customer_id: CUST.id, invoice_date: TODAY, total_amount: 100,
    }));
    const empty = rec("无明细收款单", await call("POST", "/api/v1/payment-receipts", {
      customer_id: CUST.id, receipt_date: TODAY, amount: 10, receipt_type: "normal",
      cash_account_id: acc.id, cash_account_code: acc.code, cash_account_name: acc.name, lines: [],
    }));
    const gotEmpty = await call("GET", `/api/v1/payment-receipts/${empty?.id}`);
    rec("回读无明细单", gotEmpty, {
      amount: gotEmpty?.data?.amount, status: gotEmpty?.data?.status,
      lines: JSON.stringify(gotEmpty?.data?.edges?.lines ?? gotEmpty?.data?.lines ?? null),
    });
    rec("确认无明细单", await call("POST", `/api/v1/payment-receipts/${empty?.id}/confirm`, {}));

    const mismatch = rec("合计 5 / 表头 10", await call("POST", "/api/v1/payment-receipts", {
      customer_id: CUST.id, receipt_date: TODAY, amount: 10, receipt_type: "normal",
      cash_account_id: acc.id, cash_account_code: acc.code, cash_account_name: acc.name,
      lines: [{ ar_invoice_id: inv.id, amount: 5 }],
    }));
    const gotMis = await call("GET", `/api/v1/payment-receipts/${mismatch?.id}`);
    rec("回读合计不符单", gotMis, {
      amount: gotMis?.data?.amount,
      lines: JSON.stringify((gotMis?.data?.edges?.lines || []).map((l) => l.amount)),
    });
    rec("确认合计不符单", await call("POST", `/api/v1/payment-receipts/${mismatch?.id}/confirm`, {}));
    const invAfter = await call("GET", `/api/v1/ar-invoices/${inv?.id}`);
    rec("发票核销结果", invAfter, pick(invAfter?.data || {}, ["total_amount", "received_amount", "balance", "status"]));
  }

  // ---------- BB5b 调整单落库核对 ----------
  console.log("\n=== BB5b 调整单 adjust_type / cost 型落库 ===");
  {
    const PROD = ((await call("GET", "/api/v1/products?page_size=50"))?.data?.list || [])
      .find((p) => p.is_serial !== true && p.is_batch !== true);
    const WH = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
    const bad = rec("adjust_type=garbage", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, adjust_type: "garbage", lines: [{ product_id: PROD.id, qty: 1 }],
    }));
    rec("回读 garbage 单", undefined, { adjust_type: bad?.adjust_type, status: bad?.status, total_qty: bad?.total_qty });
    rec("garbage 单 confirm", await call("POST", `/api/v1/inventory-adjusts/${bad?.id}/confirm`, {}));

    const noType = rec("不传 adjust_type", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, lines: [{ product_id: PROD.id, qty: 1 }],
    }));
    rec("回读无类型单", undefined, { adjust_type: noType?.adjust_type, status: noType?.status });
    rec("无类型单 confirm", await call("POST", `/api/v1/inventory-adjusts/${noType?.id}/confirm`, {}));

    const balBefore = await call("GET", `/api/v1/inventory-balances?product_id=${PROD.id}&warehouse_id=${WH}&page_size=5`);
    rec("调整前余额", undefined, { list: JSON.stringify(balBefore?.data?.list || balBefore?.data).slice(0, 200) });
    const costQty = rec("cost 型 qty=3", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WH, adjust_type: "cost", lines: [{ product_id: PROD.id, qty: 3, unit_cost: 77 }],
    }));
    rec("回读 cost 型", undefined, { adjust_type: costQty?.adjust_type, total_qty: costQty?.total_qty });
    rec("cost 型 confirm", await call("POST", `/api/v1/inventory-adjusts/${costQty?.id}/confirm`, {}));
    const balAfter = await call("GET", `/api/v1/inventory-balances?product_id=${PROD.id}&warehouse_id=${WH}&page_size=5`);
    rec("调整后余额", undefined, { list: JSON.stringify(balAfter?.data?.list || balAfter?.data).slice(0, 200) });
  }

  writeFileSync("evidence/backend-runtime/audit-batch-b2-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次B补证：原版接受后到底落库什么", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-b2-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
