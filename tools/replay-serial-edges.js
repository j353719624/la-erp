#!/usr/bin/env node
// 第 8 项审计第十二轮：序列号在单据流中的边界
// T1 出库序列号不在台账
// T2 出库序列号已出库
// T3 出库序列号数量与行数量不符
// T4 非序列号商品行带 serial_nos
// T5 序列号商品入库不带 serial_nos
// T6 出库序列号属于其他商品
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
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
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 84)}` + (extra ? `  ${JSON.stringify(extra).slice(0, 200)}` : ""));
  return resp?.data;
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";
  const unit = ((await call("GET", "/api/v1/units?page_size=5"))?.data?.list || [])[0];
  const stamp = Date.now() % 100000;
  const mk = async (tag, extra) => rec(`建商品-${tag}`, await call("POST", "/api/v1/products", { code: `T${stamp}${tag}`, name: `审计商品T-${tag}`, unit_id: unit?.id, sale_price: 100, purchase_price: 60, ...extra }));

  // ---------- T1 出库序列号不在台账 ----------
  console.log("=== T1：出库序列号不在台账 ===");
  {
    const p = await mk("T1", { is_serial: true });
    if (p?.id) {
      const si = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p.id, qty: 2, unit_cost: 50, serial_nos: ["T1-A", "T1-B"] }], remark: "SER-T1" });
      if (si?.data?.id) rec("T1-入库confirm", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, type: "other", lines: [{ product_id: p.id, qty: 1, unit_cost: 100, serial_nos: ["T1-Z"] }], remark: "SER-T1" });
      const outd = rec("T1-出库陌生序列号", out);
      if (outd?.id) rec("T1-出库confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
    }
  }

  // ---------- T2 出库已出库序列号 ----------
  console.log("\n=== T2：重复出库同一序列号 ===");
  {
    const p = await mk("T2", { is_serial: true });
    if (p?.id) {
      const si = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p.id, qty: 2, unit_cost: 50, serial_nos: ["T2-A", "T2-B"] }], remark: "SER-T2" });
      if (si?.data?.id) rec("T2-入库confirm", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));
      const out1 = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, type: "other", lines: [{ product_id: p.id, qty: 1, unit_cost: 100, serial_nos: ["T2-A"] }], remark: "SER-T2A" });
      if (out1?.data?.id) rec("T2-第一次出库confirm", await call("POST", `/api/v1/stock-outs/${out1.data.id}/confirm`, {}));
      const out2 = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, type: "other", lines: [{ product_id: p.id, qty: 1, unit_cost: 100, serial_nos: ["T2-A"] }], remark: "SER-T2B" });
      const outd2 = rec("T2-第二次出库同号", out2);
      if (outd2?.id) rec("T2-第二次confirm", await call("POST", `/api/v1/stock-outs/${outd2.id}/confirm`, {}));
    }
  }

  // ---------- T3 序列号数量与行数量不符 ----------
  console.log("\n=== T3：行数量 2 但只给 1 个序列号 ===");
  {
    const p = await mk("T3", { is_serial: true });
    if (p?.id) {
      const si = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p.id, qty: 2, unit_cost: 50, serial_nos: ["T3-A", "T3-B"] }], remark: "SER-T3" });
      if (si?.data?.id) rec("T3-入库confirm", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, type: "other", lines: [{ product_id: p.id, qty: 2, unit_cost: 100, serial_nos: ["T3-A"] }], remark: "SER-T3" });
      const outd = rec("T3-出库(2件1号)", out);
      if (outd?.id) rec("T3-出库confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
    }
  }

  // ---------- T4 非序列号商品行带 serial_nos ----------
  console.log("\n=== T4：非序列号商品带 serial_nos ===");
  {
    const p = await mk("T4", {});
    if (p?.id) {
      const si = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p.id, qty: 2, unit_cost: 50, serial_nos: ["T4-A", "T4-B"] }], remark: "SER-T4" });
      const d = rec("T4-入库", si);
      if (d?.id) {
        rec("T4-入库confirm", await call("POST", `/api/v1/stock-ins/${d.id}/confirm`, {}));
        const g = await call("GET", `/api/v1/stock-ins/${d.id}`);
        rec("T4-行明细", { code: 0 }, (g?.data?.edges?.lines || g?.data?.lines || []).map((l) => ({ qty: l.qty, serial_nos: l.serial_nos })));
      }
    }
  }

  // ---------- T5 序列号商品入库不带 serial_nos ----------
  console.log("\n=== T5：序列号商品入库不带序列号 ===");
  {
    const p = await mk("T5", { is_serial: true });
    if (p?.id) {
      const si = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p.id, qty: 2, unit_cost: 50 }], remark: "SER-T5" });
      const d = rec("T5-入库", si);
      if (d?.id) rec("T5-入库confirm", await call("POST", `/api/v1/stock-ins/${d.id}/confirm`, {}));
    }
  }

  // ---------- T6 出库序列号属于其他商品 ----------
  console.log("\n=== T6：出库序列号属于其他商品 ===");
  {
    const p1 = await mk("T6A", { is_serial: true });
    const p2 = await mk("T6B", { is_serial: true });
    if (p1?.id && p2?.id) {
      const si = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p1.id, qty: 2, unit_cost: 50, serial_nos: ["T6-A1", "T6-A2"] }], remark: "SER-T6A" });
      if (si?.data?.id) rec("T6-商品A入库confirm", await call("POST", `/api/v1/stock-ins/${si.data.id}/confirm`, {}));
      const si2 = await call("POST", "/api/v1/stock-ins", { warehouse_id: WAREHOUSE, type: "purchase", lines: [{ product_id: p2.id, qty: 2, unit_cost: 50, serial_nos: ["T6-B1", "T6-B2"] }], remark: "SER-T6B" });
      if (si2?.data?.id) rec("T6-商品B入库confirm", await call("POST", `/api/v1/stock-ins/${si2.data.id}/confirm`, {}));
      const out = await call("POST", "/api/v1/stock-outs", { warehouse_id: WAREHOUSE, type: "other", lines: [{ product_id: p2.id, qty: 1, unit_cost: 100, serial_nos: ["T6-A1"] }], remark: "SER-T6" });
      const outd = rec("T6-出库(商品B用商品A的号)", out);
      if (outd?.id) rec("T6-出库confirm", await call("POST", `/api/v1/stock-outs/${outd.id}/confirm`, {}));
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-serial-edges-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "第8项 序列号单据流边界取证", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-serial-edges-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
