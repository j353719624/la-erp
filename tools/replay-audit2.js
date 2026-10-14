#!/usr/bin/env node
// 清单第 7 项补充：等量取价规则的第二个样本（交叉验证）
//
// 首轮样本（audit-returns-tie-20261013.json）：
//   退 4 件 → cost=11（无批次行）；退 3 件 → cost=11（无批次行）
//   但无批次行当时有 4 件，退 3 件后无批次变 11，仍无法区分
//   「无批次优先」还是「成本/数量某种排序」。
//
// 本轮改用逐档递增数量，观察取价成本随数量的变化：
//   退 1 / 2 / 3 / 5 件，每档都查流水 unit_cost。
// 若成本始终为 11 → 无批次行被优先选中；
// 若出现 5 或 19 → 说明随可用行变化，规则不同。
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const TIE = "809d1ff9-da79-44fb-98f1-3053398c5818";
const WAREHOUSE = "5f00c2ca-ee2c-4da5-8346-3d709daa30ad";
const log = [];

let TOKEN = "";
async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  try { return await r.json(); } catch { return null; }
}

async function balances() {
  const j = await call("GET", `/api/v1/inventory-balances?product_id=${TIE}`);
  return (j?.data?.list || []).map((b) => ({
    batch: b.get ? null : (b.batch_no ?? "(无批次)"),
    qty: b.qty_available,
    cost: b.avg_cost ?? b.unit_cost,
  }));
}

async function movements() {
  const j = await call("GET", "/api/v1/stock-movements?page_size=80");
  return (j?.data?.list || [])
    .filter((m) => m.source_type === "sales_return" && m.product_id === TIE)
    .map((m) => ({ no: m.source_no, qty: m.qty, cost: m.unit_cost, after: m.balance_after, at: m.created_at }));
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  console.log("起始余额:", JSON.stringify(await balances()));
  const before = await movements();
  const beforeNos = new Set(before.map((m) => m.no));

  // 逐档递增：1 / 2 / 3 / 5 件
  for (const qty of [1, 2, 3, 5]) {
    const body = {
      remark: `REC-AUDIT2-qty${qty}`,
      warehouse_id: WAREHOUSE,
      lines: [{ product_id: TIE, qty, price: 11 }],
    };
    const c = await call("POST", "/api/v1/sales-returns", body);
    const id = c?.data?.id;
    let approved = null, mv = null;
    if (id) {
      await call("POST", `/api/v1/sales-returns/${id}/confirm`, {});
      const a = await call("POST", `/api/v1/sales-returns/${id}/approve`, {});
      approved = a;
      const all = await movements();
      mv = all.find((m) => !beforeNos.has(m.no));
      if (mv) beforeNos.add(mv.no);
    }
    console.log(`退 ${qty} 件 -> code=${c?.code}` +
      (mv ? ` | 流水 no=${mv.no} cost=${mv.cost} total=${(Number(mv.cost) * Number(mv.qty)).toFixed(2)} after=${mv.after}` : " | 无新流水"));
    log.push({ qty, create: c?.code, approve: approved?.code, movement: mv, balances: await balances() });
  }

  writeFileSync(
    "evidence/backend-runtime/audit-returns-tie-qty-matrix-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "清单第7项 等量取价规则交叉验证", product: "REC-RET-TIE-1013", records: log }, null, 2),
  );
  console.log("\n最终余额:", JSON.stringify(await balances()));
  console.log("证据已写入 evidence/backend-runtime/audit-returns-tie-qty-matrix-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });