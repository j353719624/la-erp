#!/usr/bin/env node
// 批次 PP · 装配单建单校验取证（2026-10-15）。
//
// 现象：POST /assemblies 不带明细时
//   原版   → 200 + 10000「组件明细不能为空」
//   恢复端 → 200 + code 0 成功
//
// 需查明：
//   ① 原版用什么字段接收组件明细（components / lines / items / bom_components）
//   ② 带明细后两端建单是否都能成功
//   ③ 空数组与缺字段是否同形态
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-assembly.js
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
if (!oTk || !rTk) { console.error("登录失败"); process.exit(1); }

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

async function refs(base, tk) {
  const w = await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=1");
  const p = await call(base, tk, "GET", "/api/v1/products?page=1&page_size=1");
  return {
    warehouse_id: (w.json?.data?.list ?? [])[0]?.id,
    product_id: (p.json?.data?.list ?? [])[0]?.id,
  };
}

async function tryCreate(tag, base, tk, suffix, extra) {
  const r = await refs(base, tk);
  const payload = {
    assembly_no: "AS" + suffix,
    warehouse_id: r.warehouse_id,
    product_id: r.product_id,
    qty: 1,
    ...extra,
  };
  const res = await call(base, tk, "POST", "/api/v1/assemblies", payload);
  say(`   [${tag}] http${res.http} code=${res.json?.code} ${res.json?.message ?? "success"} id=${res.json?.data?.id ?? "-"}`);
  return res;
}

const line = { product_id: null, qty: 1 }; // product_id 在下面动态填

say("=== ① 空明细 / 缺明细字段 ===");
await tryCreate("原版", ORIG, oTk, "E" + stamp, {});
await tryCreate("恢复端", RECOVERED, rTk, "E" + stamp, {});
await tryCreate("原版", ORIG, oTk, "Z" + stamp, { components: [] });
await tryCreate("恢复端", RECOVERED, rTk, "Z" + stamp, { components: [] });

say("\n=== ② 逐个试明细字段名（非空数组）===");
for (const key of ["components", "lines", "items", "bom_components"]) {
  say(`\n--- 字段名 ${key} ---`);
  for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]]) {
    const r = await refs(base, tk);
    const res = await call(base, tk, "POST", "/api/v1/assemblies", {
      assembly_no: "K" + stamp,
      warehouse_id: r.warehouse_id,
      product_id: r.product_id,
      qty: 1,
      [key]: [{ product_id: r.product_id, component_product_id: r.product_id, qty: 1 }],
    });
    const id = res.json?.data?.id;
    say(`   [${tag}] http${res.http} code=${res.json?.code} ${res.json?.message ?? "success"} id=${id ?? "-"}`);
    if (id) {
      const g = await call(base, tk, "GET", "/api/v1/assemblies/" + id);
      const edges = g.json?.data?.edges ?? {};
      const keys = Object.keys(edges);
      say(`        明细回读 edges keys: ${keys.join(",") || "(空)"}`);
      for (const k of ["lines", "components", "items"]) {
        if (Array.isArray(edges[k])) say(`        edges.${k}.length = ${edges[k].length}`);
      }
    }
  }
}

say("\n=== ③ 用 bom-components 带出的真实组件建单 ===");
for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]]) {
  const r = await refs(base, tk);
  const bc = await call(base, tk, "GET", `/api/v1/assemblies/bom-components?product_id=${r.product_id}`);
  const comps = bc.json?.data ?? [];
  say(`   [${tag}] bom-components http${bc.http} 条数=${Array.isArray(comps) ? comps.length : "非数组"}`);
  if (Array.isArray(comps) && comps.length > 0) {
    say(`        首条 keys: ${Object.keys(comps[0]).join(",")}`);
  }
}

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-pp-assembly-20261015.txt",
  log.join("\n") + "\n",
);
