#!/usr/bin/env node
// 清单第 2 项：独立汇兑损益
//
// 交接文档第 31 行：发票与结算采用**不同汇率**，直接核对余额和全部凭证明细；
// 验证差额科目、方向、舍入、冲销。已有原汇率冲销不等于汇兑差额。
//
// 恢复端 backend 全库无任何汇兑科目实现（汇兑/6603 零命中），
// payments.go 对非 CNY 已在 2026-10-13 实现外币折算，故本轮测「异汇率」而非「外币能否用」。
//
// 已知原版汇率为小数（7.872 / 7.8），需构造：
//   F1 发票以汇率 A 入账 -> 结算以汇率 B 收款 -> 看是否产生汇兑分录
//   F2 该收款冲销 -> 看汇兑分录是否反向
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
  console.log(`[${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 70)}`);
  return resp?.data;
}

// 抓取与该应收单相关的全部凭证分录明细
async function vouchersFor(sourceNo) {
  const j = await call("GET", "/api/v1/vouchers?page_size=100");
  const list = j?.data?.list || [];
  const hit = list.filter((v) => JSON.stringify(v).includes(sourceNo));
  const out = [];
  for (const v of hit) {
    const d = await call("GET", `/api/v1/vouchers/${v.id}`);
    out.push(d?.data ?? v);
  }
  return { count: hit.length, detail: out };
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  const cust = (await call("GET", "/api/v1/customers?page_size=5"))?.data?.list?.find((c) => c.code === "REC-DEPT-C-1013")
    || (await call("GET", "/api/v1/customers?page_size=5"))?.data?.list?.[0];
  // 银行账户走 cash_account_code（交接文档第21行：仅传ID无编码时原版不生成凭证）
  const acc = (await call("GET", "/api/v1/accounts?page_size=200"))?.data?.list?.find((a) => a.code === "1002");
  console.log("客户:", cust?.code, cust?.name, "| 银行存款:", acc?.code, acc?.name, "\n");

  if (!cust || !acc) { console.log("缺少客户或 1002 科目，终止"); return; }

  // ---------- F0：找一张有余额的应收发票作为核销对象 ----------
  // 原版 ar-invoices 无 currency_code/exchange_rate 字段，是纯本币单据；
  // 金额只体现在 balance 上。优先复用既有 balance>0 的单据，避免猜新建契约。
  console.log("=== F0：选取有余额的应收发票 ===");
  const ars = (await call("GET", "/api/v1/ar-invoices?page_size=50"))?.data || [];
  const target = ars.find((a) => a.status === "unpaid" && Number(a.balance) > 0 && a.customer_name === cust.name)
    || ars.find((a) => Number(a.balance) > 0);
  const arId = target?.id;
  console.log("  目标应收:", target?.invoice_no, "| 余额:", target?.balance, "| 客户:", target?.customer_name, "\n");
  if (!arId) { console.log("  无可用应收单，终止"); return; }

  // ---------- F1：按**不同汇率**（7.5）收款并核销 ----------
  const balance = Number(target.balance);
  const RATE = 7.5;
  const foreignAmt = (balance / RATE).toFixed(4);
  console.log(`=== F1：按汇率 ${RATE} 收款核销 ${balance} CNY（外币 ${foreignAmt} USD）===`);
  const rc = await call("POST", "/api/v1/payment-receipts", {
    customer_id: target.customer_id,
    currency_code: "USD",
    exchange_rate: String(RATE),
    cash_account_code: "1002",
    // 表头 amount 必填（恢复端 payments.go:155 读 input["amount"]），
    // 明细 amount 为外币原币金额（交接文档第21行：原版按汇率折算为本币核销）。
    amount: foreignAmt,
    lines: [{ ar_invoice_id: arId, amount: foreignAmt }],
    remark: "REC-AUDIT5-fx-receipt",
  });
  const rcD = rec("F1-创建USD收款@7.5", "POST", "/payment-receipts", null, rc);
  const rcId = rcD?.id;
  if (!rcId) { console.log("  收款创建失败"); return; }

  const cf = await call("POST", `/api/v1/payment-receipts/${rcId}/confirm`, {});
  rec("F2-confirm确认", "POST", `/payment-receipts/${rcId}/confirm`, {}, cf);

  const arAfter = await call("GET", `/api/v1/ar-invoices/${arId}`);
  console.log("  应收余额:", arAfter?.data?.balance, "| 已收:", arAfter?.data?.received_amount);

  const v = await vouchersFor(rcD?.receipt_no || rcD?.order_no || rcD?.number || "");
  console.log(`  关联凭证 ${v.count} 张：`);
  for (const d of v.detail) {
    console.log(`    ${d.voucher_no} date=${String(d.voucher_date).slice(0,10)} status=${d.status}`);
    for (const e of d.edges?.entries || []) {
      console.log(`       ${e.direction === 'debit' ? '借' : '贷'} ${e.account_code} ${e.account_name ?? ''} ${e.amount} ${e.currency_code ?? 'CNY'} (汇率 ${e.exchange_rate ?? '-'})`);
    }
  }
  // 查找汇兑科目
  const fx = v.detail.flatMap((d) => d.edges?.entries || []).filter((e) => /汇兑|6603|exchange/i.test(`${e.account_code}${e.account_name}`));
  console.log(`\n  >>> 汇兑类分录数量：${fx.length} ${fx.length ? JSON.stringify(fx) : "（未产生独立汇兑损益科目）"}`);

  // ---------- F3：冲销 ----------
  console.log("\n=== F3：冲销该收款 ===");
  const cx = await call("POST", `/api/v1/payment-receipts/${rcId}/cancel`, {});
  rec("F3-cancel冲销", "POST", `/payment-receipts/${rcId}/cancel`, {}, cx);
  const arBack = await call("GET", `/api/v1/ar-invoices/${arId}`);
  console.log("  冲销后应收余额:", arBack?.data?.balance);

  writeFileSync(
    "evidence/backend-runtime/audit-fx-gain-loss-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "清单第2项 独立汇兑损益（发票汇率≠结算汇率）", records: log, vouchers: v.detail }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-fx-gain-loss-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });