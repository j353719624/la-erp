#!/usr/bin/env node
// 清单第 5 项：生产高级修改和退料组合
//   交接文档第 34 行：关联后更换BOM/产品/工艺、非excess退料、同商品多行；
//   明确合法状态、实际响应和联动。
//
// 恢复端对应拒绝分支（workorders.go）：
//   :73   已有 work_order_processes 或提交 routing_id → ErrUnsupported
//   :105  关联后 bom_id/product_id 变更 → ErrUnsupported
//   :145  routing_id 关联；工艺 product_id 不匹配或非 active → ErrUnsupported
import { writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const USER = "admin";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
let TOKEN = "";
async function call(method, path, body) {
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opt);
  try { return { status: r.status, ...(await r.json()) }; } catch { return { status: r.status }; }
}
function rec(step, method, path, body, resp) {
  log.push({ step, method, path, body: body ?? null, code: resp?.code, message: resp?.message ?? "", data: resp?.data ?? null });
  console.log(`  [${step}] code=${resp?.code} ${String(resp?.message ?? "").slice(0, 60)}`);
  return resp?.data;
}

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  TOKEN = (await lr.json())?.data?.access_token || "";

  const prodRaw = (await call("GET", "/api/v1/products?page_size=50"))?.data;
  const prods = prodRaw.list || prodRaw;
  const plain = prods.filter((p) => !p.is_batch);
  const whRaw = (await call("GET", "/api/v1/warehouses"))?.data;
  const wh = (whRaw.list || whRaw)[0];
  console.log(`商品 ${prods.length} 个（非批次 ${plain.length}），仓库 ${wh.name}\n`);

  const bomsRaw = (await call("GET", "/api/v1/boms?page_size=20"))?.data;
  const boms = bomsRaw?.list || bomsRaw || [];
  const routRaw = (await call("GET", "/api/v1/routings?page_size=20"))?.data;
  const routs = routRaw?.list || routRaw || [];
  console.log(`BOM ${boms.length} 个，工艺 ${routs.length} 个\n`);

  // ============ K1：工单关联工艺（routing_id）============
  console.log("=== K1：工单关联工艺 routing_id（恢复端 :73/:145 拒绝）===");
  const p0 = plain[0];
  const k1 = await call("POST", "/api/v1/work-orders", {
    product_id: p0.id, qty: 2, warehouse_id: wh.id,
    routing_id: routs[0]?.id || "", remark: "REC-AUDIT11-routing",
  });
  const k1d = rec("K1-建工单带routing_id", "POST", "/work-orders", null, k1);
  if (k1d?.id) {
    const det = (await call("GET", `/api/v1/work-orders/${k1d.id}`))?.data;
    console.log(`     -> routing_id=${det?.routing_id} status=${det?.status}`);
    rec("K1b-confirm", "POST", `/work-orders/${k1d.id}/confirm`, {}, await call("POST", `/api/v1/work-orders/${k1d.id}/confirm`, {}));
    const d2 = (await call("GET", `/api/v1/work-orders/${k1d.id}`))?.data;
    console.log(`     -> 状态: ${d2?.status}, edges: ${Object.keys(d2?.edges || {}).join(",")}`);
  }

  // ============ K2：关联后更换 BOM / 产品 ============
  console.log("\n=== K2：关联工序后更换 BOM/产品（恢复端 :105 拒绝）===");
  if (k1d?.id) {
    const woId = k1d.id;
    const base = (await call("GET", `/api/v1/work-orders/${woId}`))?.data || {};
    console.log(`  当前: product=${base.product_id?.slice(0,8)} bom=${base.bom_id?.slice(0,8)}`);

    // 换成另一个商品的 BOM
    const otherBom = boms.find((b) => b.product_id !== base.product_id);
    const k2 = await call("PUT", `/api/v1/work-orders/${woId}`, {
      product_id: otherBom?.product_id || base.product_id,
      bom_id: otherBom?.id, qty: 2,
    });
    rec("K2a-换BOM+产品", "PUT", `/work-orders/${woId}`, null, k2);
    const after = (await call("GET", `/api/v1/work-orders/${woId}`))?.data;
    console.log(`     -> 换后: product=${after?.product_id?.slice(0,8)} bom=${after?.bom_id?.slice(0,8)}`);

    // 只换数量
    const k3 = await call("PUT", `/api/v1/work-orders/${woId}`, { qty: 9 });
    rec("K2b-仅改数量", "PUT", `/work-orders/${woId}`, null, k3);
    const after2 = (await call("GET", `/api/v1/work-orders/${woId}`))?.data;
    console.log(`     -> qty=${after2?.qty}`);
  }

  // ============ K3：非 excess 退料 ============
  console.log("\n=== K3：领料后退料（work_order_materials 有 qty_returned）===");
  if (k1d?.id) {
    const det = (await call("GET", `/api/v1/work-orders/${k1d.id}`))?.data || {};
    const mats = det?.edges?.materials || det?.edges?.material_lines || [];
    console.log(`  工单材料行 ${mats.length} 条`);
    if (mats.length) {
      const m = mats[0];
      console.log(`  行: product=${String(m.product_id).slice(0,8)} required=${m.qty_required} issued=${m.qty_issued} returned=${m.qty_returned}`);
      // 先领料
      const iss = await call("POST", `/api/v1/work-orders/${k1d.id}/issue-material`, [
        { product_id: m.product_id, qty: 1 },
      ]);
      rec("K3a-领料1件", "POST", `/work-orders/${k1d.id}/issue-material`, null, iss);
      // 再退料
      const ret = await call("POST", `/api/v1/work-orders/${k1d.id}/return-material`, [
        { product_id: m.product_id, qty: 1 },
      ]);
      rec("K3b-退料1件(全额)", "POST", `/work-orders/${k1d.id}/return-material`, null, ret);
      // 超额退料
      const ret2 = await call("POST", `/api/v1/work-orders/${k1d.id}/return-material`, [
        { product_id: m.product_id, qty: 5 },
      ]);
      rec("K3c-超额退料5件", "POST", `/work-orders/${k1d.id}/return-material`, null, ret2);
      const d3 = (await call("GET", `/api/v1/work-orders/${k1d.id}`))?.data;
      const m3 = (d3?.edges?.materials || [])[0];
      console.log(`     -> 退料后 issued=${m3?.qty_issued} returned=${m3?.qty_returned}`);
    }
  }

  writeFileSync(
    "evidence/backend-runtime/audit-workorder-advanced-20261013.json",
    JSON.stringify({ generated: "2026-10-13", purpose: "清单第5项 生产高级修改和退料组合", records: log }, null, 2),
  );
  console.log("\n证据已写入 evidence/backend-runtime/audit-workorder-advanced-20261013.json");
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });