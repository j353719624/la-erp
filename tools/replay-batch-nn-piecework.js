#!/usr/bin/env node
// 批次 NN 取证（2026-10-15）：`piecework-rates` / `piecework-records` /
// `print-templates` 三类资源的**写路径与 notFound 形态**两端对照。
//
// ## 背景
// fix-bank-adj 留档称这三类「写路径有缺口」，但未附对照证据。批次 KK 已给
// piecework-rates / piecework-records 配了 notFound 文案（gapKK_writes.go 的
// writeNotFoundBusiness），print_templates.go 也有完整 CRUD 实现 —— 留档可能已过时。
// 本脚本用实际探测核一次，避免按陈旧留档改坏已对齐的代码。
//
// ## 取证规范（沿用批次 MM/NN 铁律）
//   ① 两端都登录（原版带 company=default）
//   ② 500 一律不作为语义证据（单独标记）
//   ③ 每条记录 http / code / message / data 顶层键集合
//   ④ 会写库的操作用互不相同的载荷，并在运行前落盘两端清单
//
// 用法：ERP_PASSWORD=xxx [NN_RECOVERED=url] node tools/replay-batch-nn-piecework.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.NN_RECOVERED ?? "http://127.0.0.1:18899";
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
const origToken = await token(ORIG, true);
const recToken = await token(RECOVERED, false);
if (!origToken || !recToken) { console.error("两端登录失败"); process.exit(1); }

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json };
}
function shape(r) {
  const d = r.json?.data;
  return {
    http: r.http,
    code: r.json?.code,
    message: r.json?.message,
    dataKeys: d && typeof d === "object" && !Array.isArray(d) ? Object.keys(d).sort()
      : Array.isArray(d) ? ["__array", `len=${d.length}`] : `${typeof d}`,
  };
}

const NOPE = "00000000-0000-0000-0000-000000000099";
const RESOURCES = ["piecework-rates", "piecework-records", "print-templates"];

// 运行前清单
const before = {};
for (const res of RESOURCES) {
  before[res] = {
    orig: (await call(ORIG, origToken, "GET", `/api/v1/${res}?page=1&page_size=500`)).json?.data?.total ?? null,
    recovered: (await call(RECOVERED, recToken, "GET", `/api/v1/${res}?page=1&page_size=500`)).json?.data?.total ?? null,
  };
}
console.log("运行前 total:", JSON.stringify(before));

// 完整载荷（按前端类型定义构造）
const FULL = {
  "piecework-rates": { process_id: NOPE, employee_id: NOPE, product_id: NOPE, unit_price: 1, remark: "nn" },
  "piecework-records": { employee_id: NOPE, process_id: NOPE, product_id: NOPE, qty: 1, amount: 1, record_date: "2030-01-01T00:00:00+08:00", remark: "nn" },
  "print-templates": { doc_type: "sale_order", name: "NN 模板", paper_size: "A4", is_default: false },
};

const cases = [];
for (const res of RESOURCES) {
  cases.push({ res, name: `GET 列表`, method: "GET", path: `/api/v1/${res}?page=1&page_size=5` });
  cases.push({ res, name: `GET 不存在 id`, method: "GET", path: `/api/v1/${res}/${NOPE}` });
  cases.push({ res, name: `POST 空载荷`, method: "POST", path: `/api/v1/${res}`, body: {} });
  cases.push({ res, name: `POST 完整载荷`, method: "POST", path: `/api/v1/${res}`, body: FULL[res] });
  cases.push({ res, name: `PUT 不存在 id（空载荷）`, method: "PUT", path: `/api/v1/${res}/${NOPE}`, body: {} });
  cases.push({ res, name: `PUT 不存在 id（完整）`, method: "PUT", path: `/api/v1/${res}/${NOPE}`, body: FULL[res] });
  cases.push({ res, name: `DELETE 不存在 id`, method: "DELETE", path: `/api/v1/${res}/${NOPE}` });
}
// 特有子端点
cases.push({ res: "print-templates", name: "POST duplicate 不存在 id", method: "POST", path: `/api/v1/print-templates/${NOPE}/duplicate` });
cases.push({ res: "print-templates", name: "GET by-type 不存在类型", method: "GET", path: `/api/v1/print-templates/by-type/zzz-none` });
cases.push({ res: "piecework-records", name: "GET summary", method: "GET", path: `/api/v1/piecework-records/summary?period=2030-01` });
cases.push({ res: "piecework-records", name: "GET importable-processes", method: "GET", path: `/api/v1/piecework-records/importable-processes?period=2030-01` });
cases.push({ res: "piecework-records", name: "POST import-processes 空数组", method: "POST", path: `/api/v1/piecework-records/import-processes`, body: { process_ids: [] } });
cases.push({ res: "piecework-records", name: "POST import-processes 缺参数", method: "POST", path: `/api/v1/piecework-records/import-processes`, body: {} });

const records = [];
for (const c of cases) {
  const o = shape(await call(ORIG, origToken, c.method, c.path, c.body));
  const r = shape(await call(RECOVERED, recToken, c.method, c.path, c.body));
  const same = o.http === r.http && o.code === r.code && o.message === r.message;
  records.push({
    resource: c.res, case: c.name, method: c.method, path: c.path,
    orig: o, recovered: r, same,
    origIs500: o.http === 500, recIs500: r.http === 500,
  });
  console.log(`\n[${c.res} · ${c.name}] ${same ? "一致" : "★差异"}`);
  console.log(`  原版  http=${o.http} code=${o.code} msg=${JSON.stringify(o.message)}`);
  console.log(`  恢复端 http=${r.http} code=${r.code} msg=${JSON.stringify(r.message)}`);
}

const same = records.filter((x) => x.same).length;
writeFileSync("evidence/backend-runtime/audit-batch-nn-piecework-20261015.json", JSON.stringify({
  generated: new Date().toISOString(),
  purpose: "批次 NN：piecework-rates / piecework-records / print-templates 写路径与 notFound 形态对照",
  base: { orig: ORIG, recovered: RECOVERED },
  before,
  cases: records,
  summary: { total: records.length, same, differ: records.length - same },
}, null, 2));
console.log(`\n=== 汇总 ${same}/${records.length} 一致 ===`);
