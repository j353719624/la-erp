#!/usr/bin/env node
// 批次 PP · 业务单据**自动过账**的端到端对照（2026-10-15）。
//
// ## 目的
// 此前只验证过「期初余额写入 / 手工凭证过账」两条链路。业务单据（应收开票、
// 费用报销、工资计提…）是否真正驱动 account_balances 尚未端到端验证过。
//
// ## 自动过账点（backend/internal/business 全量 grep）
//   expense_claims.go:71  费用报销审批    借 6602 / 贷 2211
//   expense_claims.go:88  费用报销付款    借 2211 / 贷 1001|cash
//   payments.go:102       应收开票确认收入 借 1122 / 贷 6001
//   payments.go:354       收付款单（动态科目）
//   service.go:1019       出入库确认       销售 6401/1405，采购 1403/2202
//   returns.go:126        退货红字冲销
//   tax_payment.go:49     税金缴纳（需 post_voucher=true）
//   payroll_confirm.go:36 工资计提         借 6602 / 贷 2211
//
// ## 关键设计：如何绕开「balance 按 period 升序取首条」
// GET /accounts/{id}/balance 只返回最早期间那行（43 节定案），
// 所以新过账若落在既有期间之后是**看不到**的。
// 故每个场景用互不相同的**极早期**日期（2000-01 / 2000-02 / 2000-03），
// 使新写入的行成为新的升序首条，balance 才会返回它。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-autopost.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const ACTUAL = process.env.OO_ACTUAL ?? "http://127.0.0.1:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

async function token(base, withCompany) {
  const payload = { username: "admin", password: PASS };
  if (withCompany) payload.company = "default";
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  return (await r.json())?.data?.access_token ?? "";
}
const oTk = await token(ORIG, true);
const rTk = await token(ACTUAL, false);
if (!oTk || !rTk) { console.error("登录失败"); process.exit(1); }

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json };
}

const log = [];
const say = (s) => { log.push(s); console.log(s); };

// ---------- ① 科目探测（只读） ----------
const NEEDED = ["1122", "6001", "6602", "2211", "1001"];
async function probeAccounts(tag, base, tk) {
  const r = await call(base, tk, "GET", "/api/v1/accounts?page=1&page_size=500");
  const list = r.json?.data?.list ?? r.json?.data ?? [];
  const found = {};
  for (const a of list) if (NEEDED.includes(String(a.code))) found[String(a.code)] = a;
  say(`[${tag}] 科目总数=${list.length}，自动过账所需科目：`);
  for (const code of NEEDED) {
    say(`   ${code}: ${found[code] ? `${found[code].name} (${found[code].id})` : "**缺失**"}`);
  }
  return { list, found };
}
const O = await probeAccounts("原版", ORIG, oTk);
const R = await probeAccounts("恢复端", ACTUAL, rTk);

// ---------- ② 各科目当前 balance（过账前基线，只读） ----------
say("\n=== 过账前基线（balance 升序首条）===");
async function baseline(tag, base, tk, found) {
  const out = {};
  for (const code of NEEDED) {
    const a = found[code];
    if (!a) { out[code] = "科目缺失"; continue; }
    const b = await call(base, tk, "GET", `/api/v1/accounts/${a.id}/balance`);
    const d = b.json?.data;
    out[code] = d ? `${d.period} begin=${d.begin_balance} D=${d.debit_amount} C=${d.credit_amount} end=${d.end_balance}` : "null";
  }
  say(`[${tag}]`);
  for (const code of NEEDED) say(`   ${code}: ${out[code]}`);
  return out;
}
await baseline("原版", ORIG, oTk, O.found);
await baseline("恢复端", ACTUAL, rTk, R.found);

// ---------- ③ 场景 A：应收开票（建单即过账 借1122/贷6001） ----------
say("\n=== 场景 A：POST /ar-invoices（应收开票确认收入）===");
say("   期望：1122 借方累加，6001 贷方累加，期间 = invoice_date 当月 1 日");
const stamp = Date.now().toString().slice(-6);
async function arInvoice(tag, base, tk, found, no) {
  say(`\n--- ${tag} ---`);
  const customer = await (async () => {
    const r = await call(base, tk, "GET", "/api/v1/customers?page=1&page_size=5");
    const l = r.json?.data?.list ?? r.json?.data ?? [];
    return l[0];
  })();
  const payload = {
    invoice_no: "AR" + no,
    customer_id: customer?.id,
    customer_name: customer?.name ?? "测试客户",
    invoice_date: "2000-01-15T00:00:00+08:00",
    due_date: "2000-02-15T00:00:00+08:00",
    amount: 1234,
    total_amount: 1234,
    tax_amount: 0,
    remark: "自动过账验证" + no,
  };
  const r = await call(base, tk, "POST", "/api/v1/ar-invoices", payload);
  say(`  建单 http${r.http} code=${r.json?.code} ${r.json?.message ?? ""} id=${r.json?.data?.id}`);
  if (r.json?.data?.id) {
    for (const code of ["1122", "6001"]) {
      const a = found[code];
      if (!a) continue;
      const b = await call(base, tk, "GET", `/api/v1/accounts/${a.id}/balance`);
      const d = b.json?.data;
      say(`  ${code} balance: ${d ? `${d.period} begin=${d.begin_balance} D=${d.debit_amount} C=${d.credit_amount} end=${d.end_balance}` : "null"}`);
    }
  }
  return r;
}
await arInvoice("恢复端", ACTUAL, rTk, R.found, "R" + stamp);
await arInvoice("原版", ORIG, oTk, O.found, "O" + stamp);

// ---------- ④ 场景 B：工资计提（借6602/贷2211） ----------
say("\n=== 场景 B：工资批次 confirm（工资计提）===");
say("   期望：6602 借方累加，2211 贷方累加，期间 = period 当月");
async function payroll(tag, base, tk, found, no) {
  say(`\n--- ${tag} ---`);
  const emp = await (async () => {
    const r = await call(base, tk, "GET", "/api/v1/employees?page=1&page_size=5");
    const l = r.json?.data?.list ?? r.json?.data ?? [];
    return l[0];
  })();
  const batch = await call(base, tk, "POST", "/api/v1/payrolls", {
    batch_no: "PR" + no,
    period: "2000-03",
    status: "draft",
    remark: "自动过账验证" + no,
  });
  const bid = batch.json?.data?.id;
  say(`  建批次 http${batch.http} code=${batch.json?.code} ${batch.json?.message ?? ""} id=${bid}`);
  if (!bid) return;
  const item = await call(base, tk, "POST", "/api/v1/payroll-items", {
    batch_id: bid,
    employee_id: emp?.id,
    employee_name: emp?.name ?? "测试员工",
    net_pay: 888,
    remark: "自动过账验证" + no,
  });
  say(`  建明细 http${item.http} code=${item.json?.code} ${item.json?.message ?? ""} id=${item.json?.data?.id}`);
  const cf = await call(base, tk, "POST", `/api/v1/payrolls/${bid}/confirm`, {});
  say(`  confirm http${cf.http} code=${cf.json?.code} ${cf.json?.message ?? ""}`);
  for (const code of ["6602", "2211"]) {
    const a = found[code];
    if (!a) continue;
    const b = await call(base, tk, "GET", `/api/v1/accounts/${a.id}/balance`);
    const d = b.json?.data;
    say(`  ${code} balance: ${d ? `${d.period} begin=${d.begin_balance} D=${d.debit_amount} C=${d.credit_amount} end=${d.end_balance}` : "null"}`);
  }
}
await payroll("恢复端", ACTUAL, rTk, R.found, "R" + stamp);
await payroll("原版", ORIG, oTk, O.found, "O" + stamp);

// ---------- ⑤ 场景 C：费用报销审批（借6602/贷2211） ----------
say("\n=== 场景 C：费用报销审批（借 6602 / 贷 2211）===");
async function expense(tag, base, tk, found, no) {
  say(`\n--- ${tag} ---`);
  const claim = await call(base, tk, "POST", "/api/v1/expense-claims", {
    claim_no: "EC" + no,
    employee_name: "验证员工",
    claim_date: "2000-04-10T00:00:00+08:00",
    total_amount: 555,
    status: "draft",
    remark: "自动过账验证" + no,
  });
  const cid = claim.json?.data?.id;
  say(`  建报销单 http${claim.http} code=${claim.json?.code} ${claim.json?.message ?? ""} id=${cid}`);
  if (!cid) return;
  const ap = await call(base, tk, "POST", `/api/v1/expense-claims/${cid}/approve`, {});
  say(`  approve http${ap.http} code=${ap.json?.code} ${ap.json?.message ?? ""}`);
  for (const code of ["6602", "2211"]) {
    const a = found[code];
    if (!a) continue;
    const b = await call(base, tk, "GET", `/api/v1/accounts/${a.id}/balance`);
    const d = b.json?.data;
    say(`  ${code} balance: ${d ? `${d.period} begin=${d.begin_balance} D=${d.debit_amount} C=${d.credit_amount} end=${d.end_balance}` : "null"}`);
  }
}
await expense("恢复端", ACTUAL, rTk, R.found, "R" + stamp);
await expense("原版", ORIG, oTk, O.found, "O" + stamp);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-autopost-20261015.txt",
  log.join("\n") + "\n",
);
say("\n证据已落盘。");
