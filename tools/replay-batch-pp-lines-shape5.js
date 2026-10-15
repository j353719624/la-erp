#!/usr/bin/env node
// 批次 PP · 装配明细最后两处顺序取证（2026-10-15）。
//
//   ⑯ 行1 缺 product_id / 行2 qty="abc" → 判「数值解码(D)」与「商品存在(E)」的先后
//   ⑰ unit_cost="abc"                   → 判 unit_cost 是否也走 decimal 解码校验
//   ⑱ unit_cost=-1                      → 判 unit_cost 是否允许为负（调拨 cost_price 允许）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-lines-shape5.js
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

async function seed(base, tk) {
  const w = await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=1");
  const p = await call(base, tk, "GET", "/api/v1/products?page=1&page_size=2");
  const list = p.json?.data?.list ?? [];
  return {
    warehouse_id: (w.json?.data?.list ?? [])[0]?.id,
    product_id: list[0]?.id,
    product_id2: list[1]?.id ?? list[0]?.id,
  };
}
const oSeed = await seed(ORIG, oTk);
const rSeed = await seed(ACTUAL, rTk);

const CASES = [
  ["⑯ 行1 缺 product_id / 行2 qty=\"abc\"", (sd) => [{}, { product_id: sd.product_id2, qty: "abc" }]],
  ["⑰ unit_cost=\"abc\"", (sd) => [{ product_id: sd.product_id, qty: 1, unit_cost: "abc" }]],
  ["⑱ unit_cost=-1", (sd) => [{ product_id: sd.product_id, qty: 1, unit_cost: -1 }]],
];

let diff = 0;
let seq = 0;
for (const [name, mk] of CASES) {
  seq++;
  say(`\n=== ${name} ===`);
  const out = {};
  for (const [tag, base, tk, sd] of [["原版", ORIG, oTk, oSeed], ["恢复端", ACTUAL, rTk, rSeed]]) {
    const payload = {
      assembly_no: `PPT${stamp}${seq}`,
      warehouse_id: sd.warehouse_id,
      product_id: sd.product_id,
      qty: 1,
      lines: mk(sd),
    };
    const r = await call(base, tk, "POST", "/api/v1/assemblies", payload);
    out[tag] = `http${r.http} code=${r.json?.code ?? "-"} ${r.json?.message ?? (r.json?.__nonJson ? "<非JSON>" : "success")}`;
  }
  const same = out["原版"] === out["恢复端"];
  if (!same) diff++;
  say(`${same ? "  " : "!!"} 原版 : ${out["原版"]}`);
  say(`     恢复端: ${out["恢复端"]}`);
}
say(`\n不一致 = ${diff} / ${CASES.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-lines-shape5-20261015.txt",
  log.join("\n") + "\n",
);
