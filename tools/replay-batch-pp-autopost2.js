#!/usr/bin/env node
// 批次 PP · 业务单据自动过账的端到端对照（第二版，2026-10-15）。
//
// ## 第一版失败原因（留档）
// 想用「极早期日期」让新过账行成为 account_balances 的升序首条，从而被
// GET /accounts/{id}/balance 返回。但原版库里存在 `0001-01-01T00:00:00+08:05`
// 这样的脏数据行，任何真实日期都大不过它 —— 该策略在原版侧失效。
//
// ## 第二版策略：改为对照**过账产物**
// 过账会插入一条 voucher（status=posted，type=general，带 source_type）。
// 故按「动作前后 vouchers 总数增量 + 新增凭证字段」对照，绕开 balance 的可见性限制。
// 恢复端另外用 sqlite 直查 account_balances / journal_entries 验证内部状态确实落库。
//
// ## 前置：恢复端客户数为 0（原版 2 个），需先建客户，否则「往来单位不存在」。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-autopost2.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.OO_RECOVERED ?? "http://127.0.0.1:18886";
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
const rTk = await token(RECOVERED, false);
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
const stamp = Date.now().toString().slice(-6);

async function voucherCount(base, tk) {
  const r = await call(base, tk, "GET", "/api/v1/vouchers?page=1&page_size=1");
  return r.json?.data?.total ?? -1;
}

// ---------- 前置：建客户 ----------
async function ensureCustomer(tag, base, tk) {
  const l = await call(base, tk, "GET", "/api/v1/customers?page=1&page_size=1");
  if ((l.json?.data?.total ?? 0) > 0) return (l.json?.data?.list ?? [])[0];
  const c = await call(base, tk, "POST", "/api/v1/customers", { name: "过账验证客户" + stamp });
  return c.json?.data;
}

// ---------- 场景 A：应收开票 ----------
async function scenarioA(tag, base, tk, code) {
  say(`\n--- A/${tag} ---`);
  const cust = await ensureCustomer(tag, base, tk);
  say(`  客户: ${cust?.name ?? "无"} (${cust?.id ?? "-"})`);
  const before = await voucherCount(base, tk);
  const r = await call(base, tk, "POST", "/api/v1/ar-invoices", {
    invoice_no: "AR" + code,
    customer_id: cust?.id,
    customer_name: cust?.name,
    invoice_date: "2026-06-15T00:00:00+08:00",
    due_date: "2026-07-15T00:00:00+08:00",
    amount: 1234,
    total_amount: 1234,
    tax_amount: 0,
    remark: "自动过账验证" + code,
  });
  say(`  建应收单 http${r.http} code=${r.json?.code} ${r.json?.message ?? ""} id=${r.json?.data?.id ?? "-"}`);
  const after = await voucherCount(base, tk);
  say(`  vouchers 总数 ${before} → ${after}（增量 ${after - before}，过账应 +1）`);
  if (after > before) {
    const v = await call(base, tk, "GET", `/api/v1/vouchers?page=1&page_size=${after}&sort=created_at_desc`);
    const list = v.json?.data?.list ?? [];
    const newest = list[0];
    say(`  最新凭证: no=${newest?.voucher_no} type=${newest?.type} status=${newest?.status} date=${newest?.voucher_date} D=${newest?.total_debit} C=${newest?.total_credit}`);
  }
  return { before, after };
}

// ---------- 场景 B：工资计提 ----------
async function scenarioB(tag, base, tk, code) {
  say(`\n--- B/${tag} ---`);
  const before = await voucherCount(base, tk);
  const batch = await call(base, tk, "POST", "/api/v1/payrolls", {
    period: "2026-05",
    remark: "自动过账验证" + code,
    items: [{ employee_name: "验证员工", base_salary: 8000, bonus: 500, allowance: 300, deduction: 100 }],
  });
  const bid = batch.json?.data?.id;
  say(`  建工资批次 http${batch.http} code=${batch.json?.code} ${batch.json?.message ?? ""} id=${bid ?? "-"} total=${batch.json?.data?.total_amount ?? "-"}`);
  if (!bid) return { before, after: before };
  const cf = await call(base, tk, "POST", `/api/v1/payrolls/${bid}/confirm`, {});
  say(`  confirm http${cf.http} code=${cf.json?.code} ${cf.json?.message ?? ""} status=${cf.json?.data?.status ?? "-"}`);
  const after = await voucherCount(base, tk);
  say(`  vouchers 总数 ${before} → ${after}（增量 ${after - before}，过账应 +1）`);
  return { before, after };
}

// ---------- 场景 C：费用报销审批 ----------
async function scenarioC(tag, base, tk, code) {
  say(`\n--- C/${tag} ---`);
  const before = await voucherCount(base, tk);
  const claim = await call(base, tk, "POST", "/api/v1/expense-claims", {
    employee_name: "验证员工",
    claim_date: "2026-04-10T00:00:00+08:00",
    total_amount: 555,
    remark: "自动过账验证" + code,
    lines: [{ expense_date: "2026-04-10T00:00:00+08:00", category: "差旅费", amount: 555, remark: "明细" }],
  });
  const cid = claim.json?.data?.id;
  say(`  建报销单 http${claim.http} code=${claim.json?.code} ${claim.json?.message ?? ""} id=${cid ?? "-"}`);
  if (!cid) return { before, after: before };
  const ap = await call(base, tk, "POST", `/api/v1/expense-claims/${cid}/approve`, {});
  say(`  approve http${ap.http} code=${ap.json?.code} ${ap.json?.message ?? ""}`);
  const after = await voucherCount(base, tk);
  say(`  vouchers 总数 ${before} → ${after}（增量 ${after - before}，过账应 +1）`);
  return { before, after };
}

say("=== 场景 A：应收开票（借 1122 / 贷 6001）===");
await scenarioA("恢复端", RECOVERED, rTk, "R" + stamp);
await scenarioA("原版", ORIG, oTk, "O" + stamp);

say("\n=== 场景 B：工资计提 confirm（借 6602 / 贷 2211）===");
await scenarioB("恢复端", RECOVERED, rTk, "R" + stamp);
await scenarioB("原版", ORIG, oTk, "O" + stamp);

say("\n=== 场景 C：费用报销审批（借 6602 / 贷 2211）===");
await scenarioC("恢复端", RECOVERED, rTk, "R" + stamp);
await scenarioC("原版", ORIG, oTk, "O" + stamp);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-autopost2-20261015.txt",
  log.join("\n") + "\n",
);
say("\n证据已落盘。");
