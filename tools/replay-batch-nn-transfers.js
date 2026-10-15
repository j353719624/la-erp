#!/usr/bin/env node
// 批次 NN 取证（2026-10-15）：调拨单 `stock-transfers` POST 必填校验的两端对照。
//
// ## 为什么要重新取证
// 台账 37.6 留档的直证只有一条：
//   audit-batch-a-20261014.json 第 5 条 → 原版 `400 请求参数错误: Key:
//   'createTransferRequest.ToWarehouseID' … required`
// 这条只覆盖「`from` 有、`to` 缺」的组合，不足以定出完整校验规则：
//   · 空载荷（两个都缺）报的是 `FromWarehouseID` 还是 `ToWarehouseID`？
//   · 只缺 `from` 报什么？
//   · 两个都有但仓库不存在时，是 400 还是业务 10000？
// 这些不定下来就改 `transfers.go`，等于用一条证据去猜四条规则。
//
// ## 取证规范（沿用批次 MM 的四条铁律）
//   ① 运行前落盘两端 `GET /stock-transfers` 清单（记录库状态）
//   ② 各条探测用互不相同的单据号/备注，避免互相干扰
//   ③ 500 一律不作为语义证据
//   ④ 每条探测记录两端的 http / code / message / data 顶层键集合
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-nn-transfers.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.NN_RECOVERED ?? "http://127.0.0.1:18899";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

async function token(base, withCompany) {
  const payload = { username: "admin", password: PASS };
  if (withCompany) payload.company = "default";
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await r.json())?.data?.access_token ?? "";
}
const origToken = await token(ORIG, true);
const recToken = await token(RECOVERED, false);
if (!origToken || !recToken) { console.error("两端登录失败"); process.exit(1); }

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

// 只取「形态」：http + code + message（抹掉 id/uuid 等易变值）
function shape(r) {
  const d = r.json?.data;
  return {
    http: r.http,
    code: r.json?.code,
    message: r.json?.message,
    dataKeys: d && typeof d === "object" && !Array.isArray(d)
      ? Object.keys(d).sort()
      : Array.isArray(d) ? ["__array", `len=${d.length}`] : typeof d,
  };
}

// 取两端各自的第一个真实仓库 id
async function firstWarehouse(base, tk) {
  const r = await call(base, tk, "GET", "/api/v1/warehouses?page=1&page_size=50");
  const list = r.json?.data?.list ?? r.json?.data?.items ?? [];
  return list[0]?.id ?? "";
}
const [origWh, recWh] = [await firstWarehouse(ORIG, origToken), await firstWarehouse(RECOVERED, recToken)];
console.log(`仓库 id：原版=${origWh || "(空)"} 恢复端=${recWh || "(空)"}`);

// 运行前库状态
const beforeOrig = await call(ORIG, origToken, "GET", "/api/v1/stock-transfers?page=1&page_size=500");
const beforeRec = await call(RECOVERED, recToken, "GET", "/api/v1/stock-transfers?page=1&page_size=500");
const before = {
  orig: { http: beforeOrig.http, total: beforeOrig.json?.data?.total ?? null },
  recovered: { http: beforeRec.http, total: beforeRec.json?.data?.total ?? null },
};

// 探测组：两个仓库 id 各自用本端的真实值，保证「仓库存在」这一维度两端一致
const cases = [
  { name: "空载荷 {}", build: (w) => ({}) },
  { name: "只有 from", build: (w) => ({ from_warehouse_id: w }) },
  { name: "只有 to", build: (w) => ({ to_warehouse_id: w }) },
  { name: "from+to 都是真实仓库", build: (w) => ({ from_warehouse_id: w, to_warehouse_id: w }) },
  {
    name: "from+to 都是不存在的 uuid",
    build: () => ({
      from_warehouse_id: "00000000-0000-0000-0000-000000000001",
      to_warehouse_id: "00000000-0000-0000-0000-000000000002",
    }),
  },
  {
    name: "from 真实 + to 不存在",
    build: (w) => ({ from_warehouse_id: w, to_warehouse_id: "00000000-0000-0000-0000-000000000002" }),
  },
  {
    name: "from 不存在 + to 真实",
    build: (w) => ({ from_warehouse_id: "00000000-0000-0000-0000-000000000001", to_warehouse_id: w }),
  },
];

const records = [];
for (const c of cases) {
  const o = await call(ORIG, origToken, "POST", "/api/v1/stock-transfers", c.build(origWh));
  const r = await call(RECOVERED, recToken, "POST", "/api/v1/stock-transfers", c.build(recWh));
  const so = shape(o), sr = shape(r);
  records.push({
    case: c.name,
    orig: so,
    recovered: sr,
    same: so.http === sr.http && so.code === sr.code && so.message === sr.message,
    // 500 不作为语义证据
    origIs500: so.http === 500,
    recIs500: sr.http === 500,
  });
  console.log(`\n[${c.name}]  ${records.at(-1).same ? "一致" : "★差异"}`);
  console.log(`  原版  http=${so.http} code=${so.code} msg=${JSON.stringify(so.message)}`);
  console.log(`  恢复端 http=${sr.http} code=${sr.code} msg=${JSON.stringify(sr.message)}`);
}

// PUT / DELETE 不存在 id 的形态
const notFoundId = "00000000-0000-0000-0000-000000000099";
const idCases = [
  { name: "GET 不存在 id", method: "GET", path: `/api/v1/stock-transfers/${notFoundId}` },
  { name: "PUT 不存在 id", method: "PUT", path: `/api/v1/stock-transfers/${notFoundId}`, body: {} },
  { name: "DELETE 不存在 id", method: "DELETE", path: `/api/v1/stock-transfers/${notFoundId}` },
  { name: "POST dispatch 不存在 id", method: "POST", path: `/api/v1/stock-transfers/${notFoundId}/dispatch` },
  { name: "POST complete 不存在 id", method: "POST", path: `/api/v1/stock-transfers/${notFoundId}/complete` },
  { name: "POST cancel 不存在 id", method: "POST", path: `/api/v1/stock-transfers/${notFoundId}/cancel` },
];
const idRecords = [];
for (const c of idCases) {
  const o = await call(ORIG, origToken, c.method, c.path, c.body);
  const r = await call(RECOVERED, recToken, c.method, c.path, c.body);
  const so = shape(o), sr = shape(r);
  idRecords.push({
    case: c.name, orig: so, recovered: sr,
    same: so.http === sr.http && so.code === sr.code && so.message === sr.message,
    origIs500: so.http === 500, recIs500: sr.http === 500,
  });
  console.log(`\n[${c.name}]  ${idRecords.at(-1).same ? "一致" : "★差异"}`);
  console.log(`  原版  http=${so.http} code=${so.code} msg=${JSON.stringify(so.message)}`);
  console.log(`  恢复端 http=${sr.http} code=${sr.code} msg=${JSON.stringify(sr.message)}`);
}

const sameCount = [...records, ...idRecords].filter((x) => x.same).length;
const total = records.length + idRecords.length;
const out = {
  generated: new Date().toISOString(),
  purpose: "批次 NN：stock-transfers 写路径与 notFound 形态的两端对照",
  base: { orig: ORIG, recovered: RECOVERED },
  warehouseIds: { orig: origWh, recovered: recWh },
  before,
  cases: records,
  idCases: idRecords,
  summary: { total, same: sameCount, differ: total - sameCount },
};
writeFileSync("evidence/backend-runtime/audit-batch-nn-transfers-20261015.json", JSON.stringify(out, null, 2));
console.log(`\n=== 汇总 ${sameCount}/${total} 一致 ===`);
console.log("落盘 evidence/backend-runtime/audit-batch-nn-transfers-20261015.json");
