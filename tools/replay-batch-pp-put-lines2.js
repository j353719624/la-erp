#!/usr/bin/env node
// 批次 PP · PUT /assemblies/{id} 的明细**校验**是否复用 POST 的四段规则（2026-10-15）。
//
// 已确定 PUT 会整体重写明细（行数变化与调拨单同款）。本脚本确认非法明细在
// PUT 上是否同样被拒（逐条对照 POST 的取证结果）：
//   ① lines=[{}]                       → POST 是 200+10000「所选商品不存在或已被删除」
//   ② lines=[{product_id 非法}]        → POST 是 400「请求参数错误: invalid UUID length: 10」
//   ③ lines=[{product_id 合法, qty:0}] → POST 是 200+10000「组件数量必须大于0」
//   ④ lines="abc"（非数组）            → POST 是 400「系统内部错误…」
//
// 每条用例各建一张新单，避免互相污染。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-put-lines2.js
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

const CASES = [
  ["① PUT lines=[{}]", (sd) => [{}]],
  ["② PUT lines=[{product_id 非法}]", (sd) => [{ product_id: "not-a-uuid", qty: 1 }]],
  ["③ PUT lines=[{qty=0}]", (sd) => [{ product_id: sd.product_id2, qty: 0 }]],
  ["④ PUT lines=\"abc\"", (sd) => "abc"],
];

let diff = 0;
let seq = 0;
for (const [name, mk] of CASES) {
  seq++;
  say(`\n=== ${name} ===`);
  const out = {};
  for (const [tag, base, tk, withCompany] of [["原版", ORIG, oTk, true], ["恢复端", RECOVERED, rTk, false]]) {
    const sd = await seed(base, tk);
    const no = `PPV${stamp}${seq}${tag === "原版" ? "O" : "R"}`;
    const made = await call(base, tk, "POST", "/api/v1/assemblies", {
      assembly_no: no, warehouse_id: sd.warehouse_id, product_id: sd.product_id, qty: 1,
      lines: [{ product_id: sd.product_id2, qty: 1, unit_cost: 1 }],
    });
    const id = made.json?.data?.id;
    if (!id) { out[tag] = `<建单失败 http${made.http} ${made.json?.message ?? ""}>`; continue; }
    const put = await call(base, tk, "PUT", "/api/v1/assemblies/" + id, {
      assembly_no: no, warehouse_id: sd.warehouse_id, product_id: sd.product_id, qty: 1,
      lines: mk(sd),
    });
    const back = await call(base, tk, "GET", "/api/v1/assemblies/" + id);
    const ls = back.json?.data?.edges?.lines ?? [];
    out[tag] = `PUT http${put.http} code=${put.json?.code ?? "-"} ${put.json?.message ?? "success"} | 回读行数=${ls.length}`;
  }
  const same = out["原版"] === out["恢复端"];
  if (!same) diff++;
  say(`${same ? "  " : "!!"} 原版 : ${out["原版"]}`);
  say(`     恢复端: ${out["恢复端"]}`);
}
say(`\n不一致 = ${diff} / ${CASES.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-put-lines2-20261015.txt",
  log.join("\n") + "\n",
);
