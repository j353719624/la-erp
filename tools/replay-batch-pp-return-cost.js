#!/usr/bin/env node
// 批次 PP · 退货红字冲销金额的**受控对照**（2026-10-15）。
//
// ## 问题
// 批量连跑 replay-batch-pp-*.js 时，⑤ 销售退货 confirm→approve 出现不一致：
//   原版 D=9.98932 C=9.98932
//   恢复端 D=2.455673 C=2.455673
// 两个都是非整数，形态上像「加权平均成本」——而过账金额并未取请求里传的
// unit_cost:10，说明退货冲销用的是**库存表里该商品的当前成本**。
// 两端库的历史业务不同 → 加权成本早已分叉 → 属**数据差异**。
//
// ## 验证方法（受控对照）
// 在两端各**新建一个专属商品**（stamp 命名，避免撞名/撞已有库存），
// 再铺一笔**完全相同的采购入库**（同单价、同数量）建立库存成本，
// 然后跑同一张销售退货 → confirm → approve，比对凭证金额。
// 若两端一致 → 逻辑对齐，批量连跑的差异是库存状态分叉所致，非代码缺陷。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-return-cost.js
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

// ---------- 种子 ----------
async function seeds(base, tk) {
  const pick = async (path) => ((await call(base, tk, "GET", path)).json?.data?.list ?? [])[0];
  return {
    customer: await pick("/api/v1/customers?page=1&page_size=1"),
    supplier: await pick("/api/v1/suppliers?page=1&page_size=1"),
    warehouse: await pick("/api/v1/warehouses?page=1&page_size=1"),
  };
}
const TAGS = ["原版", "恢复端"];
const BASE = { 原版: ORIG, 恢复端: ACTUAL };
const TK = { 原版: oTk, 恢复端: rTk };
const S = { 原版: await seeds(ORIG, oTk), 恢复端: await seeds(ACTUAL, rTk) };

// ---------- 凭证定位（按 source_id 精确匹配，排除已有） ----------
async function findVoucher(tag, sourceId, exclude) {
  const base = BASE[tag], tk = TK[tag];
  for (let page = 1; page <= 10; page++) {
    const r = await call(base, tk, "GET", `/api/v1/vouchers?page=${page}&page_size=50`);
    const list = r.json?.data?.list ?? [];
    const hit = list.find((v) => v.source_id === sourceId && !exclude.has(v.id));
    if (hit) {
      const d = await call(base, tk, "GET", "/api/v1/vouchers/" + hit.id);
      const v = d.json?.data ?? {};
      const entries = v.edges?.entries ?? [];
      const lines = entries.map((e) => `${e.account_code}/${e.direction}/${e.amount}`).join(" + ");
      return `type=${v.type} status=${v.status} src=${v.source_type} remark="${v.remark}" D=${v.total_debit} C=${v.total_credit} | 分录[${entries.length}] ${lines}`;
    }
    if (list.length < 50) break;
  }
  return "<未找到匹配的凭证>";
}

// ---------- 受控流程 ----------
// 每一步两端都跑同样的动作，任何一步失败就如实报出（不静默吞掉）
async function run(tag) {
  const base = BASE[tag], tk = TK[tag], sd = S[tag];
  const out = { tag, steps: [] };
  const step = (name, r) => {
    const ok = r.json?.code === 0;
    out.steps.push(`${name} http${r.http} code=${r.json?.code ?? "-"} ${ok ? "ok" : JSON.stringify(r.json?.message ?? r.json).slice(0, 160)}`);
    return ok ? r.json?.data?.id ?? r.json?.data : null;
  };

  // 1) 新建专属商品
  const p = await call(base, tk, "POST", "/api/v1/products", {
    name: "退货成本对照" + stamp,
    code: "RC" + stamp,
    spec: "对照",
    unit: "个",
    category: "对照",
    purchase_price: 7,
    sale_price: 20,
    remark: "退货成本受控对照",
  });
  out.productId = step("建商品", p);

  // 2) 铺一笔采购入库：qty=10, unit_cost=7 → 建立库存成本
  const si = await call(base, tk, "POST", "/api/v1/stock-ins", {
    supplier_id: sd.supplier?.id,
    warehouse_id: sd.warehouse?.id,
    stock_in_date: "2026-06-01T00:00:00+08:00",
    type: "purchase",
    remark: "成本对照入库" + stamp,
    lines: [{ product_id: out.productId, qty: 10, unit_cost: 7 }],
  });
  const siId = step("建采购入库", si);
  out.inId = siId;
  if (siId) step("确认采购入库", await call(base, tk, "POST", `/api/v1/stock-ins/${siId}/confirm`, {}));

  // 3) 铺一笔销售出库：qty=2 → 建立出库历史（退货冲销前通常要有出库记录）
  const so = await call(base, tk, "POST", "/api/v1/stock-outs", {
    customer_id: sd.customer?.id,
    warehouse_id: sd.warehouse?.id,
    stock_out_date: "2026-06-02T00:00:00+08:00",
    type: "sales",
    remark: "成本对照出库" + stamp,
    lines: [{ product_id: out.productId, qty: 2, unit_cost: 7 }],
  });
  const soId = step("建销售出库", so);
  out.outId = soId;
  if (soId) step("确认销售出库", await call(base, tk, "POST", `/api/v1/stock-outs/${soId}/confirm`, {}));

  // 4) 销售退货 → confirm → approve（过账点在 approve）
  const sr = await call(base, tk, "POST", "/api/v1/sales-returns", {
    customer_id: sd.customer?.id,
    warehouse_id: sd.warehouse?.id,
    order_date: "2026-06-03T00:00:00+08:00",
    total_amount: 200,
    remark: "成本对照退货" + stamp,
    lines: [{ product_id: out.productId, qty: 1, unit_cost: 7, amount: 200 }],
  });
  const srId = step("建销售退货", sr);
  out.returnId = srId;
  if (srId) {
    step("确认销售退货", await call(base, tk, "POST", `/api/v1/sales-returns/${srId}/confirm`, {}));
    const ap = await call(base, tk, "POST", `/api/v1/sales-returns/${srId}/approve`, {});
    step("审批销售退货", ap);
  }
  return out;
}

say("=== 受控对照：新建专属商品 + 同源入库，再跑销售退货红字冲销 ===");
say(`stamp=${stamp}`);

// 凭证快照必须在**跑动作之前**取，否则会把本次产生的凭证也排除掉
const exclude = { 原版: new Set(), 恢复端: new Set() };
for (const tag of TAGS) {
  for (let page = 1; page <= 10; page++) {
    const r = await call(BASE[tag], TK[tag], "GET", `/api/v1/vouchers?page=${page}&page_size=50`);
    for (const v of r.json?.data?.list ?? []) exclude[tag].add(v.id);
    if ((r.json?.data?.list ?? []).length < 50) break;
  }
}

const R = {};
for (const tag of TAGS) R[tag] = await run(tag);

say("");
let bad = 0;
for (const tag of TAGS) {
  say(`--- ${tag} ---`);
  for (const s of R[tag].steps) say("   " + s);
}
say("");
say("=== 凭证产物比对（按 source_id 精确定位）===");

// 退货凭证：source_id = 退货单 id
for (const tag of TAGS) {
  const rid = R[tag].returnId;
  R[tag].retVoucher = rid ? await findVoucher(tag, rid, exclude[tag]) : "<无退货单>";
}
say(`   原版 : ${R.原版.retVoucher}`);
say(`   恢复端: ${R.恢复端.retVoucher}`);
const retOk = R.原版.retVoucher === R.恢复端.retVoucher;
if (!retOk) bad++;

// 出库/入库凭证也顺带比对（确认受控段的库存动作本身一致）
for (const key of ["inId", "outId"]) {
  for (const tag of TAGS) {
    const id = R[tag][key];
    R[tag][key + "V"] = id ? await findVoucher(tag, id, exclude[tag]) : "<无单据>";
  }
  const ok = R.原版[key + "V"] === R.恢复端[key + "V"];
  if (!ok) bad++;
  say(`   [${key}] 原版 : ${R.原版[key + "V"]}`);
  say(`   [${key}] 恢复端: ${R.恢复端[key + "V"]}`);
}

say("");
say(`不一致 = ${bad} / 3`);
say(bad === 0
  ? "结论：受控对照下两端凭证金额完全一致 → 批量连跑时的金额差异源于两端库存加权成本的历史分叉（数据差异），非代码缺陷。"
  : "结论：受控对照下仍不一致 → 存在真实逻辑差异，需继续定位。");

writeFileSync(
  new URL(`../evidence/backend-runtime/audit-batch-pp-return-cost-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`, import.meta.url),
  log.join("\n") + "\n",
  "utf8",
);
