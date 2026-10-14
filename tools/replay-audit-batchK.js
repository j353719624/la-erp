#!/usr/bin/env node
// 批次 K：凭证与现金流（契约已破解）
//
// **凭证创建契约（2026-10-14 从 evidence/backend-runtime/report-classification-contracts.json
// 与 business-flow-contracts.json 反查得到，此前一直 400 的原因在此）**：
//   每条分录必须同时给 account_id + account_code + account_name，
//   顶层给 type/voucher_date/total_debit/total_credit/entries。
//
// cashflow.go 三处守卫逐一验证：
//   :35 同一凭证两个现金科目（1001 + 1002）
//   :44 现金凭证不是两行
//   :60 对方科目不在 {1122,2202,6001,1601,2001} 白名单（如 6401、6602）
//
// KK1 1001↔6401（白名单外）
// KK2 两个现金科目 1001+1002↔1122
// KK3 四行 1001↔1122+6401↔1405
// KK4 1001↔6602
// KK5 凭证 type 非 general / 带 source / 带 currency
// KK6 凭证动作 approve/post/cancel 全集
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
let TOKEN = "", ACC = {}, ME = null;
async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  try { return { status: r.status, ...(await r.json()) }; } catch { return { status: r.status }; }
}
function rec(step, resp, extra) {
  log.push({ step, code: resp?.code, message: resp?.message ?? "", status: resp?.status, ...(extra ? { detail: extra } : {}) });
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 100)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 260)}` : ""));
  return resp?.data;
}
const NOW = new Date().toISOString();
const CF = "/api/v1/reports/finance/cash-flow?start_date=2026-01-01&end_date=2026-12-31";

// e(code, direction, amount, seq) —— 三字段齐全才是原版认可的形态
const e = (code, direction, amount, seq) => ({
  sequence: seq, account_id: ACC[code].id, account_code: code, account_name: ACC[code].name, direction, amount,
});

async function cashflow(label) {
  const r = await call("GET", CF);
  rec("CF " + label, r, { ok: r?.code === 0, data: JSON.stringify(r?.data?.items ?? r?.data ?? null).slice(0, 240) });
  return r;
}

async function mkVoucher(label, entries, extra = {}) {
  const debit = entries.filter((x) => x.direction === "debit").reduce((a, x) => a + x.amount, 0);
  const credit = entries.filter((x) => x.direction === "credit").reduce((a, x) => a + x.amount, 0);
  const v = rec("建 " + label, await call("POST", "/api/v1/vouchers", {
    type: "general", voucher_date: NOW, total_debit: debit, total_credit: credit, entries, ...extra,
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
  const accs = (await call("GET", "/api/v1/accounts?page_size=200"))?.data?.list || [];
  for (const a of accs) ACC[a.code] = a;
  console.log("前置科目:", ["1001", "1002", "1122", "1405", "1601", "2001", "6001", "6401", "6602"].filter((c) => ACC[c]).join(", "), "\n");

  console.log("=== KK0 基线 ===");
  await cashflow("基线");

  console.log("\n=== KK1 :60 白名单外的对方科目 6401 ===");
  await mkVoucher("KK1 1001↔6401", [e("1001", "debit", 7, 1), e("6401", "credit", 7, 2)]);

  console.log("\n=== KK1b :60 白名单外的对方科目 6602 ===");
  await mkVoucher("KK1b 1001↔6602", [e("1001", "debit", 9, 1), e("6602", "credit", 9, 2)]);

  console.log("\n=== KK2 :35 同一凭证两个现金科目 ===");
  await mkVoucher("KK2 1001+1002↔1122", [
    e("1001", "debit", 3, 1), e("1002", "debit", 4, 2), e("1122", "credit", 7, 3),
  ]);

  console.log("\n=== KK3 :44 现金凭证不是两行（四行） ===");
  await mkVoucher("KK3 四行", [
    e("1001", "debit", 5, 1), e("1122", "credit", 5, 2),
    e("6401", "debit", 5, 3), e("1405", "credit", 5, 4),
  ]);

  console.log("\n=== KK5 凭证 type / source / currency ===");
  {
    const ents = [e("1001", "debit", 1, 1), e("6001", "credit", 1, 2)];
    rec("KK5 type=adjustment", await call("POST", "/api/v1/vouchers", {
      type: "adjustment", voucher_date: NOW, entries: ents,
    }));
    rec("KK5 带 source_id", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: NOW, source_id: "00000000-0000-0000-0000-000000000001", source_type: "x", entries: ents,
    }));
    rec("KK5 带 currency_code", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: NOW, currency_code: "USD", entries: ents,
    }));
    rec("KK5 单行", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: NOW, entries: [e("1001", "debit", 1, 1)],
    }));
    rec("KK5 借贷不平", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: NOW, entries: [e("1001", "debit", 2, 1), e("6001", "credit", 1, 2)],
    }));
    rec("KK5 不带 account_name", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: NOW,
      entries: [{ sequence: 1, account_id: ACC["1001"].id, account_code: "1001", direction: "debit", amount: 1 },
                { sequence: 2, account_id: ACC["6001"].id, account_code: "6001", direction: "credit", amount: 1 }],
    }));
  }

  console.log("\n=== KK6 凭证动作全集 ===");
  {
    const v = await mkVoucher("KK6 生命周期", [e("1001", "debit", 2, 1), e("6001", "credit", 2, 2)], { remark: "KK6" });
    // 新建一张未过账的
    const draft = rec("建草稿凭证", await call("POST", "/api/v1/vouchers", {
      type: "general", voucher_date: NOW, remark: "KK6-draft",
      total_debit: 3, total_credit: 3,
      entries: [e("1001", "debit", 3, 1), e("6001", "credit", 3, 2)],
    }));
    if (draft?.id) {
      const me = await call("GET", "/api/v1/auth/me");
      rec("KK6 approve（无 approver_id）", await call("POST", `/api/v1/vouchers/${draft.id}/approve`, {}));
      rec("KK6 approve（带 approver_id）", await call("POST", `/api/v1/vouchers/${draft.id}/approve?approver_id=${me?.data?.id}`, {}));
      rec("KK6 post", await call("POST", `/api/v1/vouchers/${draft.id}/post`, {}));
      rec("KK6 cancel", await call("POST", `/api/v1/vouchers/${draft.id}/cancel`, {}));
      rec("KK6 DELETE 动作", await call("POST", `/api/v1/vouchers/${draft.id}/delete`, {}));
      rec("KK6 HTTP DELETE", await call("DELETE", `/api/v1/vouchers/${draft.id}`, undefined));
      for (const a of ["confirm", "reverse", "void", "audit"]) {
        rec(`KK6 ${a}`, await call("POST", `/api/v1/vouchers/${draft.id}/${a}`, {}));
      }
    }
    void v;
  }

  console.log("\n=== KK7 凭证守卫文案 ===");
  {
    rec("不存在的凭证 approve", await call("POST", "/api/v1/vouchers/00000000-0000-0000-0000-000000000000/approve?approver_id=x", {}));
    rec("不存在的凭证 post", await call("POST", "/api/v1/vouchers/00000000-0000-0000-0000-000000000000/post", {}));
    rec("不存在的凭证 cancel", await call("POST", "/api/v1/vouchers/00000000-0000-0000-0000-000000000000/cancel", {}));
  }

  writeFileSync("evidence/backend-runtime/audit-batch-k-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次K：凭证与现金流守卫（契约已破解）", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-k-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });