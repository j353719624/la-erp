#!/usr/bin/env node
// 批次 PP · 装配单 confirm / cancel 的**完整状态矩阵**取证（2026-10-15）。
//
// ## 起因
// replay-batch-pp-statemachine.js 的 B2/B3 暴露出两处不一致：
//   B2 装配 confirm→confirm  原版「只有草稿状态的组装单才能确认」
//                            恢复端「只有草稿装配单才能确认」（缺「的」，语序也不同）
//   B3 装配 confirm→cancel   原版 code=10000「只有草稿状态的组装单才能取消」
//                            恢复端 code=0 success（**放行了**）
// B3 是行为差异而非文案差异：原版**禁止**取消已确认的装配单，恢复端允许。
// 已确认的装配单已产生两条库存流水，放行取消会让库存与单据状态脱节。
//
// ## 为什么不直接照 B2/B3 改
// 状态机文案**各单据不同构**（批次 PP 已证明报销/考勤/绩效各自一套），
// 且原版 cancel 的准入状态可能不止 draft。故先把矩阵跑全，再逐条落地。
//
// ## 抗污染设计
// 装配单 confirm 会扣组件库存，两端库存状态不同会让 confirm 一端成功一端失败，
// 从而掩盖真实的状态机差异。故**两端各建专属商品并铺足库存**（1000 个），
// 使 confirm 一定成功，状态迁移只受被测逻辑支配。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-asm-statemachine.js
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
if (!oTk || !rTk) { console.error("登录失败"); process.exit(1); }

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
const SIDE = [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]];

// ── 两端各建专属商品并铺足库存 ────────────────────────────────────────
async function prepare(tag, base, tk) {
  const p = await call(base, tk, "POST", "/api/v1/products", {
    name: "装配状态机" + tag + stamp,
    code: "AS" + tag + stamp,
    unit: "个", spec: "对照", category: "对照",
    purchase_price: 1, sale_price: 10,
    remark: "装配状态机取证",
  });
  const productId = p.json?.data?.id;
  if (!productId) { say(`[${tag}] 建商品失败 http${p.http} ${JSON.stringify(p.json).slice(0, 200)}`); return null; }

  const w = await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=1");
  const warehouseId = (w.json?.data?.list ?? [])[0]?.id;

  const si = await call(base, tk, "POST", "/api/v1/stock-ins", {
    warehouse_id: warehouseId,
    stock_in_date: "2026-07-01T00:00:00+08:00",
    type: "purchase",
    remark: "装配状态机铺货" + stamp,
    lines: [{ product_id: productId, qty: 1000, unit_cost: 1 }],
  });
  const inId = si.json?.data?.id;
  if (inId) {
    const cf = await call(base, tk, "POST", `/api/v1/stock-ins/${inId}/confirm`, {});
    if (cf.json?.code !== 0) say(`[${tag}] 铺货确认失败 http${cf.http} ${cf.json?.message ?? ""}`);
  } else {
    say(`[${tag}] 铺货建单失败 http${si.http} ${JSON.stringify(si.json).slice(0, 200)}`);
  }
  say(`[${tag}] 专属商品 ${productId.slice(0, 8)}… 仓库 ${String(warehouseId).slice(0, 8)}… 已铺货 1000`);
  return { productId, warehouseId };
}

const P = {};
for (const [tag, base, tk] of SIDE) P[tag] = await prepare(tag, base, tk);

let seq = 0;
async function newAssembly(tag, base, tk) {
  const sd = P[tag];
  if (!sd) return null;
  const r = await call(base, tk, "POST", "/api/v1/assemblies", {
    assembly_no: `ASM${stamp}${(++seq).toString().padStart(3, "0")}`,
    warehouse_id: sd.warehouseId,
    product_id: sd.productId,
    qty: 1,
    lines: [{ product_id: sd.productId, qty: 1, unit_cost: 1 }],
  });
  return r.json?.code === 0 ? r.json?.data?.id : null;
}
async function act(base, tk, id, action) {
  if (!id) return "建单失败";
  const r = await call(base, tk, "POST", `/api/v1/assemblies/${id}/${action}`, {});
  return `http${r.http} code=${r.json?.code ?? "-"} ${r.json?.code === 0 ? "success" : r.json?.message ?? ""}`;
}

// ── 状态矩阵 ──────────────────────────────────────────────────────────
const CASES = [
  { name: "① draft → confirm", steps: ["confirm"] },
  { name: "② draft → confirm → confirm", steps: ["confirm", "confirm"] },
  { name: "③ draft → confirm → cancel", steps: ["confirm", "cancel"] },
  { name: "④ draft → cancel", steps: ["cancel"] },
  { name: "⑤ draft → cancel → cancel", steps: ["cancel", "cancel"] },
  { name: "⑥ draft → cancel → confirm", steps: ["cancel", "confirm"] },
  { name: "⑦ draft → confirm → cancel → confirm", steps: ["confirm", "cancel", "confirm"] },
];

say("========== 装配单 confirm / cancel 状态矩阵 ==========");
let diff = 0;
for (const tc of CASES) {
  say(`\n--- ${tc.name} ---`);
  const out = {};
  for (const [tag, base, tk] of SIDE) {
    const id = await newAssembly(tag, base, tk);
    out[tag] = [];
    for (const a of tc.steps) out[tag].push(`${a}: ${await act(base, tk, id, a)}`);
  }
  const same = out["原版"].join(" | ") === out["恢复端"].join(" | ");
  if (!same) { diff++; say("!!"); }
  for (const [tag] of SIDE) say(`   ${tag}: ${out[tag].join(" | ")}`);
}
say("");
say(`不一致 = ${diff} / ${CASES.length}`);

writeFileSync(
  new URL(`../evidence/backend-runtime/audit-batch-pp-asm-statemachine-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`, import.meta.url),
  log.join("\n") + "\n",
  "utf8",
);
say("证据已落盘。");
