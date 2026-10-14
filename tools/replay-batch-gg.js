#!/usr/bin/env node
// 批次 GG 回放：为批次 FF 新引入的 22 条中文文案向原版取证。
//
// 背景：tools/audit-self-authored-text.mjs 判定批次 FF 新增的 22 条 errors.New/fmt.Errorf
// 中文文案在原版证据库里查无实据（即「自造」）。本项目铁律是「原版有文案就逐字照抄，
// 原版无文案就不得自造」，故本脚本逐条复现触发条件，取回原版真实 message 后回填代码。
//
// 安全约定（沿用 tools/replay.sh）：口令只经环境变量传入，不落盘；输出脱敏。
//   用法：ERP_PASSWORD=xxx node tools/replay-batch-gg.js
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const ZERO = "00000000-0000-0000-0000-000000000000";
const log = [];
let TOKEN = "";

async function call(method, path, body, opts = {}) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await r.text();
  let value;
  try { value = JSON.parse(text); } catch { value = text.slice(0, 300); }
  return { status: r.status, ...(typeof value === "object" && value !== null ? value : { raw: value }) };
}

function rec(step, req, resp) {
  const row = {
    step,
    request: req,
    http_status: resp.status,
    code: resp.code,
    message: resp.message ?? "",
  };
  log.push(row);
  console.log(`[${step}] http=${resp.status} code=${resp.code ?? "-"} message=${JSON.stringify(resp.message ?? "")}`);
  return resp;
}

// ---------- 文件构造 ----------
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
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  if (!TOKEN) { console.error("登录失败"); process.exit(1); }
  console.log("登录成功\n");

  const templates = {};
  for (const kind of ["customers", "products", "users", "skus", "opening-stock", "units"]) {
    const r = await fetch(`${BASE}/api/v1/export/${kind}-template`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const text = await r.text();
    templates[kind] = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0].split(",").map((s) => s.replace(/^"|"$/g, "").trim());
    console.log(`模板 ${kind}: ${templates[kind].join(" | ")}`);
  }
  const rowFor = (kind, values) => {
    const headers = templates[kind];
    return headers.map((h) => values[h] ?? "");
  };

  const junk = [];
  // 参照数据
  const cust = ((await call("GET", "/api/v1/customers?page_size=1"))?.data?.list || [])[0];
  const prod = ((await call("GET", "/api/v1/products?page_size=1"))?.data?.list || [])[0];
  const unit = ((await call("GET", "/api/v1/units?page_size=1"))?.data?.list || [])[0];
  const wh = ((await call("GET", "/api/v1/warehouses?page_size=1"))?.data?.list || [])[0];
  const rfqList = ((await call("GET", "/api/v1/purchase-rfqs?page_size=1"))?.data?.list || []);
  const spuList = ((await call("GET", "/api/v1/spus?page_size=5"))?.data?.list || []);
  const sup = ((await call("GET", "/api/v1/suppliers?page_size=1"))?.data?.list || [])[0];
  console.log(`参照: cust=${cust?.code} prod=${prod?.code} unit=${unit?.name} wh=${wh?.code} rfq=${rfqList[0]?.id ?? "-"} spu=${spuList[0]?.id ?? "-"}\n`);

  // 询价单 / 商品款：原版库里没有，先建一只用于取证，结束即清理
  let rfq = rfqList[0];
  if (!rfq) {
    const made = await call("POST", "/api/v1/purchase-rfqs", { supplier_id: sup?.id, remark: "GG回放临时" });
    if (made.code === 0 && made.data?.id) {
      rfq = made.data;
      junk.push(["purchase-rfqs", rfq.id]);
      console.log(`临时询价单 ${rfq.id}`);
    }
  }
  let spu = spuList[0];
  if (!spu) {
    const made = await call("POST", "/api/v1/spus", {
      code: "GG-SPU", name: "GG回放款",
      dims: [{ code: "color", name: "颜色", values: ["红"] }],
    });
    if (made.code === 0 && made.data?.id) {
      spu = made.data;
      junk.push(["spus", spu.id]);
      console.log(`临时商品款 ${spu.id}`);
    }
  }

  // ═══ 一、单据 CRUD 校验（document_crud.go） ═══
  let r = await call("POST", "/api/v1/spus", {});
  rec("GG1 POST /spus 缺 name", { body: {} }, r);
  if (r.code === 0 && r.data?.id) junk.push(["spus", r.data.id]);

  r = await call("POST", "/api/v1/purchase-contracts", {});
  rec("GG2 POST /purchase-contracts 缺 supplier_id", { body: {} }, r);
  if (r.code === 0 && r.data?.id) junk.push(["purchase-contracts", r.data.id]);

  r = await call("POST", "/api/v1/sales-contracts", {});
  rec("GG3 POST /sales-contracts 缺 customer_id", { body: {} }, r);
  if (r.code === 0 && r.data?.id) junk.push(["sales-contracts", r.data.id]);

  r = await call("POST", "/api/v1/sales-quotations", {});
  rec("GG4 POST /sales-quotations 缺 customer_id", { body: {} }, r);
  if (r.code === 0 && r.data?.id) junk.push(["sales-quotations", r.data.id]);

  r = await call("POST", "/api/v1/purchase-requisitions", { lines: [{ product_id: ZERO, qty: 1 }] });
  rec("GG5 POST /purchase-requisitions 明细商品不存在", { lines: [{ product_id: ZERO, qty: 1 }] }, r);
  if (r.code === 0 && r.data?.id) junk.push(["purchase-requisitions", r.data.id]);

  r = await call("POST", "/api/v1/purchase-requisitions", { lines: [{ product_id: prod?.id }] });
  rec("GG6 POST /purchase-requisitions 明细缺 qty", { lines: [{ product_id: prod?.id }] }, r);
  if (r.code === 0 && r.data?.id) junk.push(["purchase-requisitions", r.data.id]);

  // ═══ 二、询价报价（document_actions.go） ═══
  if (rfq) {
    r = await call("POST", `/api/v1/purchase-rfqs/${rfq.id}/convert`, { quote_id: ZERO });
    rec("GG7 POST /purchase-rfqs/{id}/convert 报价不存在", { quote_id: ZERO }, r);

    r = await call("POST", `/api/v1/purchase-rfqs/${rfq.id}/quotes`, {
      supplier_id: cust?.id, lines: [{ product_id: ZERO, qty: 1, price: 1 }],
    });
    rec("GG8 POST /purchase-rfqs/{id}/quotes 明细商品不存在", { lines: [{ product_id: ZERO }] }, r);

    r = await call("POST", `/api/v1/purchase-rfqs/${rfq.id}/quotes/${ZERO}/select`, {});
    rec("GG9 POST /quotes/{quoteId}/select 报价不存在", { quoteId: ZERO }, r);

    r = await call("DELETE", `/api/v1/purchase-rfqs/${rfq.id}/quotes/${ZERO}`, undefined);
    rec("GG10 DELETE /quotes/{quoteId} 报价不存在", { quoteId: ZERO }, r);
  } else {
    console.log("（无询价单，GG7-GG10 跳过）");
  }

  // ═══ 三、SPU 批量生成 SKU（spu_actions.go） ═══
  if (spu) {
    r = await call("POST", `/api/v1/spus/${spu.id}/skus`, {});
    rec("GG11a POST /spus/{id}/skus 首次生成", { spu: spu.id }, r);
    const made = r?.data?.products || [];
    for (const p of made) junk.push(["products", p.id]);
    r = await call("POST", `/api/v1/spus/${spu.id}/skus`, {});
    rec("GG11b POST /spus/{id}/skus 重复编码", { spu: spu.id }, r);
  } else {
    console.log("（无商品款，GG11 跳过）");
  }

  // 补充：报价单「有明细但缺客户」与「缺明细」的先后顺序
  r = await call("POST", "/api/v1/sales-quotations", {
    lines: [{ product_id: prod?.id, qty: 1, price: 1 }],
  });
  rec("GG4b POST /sales-quotations 有明细缺客户", { lines: 1 }, r);
  if (r.code === 0 && r.data?.id) junk.push(["sales-quotations", r.data.id]);
  r = await call("POST", "/api/v1/sales-quotations", { customer_id: cust?.id, lines: [] });
  rec("GG4c POST /sales-quotations 空明细", { lines: 0 }, r);
  if (r.code === 0 && r.data?.id) junk.push(["sales-quotations", r.data.id]);
  r = await call("POST", "/api/v1/purchase-requisitions", { lines: [{ product_id: prod?.id, qty: 0 }] });
  rec("GG6b POST /purchase-requisitions 明细 qty=0", { qty: 0 }, r);
  if (r.code === 0 && r.data?.id) junk.push(["purchase-requisitions", r.data.id]);
  r = await call("POST", "/api/v1/sales-contracts", { customer_id: cust?.id, lines: [{ product_id: ZERO, qty: 1 }] });
  rec("GG5b POST /sales-contracts 明细商品不存在", { product_id: ZERO }, r);
  if (r.code === 0 && r.data?.id) junk.push(["sales-contracts", r.data.id]);

  // ═══ 四、元数据 / 动态实体（metadata.go） ═══
  r = await call("GET", "/api/v1/metadata/entities/code/GG-NOT-EXIST", undefined);
  rec("GG12 GET /metadata/entities/code/{code} 实体不存在", { code: "GG-NOT-EXIST" }, r);
  r = await call("GET", "/api/v1/dynamic/GG-NOT-EXIST", undefined);
  rec("GG13 GET /dynamic/{entityCode} 实体不存在", { entityCode: "GG-NOT-EXIST" }, r);
  r = await call("GET", `/api/v1/dynamic/GG-NOT-EXIST/${ZERO}`, undefined);
  rec("GG14 GET /dynamic/{entityCode}/{id} 实体不存在", { entityCode: "GG-NOT-EXIST" }, r);

  // ═══ 五、导入导出（exportimport.go） ═══
  r = await call("GET", "/api/v1/export/meta", undefined);
  rec("GG15 GET /export/meta 缺 entity", {}, r);
  r = await call("GET", "/api/v1/export/meta?entity=GG-NOT-EXIST", undefined);
  rec("GG16 GET /export/meta?entity=不存在", { entity: "GG-NOT-EXIST" }, r);
  r = await call("GET", "/api/v1/export/meta-template", undefined);
  rec("GG17 GET /export/meta-template 缺 entity", {}, r);
  r = await call("POST", "/api/v1/import/meta", upload("x.csv", csvOf(["编码"], [["A1"]]), { dry_run: "true" }));
  rec("GG18 POST /import/meta 缺 entity", { entity: "" }, r);

  // 导入：必填列缺失
  r = await call("POST", "/api/v1/import/customers",
    upload("customers.csv", csvOf(templates.customers, [rowFor("customers", { 联系人: "x", 电话: "1" })]), { dry_run: "true" }));
  rec("GG19 POST /import/customers 编码与名称同时为空", { row: "编码/名称留空" }, r);

  r = await call("POST", "/api/v1/import/users",
    upload("users.csv", csvOf(templates.users, [rowFor("users", { 姓名: "GG测试" })]), { dry_run: "true" }));
  rec("GG20 POST /import/users 用户名不能为空", { row: "用户名留空" }, r);

  r = await call("POST", "/api/v1/import/opening-stock",
    upload("opening-stock.csv", csvOf(templates["opening-stock"], [rowFor("opening-stock", { 数量: "1" })]), { dry_run: "true" }));
  rec("GG21 POST /import/opening-stock 商品编码为空", { row: "商品编码留空" }, r);

  r = await call("POST", "/api/v1/import/opening-stock",
    upload("opening-stock.csv", csvOf(templates["opening-stock"], [rowFor("opening-stock", { 商品编码: prod?.code, 数量: "1" })]), { dry_run: "true" }));
  rec("GG22 POST /import/opening-stock 仓库编码为空", { row: "仓库编码留空" }, r);

  r = await call("POST", "/api/v1/import/skus",
    upload("skus.csv", csvOf(templates.skus, [rowFor("skus", { 款号: spu?.code ?? "", 颜色: "红" })]), { dry_run: "true" }));
  rec("GG23 POST /import/skus SKU编码为空", { row: "SKU编码留空" }, r);

  // 导入：参照不存在 / 类型错误 / 文件损坏
  r = await call("POST", "/api/v1/import/products",
    upload("products.csv", csvOf(templates.products, [rowFor("products", { 编码: "GG-REF-1", 名称: "GG参照测试", 分类名称: "GG不存在的分类" })]), { dry_run: "true" }));
  rec("GG24 POST /import/products 分类名称参照不存在", { 分类名称: "GG不存在的分类" }, r);

  r = await call("POST", "/api/v1/import/customers",
    upload("customers.csv", csvOf(templates.customers, [rowFor("customers", { 编码: "GG-INT", 名称: "GG整数测试", "账期(天)": "abc" })]), { dry_run: "true" }));
  rec("GG25 POST /import/customers 账期(天)非整数", { "账期(天)": "abc" }, r);

  r = await call("POST", "/api/v1/import/customers",
    upload("customers.csv", csvOf(templates.customers, [rowFor("customers", { 编码: "GG-NUM", 名称: "GG数字测试", 信用额度: "abc" })]), { dry_run: "true" }));
  rec("GG26 POST /import/customers 信用额度非数字", { 信用额度: "abc" }, r);

  r = await call("POST", "/api/v1/import/customers",
    upload("bad.csv", Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05]).toString("binary"), { dry_run: "true" }));
  rec("GG27 POST /import/customers 损坏的 CSV", { file: "二进制垃圾.csv" }, r);

  r = await call("POST", "/api/v1/import/customers",
    upload("bad.xlsx", "not-an-excel-file", { dry_run: "true" }));
  rec("GG28 POST /import/customers 损坏的 XLSX", { file: "文本伪装.xlsx" }, r);

  // 动态实体无字段
  const created = await call("POST", "/api/v1/metadata/entities", { code: "GG-EMPTY", name: "GG空实体" });
  console.log(`建空实体: code=${created.code} ${created.message ?? ""}`);
  r = await call("POST", "/api/v1/import/meta?entity=GG-EMPTY",
    upload("meta.csv", csvOf(["编码"], [["A1"]]), { dry_run: "true" }));
  rec("GG29 POST /import/meta 实体没有可用字段", { entity: "GG-EMPTY" }, r);
  r = await call("GET", "/api/v1/export/meta?entity=GG-EMPTY", undefined);
  rec("GG30 GET /export/meta 实体没有可用字段", { entity: "GG-EMPTY" }, r);

  // 清理：删除误建的单据与测试实体
  for (const [route, id] of junk) {
    const d = await call("DELETE", `/api/v1/${route}/${id}`, undefined);
    console.log(`清理 DELETE /${route}/${id} → code=${d.code} ${d.message ?? ""}`);
  }
  if (created?.data?.id) {
    const d = await call("DELETE", `/api/v1/metadata/entities/${created.data.id}`, undefined);
    console.log(`清理 实体 GG-EMPTY → code=${d.code} ${d.message ?? ""}`);
  }

  writeFileSync(
    "C:/Users/35371/Desktop/11111/la-erp-recovered/evidence/backend-runtime/audit-batch-gg-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), source: "原版回放 192.168.110.97:18886", templates, records: log }, null, 2),
  );
  console.log("\n已写入 evidence/backend-runtime/audit-batch-gg-20261014.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
