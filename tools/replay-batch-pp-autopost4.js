#!/usr/bin/env node
// 批次 PP · autopost3 暴露的 4 个待确认点（2026-10-15）。
//
// autopost3 已确认收付款单、采购入库三条过账链路逐字一致。剩余疑点：
//
//   A. 销售出库 confirm：恢复端产生 sales_outbound 凭证，原版**不产生**
//      → 是原版 type 取值不同（我传的是 "sale"），还是原版确认不过账？
//   B. 销售退货 approve：恢复端 4 条分录（含两条金额=0），原版只有 2 条
//      → 是否原版**跳过金额为 0 的分录**？
//   C. 采购退货 approve：恢复端 2 条分录（金额全 0），原版**不产生凭证**
//      → 是否原版在**分录全为 0 时整单不过账**？（与 B 同一假设的两面）
//   D. 税金缴纳：原版 type=payment / status=draft / remark 带「缴纳税费（…）」前缀，
//      恢复端 type=general / status=posted / remark 原样；
//      且原版 post_voucher=true 与 false 结果相同（疑似**忽略该参数**）
//      → 另：autopost3 里 ⑧ 定位到了 ⑦ 的凭证，本脚本改为「排除已有 id」精确定位。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-autopost4.js
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

async function seeds(base, tk) {
  const pick = async (p) => ((await call(base, tk, "GET", p)).json?.data?.list ?? [])[0];
  const accounts = (await call(base, tk, "GET", "/api/v1/accounts?page=1&page_size=500")).json?.data?.list ?? [];
  return {
    customer: await pick("/api/v1/customers?page=1&page_size=1"),
    supplier: await pick("/api/v1/suppliers?page=1&page_size=1"),
    product: await pick("/api/v1/products?page=1&page_size=1"),
    warehouse: await pick("/api/v1/warehouses?page=1&page_size=1"),
    bank: accounts.find((a) => String(a.code).startsWith("1002")) ?? accounts.find((a) => String(a.code).startsWith("1001")),
    taxAccount: accounts.find((a) => String(a.code) === "2221") ?? accounts.find((a) => String(a.code).startsWith("2221")),
  };
}
const S = { 原版: await seeds(ORIG, oTk), 恢复端: await seeds(ACTUAL, rTk) };

async function voucherTotal(base, tk) {
  return (await call(base, tk, "GET", "/api/v1/vouchers?page=1&page_size=1")).json?.data?.total ?? -1;
}
// 按 source_id 定位；sourceId 为空（税金缴纳）时按 source_type 定位并**排除已知的旧凭证**
async function findVoucher(base, tk, sourceId, sourceType, exclude = new Set()) {
  for (let page = 1; page <= 10; page++) {
    const r = await call(base, tk, "GET", `/api/v1/vouchers?page=${page}&page_size=50`);
    const list = r.json?.data?.list ?? [];
    const hit = list.find((v) =>
      !exclude.has(v.id) && (sourceId ? v.source_id === sourceId : v.source_type === sourceType));
    if (hit) {
      const d = await call(base, tk, "GET", "/api/v1/vouchers/" + hit.id);
      const v = d.json?.data ?? {};
      const es = v.edges?.entries ?? [];
      return `type=${v.type} status=${v.status} src=${v.source_type} remark="${v.remark}" D=${v.total_debit} C=${v.total_credit} | 分录[${es.length}] ${es.map((e) => `${e.account_code}/${e.direction}/${e.amount}`).join(" + ")}`;
    }
    if (list.length < 50) break;
  }
  return "<未产生新凭证>";
}
// 收集当前已有的某 source_type 凭证 id（用于「排除旧凭证」）
async function knownVoucherIds(base, tk, sourceType) {
  const ids = new Set();
  for (let page = 1; page <= 10; page++) {
    const r = await call(base, tk, "GET", `/api/v1/vouchers?page=${page}&page_size=50`);
    const list = r.json?.data?.list ?? [];
    for (const v of list) if (v.source_type === sourceType) ids.add(v.id);
    if (list.length < 50) break;
  }
  return ids;
}

const SIDE = [["原版", ORIG, oTk], ["恢复端", ACTUAL, rTk]];

// ─────────── A. 销售出库：type 各取值的过账行为 ───────────
say("========== A. 销售出库 confirm 的 type 取值 ==========");
say("   恢复端过账条件（service.go:1019）：type != \"other\" 且非空");
const OUT_TYPES = [undefined, "", "sale", "sales", "sales_out", "other", "transfer"];
let diff = 0, total = 0;
for (const type of OUT_TYPES) {
  total++;
  say(`\n--- type=${type === undefined ? "<不传>" : JSON.stringify(type)} ---`);
  const out = {};
  for (const [tag, base, tk] of SIDE) {
    const sd = S[tag];
    const before = await voucherTotal(base, tk);
    const payload = {
      customer_id: sd.customer?.id,
      warehouse_id: sd.warehouse?.id,
      stock_out_date: "2026-05-23T00:00:00+08:00",
      remark: "出库过账" + stamp + (tag === "原版" ? "O" : "R"),
      lines: [{ product_id: sd.product?.id, qty: 1, unit_cost: 10 }],
    };
    if (type !== undefined) payload.type = type;
    const b = await call(base, tk, "POST", "/api/v1/stock-outs", payload);
    const id = b.json?.data?.id;
    if (!id) { out[tag] = `建单失败 http${b.http} ${b.json?.message ?? ""}`; continue; }
    const a = await call(base, tk, "POST", `/api/v1/stock-outs/${id}/confirm`, {});
    const delta = (await voucherTotal(base, tk)) - before;
    out[tag] = `建单 http${b.http} | confirm http${a.http} code=${a.json?.code ?? "-"} ${a.json?.message ?? "success"} | 凭证增量=${delta} | ${delta > 0 ? await findVoucher(base, tk, id) : "—"}`;
  }
  if (out["原版"] !== out["恢复端"]) { diff++; say("!!"); }
  say(`   原版 : ${out["原版"]}`);
  say(`   恢复端: ${out["恢复端"]}`);
}

// ─────────── B/C. 退货：金额非 0 时的分录形态 ───────────
say("\n\n========== B/C. 退货的分录形态（total_amount 非 0） ==========");
say("   恢复端代码：销售退货 4 条（6001/1122 按 amount，1405/6401 按 totalCost）");
say("   采购退货 2 条（2202/1403 按 amount）");
const RETURNS = [
  ["销售退货 amount=200", "/api/v1/sales-returns", 200],
  ["销售退货 amount=0", "/api/v1/sales-returns", 0],
  ["采购退货 amount=150", "/api/v1/purchase-returns", 150],
  ["采购退货 amount=0", "/api/v1/purchase-returns", 0],
];
for (const [name, route, amount] of RETURNS) {
  total++;
  say(`\n--- ${name} ---`);
  const out = {};
  for (const [tag, base, tk] of SIDE) {
    const sd = S[tag];
    const no = stamp + (tag === "原版" ? "O" : "R");
    const before = await voucherTotal(base, tk);
    const payload = {
      warehouse_id: sd.warehouse?.id,
      order_date: "2026-05-24T00:00:00+08:00",
      total_amount: amount,
      remark: "退货过账" + no,
      lines: [{ product_id: sd.product?.id, qty: 1, unit_cost: 10, amount }],
    };
    if (route.includes("sales")) payload.customer_id = sd.customer?.id;
    else payload.supplier_id = sd.supplier?.id;
    const b = await call(base, tk, "POST", route, payload);
    const id = b.json?.data?.id;
    if (!id) { out[tag] = `建单失败 http${b.http} ${b.json?.message ?? ""}`; continue; }
    const cf = await call(base, tk, "POST", `${route}/${id}/confirm`, {});
    const ap = await call(base, tk, "POST", `${route}/${id}/approve`, {});
    const delta = (await voucherTotal(base, tk)) - before;
    out[tag] = `建单 http${b.http} | confirm http${cf.http} code=${cf.json?.code ?? "-"} | approve http${ap.http} code=${ap.json?.code ?? "-"} ${ap.json?.message ?? "success"} | 凭证增量=${delta} | ${delta > 0 ? await findVoucher(base, tk, id) : "—"}`;
  }
  if (out["原版"] !== out["恢复端"]) { diff++; say("!!"); }
  say(`   原版 : ${out["原版"]}`);
  say(`   恢复端: ${out["恢复端"]}`);
}

// ─────────── D. 税金缴纳 ───────────
say("\n\n========== D. 税金缴纳（精确定位新增凭证） ==========");
for (const [name, postVoucher] of [["post_voucher=true", true], ["post_voucher=false", false]]) {
  total++;
  say(`\n--- ${name} ---`);
  const out = {};
  for (const [tag, base, tk] of SIDE) {
    const sd = S[tag];
    // 税金缴纳的凭证 remark 会**原样带上**这里传入的 remark，
    // 若带 O/R 后缀会让两端 remark 不同 → 假不一致。故用同一个取样戳。
    const no = stamp;
    // 税金缴纳的 source_id 是空串，只能按 source_type 定位 → 先记录已有的，再排除
    const known = await knownVoucherIds(base, tk, "tax_payment");
    const before = await voucherTotal(base, tk);
    const payload = {
      items: [{ account_code: sd.taxAccount?.code, amount: 88 }],
      bank_code: sd.bank?.code,
      pay_date: "2026-05-26T00:00:00+08:00",
      post_voucher: postVoucher,
      remark: "税金过账" + no,
    };
    const a = await call(base, tk, "POST", "/api/v1/tax-accruals/pay", payload);
    const delta = (await voucherTotal(base, tk)) - before;
    out[tag] = `pay http${a.http} code=${a.json?.code ?? "-"} ${a.json?.message ?? "success"} | 凭证增量=${delta} | ${delta > 0 ? await findVoucher(base, tk, "", "tax_payment", known) : "—"}`;
  }
  if (out["原版"] !== out["恢复端"]) { diff++; say("!!"); }
  say(`   原版 : ${out["原版"]}`);
  say(`   恢复端: ${out["恢复端"]}`);
}

// ─────────── E. 调拨类出/入库单的拦截（出入库各一句不同文案） ───────────
// 首版这条只在临时脚本里跑过、没落盘，导致自造文案审计把入库侧那句判成「自造」。
// 这里补正式取证：POST 建单与 PUT 改单都要拦；confirm 不拦。
say("\n\n========== E. 调拨类出/入库单拦截 ==========");
const GUARDS = [
  ["出库 POST transfer", "/api/v1/stock-outs", "stock_out_date", "POST", ""],
  ["入库 POST transfer", "/api/v1/stock-ins", "stock_in_date", "POST", ""],
];
for (const [name, route, dateKey, method] of GUARDS) {
  total++;
  say(`\n--- ${name} ---`);
  const out = {};
  for (const [tag, base, tk] of SIDE) {
    const sd = S[tag];
    const payload = {
      [dateKey]:    "2026-05-23T00:00:00+08:00",
      "warehouse_id": sd.warehouse?.id,
      "type":         "transfer",
      "lines":        [{ product_id: sd.product?.id, qty: 1, unit_cost: 10 }],
    };
    const r = await call(base, tk, "POST", route, payload);
    out[tag] = `http${r.http} code=${r.json?.code ?? "-"} ${r.json?.message ?? "success"}`;
  }
  if (out["原版"] !== out["恢复端"]) { diff++; say("!!"); }
  say(`   原版 : ${out["原版"]}`);
  say(`   恢复端: ${out["恢复端"]}`);
}

say(`\n不一致 = ${diff} / ${total}`);
writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-autopost4-20261015.txt",
  log.join("\n") + "\n",
);
