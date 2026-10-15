#!/usr/bin/env node
// 批次 PP · 出库过账的**二次受控对照**（2026-10-15）—— 修正首版的取样错误。
//
// ## 首版错在哪
// replay-batch-pp-outbound.js 得出「原版出库不过账」，并据此删掉了恢复端的
// 出库过账。但随后 `TestOriginalBusinessFlowReplay` 报
// `journal_entries original=56 actual=48` —— 原版回放快照里
// **sales_outbound 有 8 条分录 / 4 张凭证**，证明原版出库**是过账的**。
//
// 回头查原版业务流（business-flow-contracts.json）才发现：
// 原版出库单的 type 是 **"sales"**（复数），而首版探测用的是 **"sale"**。
// 首版里 type="sales" 那组又恰好被「库存不足」挡住，于是没测到过账。
//
// ## 本脚本的修正
//   ① 两端各用 type=other 的入库单铺**同样**的货（消除库存差异）
//   ② 对 type ∈ {sale, sales, 不传, other} 各跑一遍 confirm，观测凭证增量
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-outbound2.js
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

async function seeds(base, tk) {
  const pick = async (p) => ((await call(base, tk, "GET", p)).json?.data?.list ?? [])[0];
  return {
    customer: await pick("/api/v1/customers?page=1&page_size=1"),
    product: await pick("/api/v1/products?page=1&page_size=1"),
    warehouse: await pick("/api/v1/warehouses?page=1&page_size=1"),
  };
}
const S = { 原版: await seeds(ORIG, oTk), 恢复端: await seeds(ACTUAL, rTk) };

async function voucherTotal(base, tk) {
  return (await call(base, tk, "GET", "/api/v1/vouchers?page=1&page_size=1")).json?.data?.total ?? -1;
}
async function findVoucher(base, tk, sourceId) {
  for (let page = 1; page <= 10; page++) {
    const r = await call(base, tk, "GET", `/api/v1/vouchers?page=${page}&page_size=50`);
    const list = r.json?.data?.list ?? [];
    const hit = list.find((v) => v.source_id === sourceId);
    if (hit) {
      const d = await call(base, tk, "GET", "/api/v1/vouchers/" + hit.id);
      const v = d.json?.data ?? {};
      const es = v.edges?.entries ?? [];
      return `type=${v.type} src=${v.source_type} remark="${v.remark}" D=${v.total_debit} C=${v.total_credit} | 分录[${es.length}] ${es.map((e) => `${e.account_code}/${e.direction}/${e.amount}`).join(" + ")}`;
    }
    if (list.length < 50) break;
  }
  return "<未产生凭证>";
}

const SIDE = [["原版", ORIG, oTk], ["恢复端", ACTUAL, rTk]];

// 两端各铺同样的货（type=other 不过账，不干扰凭证计数）
for (const [tag, base, tk] of SIDE) {
  const sd = S[tag];
  const inb = await call(base, tk, "POST", "/api/v1/stock-ins", {
    warehouse_id: sd.warehouse?.id,
    stock_in_date: "2026-05-01T00:00:00+08:00",
    type: "other",
    remark: "出库对照铺货" + stamp,
    lines: [{ product_id: sd.product?.id, qty: 500, unit_cost: 10 }],
  });
  const inId = inb.json?.data?.id;
  if (!inId) { say(`铺货失败 ${tag}: ${inb.json?.message ?? ""}`); continue; }
  const ic = await call(base, tk, "POST", `/api/v1/stock-ins/${inId}/confirm`, {});
  say(`铺货 ${tag}: http${ic.http} code=${ic.json?.code ?? "-"} ${ic.json?.message ?? "success"}`);
}

const TYPES = [undefined, "", "sale", "sales", "sales_out", "other"];
let diff = 0;
for (const type of TYPES) {
  say(`\n=== type=${type === undefined ? "<不传>" : JSON.stringify(type)} ===`);
  const out = {};
  for (const [tag, base, tk] of SIDE) {
    const sd = S[tag];
    const before = await voucherTotal(base, tk);
    const payload = {
      customer_id: sd.customer?.id,
      warehouse_id: sd.warehouse?.id,
      stock_out_date: "2026-05-23T00:00:00+08:00",
      remark: "出库对照" + stamp,
      lines: [{ product_id: sd.product?.id, qty: 1, unit_cost: 10 }],
    };
    if (type !== undefined) payload.type = type;
    const b = await call(base, tk, "POST", "/api/v1/stock-outs", payload);
    const id = b.json?.data?.id;
    if (!id) { out[tag] = `建单失败 http${b.http} ${b.json?.message ?? ""}`; continue; }
    const a = await call(base, tk, "POST", `/api/v1/stock-outs/${id}/confirm`, {});
    const delta = (await voucherTotal(base, tk)) - before;
    out[tag] = `confirm http${a.http} code=${a.json?.code ?? "-"} ${a.json?.message ?? "success"} | 凭证增量=${delta} | ${delta > 0 ? await findVoucher(base, tk, id) : "—"}`;
  }
  if (out["原版"] !== out["恢复端"]) { diff++; say("!!"); }
  say(`   原版 : ${out["原版"]}`);
  say(`   恢复端: ${out["恢复端"]}`);
}
say(`\n不一致 = ${diff} / ${TYPES.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-outbound2-20261015.txt",
  log.join("\n") + "\n",
);
