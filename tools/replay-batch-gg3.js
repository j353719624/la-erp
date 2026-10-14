#!/usr/bin/env node
// 批次 GG 第三轮取证：导入校验文案矩阵。
//   1. 每种导入对象「整行留空」的必填文案
//   2. 每种导入对象「参照值不存在」的文案
//   3. int / num 列格式错误的文案（确认列名口径）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-gg3.js
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }
const log = [];
let TOKEN = "";

const BOM = "\uFEFF";
const csvOf = (headers, rows) => {
  const esc = (v) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v ?? "").replace(/"/g, '""')}"` : String(v ?? ""));
  return BOM + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
};
const upload = (filename, content, extra = {}) => {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), filename);
  for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
  return fd;
};
async function login() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
}
async function call(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const t = await r.text();
  let v; try { v = JSON.parse(t); } catch { v = { raw: t.slice(0, 200) }; }
  return { http: r.status, ...v };
}
function rec(step, req, resp) {
  const msgs = resp?.data?.messages || [];
  log.push({ step, request: req, http_status: resp.http, code: resp.code, message: resp.message ?? "", row_messages: msgs });
  console.log(`[${step}] http=${resp.http} code=${resp.code ?? "-"} msg=${JSON.stringify(resp.message ?? "")} rows=${JSON.stringify(msgs)}`);
  return resp;
}

const KINDS = ["customers", "products", "suppliers", "units", "warehouses", "locations", "racks", "skus", "users", "opening-stock"];

async function main() {
  await login();
  const templates = {};
  for (const kind of KINDS) {
    const r = await fetch(`${BASE}/api/v1/export/${kind}-template`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    templates[kind] = (await r.text()).replace(/^\uFEFF/, "").split(/\r?\n/)[0].split(",").map((s) => s.replace(/^"|"$/g, "").trim());
  }
  const blank = (kind) => templates[kind].map(() => "");
  const fill = (kind, values) => templates[kind].map((h) => values[h] ?? "");

  // 1. 整行留空
  for (const kind of KINDS) {
    const r = await call("POST", `/api/v1/import/${kind}`, upload(`${kind}.csv`, csvOf(templates[kind], [blank(kind)]), { dry_run: "true" }));
    rec(`N1 ${kind} 整行留空`, { kind }, r);
  }
  // 2. 参照不存在
  const REFCASES = [
    ["products", { 编码: "GG-R1", 名称: "GG参照1", 分类名称: "GG无此分类" }],
    ["products", { 编码: "GG-R2", 名称: "GG参照2", 单位名称: "GG无此单位" }],
    ["customers", { 编码: "GG-R3", 名称: "GG参照3", 分类名称: "GG无此分类" }],
    ["suppliers", { 编码: "GG-R4", 名称: "GG参照4", 分类名称: "GG无此分类" }],
    ["locations", { 编码: "GG-R5", 名称: "GG参照5", 仓库编码: "GG无此仓库" }],
    ["racks", { 编码: "GG-R6", 名称: "GG参照6", 库位编码: "GG无此库位" }],
    ["skus", { 款号: "GG无此款", 颜色: "红", 尺码: "M", SKU编码: "GG-S1" }],
    ["skus", { 款号: "GG-SPUX", 颜色: "红", 尺码: "M", SKU编码: "GG-S2", 单位名称: "GG无此单位" }],
    ["users", { 用户名: "GG-U1", 姓名: "甲", 部门: "GG无此部门" }],
    ["opening-stock", { 商品编码: "GG无此商品", 仓库编码: "WH-DEFAULT", 数量: "1" }],
    ["opening-stock", { 商品编码: "CB-C3", 仓库编码: "GG无此仓库", 数量: "1" }],
  ];
  for (const [kind, values] of REFCASES) {
    const r = await call("POST", `/api/v1/import/${kind}`, upload(`${kind}.csv`, csvOf(templates[kind], [fill(kind, values)]), { dry_run: "true" }));
    rec(`N2 ${kind} 参照不存在 ${Object.keys(values).join("/")}`, { kind, values }, r);
  }
  // 3. 格式错误
  const FORMAT = [
    ["customers", { 编码: "GG-F1", 名称: "GG格式1", "账期(天)": "abc" }],
    ["customers", { 编码: "GG-F2", 名称: "GG格式2", 信用额度: "abc" }],
    ["products", { 编码: "GG-F3", 名称: "GG格式3", 销售价: "abc" }],
    ["products", { 编码: "GG-F4", 名称: "GG格式4", "保质期(天)": "abc" }],
    ["racks", { 编码: "GG-F5", 名称: "GG格式5", 行数: "abc" }],
    ["racks", { 编码: "GG-F6", 名称: "GG格式6", 容量: "abc" }],
  ];
  for (const [kind, values] of FORMAT) {
    const r = await call("POST", `/api/v1/import/${kind}`, upload(`${kind}.csv`, csvOf(templates[kind], [fill(kind, values)]), { dry_run: "true" }));
    rec(`N3 ${kind} 格式错误 ${Object.keys(values).join("/")}`, { kind, values }, r);
  }
  // 4. skus「规格维度」文案：只填颜色不填尺码 / 都不填
  for (const values of [
    { 款号: "GG-SPUX", 颜色: "红", SKU编码: "GG-S3" },
    { 款号: "GG-SPUX", SKU编码: "GG-S4" },
  ]) {
    const r = await call("POST", "/api/v1/import/skus", upload("skus.csv", csvOf(templates.skus, [fill("skus", values)]), { dry_run: "true" }));
    rec(`N4 skus 规格维度 ${JSON.stringify(values)}`, values, r);
  }

  writeFileSync(
    "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-gg3-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), source: "原版回放 192.168.110.97:18886", templates, records: log }, null, 2),
  );
  console.log("\n已写入 evidence/backend-runtime/audit-batch-gg3-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
