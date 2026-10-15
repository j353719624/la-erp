#!/usr/bin/env node
// 批次 PP · PUT 明细校验剩余两段 + 落库值（2026-10-15）。
//
// 上一轮（put-lines2）已知 PUT 与 POST 的差异：**不校验数量为正**。
// 本脚本补齐剩余两段，并确认 PUT 是否原样落库：
//   ⑤ qty="abc"                → 判数值解码段(D) 在 PUT 上是否生效
//   ⑥ product_id 合法但查无商品 → 判「幽灵商品」段(F) 在 PUT 上是否也是通用 500
//   ⑦ qty=0 落库后回读          → 确认 PUT 原样落库（不是被静默改成其他值）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-put-lines3.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.OO_RECOVERED ?? "http://127.0.0.1:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const GHOST = "00000000-0000-4000-8000-000000000001";

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
  ["⑤ PUT qty=\"abc\"", (sd) => [{ product_id: sd.product_id2, qty: "abc" }]],
  ["⑥ PUT product_id 合法但查无", (sd) => [{ product_id: GHOST, qty: 1 }]],
  ["⑦ PUT qty=0 后回读落库值", (sd) => [{ product_id: sd.product_id2, qty: 0 }]],
];

let diff = 0;
let seq = 0;
for (const [name, mk] of CASES) {
  seq++;
  say(`\n=== ${name} ===`);
  const out = {};
  for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]]) {
    const sd = await seed(base, tk);
    const no = `PPW${stamp}${seq}${tag === "原版" ? "O" : "R"}`;
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
    const detail = ls.map((l) => `行${l.line_no}:qty=${l.qty}`).join(",") || "无";
    out[tag] = `PUT http${put.http} code=${put.json?.code ?? "-"} ${put.json?.message ?? "success"} | 回读 ${detail}`;
  }
  const same = out["原版"] === out["恢复端"];
  if (!same) diff++;
  say(`${same ? "  " : "!!"} 原版 : ${out["原版"]}`);
  say(`     恢复端: ${out["恢复端"]}`);
}
say(`\n不一致 = ${diff} / ${CASES.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-pp-put-lines3-20261015.txt",
  log.join("\n") + "\n",
);
