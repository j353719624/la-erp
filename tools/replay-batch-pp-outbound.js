#!/usr/bin/env node
// 批次 PP · 销售出库过账的**受控对照**（2026-10-15）。
//
// 前两轮（autopost3 ④ / autopost4 A 组）都报「原版不过账、恢复端过账」，
// 但同组其它用例又显示两端都是「库存不足」。怀疑是**库存数据差异**而非逻辑差异
// （恢复端库里被前几轮探测铺了货，原版没有）。
//
// 按项目的受控对照法：先在两端**各造同样的数据**，再执行同一操作。
// 步骤（两端各自独立执行）：
//   ① 用 type=other 的入库单铺货（type=other 不过账，不干扰凭证计数）
//   ② 建销售出库单（type=sale）
//   ③ confirm，观测凭证增量与凭证形态
//
// 另附一个反向对照：不铺货直接 confirm，两端应都回「库存不足」。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-outbound.js
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
    product: await pick("/api/v1/products?page=1&page_size=1"),
    warehouse: await pick("/api/v1/warehouses?page=1&page_size=1"),
  };
}
const S = { 原版: await seeds(ORIG, oTk), 恢复端: await seeds(RECOVERED, rTk) };

async function voucherTotal(base, tk) {
  return (await call(base, tk, "GET", "/api/v1/vouchers?page=1&page_size=1")).json?.data?.total ?? -1;
}
async function findVoucher(base, tk, sourceId) {
  for (let page = 1; page <= 10; page++) {
    const r = await call(base, tk, "GET", `/api/v1/vouchers?page=${page}&page_size=50`);
    const list = r.json?.data?.list ?? [];
    const hit = list.find((v) => v.source_id === sourceId);
    if (hit) {
      const d = await call(base, tk, "GET", "/api/v1/vouchers/" + hit.id);
      const v = d.json?.data ?? {};
      const es = v.edges?.entries ?? [];
      return `type=${v.type} status=${v.status} src=${v.source_type} remark="${v.remark}" D=${v.total_debit} C=${v.total_credit} | 分录[${es.length}] ${es.map((e) => `${e.account_code}/${e.direction}/${e.amount}`).join(" + ")}`;
    }
    if (list.length < 50) break;
  }
  return "<未产生凭证>";
}

const SIDE = [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]];
let diff = 0, total = 0;

for (const [label, stockUp] of [["① 先铺货再出库（受控）", true], ["② 不铺货直接出库（对照）", false]]) {
  total++;
  say(`\n=== ${label} ===`);
  const out = {};
  for (const [tag, base, tk] of SIDE) {
    const sd = S[tag];
    const no = stamp + (tag === "原版" ? "O" : "R");
    if (stockUp) {
      // type=other 的入库单：只动库存，不过账
      const inb = await call(base, tk, "POST", "/api/v1/stock-ins", {
        warehouse_id: sd.warehouse?.id,
        stock_in_date: "2026-05-01T00:00:00+08:00",
        type: "other",
        remark: "铺货" + no,
        lines: [{ product_id: sd.product?.id, qty: 100, unit_cost: 10 }],
      });
      const inId = inb.json?.data?.id;
      if (!inId) { out[tag] = `铺货失败 http${inb.http} ${inb.json?.message ?? ""}`; continue; }
      const ic = await call(base, tk, "POST", `/api/v1/stock-ins/${inId}/confirm`, {});
      if (ic.json?.code !== 0) { out[tag] = `铺货确认失败 ${ic.json?.message ?? ""}`; continue; }
    }
    const before = await voucherTotal(base, tk);
    const b = await call(base, tk, "POST", "/api/v1/stock-outs", {
      customer_id: sd.customer?.id,
      warehouse_id: sd.warehouse?.id,
      stock_out_date: "2026-05-23T00:00:00+08:00",
      type: "sale",
      remark: "出库过账" + no,
      lines: [{ product_id: sd.product?.id, qty: 1, unit_cost: 10 }],
    });
    const id = b.json?.data?.id;
    if (!id) { out[tag] = `建单失败 http${b.http} ${b.json?.message ?? ""}`; continue; }
    const a = await call(base, tk, "POST", `/api/v1/stock-outs/${id}/confirm`, {});
    const delta = (await voucherTotal(base, tk)) - before;
    out[tag] = `confirm http${a.http} code=${a.json?.code ?? "-"} ${a.json?.message ?? "success"} | 凭证增量=${delta} | ${delta > 0 ? await findVoucher(base, tk, id) : "—"}`;
  }
  if (out["原版"] !== out["恢复端"]) { diff++; say("!!"); }
  say(`   原版 : ${out["原版"]}`);
  say(`   恢复端: ${out["恢复端"]}`);
}

say(`\n不一致 = ${diff} / ${total}`);
writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-outbound-20261015.txt",
  log.join("\n") + "\n",
);
