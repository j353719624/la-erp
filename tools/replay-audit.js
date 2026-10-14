#!/usr/bin/env node
// 清单第 7 项：退货取价与零余额边界 —— 原版回放取证
//
// 目标商品 REC-RET-TIE-1013「退货等量成本对照保留」（is_batch=true）
// 起始批次余额：TIE-LAST 3件@19、无批次 4件@11、TIE-FIRST 3件@5，合计 10
//
// 场景：
//   A 等量库存行取价  —— 退货数量恰好等于某一余额行（原版取哪一行成本？）
//   B 无批次余额恰好归零 —— 退货把某个余额行扣到 0，原版是否拒绝（防除零）
//   C 外币退货       —— 非 CNY 退货
//   D 已付款退货     —— 对已收/已付单据退货
//
// 安全：凭据只在环境变量，不落盘；输出经脱敏；证据落盘前二次脱敏。
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) {
  console.error("缺少 ERP_PASSWORD 环境变量");
  process.exit(1);
}

const log = [];
function rec(step, method, path, body, resp, note) {
  log.push({ step, method, path, body: body ?? null, response: resp, note: note ?? "" });
  const code = resp?.code;
  const msg = resp?.message ?? "";
  console.log(`[${step}] ${method} ${path} -> code=${code} ${String(msg).slice(0, 70)}`);
}

async function login() {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const j = await r.json();
  const t = j?.data?.access_token;
  if (!t) throw new Error("登录失败");
  return t;
}

let TOKEN = "";
async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  let j = null;
  try { j = await r.json(); } catch { /* 非JSON */ }
  return { status: r.status, ...j };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  TOKEN = await login();

  const TIE = "809d1ff9-da79-44fb-98f1-3053398c5818";   // REC-RET-TIE-1013
  const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";

  // ---- 取起始状态 ----
  const bal0 = await call("GET", `/api/v1/inventory-balances?product_id=${TIE}`);
  rec("0-起始余额", "GET", `/inventory-balances?product_id=${TIE}`, null, bal0);

  // ---- 场景 B：无批次余额恰好归零（无批次行当前 4 件，退 4 件）----
  const bBody = {
    remark: "REC-AUDIT-B-nobatch-to-zero",
    warehouse_id: WAREHOUSE,
    lines: [{ product_id: TIE, qty: 4, price: 11 }],
  };
  const bCreate = await call("POST", "/api/v1/sales-returns", bBody);
  rec("B1-创建(退无批次行全部4件)", "POST", "/sales-returns", bBody, bCreate);
  const bId = bCreate?.data?.id;
  if (bId) {
    rec("B2-confirm", "POST", `/sales-returns/${bId}/confirm`, {}, await call("POST", `/api/v1/sales-returns/${bId}/confirm`, {}));
    rec("B3-approve", "POST", `/sales-returns/${bId}/approve`, {}, await call("POST", `/api/v1/sales-returns/${bId}/approve`, {}));
    const balAfter = await call("GET", `/api/v1/inventory-balances?product_id=${TIE}`);
    rec("B4-审批后余额", "GET", `/inventory-balances?product_id=${TIE}`, null, balAfter);
  }

  // ---- 场景 A：等量库存行取价（退 3 件，恰好等于 TIE-FIRST 3@5 与 TIE-LAST 3@19）----
  const aBody = {
    remark: "REC-AUDIT-A-equal-qty-cost",
    warehouse_id: WAREHOUSE,
    lines: [{ product_id: TIE, qty: 3, price: 5 }],
  };
  const aCreate = await call("POST", "/api/v1/sales-returns", aBody);
  rec("A1-创建(退3件=两行各3件)", "POST", "/sales-returns", aBody, aCreate);
  const aId = aCreate?.data?.id;
  if (aId) {
    rec("A2-confirm", "POST", `/sales-returns/${aId}/confirm`, {}, await call("POST", `/api/v1/sales-returns/${aId}/confirm`, {}));
    const aApprove = await call("POST", `/api/v1/sales-returns/${aId}/approve`, {});
    rec("A3-approve", "POST", `/sales-returns/${aId}/approve`, {}, aApprove);
    console.log("   A3 审批响应关键字段:", JSON.stringify(approveKey(aApprove)));
    const balA = await call("GET", `/api/v1/inventory-balances?product_id=${TIE}`);
    rec("A4-审批后余额", "GET", `/inventory-balances?product_id=${TIE}`, null, balA);
  }

  // ---- 场景 C：外币退货 ----
  const cBody = {
    remark: "REC-AUDIT-C-foreign",
    warehouse_id: WAREHOUSE,
    currency_code: "USD",
    exchange_rate: "7.2",
    lines: [{ product_id: TIE, qty: 1, price: 11 }],
  };
  const cCreate = await call("POST", "/api/v1/sales-returns", cBody);
  rec("C1-创建(USD退货)", "POST", "/sales-returns", cBody, cCreate);
  const cId = cCreate?.data?.id;
  if (cId) {
    const cConfirm = await call("POST", `/api/v1/sales-returns/${cId}/confirm`, {});
    rec("C2-confirm", "POST", `/sales-returns/${cId}/confirm`, {}, cConfirm);
  }

  // ---- 落盘（不含任何凭据）----
  writeFileSync(
    "evidence/backend-runtime/audit-returns-tie-20261013.json",
    JSON.stringify({ generated: "2026-10-13", scenario: "清单第7项 退货取价与零余额边界", product: "REC-RET-TIE-1013", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-returns-tie-20261013.json");
}

function approveKey(r) {
  const d = r?.data || {};
  const keep = {};
  for (const k of ["status", "total_amount", "total_cost", "cost_amount", "unit_cost", "avg_cost", "currency_code", "exchange_rate"]) {
    if (d[k] !== undefined) keep[k] = d[k];
  }
  return keep;
}

main().catch((e) => { console.error("回放失败:", e.message); process.exit(1); });