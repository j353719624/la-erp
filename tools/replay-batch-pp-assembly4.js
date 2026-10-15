#!/usr/bin/env node
// 批次 PP · 装配单 confirm 的库存副作用取证（2026-10-15）。
//
// 已确认：原版 confirm **按库存校验**（组件 qty=999999 → 10000「库存不足」；
// 数量合理 → 成功），恢复端完全不校验。
//
// 本轮查清 confirm 成功后**是否产生库存变动**（扣组件 / 加成成品）：
//   confirm 前记录 inventory-balances 与 stock-movements 快照
//   confirm 后再次记录，比对差异
// 只有查清副作用，恢复端才能按原版实现，而不是只加一句校验。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-assembly4.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const r0 = await fetch(`${ORIG}/api/v1/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: PASS, company: "default" }),
});
const tk = (await r0.json())?.data?.access_token;
if (!tk) { console.error("登录失败"); process.exit(1); }

async function call(method, path, body) {
  const res = await fetch(ORIG + path, {
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

// 找一个有库存余额的商品 + 其仓库
const bals = list(await call("GET", "/api/v1/inventory-balances?page=1&page_size=100"));
say(`=== 原版 inventory-balances 共 ${bals.length} 条 ===`);
const pick = bals.find((b) => b.product_id && b.warehouse_id) ?? bals[0];
if (!pick) { say("无库存记录，终止"); process.exit(0); }
say(`选中: product=${pick.product_id} warehouse=${pick.warehouse_id}`);
say(`  全字段: ${JSON.stringify(pick).slice(0, 300)}`);

const pid = pick.product_id, wid = pick.warehouse_id;

async function snapshot(tag) {
  const b = list(await call("GET", "/api/v1/inventory-balances?page=1&page_size=200"));
  const m = list(await call("GET", "/api/v1/stock-movements?page=1&page_size=200"));
  const mine = b.filter((x) => x.product_id === pid && x.warehouse_id === wid);
  say(`  [${tag}] 该商品库存行 qty_available=${mine.map((x) => x.qty_available).join(",") || "无"}`);
  say(`  [${tag}] stock-movements 总数=${m.length}`);
  return { bals: b, moves: m, mine };
}

// 建装配单（组件 = 该商品，qty=1）
const no = "A4" + stamp;
const c = await call("POST", "/api/v1/assemblies", {
  assembly_no: no, warehouse_id: wid, product_id: pid, qty: 1,
  lines: [{ product_id: pid, qty: 1, unit_cost: 1 }],
});
const id = c.json?.data?.id;
say(`\n建单: http${c.http} code=${c.json?.code} ${c.json?.message ?? "success"} id=${id ?? "-"}`);
if (!id) { process.exit(0); }

const before = await snapshot("confirm 前");
const cf = await call("POST", `/api/v1/assemblies/${id}/confirm`, {});
say(`\nconfirm: http${cf.http} code=${cf.json?.code} ${cf.json?.message ?? "success"}`);
const after = await snapshot("confirm 后");

say(`\n=== 差异 ===`);
say(`  库存行: ${before.mine.length} → ${after.mine.length}`);
say(`  库存总数: ${before.bals.length} → ${after.bals.length}`);
say(`  流水总数: ${before.moves.length} → ${after.moves.length}（增量 ${after.moves.length - before.moves.length}）`);
const newMoves = after.moves.filter((m) => !before.moves.some((b) => b.id === m.id));
for (const m of newMoves.slice(0, 5)) {
  say(`  新增流水: type=${m.type} source_type=${m.source_type} qty=${m.qty} dir=${m.direction} product=${m.product_id} wh=${m.warehouse_id}`);
}

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-assembly4-20261015.txt",
  log.join("\n") + "\n",
);
