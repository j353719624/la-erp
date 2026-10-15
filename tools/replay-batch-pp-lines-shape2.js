#!/usr/bin/env node
// 批次 PP · 装配明细行「行内字段」的原版校验文案取证（2026-10-15）。
//
// 上一轮 lines-shape 发现：原版 [null] / [{}] 都回 200 + 10000「所选商品不存在或已被删除」，
// 说明原版**逐行校验商品存在性**。本脚本继续取证行内字段的边界：
//   - product_id 是合法 UUID 但查无此商品
//   - product_id 不是合法 UUID
//   - qty 非数值 / 负数 / 0
//
// 同时给「正常明细」做一次对照，确认成功路径不受影响。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-lines-shape2.js
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
  const p = await call(base, tk, "GET", "/api/v1/products?page=1&page_size=1");
  return {
    warehouse_id: (w.json?.data?.list ?? [])[0]?.id,
    product_id: (p.json?.data?.list ?? [])[0]?.id,
  };
}
const oSeed = await seed(ORIG, oTk);
const rSeed = await seed(ACTUAL, rTk);

const GHOST = "00000000-0000-4000-8000-000000000001"; // 合法 UUID，一定查无此商品

const CASES = [
  ["① product_id=合法UUID但查无此商品", () => [{ product_id: GHOST, qty: 1 }]],
  ["② product_id=非法UUID", () => [{ product_id: "not-a-uuid", qty: 1 }]],
  ["③ product_id=空串", () => [{ product_id: "", qty: 1 }]],
  ["④ qty=非数值字符串", (sd) => [{ product_id: sd.product_id, qty: "abc" }]],
  ["⑤ qty=-1", (sd) => [{ product_id: sd.product_id, qty: -1 }]],
  ["⑥ qty=0", (sd) => [{ product_id: sd.product_id, qty: 0 }]],
  ["⑦ 正常明细（对照）", (sd) => [{ product_id: sd.product_id, qty: 1, unit_cost: 2 }]],
];

let diff = 0;
let seq = 0;
for (const [name, mk] of CASES) {
  seq++;
  say(`\n=== ${name} ===`);
  const out = {};
  for (const [tag, base, tk, sd] of [["原版", ORIG, oTk, oSeed], ["恢复端", ACTUAL, rTk, rSeed]]) {
    const payload = {
      // 注意：单号必须逐条不同，否则触发唯一约束掩盖真实校验（首版在此踩坑）
      assembly_no: `PPQ${stamp}${seq}`,
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
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-lines-shape2-20261015.txt",
  log.join("\n") + "\n",
);
