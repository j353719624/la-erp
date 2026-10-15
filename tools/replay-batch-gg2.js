#!/usr/bin/env node
// 批次 GG 第二轮取证（补第一轮盲区）：
//   1. 三种带明细单据的「明细校验」矩阵（商品不存在 / 缺数量 / 数量 0 / 空明细 / 无明细）
//   2. SPU 多维度生成 SKU 的重复文案（确认维度值的连接符）
//   3. 导入逐行错误文案（原版放在 data.messages 里，第一轮只记了顶层 message）
//   4. 动态实体「有表无字段」的文案
//   5. 上一轮遗留的临时商品款 / SKU 清理
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-gg2.js
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }
const ZERO = "00000000-0000-0000-0000-000000000000";
const log = [];
let TOKEN = "";

async function call(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await r.text();
  let value; try { value = JSON.parse(text); } catch { value = text.slice(0, 300); }
  return { status: r.status, ...(typeof value === "object" && value !== null ? value : { raw: value }) };
}
function rec(step, req, resp, withData) {
  log.push({
    step, request: req, http_status: resp.status, code: resp.code,
    message: resp.message ?? "", ...(withData ? { data: resp.data } : {}),
  });
  const extra = withData && resp.data ? ` data=${JSON.stringify(resp.data).slice(0, 400)}` : "";
  console.log(`[${step}] http=${resp.status} code=${resp.code ?? "-"} message=${JSON.stringify(resp.message ?? "")}${extra}`);
  return resp;
}
const BOM = "\uFEFF";
function csvOf(headers, rows) {
  const esc = (v) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v ?? "").replace(/"/g, '""')}"` : String(v ?? ""));
  return BOM + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
}
function upload(filename, content, extra = {}) {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), filename);
  for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
  return fd;
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  if (!TOKEN) { console.error("登录失败"); process.exit(1); }

  const junk = [];
  const templates = {};
  for (const kind of ["customers", "products", "users", "skus", "opening-stock"]) {
    const r = await fetch(`${BASE}/api/v1/export/${kind}-template`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    templates[kind] = (await r.text()).replace(/^\uFEFF/, "").split(/\r?\n/)[0].split(",").map((s) => s.replace(/^"|"$/g, "").trim());
  }
  const rowFor = (kind, values) => templates[kind].map((h) => values[h] ?? "");

  const cust = ((await call("GET", "/api/v1/customers?page_size=1"))?.data?.list || [])[0];
  const prod = ((await call("GET", "/api/v1/products?page_size=1"))?.data?.list || [])[0];
  const wh = ((await call("GET", "/api/v1/warehouses?page_size=1"))?.data?.list || [])[0];

  // ── 清理上一轮遗留 ──
  for (const id of ["18da0adb-502c-45a3-87ac-cd8326b6ade6"]) {
    const d = await call("DELETE", `/api/v1/spus/${id}`);
    console.log(`清理临时商品款 ${id} → code=${d.code} ${d.message ?? ""}`);
  }
  const leftovers = ((await call("GET", "/api/v1/products?keyword=GG-SPU&page_size=10"))?.data?.list || []);
  for (const p of leftovers) {
    const d = await call("DELETE", `/api/v1/products/${p.id}`);
    console.log(`清理临时商品 ${p.code} → code=${d.code} ${d.message ?? ""}`);
  }

  // ═══ 一、明细校验矩阵 ═══
  const docs = [
    ["purchase-requisitions", "采购申请"],
    ["purchase-rfqs", "询价单"],
    ["sales-quotations", "销售报价单"],
  ];
  const cases = [
    ["a 明细商品不存在", { lines: [{ product_id: ZERO, qty: 1, price: 1 }] }],
    ["b 明细缺 qty", { lines: [{ product_id: prod?.id, price: 1 }] }],
    ["c 明细 qty=0", { lines: [{ product_id: prod?.id, qty: 0, price: 1 }] }],
    ["d 空明细数组", { lines: [] }],
    ["e 无 lines 键", {}],
    ["f 合法明细", { lines: [{ product_id: prod?.id, qty: 1, price: 1 }] }],
  ];
  for (const [route, label] of docs) {
    for (const [name, body] of cases) {
      const r = await call("POST", `/api/v1/${route}`, body);
      rec(`MM ${label} /${route} ${name}`, body, r);
      if (r.code === 0 && r.data?.id) junk.push([route, r.data.id]);
    }
  }

  // ═══ 二、SPU 多维度重复文案 ═══
  let spu2;
  const made2 = await call("POST", "/api/v1/spus", {
    code: "GG-SPU2", name: "GG回放款2",
    dims: [{ code: "color", name: "颜色", values: ["红"] }, { code: "size", name: "尺码", values: ["M"] }],
  });
  if (made2.code === 0 && made2.data?.id) {
    spu2 = made2.data;
    junk.push(["spus", spu2.id]);
    let r = await call("POST", `/api/v1/spus/${spu2.id}/skus`, {});
    rec("MM SPU2 首次生成", {}, r);
    for (const p of (r?.data?.products || [])) junk.push(["products", p.id]);
    r = await call("POST", `/api/v1/spus/${spu2.id}/skus`, {});
    rec("MM SPU2 重复编码（两维度）", {}, r, true);
  } else {
    console.log(`SPU2 创建失败 code=${made2.code} ${made2.message}`);
  }

  // ═══ 三、导入逐行错误文案（取 data.messages） ═══
  const imports = [
    ["GG19", "customers", rowFor("customers", { 联系人: "x", 电话: "1" })],
    ["GG20", "users", rowFor("users", { 姓名: "GG测试" })],
    ["GG21", "opening-stock", rowFor("opening-stock", { 数量: "1" })],
    ["GG22", "opening-stock", rowFor("opening-stock", { 商品编码: prod?.code, 数量: "1" })],
    ["GG23", "skus", rowFor("skus", { 款号: spu2?.code ?? "", 颜色: "红" })],
    ["GG24", "products", rowFor("products", { 编码: "GG-REF-1", 名称: "GG参照测试", 分类名称: "GG不存在的分类" })],
    ["GG25", "customers", rowFor("customers", { 编码: "GG-INT", 名称: "GG整数测试", "账期(天)": "abc" })],
    ["GG26", "customers", rowFor("customers", { 编码: "GG-NUM", 名称: "GG数字测试", 信用额度: "abc" })],
  ];
  for (const [step, kind, row] of imports) {
    const r = await call("POST", `/api/v1/import/${kind}`,
      upload(`${kind}.csv`, csvOf(templates[kind], [row]), { dry_run: "true" }));
    rec(`${step}b POST /import/${kind}（含 data）`, { kind, row }, r, true);
  }
  let r = await call("POST", "/api/v1/import/customers",
    upload("bad.csv", Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05]).toString("binary"), { dry_run: "true" }));
  rec("GG27b POST /import/customers 损坏 CSV（含 data）", { file: "二进制垃圾.csv" }, r, true);
  r = await call("POST", "/api/v1/import/customers", upload("bad.xlsx", "not-an-excel-file", { dry_run: "true" }));
  rec("GG28b POST /import/customers 损坏 XLSX（含 data）", { file: "文本伪装.xlsx" }, r, true);
  r = await call("POST", "/api/v1/import/customers", upload("no-header.csv", csvOf(["无关列"], [["x"]]), { dry_run: "true" }));
  rec("GG31 POST /import/customers 表头不匹配（含 data）", { headers: ["无关列"] }, r, true);
  r = await call("POST", "/api/v1/import/customers", upload("only-header.csv", csvOf(templates.customers, []), { dry_run: "true" }));
  rec("GG32 POST /import/customers 无数据行（含 data）", { rows: 0 }, r, true);

  // ═══ 四、动态实体：有表无字段 ═══
  const ent = await call("POST", "/api/v1/metadata/entities", {
    code: "GG-EMPTY2", name: "GG空实体2", table_name: "gg_empty2_t",
  });
  console.log(`建实体（带表名）: code=${ent.code} ${ent.message ?? ""} id=${ent.data?.id ?? "-"}`);
  if (ent.data?.id) {
    r = await call("POST", "/api/v1/import/meta?entity=GG-EMPTY2",
      upload("meta.csv", csvOf(["编码"], [["A1"]]), { dry_run: "true" }));
    rec("GG33 POST /import/meta 有表无字段", { entity: "GG-EMPTY2" }, r, true);
    r = await call("GET", "/api/v1/export/meta?entity=GG-EMPTY2", undefined);
    rec("GG34 GET /export/meta 有表无字段", { entity: "GG-EMPTY2" }, r, true);
    r = await call("GET", "/api/v1/export/meta-template?entity=GG-EMPTY2", undefined);
    rec("GG35 GET /export/meta-template 有表无字段", { entity: "GG-EMPTY2" }, r, true);
    r = await call("GET", "/api/v1/dynamic/GG-EMPTY2", undefined);
    rec("GG36 GET /dynamic/GG-EMPTY2 有表无字段", {}, r, true);
    const d = await call("DELETE", `/api/v1/metadata/entities/${ent.data.id}`);
    console.log(`清理实体 GG-EMPTY2 → code=${d.code} ${d.message ?? ""}`);
  }

  // ═══ 清理 ═══
  for (const [route, id] of junk) {
    const d = await call("DELETE", `/api/v1/${route}/${id}`);
    console.log(`清理 DELETE /${route}/${id} → code=${d.code} ${d.message ?? ""}`);
  }

  writeFileSync(
    "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-gg2-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), source: "原版回放 192.168.110.97:18886", templates, records: log }, null, 2),
  );
  console.log("\n已写入 evidence/backend-runtime/audit-batch-gg2-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
