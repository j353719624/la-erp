#!/usr/bin/env node
// 批次 PP · 装配单 confirm 的库存校验对照（2026-10-15）。
//
// 现象：带明细建单后 confirm
//   原版   → 200 + 10000「库存不足」
//   恢复端 → 200 + code 0 成功
//
// 按铁律「现象相同 ≠ 原因相同」，需受控对照区分：
//   A. 原版库存真的不足（数据差异）→ 恢复端也应报，但两端库存不同无法直接比
//   B. 恢复端 confirm **根本不校验库存**（逻辑差异）
//
// 验证方式：
//   ① 两端各自找一个有库存的商品（inventory_balances qty > 0），用它建装配单后 confirm
//   ② 若原版仍报「库存不足」而恢复端成功 → 需进一步看原版是否按组件校验
//   ③ 反向：用库存为 0 的商品，看恢复端是否也不报（确认恢复端无校验）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-assembly2.js
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

async function pickProducts(base, tk) {
  const r = await call(base, tk, "GET", "/api/v1/products?page=1&page_size=50");
  const list = r.json?.data?.list ?? r.json?.data ?? [];
  const w = await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=5");
  return { list, warehouse: (w.json?.data?.list ?? [])[0] };
}

// 库存：用 inventory/balances 之类端点查不到时，退回用商品列表顺序
async function confirmWithQty(tag, base, tk, qty) {
  const { list, warehouse } = await pickProducts(base, tk);
  if (!list.length || !warehouse) { say(`  [${tag}] 无商品/仓库`); return; }
  const p = list[0];
  const no = "AC" + stamp + qty;
  const c = await call(base, tk, "POST", "/api/v1/assemblies", {
    assembly_no: no,
    warehouse_id: warehouse.id,
    product_id: p.id,
    qty: 1,
    lines: [{ product_id: p.id, qty, unit_cost: 1 }],
  });
  const id = c.json?.data?.id;
  if (!id) { say(`  [${tag}] 建单失败: ${c.json?.message}`); return; }
  const cf = await call(base, tk, "POST", `/api/v1/assemblies/${id}/confirm`, {});
  say(`  [${tag}] 组件 qty=${qty} → confirm http${cf.http} code=${cf.json?.code} ${cf.json?.message ?? "success"}`);
}

say("=== 用不同组件数量 confirm（两端对照）===");
for (const qty of [1, 999999]) {
  say(`\n--- 组件数量 ${qty} ---`);
  await confirmWithQty("恢复端", ACTUAL, rTk, qty);
  await confirmWithQty("原版", ORIG, oTk, qty);
}

say("\n=== 库存快照（判断是数据差异还是逻辑差异）===");
for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", ACTUAL, rTk]]) {
  for (const p of ["/api/v1/inventory/balances?page=1&page_size=3", "/api/v1/inventory-balances?page=1&page_size=3"]) {
    const r = await call(base, tk, "GET", p);
    const l = r.json?.data?.list ?? r.json?.data ?? [];
    say(`  [${tag}] ${p} → http${r.http} 条数=${Array.isArray(l) ? l.length : "?"} ${r.json?.message ?? ""}`);
    if (Array.isArray(l) && l[0]) say(`       首条: ${JSON.stringify(l[0]).slice(0, 160)}`);
  }
}

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-assembly2-20261015.txt",
  log.join("\n") + "\n",
);
