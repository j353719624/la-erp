#!/usr/bin/env node
// 指定批次退货的取价取证（补齐 7.3 的另一半）
//
// 背景：恢复端 service.go:518 的 balance() 硬编码只查无批次行，
// 指定批次时批次成本从未被读取，原本靠后续 ORDER BY qty_available DESC 补成本。
// 原版回放已证明「未指定批次」不该排序挑选，但「指定批次」取哪一行成本仍无直接证据。
//
// 本轮：在 REC-BOUNDARY-1013（is_batch=true，多批次余额）上分别做
//   D1 指定 batch_no 退货
//   D2 未指定 batch_no 退货
// 对比两条流水的 unit_cost 与 balance_after 落点。
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const BOUND = "bf72a5f6-6472-4d6d-9ae3-e36aaf94e283"; // REC-BOUNDARY-1013, is_batch=true, stock=55
const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
const log = [];
let TOKEN = "";

async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  try { return await r.json(); } catch { return null; }
}

const balances = async () => {
  const j = await call("GET", `/api/v1/inventory-balances?product_id=${BOUND}`);
  return (j?.data?.list || []).map((b) => ({ batch: b.batch_no ?? "(无批次)", qty: b.qty_available, cost: b.avg_cost ?? b.unit_cost }));
};

async function run(tag, line) {
  const body = { remark: `REC-AUDIT3-${tag}`, warehouse_id: WAREHOUSE, lines: [line] };
  const c = await call("POST", "/api/v1/sales-returns", body);
  const id = c?.data?.id;
  let mv = null;
  if (id) {
    await call("POST", `/api/v1/sales-returns/${id}/confirm`, {});
    await call("POST", `/api/v1/sales-returns/${id}/approve`, {});
    const j = await call("GET", "/api/v1/stock-movements?page_size=40");
    mv = (j?.data?.list || []).find((m) => m.source_id === id) || null;
  }
  console.log(`${tag}: code=${c?.code}` + (mv ? ` | 流水 batch=${mv.batch_no ?? "(无批次)"} qty=${mv.qty} cost=${mv.unit_cost} after=${mv.balance_after}` : " | 无流水"));
  log.push({ tag, request: body, code: c?.code, movement: mv, balances: await balances() });
  return mv;
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  const b0 = await balances();
  console.log("起始余额:");
  for (const b of b0) console.log(`   ${b.batch}: qty=${b.qty} cost=${b.cost}`);
  console.log();

  const target = b0.find((b) => b.batch !== "(无批次)");
  if (target) {
    console.log(`>>> D1 指定批次 ${target.batch} (qty=${target.qty} cost=${target.cost}) 退 1 件`);
    await run("D1-specified-batch", { product_id: BOUND, qty: 1, price: 9, batch_no: target.batch });
  } else console.log("（无非批次以外的批次行，跳过 D1）");

  console.log(`>>> D2 未指定批次 退 1 件`);
  await run("D2-no-batch", { product_id: BOUND, qty: 1, price: 9 });

  writeFileSync(
    "evidence/backend-runtime/audit-returns-batch-specified-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "清单第7项 指定批次 vs 未指定批次 取价对照", product: "REC-BOUNDARY-1013", records: log }, null, 2),
  );
  console.log("\n最终余额:", JSON.stringify(await balances()));
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });