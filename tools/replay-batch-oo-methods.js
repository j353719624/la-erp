#!/usr/bin/env node
// 批次 OO 取证 · 第一段（2026-10-15）：复验对账报告里「原版=absent」的 22 条路径。
//
// ## 为什么需要这一段
// 对账脚本 audit-route-coverage.mjs 只用「探针方法」打一次：集合路由用 GET/POST，
// 单资源用 GET/PUT/DELETE。若原版把某个入口实现为 POST-only，而探针只打了 GET/PUT，
// Gin 会回 404「路由不存在」，脚本就把它记成 absent —— 这是**探测噪声**，不是缺口。
// 本脚本对每条路径打满 GET/POST/PUT/DELETE/PATCH，把「真不存在」与「方法不对」分开。
//
// ## 判定口径（无 token 探测）
//   原版     401「未提供认证令牌」→ 存在；404「路由不存在」→ 不存在；其它 → 记形态
//   恢复端   401 → 存在；501「该业务接口尚未实现」→ 不存在；其它 → 记形态
// 注意：少数原版入口不鉴权（license/*、portal/*），会直接回 200，也视为存在。
//
// 用法：node tools/replay-batch-oo-methods.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const ACTUAL = process.env.OO_ACTUAL ?? "http://127.0.0.1:18899";
const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

const PATHS = [
  "/api/v1/approval-records",
  "/api/v1/approval-records/approve",
  "/api/v1/approval-records/reject",
  "/api/v1/approval-records/submit",
  "/api/v1/crm-activities/pending",
  "/api/v1/employee-changes",
  "/api/v1/expense-claims/00000000-0000-0000-0000-000000000000",
  "/api/v1/expense-claims/00000000-0000-0000-0000-000000000001",
  "/api/v1/fixed-assets/00000000-0000-0000-0000-000000000001",
  "/api/v1/fixed-assets/depreciation-entries",
  "/api/v1/fixed-assets/run-depreciation",
  "/api/v1/leads/00000000-0000-0000-0000-000000000001",
  "/api/v1/notifications/read-all",
  "/api/v1/payrolls/00000000-0000-0000-0000-000000000001",
  "/api/v1/sales-commissions/settlements/generate",
  "/api/v1/tax-accruals/pay",
  "/api/v1/tax-accruals/payables",
  "/api/v1/tax-accruals/preview",
  "/api/v1/tax-accruals/summary",
  "/api/v1/tax-accruals/vat-balance",
  "/api/v1/work-order-processes/bulk-report",
];

async function probe(base, method, path) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, msg: json?.message ?? json?.error ?? "", code: json?.code };
}

// 无 token 下把响应归成「存在性」三态
function exists(base, r) {
  if (base === ORIG) {
    if (r.http === 401) return "EXISTS";
    if (r.http === 404 && String(r.msg).includes("路由不存在")) return "ABSENT";
    return `OTHER(${r.http}/${r.code})`;
  }
  if (r.http === 401) return "EXISTS";
  if (r.http === 501) return "ABSENT";
  return `OTHER(${r.http}/${r.code})`;
}

const rows = [];
for (const p of PATHS) {
  for (const m of METHODS) {
    const o = await probe(ORIG, m, p);
    const r = await probe(ACTUAL, m, p);
    rows.push({
      path: p, method: m,
      orig: { http: o.http, code: o.code, msg: o.message, exists: exists(ORIG, o) },
      rec: { http: r.http, code: r.code, msg: r.msg, exists: exists(ACTUAL, r) },
    });
    process.stdout.write(".");
  }
}
console.log("");

const out = [];
const eq = (a, b) => a === b;
for (const p of PATHS) {
  const rs = rows.filter((x) => x.path === p);
  const oMethods = rs.filter((x) => x.orig.exists === "EXISTS").map((x) => x.method);
  const rMethods = rs.filter((x) => x.rec.exists === "EXISTS").map((x) => x.method);
  const same = oMethods.join(",") === rMethods.join(",");
  out.push(`\n${same ? "==" : "!="} ${p}`);
  out.push(`    原版存在的方法: ${oMethods.join(",") || "（无）"}`);
  out.push(`    恢复端存在的方法: ${rMethods.join(",") || "（无）"}`);
  if (!same) {
    for (const x of rs) {
      out.push(`      ${x.method}: 原版=${x.orig.exists}/${x.orig.http}/${x.orig.code} "${x.orig.message}" 恢复端=${x.rec.exists}/${x.rec.http}/${x.rec.code} "${x.rec.message}"`);
    }
  }
}
const text =
  `批次 OO 第一段：多方法存在性复验（无 token）\n` +
  `原版=${ORIG} 恢复端=${ACTUAL} 共 ${PATHS.length} 路径 × ${METHODS.length} 方法\n` +
  out.join("\n") + "\n";
console.log(text);
writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-methods-20261015.txt",
  text,
);
writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-oo-methods-20261015.json",
  JSON.stringify(rows, null, 2),
);
