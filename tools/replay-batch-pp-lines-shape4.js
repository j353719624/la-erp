#!/usr/bin/env node
// 批次 PP · 装配明细「商品存在性 vs 数量」的先后顺序取证（2026-10-15）。
//
// 已确定（lines-shape3）：UUID 格式校验**全量前置**（⑫ 行1 qty=0、行2 UUID 非法
// → 报 UUID 错，说明不是逐行短路）。剩最后一个顺序待定：商品存在性 vs 数量。
//   ⑭ 行1 qty=0        / 行2 缺 product_id → 逐行短路报数量错；全量商品前置报商品错
//   ⑮ 行1 缺 product_id / 行2 qty=0        → 反向确认
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-lines-shape4.js
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
const rSeed = await seed(RECOVERED, rTk);

const CASES = [
  ["⑭ 行1 qty=0 / 行2 缺 product_id", (sd) => [{ product_id: sd.product_id, qty: 0 }, {}]],
  ["⑮ 行1 缺 product_id / 行2 qty=0", (sd) => [{}, { product_id: sd.product_id2, qty: 0 }]],
];

let diff = 0;
let seq = 0;
for (const [name, mk] of CASES) {
  seq++;
  say(`\n=== ${name} ===`);
  const out = {};
  for (const [tag, base, tk, sd] of [["原版", ORIG, oTk, oSeed], ["恢复端", RECOVERED, rTk, rSeed]]) {
    const payload = {
      assembly_no: `PPS${stamp}${seq}`,
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
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-pp-lines-shape4-20261015.txt",
  log.join("\n") + "\n",
);
