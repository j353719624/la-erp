#!/usr/bin/env node
// 批次 G：财务报表与凭证（cashflow 三处守卫 + vouchers + financereports + aging + statements + bank）
//
// cashflow.go 三处 ErrUnsupported 会让**整张现金流量表直接失败**：
//   :35 同一凭证出现两个现金科目（1001 + 1002）
//   :44 现金凭证不是两行
//   :60 对方科目不在 {1122,2202,6001,1601,2001} 白名单
// 原版库中 6401（主营成本）出现 46 次，若按现白名单会整表失败——必须取证。
//
// GG1 现金流量表：对方科目 6401 的凭证如何归类
// GG2 两个现金科目的凭证
// GG3 三行及以上含现金科目的凭证
// GG4 对方科目为完全未映射科目（如 6602）
// GG5 凭证 type 非 general / 带 source
// GG6 凭证动作集合
// GG7 financereports 支持的报表类型
// GG8 aging / statements 路由与日期格式
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
const CF = "/api/v1/reports/finance/cash-flow?start_date=2026-01-01&end_date=2026-12-31";

async function cashflow(label) {
  const r = await call("GET", CF);
  rec("CF " + label, r, { ok: r?.code === 0, items: JSON.stringify(r?.data?.items || r?.data || null).slice(0, 240) });
}

let ACCT = {};
async function loadAccounts() {
  const list = (await call("GET", "/api/v1/accounts?page_size=200"))?.data?.list || [];
  for (const a of list) ACCT[a.code] = a.id;
  console.log("科目:", Object.keys(ACCT).join(","));
}
const e = (code, direction, amount, seq) => ({ sequence: seq, account_id: ACCT[code], direction, amount });

async function mkVoucher(label, entries, extra = {}) {
  const v = rec("建 " + label, await call("POST", "/api/v1/vouchers", {
    type: "general", voucher_date: TODAY, entries, ...extra,
  }));
  if (!v?.id) return null;
  rec("  过账 " + label, await call("POST", `/api/v1/vouchers/${v.id}/post`, {}));
  await cashflow(label);
  return v;
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  await loadAccounts();
  console.log("=== GG1 改前基线 ===");
  await cashflow("基线");

  // GG1 对方科目 6401（主营成本）—— 原版库已有 46 条，确认归到 operating
  await mkVoucher("GG1 1001↔6401", [
    { account_code: "1001", account_name: "库存现金", direction: "debit", amount: 7 },
    { account_code: "6401", account_name: "主营业务成本", direction: "credit", amount: 7 },
  ]);
  // GG2 两个现金科目
  await mkVoucher("GG2 1001+1002↔1122", [
    { account_code: "1001", account_name: "库存现金", direction: "debit", amount: 3 },
    e("1002","debit",4,2),
    e("1122","credit",7,3),
  ]);
  // GG3 三行含现金
  await mkVoucher("GG3 1001↔1122+6401", [
    { account_code: "1001", account_name: "库存现金", direction: "debit", amount: 5 },
    e("1122","credit",5,2),
    e("6401","debit",5,3),
    e("1405","credit",5,4),
  ]);
  // GG4 完全未映射的对方科目
  await mkVoucher("GG4 1001↔6602", [
    { account_code: "1001", account_name: "库存现金", direction: "debit", amount: 9 },
    e("6602","credit",9,2),
  ]);

  // ---------- GG5 凭证 type/source ----------
  console.log("\n=== GG5 凭证 type 与 source ===");
  {
    rec("GG5 type=adjustment", await call("POST", "/api/v1/vouchers", {
      type: "adjustment", voucher_date: TODAY,
      entries: [e("1001","debit",1,1),
                e("6001","credit",1,2)],
    }));
    rec("GG5 带 source_id", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: TODAY, source_id: "00000000-0000-0000-0000-000000000001",
      source_type: "x",
      entries: [e("1001","debit",1,1),
                e("6001","credit",1,2)],
    }));
    rec("GG5 带 currency_code", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: TODAY, currency_code: "USD",
      entries: [e("1001","debit",1,1),
                e("6001","credit",1,2)],
    }));
    rec("GG5 单行", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: TODAY,
      entries: [e("1001","debit",1,1)],
    }));
  }

  // ---------- GG6 凭证动作 ----------
  console.log("\n=== GG6 凭证动作 ===");
  {
    const v = rec("建凭证", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: TODAY,
      entries: [e("1001","debit",2,1),
                e("6001","credit",2,2)],
    }));
    for (const a of ["approve", "post", "cancel", "delete", "confirm", "reverse", "void"]) {
      rec(`GG6 ${a}`, await call("POST", `/api/v1/vouchers/${v?.id}/${a}`, {}));
    }
  }

  // ---------- GG7 报表类型 ----------
  console.log("\n=== GG7 财务报表类型 ===");
  {
    for (const k of ["profit-loss", "balance-sheet", "trial-balance", "cash-flow", "general-ledger", "income", "bogus"]) {
      const q = k === "general-ledger" ? "?account_code=1001&start_date=2026-01-01&end_date=2026-12-31"
        : "?start_date=2026-01-01&end_date=2026-12-31";
      const r = await call("GET", "/api/v1/reports/finance/" + k + q);
      rec("GG7 " + k, r, { ok: r?.code === 0, keys: r?.data ? Object.keys(r.data).slice(0, 6) : null });
    }
  }

  // ---------- GG8 aging / statements 路由 ----------
  console.log("\n=== GG8 账龄与对账单 ===");
  {
    for (const p of ["aging", "ar-aging", "receivable-aging", "customer-aging",
                     "statements", "ar-statements", "customer-statements", "payment-statements"]) {
      const r = await call("GET", "/api/v1/" + p);
      rec("GG8 " + p, r, { ok: r?.code === 0 });
    }
  }

  writeFileSync("evidence/backend-runtime/audit-batch-g-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次G：财务报表/凭证/账龄/对账单", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-g-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });