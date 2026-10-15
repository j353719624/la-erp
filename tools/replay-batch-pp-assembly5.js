#!/usr/bin/env node
// 批次 PP · 装配单库存副作用的最终两端对照（2026-10-15）。
//
// 前几轮已确认规格并实现，本轮做**同等条件下的端到端对照**：
//   ① 组件数量远超库存 → 两端都应回 200+10000「库存不足」
//   ② 成功后两端都应产生 2 条流水（out + in），且 unit_cost / total_cost /
//      direction / balance_after / remark 一致
//
// 恢复端库存数据与原版不同，故不能直接比数值；比对的是**行为形态**
// （拒绝/放行、流水条数、字段口径）。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-assembly5.js
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
const list = (r) => r.json?.data?.list ?? r.json?.data ?? [];

const log = [];
const say = (s) => { log.push(s); console.log(s); };
const stamp = Date.now().toString().slice(-6);

async function pickStocked(base, tk) {
  const bals = list(await call(base, tk, "GET", "/api/v1/inventory-balances?page=1&page_size=100"));
  return bals.find((b) => b.product_id && b.warehouse_id) ?? null;
}

// 恢复端库存为空，用**正规入库单**铺货（不绕过业务逻辑直接改库），
// 这样两端才处在可比对的同等条件下。
async function stockUp(base, tk, tag) {
  const w = list(await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=1"));
  const p = list(await call(base, tk, "GET", "/api/v1/products?page=1&page_size=1"));
  if (!w.length || !p.length) return null;
  const no = "SI" + tag;
  const c = await call(base, tk, "POST", "/api/v1/stock-ins", {
    inbound_no: no,
    warehouse_id: w[0].id,
    stock_in_date: "2026-06-01T00:00:00+08:00",
    lines: [{ line_no: 1, product_id: p[0].id, product_name: p[0].name, product_code: p[0].code, qty: 100, unit_cost: 1 }],
  });
  const id = c.json?.data?.id;
  if (!id) return null;
  const cf = await call(base, tk, "POST", `/api/v1/stock-ins/${id}/confirm`, {});
  if (cf.json?.code !== 0) return null;
  return { product_id: p[0].id, warehouse_id: w[0].id };
}

async function run(tag, base, tk, suffix, qty) {
  let pick = await pickStocked(base, tk);
  if (!pick) {
    say(`  [${tag}] 无库存记录，先用入库单铺货`);
    pick = await stockUp(base, tk, suffix);
  }
  if (!pick) { say(`  [${tag}] 铺货失败，跳过`); return null; }
  const pid = pick.product_id;
  const wid = pick.warehouse_id;
  const no = "A5" + suffix;
  const c = await call(base, tk, "POST", "/api/v1/assemblies", {
    assembly_no: no, warehouse_id: wid, product_id: pid, qty: 2,
    lines: [{ product_id: pid, qty, unit_cost: 7 }],
  });
  const id = c.json?.data?.id;
  if (!id) { say(`  [${tag}] 建单失败: ${c.json?.message}`); return null; }
  const cf = await call(base, tk, "POST", `/api/v1/assemblies/${id}/confirm`, {});
  const confirmText = `http${cf.http} code=${cf.json?.code} ${cf.json?.message ?? "success"}`;
  const moves = list(await call(base, tk, "GET", "/api/v1/stock-movements?page=1&page_size=300"))
    .filter((m) => m.source_id === id)
    .map((m) => `type=${m.type} qty=${m.qty} dir=${m.direction} uc=${m.unit_cost} tc=${m.total_cost} ba=${m.balance_after} remark="${m.remark}"`)
    .sort();
  return { confirmText, moves };
}

say("=== ① 组件 qty=999999（远超库存）→ 两端都应拒绝 ===");
for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", ACTUAL, rTk]]) {
  const r = await run(tag, base, tk, "OVER" + stamp, 999999);
  if (r) say(`  [${tag}] confirm: ${r.confirmText} | 流水条数=${r.moves.length}`);
}

say("\n=== ② 组件 qty=1（合理）→ 两端都应成功并产生 2 条流水 ===");
for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", ACTUAL, rTk]]) {
  const r = await run(tag, base, tk, "OK" + stamp, 1);
  if (!r) continue;
  say(`  [${tag}] confirm: ${r.confirmText}`);
  for (const m of r.moves) say(`         ${m}`);
}

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-assembly5-20261015.txt",
  log.join("\n") + "\n",
);
