#!/usr/bin/env node
// 批次 PP · 自动过账**凭证形态**的干净取样（2026-10-15）。
//
// 问题：翻历史凭证得到的分录 remark 规律自相矛盾 ——
//   payroll（15 条）：分录1 remark="工资计提"、分录2 remark="应付职工薪酬"（科目名）
//   expense_paid（2 条）：两条 remark 都="费用报销付款"（凭证摘要）
//   sales_return / purchase_inbound：两条都为空
// 历史数据可能来自不同写入路径，不能用来定规则。
//
// 故本脚本**现场产生**各类型凭证各 1 条，只取新增那条来比对，
// 拿到干净样本后再定规则。同时核对三处已知可疑点：
//   ① 凭证头 remark 是否带期间后缀（原版 payroll 是「工资计提 2026-05」）
//   ② 工资批次单号前缀（原版 SAL… vs 恢复端 PAY…）
//   ③ 分录是否携带 remark
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-voucher-shape.js
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

async function seeds(base, tk) {
  const pick = async (p) => ((await call(base, tk, "GET", p)).json?.data?.list ?? [])[0];
  const accounts = (await call(base, tk, "GET", "/api/v1/accounts?page=1&page_size=500")).json?.data?.list ?? [];
  return {
    customer: await pick("/api/v1/customers?page=1&page_size=1"),
    supplier: await pick("/api/v1/suppliers?page=1&page_size=1"),
    product: await pick("/api/v1/products?page=1&page_size=1"),
    warehouse: await pick("/api/v1/warehouses?page=1&page_size=1"),
    employee: await pick("/api/v1/employees?page=1&page_size=1"),
    bank: accounts.find((a) => String(a.code).startsWith("1002")) ?? accounts.find((a) => String(a.code).startsWith("1001")),
    expenseAccount: accounts.find((a) => String(a.code) === "6602") ?? accounts[0],
  };
}
const S = { 原版: await seeds(ORIG, oTk), 恢复端: await seeds(RECOVERED, rTk) };

async function findVoucher(base, tk, sourceId, sourceType, exclude) {
  for (let page = 1; page <= 10; page++) {
    const r = await call(base, tk, "GET", `/api/v1/vouchers?page=${page}&page_size=50`);
    const list = r.json?.data?.list ?? [];
    const hit = list.find((v) => !exclude.has(v.id) &&
      (sourceId ? v.source_id === sourceId : v.source_type === sourceType));
    if (hit) {
      const d = await call(base, tk, "GET", "/api/v1/vouchers/" + hit.id);
      return d.json?.data ?? null;
    }
    if (list.length < 50) break;
  }
  return null;
}
async function knownIds(base, tk) {
  const ids = new Set();
  for (let page = 1; page <= 10; page++) {
    const r = await call(base, tk, "GET", `/api/v1/vouchers?page=${page}&page_size=50`);
    const list = r.json?.data?.list ?? [];
    list.forEach((v) => ids.add(v.id));
    if (list.length < 50) break;
  }
  return ids;
}

// 现场产生各类凭证（每个过账点各一条）
const CASES = [
  {
    key: "payroll", label: "工资计提",
    async run(base, tk, sd, no) {
      const b = await call(base, tk, "POST", "/api/v1/payrolls", {
        period: "2026-05", status: "draft", remark: "形态取样" + no,
      });
      const bid = b.json?.data?.id;
      if (!bid) return { err: `建批次失败 ${b.json?.message ?? ""}`, batchNo: "" };
      await call(base, tk, "POST", "/api/v1/payroll-items", {
        batch_id: bid, employee_id: sd.employee?.id, employee_name: sd.employee?.name ?? "取样员工",
        base_salary: 4000, actual_salary: 4000,
      });
      const c = await call(base, tk, "POST", `/api/v1/payrolls/${bid}/confirm`, {});
      return { sourceId: bid, err: c.json?.code === 0 ? "" : `confirm ${c.json?.message}`, batchNo: b.json?.data?.batch_no ?? "" };
    },
  },
  {
    key: "expense_claim", label: "费用报销审批",
    async run(base, tk, sd, no) {
      const b = await call(base, tk, "POST", "/api/v1/expense-claims", {
        claim_no: "EC" + no, employee_name: sd.employee?.name ?? "取样员工",
        claim_date: "2026-05-10T00:00:00+08:00", amount: 100, total_amount: 100,
        expense_account_code: sd.expenseAccount?.code, remark: "形态取样" + no,
      });
      const id = b.json?.data?.id;
      if (!id) return { err: `建单失败 ${b.json?.message ?? ""}` };
      await call(base, tk, "POST", `/api/v1/expense-claims/${id}/submit`, {});
      const a = await call(base, tk, "POST", `/api/v1/expense-claims/${id}/approve`, {});
      return { sourceId: id, err: a.json?.code === 0 ? "" : `approve ${a.json?.message}` };
    },
  },
  {
    key: "payment_receipt", label: "收款单确认",
    async run(base, tk, sd, no) {
      const b = await call(base, tk, "POST", "/api/v1/payment-receipts", {
        customer_id: sd.customer?.id, receipt_date: "2026-05-20T00:00:00+08:00",
        amount: 500, receipt_type: "银行转账",
        cash_account_id: sd.bank?.id, cash_account_code: sd.bank?.code, remark: "形态取样" + no,
      });
      const id = b.json?.data?.id;
      if (!id) return { err: `建单失败 ${b.json?.message ?? ""}` };
      const a = await call(base, tk, "POST", `/api/v1/payment-receipts/${id}/confirm`, {});
      return { sourceId: id, err: a.json?.code === 0 ? "" : `confirm ${a.json?.message}` };
    },
  },
  {
    key: "purchase_inbound", label: "采购入库确认",
    async run(base, tk, sd, no) {
      const b = await call(base, tk, "POST", "/api/v1/stock-ins", {
        supplier_id: sd.supplier?.id, warehouse_id: sd.warehouse?.id,
        stock_in_date: "2026-05-22T00:00:00+08:00", type: "purchase", remark: "形态取样" + no,
        lines: [{ product_id: sd.product?.id, qty: 2, unit_cost: 10 }],
      });
      const id = b.json?.data?.id;
      if (!id) return { err: `建单失败 ${b.json?.message ?? ""}` };
      const a = await call(base, tk, "POST", `/api/v1/stock-ins/${id}/confirm`, {});
      return { sourceId: id, err: a.json?.code === 0 ? "" : `confirm ${a.json?.message}` };
    },
  },
  {
    key: "sales_return", label: "销售退货红字冲销",
    async run(base, tk, sd, no) {
      const b = await call(base, tk, "POST", "/api/v1/sales-returns", {
        customer_id: sd.customer?.id, warehouse_id: sd.warehouse?.id,
        order_date: "2026-05-24T00:00:00+08:00", total_amount: 200, remark: "形态取样" + no,
        lines: [{ product_id: sd.product?.id, qty: 1, unit_cost: 10, amount: 200 }],
      });
      const id = b.json?.data?.id;
      if (!id) return { err: `建单失败 ${b.json?.message ?? ""}` };
      await call(base, tk, "POST", `/api/v1/sales-returns/${id}/confirm`, {});
      const a = await call(base, tk, "POST", `/api/v1/sales-returns/${id}/approve`, {});
      return { sourceId: id, err: a.json?.code === 0 ? "" : `approve ${a.json?.message}` };
    },
  },
  {
    key: "tax_payment", label: "税金缴纳",
    async run(base, tk, sd, no) {
      const a = await call(base, tk, "POST", "/api/v1/tax-accruals/pay", {
        items: [{ account_code: sd.expenseAccount?.code, amount: 88 }],
        bank_code: sd.bank?.code, pay_date: "2026-05-26T00:00:00+08:00",
        post_voucher: true, remark: "形态取样" + no,
      });
      return { sourceId: "", sourceType: "tax_payment", err: a.json?.code === 0 ? "" : `pay ${a.json?.message}` };
    },
  },
];

let diff = 0;
for (const tc of CASES) {
  say(`\n=== ${tc.label}（${tc.key}）===`);
  const out = {};
  for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]]) {
    const sd = S[tag];
    const no = stamp + (tag === "原版" ? "O" : "R");
    const known = await knownIds(base, tk);
    // 两端用**同一个**取样戳：若带 O/R 后缀，凭证 remark 里就会混入不同字符，
    // 制造假不一致（首版 4 条全因此误报）。
    const r = await tc.run(base, tk, sd, stamp);
    if (r.err) { out[tag] = `<未产生凭证> ${r.err}`; continue; }
    const v = await findVoucher(base, tk, r.sourceId, r.sourceType, known);
    if (!v) { out[tag] = "<未找到新增凭证>"; continue; }
    const es = v.edges?.entries ?? [];
    // 不比 source_no：它是由各自库的行数生成的流水号，两端必然不同。
    const head = `头: type=${v.type} status=${v.status} src=${v.source_type} remark="${v.remark}" D=${v.total_debit} C=${v.total_credit}`;
    const lines = es.map((e) => `分录${e.sequence}: ${e.account_code}/${e.account_name}/${e.direction}/${e.amount}/remark=${JSON.stringify(e.remark)}`).join("\n        ");
    out[tag] = `${head}\n        ${lines}${r.batchNo ? `\n        批次单号=${r.batchNo}` : ""}`;
  }
  const same = out["原版"] === out["恢复端"];
  if (!same) diff++;
  say(`${same ? "  " : "!!"} 原版 : ${out["原版"]}`);
  say(`     恢复端: ${out["恢复端"]}`);
}
say(`\n不一致 = ${diff} / ${CASES.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-voucher-shape-20261015.txt",
  log.join("\n") + "\n",
);
