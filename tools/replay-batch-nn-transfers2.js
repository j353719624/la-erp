#!/usr/bin/env node
// 批次 NN 第二轮取证（2026-10-15）：钉死 `POST /stock-transfers` 的校验顺序与明细字段名。
//
// ## 第一轮已定
//   ① 必填：`FromWarehouseID` / `ToWarehouseID`（400，多字段 `\n` 连接，From 先 To 后）
//   ② `from == to` → `200 code 10000「调出仓与调入仓不能相同」`
//   ③ 仓库不存在的 uuid → `200 code 10000「调拨明细不能为空」`（**不报仓库不存在**）
//      说明明细校验**早于**仓库存在性校验，恢复端把顺序搞反了
//
// ## 本轮要钉死
//   · 明细字段叫什么（items / products / details）
//   · 明细项里物料字段叫什么（product_id / material_id）
//   · 「明细为空」与「仓库不存在」的先后（构造 from 不存在 + 有明细）
//   · 建单成功的返回形状（data 顶层键集合）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-nn-transfers2.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.NN_RECOVERED ?? "http://127.0.0.1:18899";
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
const origToken = await token(ORIG, true);
const recToken = await token(RECOVERED, false);

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json };
}
function shape(r) {
  const d = r.json?.data;
  return {
    http: r.http, code: r.json?.code, message: r.json?.message,
    dataKeys: d && typeof d === "object" && !Array.isArray(d) ? Object.keys(d).sort()
      : Array.isArray(d) ? ["__array", `len=${d.length}`] : typeof d,
  };
}

async function pick(base, tk, path, key = "id", n = 2) {
  const r = await call(base, tk, "GET", path);
  const list = r.json?.data?.list ?? r.json?.data?.items ?? [];
  return list.slice(0, n).map((x) => x[key] ?? "").filter(Boolean);
}

// 两端都取到**两个不同**仓库：恢复端种子通常只带一个，缺则补建。
// 否则 `to` 为 undefined 会命中「ToWarehouseID required」，与「两仓不同」的意图不符，
// 差异会全部来自环境而非实现。
async function twoWarehouses(base, tk) {
  let list = await pick(base, tk, "/api/v1/warehouses?page=1&page_size=50", "id", 2);
  if (list.length < 2) {
    const created = await call(base, tk, "POST", "/api/v1/warehouses", { name: "NN 第二仓", code: "NN-W2" });
    if (created.json?.data?.id) list.push(created.json.data.id);
  }
  return list;
}
const whOrig = await twoWarehouses(ORIG, origToken);
const whRec = await twoWarehouses(RECOVERED, recToken);
const prdOrig = await pick(ORIG, origToken, "/api/v1/products?page=1&page_size=20", "id", 1);
const prdRec = await pick(RECOVERED, recToken, "/api/v1/products?page=1&page_size=20", "id", 1);
console.log("原版 仓库:", whOrig, "物料:", prdOrig);
console.log("恢复端 仓库:", whRec, "物料:", prdRec);

const NOPE1 = "00000000-0000-0000-0000-000000000001";
const NOPE2 = "00000000-0000-0000-0000-000000000002";

function build(w, p, opt) {
  const o = { from_warehouse_id: opt.from ?? w[0], to_warehouse_id: opt.to ?? w[1] };
  if (opt.detailField && p[0]) {
    const item = opt.item || {};
    o[opt.detailField] = [Object.assign({ product_id: p[0], quantity: 1 }, item)];
  } else if (opt.detailField) {
    o[opt.detailField] = [];
  }
  return o;
}

const cases = [
  { name: "A 两仓不同 + 无明细字段", opt: {} },
  { name: "B 两仓不同 + items:[]", opt: { detailField: "lines" } },
  { name: "C 两仓不同 + items:[{product_id,quantity}]", opt: { detailField: "lines" } },
  { name: "D 两仓不同 + products:[{...}]", opt: { detailField: "lines" } },
  { name: "E 两仓不同 + details:[{...}]", opt: { detailField: "lines" } },
  { name: "F from不存在 + items正常", opt: { detailField: "lines", from: NOPE1 } },
  { name: "G to不存在 + items正常", opt: { detailField: "lines", to: NOPE2 } },
  { name: "H 两仓不同 + items物料不存在", opt: { detailField: "lines", item: { product_id: NOPE1, quantity: 1 } } },
  { name: "I 两仓不同 + items数量0", opt: { detailField: "lines", item: { quantity: 0 } } },
  { name: "J 两仓不同 + items数量-1", opt: { detailField: "lines", item: { quantity: -1 } } },
];

const records = [];
for (const c of cases) {
  const ob = build(whOrig, prdOrig, c.opt);
  const rb = build(whRec, prdRec, c.opt);
  const o = await call(ORIG, origToken, "POST", "/api/v1/stock-transfers", ob);
  const r = await call(RECOVERED, recToken, "POST", "/api/v1/stock-transfers", rb);
  const so = shape(o), sr = shape(r);
  records.push({
    case: c.name, sentOrig: ob, sentRec: rb, orig: so, recovered: sr,
    same: so.http === sr.http && so.code === sr.code && so.message === sr.message,
    origIs500: so.http === 500, recIs500: sr.http === 500,
  });
  console.log(`\n[${c.name}] ${records.at(-1).same ? "一致" : "★差异"}`);
  console.log(`  原版  http=${so.http} code=${so.code} msg=${JSON.stringify(so.message)}`);
  console.log(`  恢复端 http=${sr.http} code=${sr.code} msg=${JSON.stringify(sr.message)}`);
  if (so.http === 200 && so.code === 0) console.log(`  原版建单成功 data 键: ${JSON.stringify(so.dataKeys)}`);
  if (sr.http === 200 && sr.code === 0) console.log(`  恢复端建单成功 data 键: ${JSON.stringify(sr.dataKeys)}`);
}

const same = records.filter((x) => x.same).length;
writeFileSync("evidence/backend-runtime/audit-batch-nn-transfers2-20261015.json", JSON.stringify({
  generated: new Date().toISOString(),
  purpose: "批次 NN 第二轮：stock-transfers 校验顺序与明细字段名",
  base: { orig: ORIG, recovered: RECOVERED },
  ids: { whOrig, whRec, prdOrig, prdRec },
  cases: records,
  summary: { total: records.length, same, differ: records.length - same },
}, null, 2));
console.log(`\n=== 汇总 ${same}/${records.length} 一致 ===`);
