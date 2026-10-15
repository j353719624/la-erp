#!/usr/bin/env node
// 批次 PP · PUT /assemblies/{id} 是否会更新组件明细（2026-10-15）。
//
// 背景：调拨单实测 PUT 不带 lines → **明细被清空**；PUT 带 lines → 明细整体重写。
// 恢复端的 s.update 对装配单**完全不碰明细**，若原版行为不同即是缺口。
//
// 步骤（两端各建一张带 1 行明细的装配单，再各自 PUT，最后回读 edges.lines）：
//   ① PUT 带 2 行新明细 → 回读应有 2 行
//   ② PUT 不带 lines    → 回读 0 行（清空）还是 2 行（保留）？
//   ③ PUT lines=[]      → 回读 0 行？
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-put-lines.js
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

const SIDE = [
  ["原版", ORIG, oTk, true],
  ["恢复端", RECOVERED, rTk, false],
];

const created = {};
const seeds = {};
for (const [tag, base, tk, withCompany] of SIDE) {
  const sd = await seed(base, tk);
  seeds[tag] = sd;
  const r = await call(base, tk, "POST", "/api/v1/assemblies", {
    assembly_no: `PPU${stamp}${tag === "原版" ? "O" : "R"}`,
    warehouse_id: sd.warehouse_id,
    product_id: sd.product_id,
    qty: 1,
    lines: [{ product_id: sd.product_id2, qty: 1, unit_cost: 1 }],
  });
  created[tag] = r.json?.data?.id;
  say(`建单 ${tag}: http${r.http} id=${created[tag] ?? "-"} ${r.json?.message ?? "success"}`);
}

const linesOf = (r) => (r.json?.data?.edges?.lines ?? r.json?.data?.lines ?? []);
// 只比行数与行内数值：**不要**把 product_id 拼进比较串 ——
// 两端是各自独立的库，同一件商品的 UUID 必然不同，拼进去会产生假不一致
// （首版就踩了这个坑：①②③ 全部误报，实际语义完全对齐）。
const summarize = (r) => {
  const ls = linesOf(r);
  return `行数=${ls.length}${ls.length ? " " + ls.map((l) => `行${l.line_no}×${l.qty}`).join(",") : ""}`;
};

const STEPS = [
  ["① PUT 带 2 行新明细", (sd) => ({ lines: [{ product_id: sd.product_id, qty: 2, unit_cost: 1 }, { product_id: sd.product_id2, qty: 3, unit_cost: 1 }] })],
  ["② PUT 不带 lines", (sd) => ({ qty: 5 })],
  ["③ PUT lines=[]", (sd) => ({ qty: 6, lines: [] })],
];

let diff = 0;
for (const [name, mk] of STEPS) {
  say(`\n=== ${name} ===`);
  const out = {};
  for (const [tag, base, tk] of SIDE) {
    const id = created[tag];
    if (!id) { out[tag] = "<建单失败，跳过>"; continue; }
    const sd = seeds[tag];
    const put = await call(base, tk, "PUT", "/api/v1/assemblies/" + id, {
      assembly_no: `PPU${stamp}${tag === "原版" ? "O" : "R"}`,
      warehouse_id: sd.warehouse_id,
      product_id: sd.product_id,
      ...mk(sd),
    });
    const back = await call(base, tk, "GET", "/api/v1/assemblies/" + id);
    out[tag] = `PUT http${put.http} code=${put.json?.code ?? "-"} ${put.json?.message ?? "success"} | 回读 ${summarize(back)}`;
  }
  const same = out["原版"] === out["恢复端"];
  if (!same) diff++;
  say(`${same ? "  " : "!!"} 原版 : ${out["原版"]}`);
  say(`     恢复端: ${out["恢复端"]}`);
}
say(`\n不一致 = ${diff} / ${STEPS.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-pp-put-lines-20261015.txt",
  log.join("\n") + "\n",
);
