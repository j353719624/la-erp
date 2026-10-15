#!/usr/bin/env node
// 批次 PP · 建装配单时 lines 行格式非法的原版文案取证（2026-10-15）。
//
// 起因：自造文案审计抓到恢复端 `组件明细格式错误`（assemblies.go 明细行非对象分支）
// 没有原版证据。按项目铁律「原版无文案就不得自造」，先取证原版真实行为再决定：
//   - 若原版有业务文案 → 逐字照抄
//   - 若原版是通用 400/500 无文案 → 恢复端走同形态，不自造文案
//
// 探测面：lines = [1] / ["abc"] / [null] / [{}] / [{product_id:"非法"}] /
//         lines = "abc"（非数组）/ lines = {}（非数组）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-lines-shape.js
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

// 两端各取一个仓库 + 一个产品，保证 payload 合法（只有 lines 形态是变量）
async function seed(base, tk) {
  const w = await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=1");
  const p = await call(base, tk, "GET", "/api/v1/products?page=1&page_size=1");
  return {
    warehouse_id: (w.json?.data?.list ?? [])[0]?.id,
    product_id: (p.json?.data?.list ?? [])[0]?.id,
  };
}
const oSeed = await seed(ORIG, oTk);
const rSeed = await seed(RECOVERED, rTk);

const SHAPES = [
  ["lines=[1]（数字行）", [1]],
  ["lines=[\"abc\"]（字符串行）", ["abc"]],
  ["lines=[null]（空行）", [null]],
  ["lines=[{}]（空对象行）", [{}]],
  ["lines=\"abc\"（非数组）", "abc"],
  ["lines={}（对象非数组）", {}],
];

let diff = 0;
let i = 0;
for (const [name, lines] of SHAPES) {
  i++;
  say(`\n=== ${name} ===`);
  const out = {};
  for (const [tag, base, tk, sd] of [["原版", ORIG, oTk, oSeed], ["恢复端", RECOVERED, rTk, rSeed]]) {
    const payload = {
      assembly_no: `PPL${stamp}${i}`,
      warehouse_id: sd.warehouse_id,
      product_id: sd.product_id,
      qty: 1,
      lines,
    };
    const r = await call(base, tk, "POST", "/api/v1/assemblies", payload);
    out[tag] = `http${r.http} code=${r.json?.code ?? "-"} ${r.json?.message ?? (r.json?.__nonJson ? "<非JSON>" : "success")}`;
  }
  const same = out["原版"] === out["恢复端"];
  if (!same) diff++;
  say(`${same ? "  " : "!!"} 原版 : ${out["原版"]}`);
  say(`     恢复端: ${out["恢复端"]}`);
}
say(`\n不一致 = ${diff} / ${SHAPES.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-pp-lines-shape-20261015.txt",
  log.join("\n") + "\n",
);
