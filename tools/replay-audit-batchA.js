#!/usr/bin/env node
// 批次 A：default 型动作白名单 —— 逐动作回放
// 覆盖 assemblies / reworks / transfers / checks / adjustments / attendance /
// expense-claims / work-processes / toolings / vouchers / production-masters /
// bank / finance-reports / subcontracts
//
// 目标：确认每个单据在原版支持哪些动作、各动作的文案与状态迁移；
//       恢复端 switch 的 default 分支本身是否可达。
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
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
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 100)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 160)}` : ""));
  return resp?.data;
}
async function findPlainProduct() {
  const list = (await call("GET", "/api/v1/products?page_size=200"))?.data?.list || [];
  for (const p of list) {
    if (p.is_serial !== true && p.is_batch !== true && p.is_combo !== true) return p;
  }
  throw new Error("没有普通商品");
}
function act(routes, id, action, label) {
  return async () => {
    for (const route of routes) {
      await call("POST", `/api/v1/${route}/${id}/${action}`, {});
    }
    rec(`${label} :: ${action}`, await call("POST", `/api/v1/${routes[0]}/${id}/${action}`, {}));
  };
}

let PROD;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  PROD = await findPlainProduct();
  const CUST = ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0];
  const EMP = ((await call("GET", "/api/v1/employees?page_size=5"))?.data?.list || [])[0];
  console.log("前置:", PROD.name, "|", CUST?.name, "|", EMP?.name || "(无员工)", "\n");

  const si = await call("POST", "/api/v1/stock-ins", {
    warehouse_id: WAREHOUSE, type: "purchase",
    lines: [{ product_id: PROD.id, qty: 900, unit_cost: 50 }], remark: "BATCHA-STOCK",
  });
  if (si?.data?.id) rec("备货", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));

  // ---------- A1 装配单动作 ----------
  console.log("\n=== A1 装配单 actions.go:34 ===");
  {
    const asm = rec("建装配单", await call("POST", "/api/v1/assemblies", {
      warehouse_id: WAREHOUSE, product_id: PROD.id, qty: 2, remark: "BATCHA-A1",
    }));
    if (asm?.id) {
      for (const a of ["confirm", "start", "complete", "cancel", "delete", "close", "ship"]) {
        rec(`A1 ${a}`, await call("POST", `/api/v1/assemblies/${asm.id}/${a}`, {}), null);
      }
      rec("A1 终态", await call("GET", `/api/v1/assemblies/${asm.id}`), undefined);
    }
  }

  // ---------- A2 返工单动作 ----------
  console.log("\n=== A2 返工单 reworks.go:153 ===");
  {
    const wo = rec("建工单", await call("POST", "/api/v1/work-orders", {
      product_id: PROD.id, qty: 5, warehouse_id: WAREHOUSE, remark: "BATCHA-A2",
    }));
    const rw = rec("建返工单", await call("POST", "/api/v1/rework-orders", {
      work_order_id: wo?.id, qty: 1, reason: "BATCHA", remark: "BATCHA-A2",
    }));
    if (rw?.id) {
      for (const a of ["confirm", "start", "complete", "cancel", "delete", "issue", "receive"]) {
        rec(`A2 ${a}`, await call("POST", `/api/v1/rework-orders/${rw.id}/${a}`, {}));
      }
    }
  }

  // ---------- A3 调拨单动作 ----------
  console.log("\n=== A3 调拨单 transfers.go:208 ===");
  {
    const target = rec("建目标仓", await call("POST", "/api/v1/warehouses", { code: "BATCHA-WH", name: "BATCHA-WH" }));
    const tr = rec("建调拨单", await call("POST", "/api/v1/stock-transfers", {
      from_warehouse_id: WAREHOUSE, to_warehouse_id: target?.id,
      lines: [{ product_id: PROD.id, qty: 2 }], remark: "BATCHA-A3",
    }));
    if (tr?.id) {
      for (const a of ["dispatch", "complete", "cancel", "delete", "confirm", "arrive", "receive"]) {
        rec(`A3 ${a}`, await call("POST", `/api/v1/stock-transfers/${tr.id}/${a}`, {}));
      }
    }
  }

  // ---------- A4 盘点单动作 ----------
  console.log("\n=== A4 盘点单 checks.go:286 ===");
  {
    const chk = rec("建盘点单", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WAREHOUSE, lines: [{ product_id: PROD.id }], remark: "BATCHA-A4",
    }));
    if (chk?.id) {
      for (const a of ["start", "complete", "cancel", "delete", "confirm", "approve"]) {
        rec(`A4 ${a}`, await call("POST", `/api/v1/inventory-checks/${chk.id}/${a}`, {}));
      }
    }
  }

  // ---------- A5 调整单动作 ----------
  console.log("\n=== A5 库存调整 adjustments.go:181 ===");
  {
    const adj = rec("建调整单", await call("POST", "/api/v1/inventory-adjusts", {
      warehouse_id: WAREHOUSE, adjust_type: "increase",
      lines: [{ product_id: PROD.id, qty: 1 }], remark: "BATCHA-A5",
    }));
    if (adj?.id) {
      for (const a of ["confirm", "cancel", "delete", "post", "approve", "reverse"]) {
        rec(`A5 ${a}`, await call("POST", `/api/v1/inventory-adjusts/${adj.id}/${a}`, {}));
      }
    }
  }

  // ---------- A6 考勤申请动作 ----------
  console.log("\n=== A6 考勤申请 attendance.go:44 ===");
  {
    const at = rec("建考勤", await call("POST", "/api/v1/attendance-requests", {
      code: "BATCHA-ATT", employee_id: EMP?.id, employee_name: EMP?.name || "T",
      request_type: "leave", start_date: "2026-10-20T00:00:00Z", days: 1, remark: "BATCHA-A6",
    }));
    if (at?.id) {
      for (const a of ["submit", "approve", "reject", "cancel", "confirm", "delete"]) {
        rec(`A6 ${a}`, await call("POST", `/api/v1/attendance-requests/${at.id}/${a}`, {}));
      }
    }
  }

  // ---------- A7 费用报销动作 ----------
  console.log("\n=== A7 费用报销 expense_claims.go:106 ===");
  {
    const ex = rec("建报销", await call("POST", "/api/v1/expense-claims", {
      claim_no: "BATCHA-EX", employee_name: EMP?.name || "T", claim_date: "2026-10-14T00:00:00Z", total_amount: 50,
    }));
    if (ex?.id) {
      for (const a of ["submit", "approve", "reject", "cancel", "pay", "delete", "confirm"]) {
        rec(`A7 ${a}`, await call("POST", `/api/v1/expense-claims/${ex.id}/${a}`, {}));
      }
    }
  }

  // ---------- A8 凭证动作 ----------
  console.log("\n=== A8 凭证 vouchers.go:185 ===");
  {
    const v = rec("建凭证", await call("POST", "/api/v1/vouchers", {
      type: "general", entry_date: "2026-10-14T00:00:00Z",
      entries: [{ account_code: "1001", account_name: "库存现金", direction: "debit", amount: 10 },
                { account_code: "6001", account_name: "主营业务收入", direction: "credit", amount: 10 }],
    }));
    if (v?.id) {
      for (const a of ["approve", "post", "cancel", "delete", "confirm", "reverse"]) {
        rec(`A8 ${a}`, await call("POST", `/api/v1/vouchers/${v.id}/${a}`, {}));
      }
    }
  }

  // ---------- A9 工装动作 ----------
  console.log("\n=== A9 工装 toolings.go:59 ===");
  {
    const tl = rec("建工装", await call("POST", "/api/v1/toolings", {
      tooling_no: "BATCHA-TL", name: "BATCHA 工装",
    }));
    if (tl?.id) {
      for (const a of ["check", "maintain", "repair", "scrap", "delete", "cancel", "complete"]) {
        rec(`A9 ${a}`, await call("POST", `/api/v1/toolings/${tl.id}/${a}`, {}));
      }
    }
  }

  // ---------- A10 生产主数据删除 ----------
  console.log("\n=== A10 生产主数据删除 productionmasters.go:12 ===");
  {
    const wc = rec("建工作中心", await call("POST", "/api/v1/work-centers", { code: "BATCHA-WC", name: "BATCHA 中心" }));
    if (wc?.id) rec("A10 删工作中心", await call("DELETE", `/api/v1/work-centers/${wc.id}`, undefined));
    const rt = rec("建工艺", await call("POST", "/api/v1/routings", {
      code: "BATCHA-RT", name: "BATCHA 工艺", product_id: PROD.id,
      steps: [{ sequence: 1, process_code: "P1", process_name: "工序1" }],
    }));
    if (rt?.id) rec("A10 删工艺", await call("DELETE", `/api/v1/routings/${rt.id}`, undefined));
  }

  // ---------- A11 银行记录删除 ----------
  console.log("\n=== A11 银行记录删除 bank.go:98 ===");
  {
    const D = "00000000-0000-0000-0000-000000000000";
    rec("A11 删银行账户(不存在)", await call("DELETE", `/api/v1/bank/accounts/${D}`, undefined));
    rec("A11 删银行流水(不存在)", await call("DELETE", `/api/v1/bank/statements/${D}`, undefined));
    const acc = rec("建银行账户", await call("POST", "/api/v1/bank/accounts", { name: "BATCHA 银行", code: "BATCHA-BANK", account_no: "62220001" }));
    if (acc?.id) rec("A11 删真实银行账户", await call("DELETE", `/api/v1/bank/accounts/${acc.id}`, undefined));
  }

  // ---------- A12 财务报表类型 ----------
  console.log("\n=== A12 财务报表类型 financereports.go:109 ===");
  {
    for (const kind of ["income", "balance-sheet", "profit", "cashflow", "trial-balance", "bogus"]) {
      rec(`A12 ${kind}`, await call("GET", `/api/v1/reports/finance/${kind}?start_date=2026-10-01&end_date=2026-10-31`));
    }
  }

  // ---------- A13 外协单动作 ----------
  console.log("\n=== A13 外协单 subcontracts.go:245 ===");
  {
    const SUP = ((await call("GET", "/api/v1/suppliers?page_size=5"))?.data?.list || [])[0];
    const so = rec("建外协单", await call("POST", "/api/v1/subcontract-orders", {
      supplier_id: SUP?.id, product_id: PROD.id, qty: 2, mode: "pure", remark: "BATCHA-A13",
    }));
    if (so?.id) {
      for (const a of ["confirm", "complete", "cancel", "delete", "issue", "return-material", "close", "receive"]) {
        rec(`A13 ${a}`, await call("POST", `/api/v1/subcontract-orders/${so.id}/${a}`, {}));
      }
    }
  }

  // ---------- A14 工序动作 ----------
  console.log("\n=== A14 工序 workprocesses.go:108 ===");
  {
    const wo = rec("建工单2", await call("POST", "/api/v1/work-orders", {
      product_id: PROD.id, qty: 3, warehouse_id: WAREHOUSE, remark: "BATCHA-A14",
    }));
    const procs = (await call("GET", `/api/v1/work-orders/${wo?.id}/processes`))?.data;
    const first = Array.isArray(procs) ? procs[0] : (procs?.list || [])[0];
    if (first?.id) {
      for (const a of ["start", "complete", "cancel", "report", "delete", "confirm"]) {
        rec(`A14 ${a}`, await call("POST", `/api/v1/work-order-processes/${first.id}/${a}`, {}));
      }
    } else {
      rec("A14 工序列表", undefined, { procs: JSON.stringify(procs).slice(0, 200) });
    }
  }

  writeFileSync("evidence/backend-runtime/audit-batch-a-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次A：default 型动作白名单逐动作回放", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-a-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
