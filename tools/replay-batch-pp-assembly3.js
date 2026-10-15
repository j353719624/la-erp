#!/usr/bin/env node
// 批次 PP · 装配单 confirm 库存校验的受控对照（2026-10-15）。
//
// 上一轮（assembly2）结论不够：两端库存数据本身不同（原版 3 条 / 恢复端 0 条），
// 无法区分「原版因库存为空而拒绝」与「恢复端根本不校验库存」。
//
// 本轮受控设计：
//   ① 从原版 inventory-balances 取**确实有余额**的 product_id
//   ② 恢复端用**同一个 product_id**（不存在则先在恢复端建同 id 商品 + 库存）
//   ③ 用该商品建装配单并 confirm，比对两端
//
// 若原版用有库存的商品能 confirm 成功 → 说明原版确实按库存校验，
// 恢复端缺的是这套校验（真逻辑差异）。
// 若原版仍报「库存不足」→ 需再找其他前置条件，不得据此臆造。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-assembly3.js
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

// ── ① 原版里有库存余额的商品 ──────────────────────────────────────────
const bal = await call(ORIG, oTk, "GET", "/api/v1/inventory-balances?page=1&page_size=50");
const rows = bal.json?.data?.list ?? bal.json?.data ?? [];
say(`=== ① 原版 inventory-balances 共 ${rows.length} 条 ===`);
const stocked = [];
for (const r of rows) {
  const qty = Number(r.qty ?? r.quantity ?? r.available_qty ?? 0);
  if (r.product_id) {
    say(`   product=${r.product_id} wh=${r.warehouse_id ?? "-"} qty=${r.qty ?? "?"} available=${r.available_qty ?? "?"}`);
    stocked.push({ product_id: r.product_id, warehouse_id: r.warehouse_id, qty });
  }
}

// ── ② 用这些商品在两端各建装配单并 confirm ───────────────────────────
say(`\n=== ② 用有库存的商品 confirm（两端对照，组件 qty=1）===`);
for (const s of stocked.slice(0, 3)) {
  say(`\n--- product=${s.product_id} (库存 qty=${s.qty}) ---`);
  for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]]) {
    const no = "A3" + stamp + tag;
    const c = await call(base, tk, "POST", "/api/v1/assemblies", {
      assembly_no: no,
      warehouse_id: s.warehouse_id,
      product_id: s.product_id,
      qty: 1,
      lines: [{ product_id: s.product_id, qty: 1, unit_cost: 1 }],
    });
    const id = c.json?.data?.id;
    if (!id) { say(`  [${tag}] 建单失败: http${c.http} ${c.json?.message}`); continue; }
    const cf = await call(base, tk, "POST", `/api/v1/assemblies/${id}/confirm`, {});
    say(`  [${tag}] confirm → http${cf.http} code=${cf.json?.code} ${cf.json?.message ?? "success"}`);
  }
}

// ── ③ 反证：恢复端用远超库存的数量，看是否仍成功 ──────────────────────
say(`\n=== ③ 反证：组件 qty=999999（远超任何库存）===`);
for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]]) {
  const { list, warehouse } = await (async () => {
    const r = await call(base, tk, "GET", "/api/v1/products?page=1&page_size=5");
    const w = await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=1");
    return { list: r.json?.data?.list ?? [], warehouse: (w.json?.data?.list ?? [])[0] };
  })();
  if (!list.length) { say(`  [${tag}] 无商品`); continue; }
  const c = await call(base, tk, "POST", "/api/v1/assemblies", {
    assembly_no: "A3X" + stamp + tag,
    warehouse_id: warehouse.id,
    product_id: list[0].id,
    qty: 1,
    lines: [{ product_id: list[0].id, qty: 999999, unit_cost: 1 }],
  });
  const id = c.json?.data?.id;
  if (!id) { say(`  [${tag}] 建单失败: ${c.json?.message}`); continue; }
  const cf = await call(base, tk, "POST", `/api/v1/assemblies/${id}/confirm`, {});
  say(`  [${tag}] confirm → http${cf.http} code=${cf.json?.code} ${cf.json?.message ?? "success"}`);
}

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-assembly3-20261015.txt",
  log.join("\n") + "\n",
);
