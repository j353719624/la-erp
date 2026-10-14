#!/usr/bin/env node
// 批次 C 补充取证：确认原版接受后「到底落库了什么」
// CC1 盘点单编辑改仓库是否真的改表头 warehouse_id
// CC3 工艺编辑改 code 是否真的改 code
// CC7 科目树成环（parent 指向自己）落库后 tree 是否死循环
// CC8 BOM qty=0/-1/scrap<0 落库值与工单展开结果
// CC9 同产品多张 active BOM 时 MRP 取哪一张
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WH = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
const log = [];
let TOKEN = "";
async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  try { return { status: r.status, ...(await r.json()) }; } catch { return { status: r.status }; }
}
function rec(step, resp, extra) {
  log.push({ step, code: resp?.code, message: resp?.message ?? "", status: resp?.status, ...(extra ? { detail: extra } : {}) });
  console.log(`  [${step}] http=${resp?.status} code=${resp?.code} ${String(resp?.message ?? "").slice(0, 100)}` + (extra ? ` ${JSON.stringify(extra).slice(0, 280)}` : ""));
  return resp?.data;
}
async function findPlainProduct() {
  const list = (await call("GET", "/api/v1/products?page_size=200"))?.data?.list || [];
  for (const p of list) {
    if (p.is_serial !== true && p.is_batch !== true && p.is_combo !== true) return p;
  }
  throw new Error("没有普通商品");
}

let PROD;
async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  PROD = await findPlainProduct();
  const CUST = ((await call("GET", "/api/v1/customers?page_size=5"))?.data?.list || [])[0];
  console.log("前置:", PROD.name, "\n");

  // ---------- CC1b 盘点单改仓库落库 ----------
  console.log("\n=== CC1b 盘点单改仓库落库 ===");
  {
    const whs = (await call("GET", "/api/v1/warehouses?page_size=50"))?.data?.list || [];
    const other = whs.find((w) => w.id !== WH);
    const chk = rec("建盘点单", await call("POST", "/api/v1/inventory-checks", {
      warehouse_id: WH, lines: [{ product_id: PROD.id }], remark: "BATCHC2-CC1",
    }));
    rec("改前 warehouse_id", undefined, { warehouse_id: chk?.warehouse_id, target: other?.id });
    const put = rec("编辑改仓库", await call("PUT", `/api/v1/inventory-checks/${chk?.id}`, {
      warehouse_id: other?.id, lines: [{ product_id: PROD.id }],
    }));
    const got = await call("GET", `/api/v1/inventory-checks/${chk?.id}`);
    rec("改后 warehouse_id", undefined, { warehouse_id: got?.data?.warehouse_id });
    rec("start", await call("POST", `/api/v1/inventory-checks/${chk?.id}/start`, {}));
    const st = await call("GET", `/api/v1/inventory-checks/${chk?.id}`);
    rec("start 后 book_qty", undefined, {
      lines: JSON.stringify((st?.data?.edges?.lines || []).map((l) => ({ qty: l.book_qty, actual: l.actual_qty, diff: l.diff_qty }))),
    });
    rec("complete", await call("POST", `/api/v1/inventory-checks/${chk?.id}/complete`, {}));
    void put;
  }

  // ---------- CC3b 工艺改 code 落库 ----------
  console.log("\n=== CC3b 工艺改 code 落库 ===");
  {
    const rt = rec("建工艺", await call("POST", "/api/v1/routings", {
      code: "BATCHC2-RT", name: "BATCHC2 工艺", product_id: PROD.id,
      steps: [{ sequence: 1, process_code: "P1", process_name: "工序1" }],
    }));
    rec("改前 code", undefined, { code: rt?.code });
    rec("编辑改 code", await call("PUT", `/api/v1/routings/${rt?.id}`, {
      code: "BATCHC2-RT-NEW", name: "BATCHC2 工艺", product_id: PROD.id,
      steps: [{ sequence: 1, process_code: "P1", process_name: "工序1" }],
    }));
    const got = await call("GET", `/api/v1/routings/${rt?.id}`);
    rec("改后 code", undefined, { code: got?.data?.code });
    rec("编辑改 product_id", await call("PUT", `/api/v1/routings/${rt?.id}`, {
      code: "BATCHC2-RT-NEW", name: "BATCHC2 工艺",
      product_id: ((await call("GET", "/api/v1/products?page_size=50"))?.data?.list || [])[1].id,
      steps: [{ sequence: 1, process_code: "P1", process_name: "工序1" }],
    }));
    const got2 = await call("GET", `/api/v1/routings/${rt?.id}`);
    rec("改后 product_id", undefined, { product_id: got2?.data?.product_id });
  }

  // ---------- CC7b 科目树成环 ----------
  console.log("\n=== CC7b 科目 parent 指向自身 ===");
  {
    const self = rec("建科目", await call("POST", "/api/v1/accounts", {
      code: "BATCHC2-SELF", name: "BATCHC2 自环", direction: "debit", category: "asset",
    }));
    rec("父=自己", await call("PUT", `/api/v1/accounts/${self?.id}`, { parent_id: self?.id }));
    const got = await call("GET", `/api/v1/accounts/${self?.id}`);
    rec("回读 parent_id", undefined, { parent_id: got?.data?.parent_id, self: self?.id });
    const tree = await call("GET", "/api/v1/accounts/tree");
    const flat = JSON.stringify(tree?.data || []).slice(0, 300);
    rec("科目树是否死循环", tree, { flat, len: JSON.stringify(tree?.data || "").length });
    // 造一个 A->B->A 的环
    const a = rec("建 A", await call("POST", "/api/v1/accounts", { code: "BATCHC2-A", name: "BATCHC2 A", direction: "debit", category: "asset" }));
    const b = rec("建 B", await call("POST", "/api/v1/accounts", { code: "BATCHC2-B", name: "BATCHC2 B", direction: "debit", category: "asset", parent_id: a?.id }));
    rec("A 的父改成 B", await call("PUT", `/api/v1/accounts/${a?.id}`, { parent_id: b?.id }));
    const tree2 = await call("GET", "/api/v1/accounts/tree");
    rec("成环后科目树", tree2, { len: JSON.stringify(tree2?.data || "").length });
    rec("清理 A 的父", await call("PUT", `/api/v1/accounts/${a?.id}`, { parent_id: "00000000-0000-0000-0000-000000000000" }));
  }

  // ---------- CC8b BOM 负数落库与展开 ----------
  console.log("\n=== CC8b BOM qty/scrap 落库与工单展开 ===");
  {
    const bom0 = rec("qty=0 BOM", await call("POST", "/api/v1/boms", {
      name: "BATCHC2 BOM0", product_id: PROD.id, items: [{ product_id: PROD.id, qty_per: 0 }],
    }));
    rec("回读 items", undefined, { items: JSON.stringify(bom0?.edges?.items || bom0?.items || []).slice(0, 200) });
    const bomN = rec("qty=-1 BOM", await call("POST", "/api/v1/boms", {
      name: "BATCHC2 BOMN", product_id: PROD.id, items: [{ product_id: PROD.id, qty_per: -1 }],
    }));
    rec("回读 items", undefined, { items: JSON.stringify(bomN?.edges?.items || bomN?.items || []).slice(0, 200) });
    const bomS = rec("scrap=-0.1 BOM", await call("POST", "/api/v1/boms", {
      name: "BATCHC2 BOMS", product_id: PROD.id, items: [{ product_id: PROD.id, qty_per: 4, scrap_rate: -0.1 }],
    }));
    rec("回读 items", undefined, { items: JSON.stringify(bomS?.edges?.items || bomS?.items || []).slice(0, 200) });
    const wo = rec("按 scrap<0 BOM 建工单", await call("POST", "/api/v1/work-orders", {
      product_id: PROD.id, qty: 10, warehouse_id: WH, bom_id: bomS?.id, remark: "BATCHC2-CC8",
    }));
    const mats = await call("GET", `/api/v1/work-orders/${wo?.id}/materials`);
    rec("工单材料（需求量=10×4×0.9=36）", mats, { json: JSON.stringify(mats?.data || mats).slice(0, 260) });
  }

  // ---------- CC9b 多张 active BOM 取哪张 ----------
  console.log("\n=== CC9b 同产品多张 active BOM ===");
  {
    const p2 = ((await call("GET", "/api/v1/products?page_size=50"))?.data?.list || [])
      .find((p) => p.id !== PROD.id && p.is_serial !== true && p.is_batch !== true);
    const first = rec("第一张 BOM(qty_per=2)", await call("POST", "/api/v1/boms", {
      name: "BATCHC2 P2 BOM-A", product_id: p2.id, items: [{ product_id: p2.id, qty_per: 2 }],
    }));
    const second = rec("第二张 BOM(qty_per=9)", await call("POST", "/api/v1/boms", {
      name: "BATCHC2 P2 BOM-B", product_id: p2.id, items: [{ product_id: p2.id, qty_per: 9 }],
    }));
    rec("两张 BOM", undefined, { first: first?.id, second: second?.id });
    // 不显式指定 bom_id，看工单选哪张
    const wo = rec("不指定 bom_id 建工单 qty=3", await call("POST", "/api/v1/work-orders", {
      product_id: p2.id, qty: 3, warehouse_id: WH, remark: "BATCHC2-CC9",
    }));
    rec("工单选中的 bom_id", undefined, {
      bom_id: wo?.bom_id, isFirst: wo?.bom_id === first?.id, isSecond: wo?.bom_id === second?.id,
    });
    const mats = await call("GET", `/api/v1/work-orders/${wo?.id}/materials`);
    rec("工单材料需求(6=3×2 / 27=3×9)", mats, { json: JSON.stringify(mats?.data || mats).slice(0, 260) });
    // 停用第一张后再建
    rec("停用第一张", await call("PUT", `/api/v1/boms/${first?.id}`, { status: "inactive" }));
    const wo2 = rec("停用后建工单", await call("POST", "/api/v1/work-orders", {
      product_id: p2.id, qty: 3, warehouse_id: WH, remark: "BATCHC2-CC9B",
    }));
    rec("工单选中的 bom_id", undefined, { bom_id: wo2?.bom_id, isSecond: wo2?.bom_id === second?.id });
  }

  writeFileSync("evidence/backend-runtime/audit-batch-c2-20261014.json",
    JSON.stringify({ generated: new Date().toISOString(), base: BASE, purpose: "批次C补证：原版接受后落库什么", records: log }, null, 2));
  console.log("\n证据已写入 evidence/backend-runtime/audit-batch-c2-20261014.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
