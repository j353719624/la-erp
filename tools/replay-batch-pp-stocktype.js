#!/usr/bin/env node
// 批次 PP · 出入库自动过账的 **type 白名单**扫描（2026-10-15）。
//
// ## 为什么需要这一轮
// outbound2 的受控对照证明：原版出库只在 **type="sales"** 时过账，
// `sale` / `sales_out` 都不过账 —— 即原版是**白名单**，而恢复端用的是
// 「type != other 且非空」的**黑名单**，口径过宽。
//
// 原版业务流里出入库的 type 取值只有三种：
//   stock-ins  : purchase（9 次）、不传（1 次）
//   stock-outs : sales（7 次）
// 但「业务流只用这几个值」不等于「只有这几个值会过账」，
// 故本脚本对**候选值逐个扫描**，把白名单钉死。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-stocktype.js
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

async function seeds(base, tk) {
  const pick = async (p) => ((await call(base, tk, "GET", p)).json?.data?.list ?? [])[0];
  return {
    customer: await pick("/api/v1/customers?page=1&page_size=1"),
    supplier: await pick("/api/v1/suppliers?page=1&page_size=1"),
    product: await pick("/api/v1/products?page=1&page_size=1"),
    warehouse: await pick("/api/v1/warehouses?page=1&page_size=1"),
  };
}
const S = { 原版: await seeds(ORIG, oTk), 恢复端: await seeds(RECOVERED, rTk) };

async function voucherTotal(base, tk) {
  return (await call(base, tk, "GET", "/api/v1/vouchers?page=1&page_size=1")).json?.data?.total ?? -1;
}
const SIDE = [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]];

// 两端各铺同样的货（type=other 不过账）
for (const [tag, base, tk] of SIDE) {
  const sd = S[tag];
  const inb = await call(base, tk, "POST", "/api/v1/stock-ins", {
    warehouse_id: sd.warehouse?.id,
    stock_in_date: "2026-05-01T00:00:00+08:00",
    type: "other",
    remark: "白名单扫描铺货" + stamp,
    lines: [{ product_id: sd.product?.id, qty: 1000, unit_cost: 10 }],
  });
  const inId = inb.json?.data?.id;
  if (!inId) { say(`铺货失败 ${tag}: ${inb.json?.message ?? ""}`); continue; }
  const ic = await call(base, tk, "POST", `/api/v1/stock-ins/${inId}/confirm`, {});
  say(`铺货 ${tag}: code=${ic.json?.code ?? "-"} ${ic.json?.message ?? "success"}`);
}

const SWEEP = [
  {
    route: "/api/v1/stock-outs", dateKey: "stock_out_date", party: "customer_id",
    types: [undefined, "", "sale", "sales", "sales_out", "salesout", "SALES", "Sales", "sale_out", "out"],
  },
  {
    route: "/api/v1/stock-ins", dateKey: "stock_in_date", party: "supplier_id",
    types: [undefined, "", "purchase", "purchase_in", "Purchase", "buy", "in", "purchases"],
  },
];

let diff = 0, total = 0;
for (const sw of SWEEP) {
  say(`\n========== ${sw.route} ==========`);
  for (const type of sw.types) {
    total++;
    const out = {};
    for (const [tag, base, tk] of SIDE) {
      const sd = S[tag];
      const before = await voucherTotal(base, tk);
      const payload = {
        [sw.party]: sw.route.includes("out") ? sd.customer?.id : sd.supplier?.id,
        [sw.dateKey]: "2026-05-23T00:00:00+08:00",
        warehouse_id: sd.warehouse?.id,
        remark: "白名单扫描" + stamp,
        lines: [{ product_id: sd.product?.id, qty: 1, unit_cost: 10 }],
      };
      if (type !== undefined) payload.type = type;
      const b = await call(base, tk, "POST", sw.route, payload);
      const id = b.json?.data?.id;
      if (!id) { out[tag] = `建单失败 ${b.json?.message ?? ""}`; continue; }
      const a = await call(base, tk, "POST", `${sw.route}/${id}/confirm`, {});
      const delta = (await voucherTotal(base, tk)) - before;
      out[tag] = `confirm code=${a.json?.code ?? "-"} ${a.json?.message ?? "success"} | 凭证增量=${delta}`;
    }
    if (out["原版"] !== out["恢复端"]) diff++;
    const mark = out["原版"] === out["恢复端"] ? "  " : "!!";
    say(`${mark} type=${String(type === undefined ? "<不传>" : JSON.stringify(type)).padEnd(12)} 原版[${out["原版"]}] 恢复端[${out["恢复端"]}]`);
  }
}
say(`\n不一致 = ${diff} / ${total}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-pp-stocktype-20261015.txt",
  log.join("\n") + "\n",
);
