#!/usr/bin/env node
// 批次 PP · 装配明细**校验顺序**的原版取证（2026-10-15）。
//
// 背景：调拨单（transfers.go:158）实测出原版是「**先全量算数量、再逐行查商品**」，
// 与本轮直觉（逐行依次校验）不同，不能套用。故对装配单**单独**取证顺序：
//   ⑨  单行同时 product_id 非法 + qty 非法   → 判 UUID 与 decimal 的先后
//   ⑩  单行只给合法 product_id、不给 qty     → 判「缺 qty」的语义
//   ⑪  两行：行1 product_id 非法，行2 qty=0  → 判跨行是否短路在第一行的 UUID 错
//   ⑫  两行：行1 qty=0，行2 product_id 非法  → 反向确认（若与⑪同为 UUID 错，说明先查商品）
//   ⑬  两行：行1 qty=0，行2 product_id 合法  → 判数量错是否覆盖全表
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-lines-shape3.js
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
  ["⑨ product_id非法 + qty非法（单行）", (sd) => [{ product_id: "not-a-uuid", qty: "abc" }]],
  ["⑩ 只给合法 product_id，不给 qty", (sd) => [{ product_id: sd.product_id }]],
  ["⑪ 行1 product_id非法 / 行2 qty=0", (sd) => [{ product_id: "not-a-uuid", qty: 1 }, { product_id: sd.product_id2, qty: 0 }]],
  ["⑫ 行1 qty=0 / 行2 product_id非法", (sd) => [{ product_id: sd.product_id, qty: 0 }, { product_id: "not-a-uuid", qty: 1 }]],
  ["⑬ 行1 qty=0 / 行2 合法", (sd) => [{ product_id: sd.product_id, qty: 0 }, { product_id: sd.product_id2, qty: 1 }]],
];

let diff = 0;
let seq = 0;
for (const [name, mk] of CASES) {
  seq++;
  say(`\n=== ${name} ===`);
  const out = {};
  for (const [tag, base, tk, sd] of [["原版", ORIG, oTk, oSeed], ["恢复端", ACTUAL, rTk, rSeed]]) {
    const payload = {
      assembly_no: `PPR${stamp}${seq}`,
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
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-lines-shape3-20261015.txt",
  log.join("\n") + "\n",
);
