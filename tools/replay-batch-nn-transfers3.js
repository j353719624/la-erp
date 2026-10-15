#!/usr/bin/env node
// 批次 NN 第三轮取证（2026-10-15）：`PUT /stock-transfers/{id}` 与 DELETE 的两端对照。
//
// 前两轮只覆盖了 POST。PUT 有四条**与 POST 不同**的语义，必须单独取证：
//   ① 必填校验同样存在，但结构体名换为 `updateTransferRequest`
//   ② 「调出仓与调入仓不能相同」**早于**单据存在性检查
//   ③ lines 缺失/为空 → 清空明细并 code:0（POST 是报「调拨明细不能为空」）
//   ④ 非草稿（含 id 不存在）→ 10000「调拨单不存在或状态不允许修改」
//      （原恢复端的「只有草稿状态的调拨单才能编辑」是自造文案）
// DELETE 的状态守卫文案又是另一句「只有草稿状态的调拨单才能删除」，勿与 ④ 合并。
//
// 用法：ERP_PASSWORD=xxx [NN_RECOVERED=url] node tools/replay-batch-nn-transfers3.js
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
const [origToken, recToken] = [await token(ORIG, true), await token(RECOVERED, false)];

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json };
}
const flat = (r) => ({ http: r.http, code: r.json?.code, message: r.json?.message });
const pick = async (base, tk, path, n = 2) => {
  const r = await call(base, tk, "GET", path);
  const list = r.json?.data?.list ?? [];
  if (list.length >= n) return list.slice(0, n).map((x) => x.id);
  const c = await call(base, tk, "POST", "/api/v1/warehouses", { name: "NN 第二仓", code: "NN-W2" });
  const out = list.map((x) => x.id);
  if (c.json?.data?.id) out.push(c.json.data.id);
  return out;
};

// 每个 base 各自准备：两个不同仓库 + 一个商品 + 一张草稿单
async function prepare(base, tk) {
  const wh = await pick(base, tk, "/api/v1/warehouses?page=1&page_size=50", 2);
  const prd = await pick(base, tk, "/api/v1/products?page=1&page_size=5", 1);
  const line = { product_id: prd[0], qty: 1 };
  const mk = async () => (await call(base, tk, "POST", "/api/v1/stock-transfers", {
    from_warehouse_id: wh[0], to_warehouse_id: wh[1], lines: [line],
  })).json?.data?.id;
  return { wh, prd, line, mk };
}
const O = await prepare(ORIG, origToken);
const R = await prepare(RECOVERED, recToken);
const NOPE = "00000000-0000-0000-0000-000000000099";

const both = (n) => "请求参数错误: Key: '" + n + ".FromWarehouseID' Error:Field validation for 'FromWarehouseID' failed on the 'required' tag\n" +
  "Key: '" + n + ".ToWarehouseID' Error:Field validation for 'ToWarehouseID' failed on the 'required' tag";
const onlyTo = (n) => "请求参数错误: Key: '" + n + ".ToWarehouseID' Error:Field validation for 'ToWarehouseID' failed on the 'required' tag";
const onlyFrom = (n) => "请求参数错误: Key: '" + n + ".FromWarehouseID' Error:Field validation for 'FromWarehouseID' failed on the 'required' tag";

// 每条用例在两端各建一张**新**草稿单，避免前一条改坏后一条的前提。
const cases = [
  { n: "PUT 空载荷", build: (x) => ({ id: null, body: {} }) },
  { n: "PUT 只有 from", build: (x) => ({ id: null, body: { from_warehouse_id: x.wh[0] } }) },
  { n: "PUT 只有 to", build: (x) => ({ id: null, body: { to_warehouse_id: x.wh[1] } }) },
  { n: "PUT 两仓相同", build: (x) => ({ id: null, body: { from_warehouse_id: x.wh[0], to_warehouse_id: x.wh[0], lines: [x.line] } }) },
  { n: "PUT 不存在id+两仓相同", build: (x) => ({ id: NOPE, body: { from_warehouse_id: x.wh[0], to_warehouse_id: x.wh[0], lines: [x.line] } }) },
  { n: "PUT 不存在id+完整载荷", build: (x) => ({ id: NOPE, body: { from_warehouse_id: x.wh[0], to_warehouse_id: x.wh[1], lines: [x.line] } }) },
  { n: "PUT 不存在id+无lines", build: (x) => ({ id: NOPE, body: { from_warehouse_id: x.wh[0], to_warehouse_id: x.wh[1] } }) },
  { n: "PUT lines:[]", build: (x) => ({ id: null, body: { from_warehouse_id: x.wh[0], to_warehouse_id: x.wh[1], lines: [] } }) },
  { n: "PUT 无 lines", build: (x) => ({ id: null, body: { from_warehouse_id: x.wh[0], to_warehouse_id: x.wh[1] } }) },
  { n: "PUT 正常", build: (x) => ({ id: null, body: { from_warehouse_id: x.wh[0], to_warehouse_id: x.wh[1], lines: [x.line] } }) },
];

const records = [];
for (const c of cases) {
  const o = c.build(O), r = c.build(R);
  const oid = o.id ?? (await O.mk()), rid = r.id ?? (await R.mk());
  const ro = flat(await call(ORIG, origToken, "PUT", `/api/v1/stock-transfers/${oid}`, o.body));
  const rr = flat(await call(RECOVERED, recToken, "PUT", `/api/v1/stock-transfers/${rid}`, r.body));
  // ③ 的落库后果：明细确实被清空
  let oLines = null, rLines = null;
  if (ro.code === 0 && rr.code === 0) {
    const od = await call(ORIG, origToken, "GET", `/api/v1/stock-transfers/${oid}`);
    const rd = await call(RECOVERED, recToken, "GET", `/api/v1/stock-transfers/${rid}`);
    oLines = od.json?.data?.edges?.lines?.length ?? 0;
    rLines = rd.json?.data?.edges?.lines?.length ?? 0;
  }
  const same = ro.http === rr.http && ro.code === rr.code && ro.message === rr.message && oLines === rLines;
  records.push({ case: c.n, orig: ro, actual: rr, origLines: oLines, recLines: rLines, same });
  console.log(`\n[${c.n}] ${same ? "一致" : "★差异"}`);
  console.log(`  原版  http=${ro.http} code=${ro.code} msg=${JSON.stringify(ro.message)} lines=${oLines}`);
  console.log(`  恢复端 http=${rr.http} code=${rr.code} msg=${JSON.stringify(rr.message)} lines=${rLines}`);
}

// DELETE 状态守卫
const delRec = [];
{
  const oid = await O.mk(), rid = await R.mk();
  await call(ORIG, origToken, "POST", `/api/v1/stock-transfers/${oid}/cancel`, {});
  await call(RECOVERED, recToken, "POST", `/api/v1/stock-transfers/${rid}/cancel`, {});
  const ro = flat(await call(ORIG, origToken, "DELETE", `/api/v1/stock-transfers/${oid}`));
  const rr = flat(await call(RECOVERED, recToken, "DELETE", `/api/v1/stock-transfers/${rid}`));
  const same = ro.http === rr.http && ro.code === rr.code && ro.message === rr.message;
  delRec.push({ case: "DELETE cancelled", orig: ro, actual: rr, same });
  console.log(`\n[DELETE cancelled] ${same ? "一致" : "★差异"}`);
  console.log(`  原版  http=${ro.http} code=${ro.code} msg=${JSON.stringify(ro.message)}`);
  console.log(`  恢复端 http=${rr.http} code=${rr.code} msg=${JSON.stringify(rr.message)}`);
}
// DELETE 草稿
{
  const oid = await O.mk(), rid = await R.mk();
  const ro = flat(await call(ORIG, origToken, "DELETE", `/api/v1/stock-transfers/${oid}`));
  const rr = flat(await call(RECOVERED, recToken, "DELETE", `/api/v1/stock-transfers/${rid}`));
  const same = ro.http === rr.http && ro.code === rr.code && ro.message === rr.message;
  delRec.push({ case: "DELETE draft", orig: ro, actual: rr, same });
  console.log(`\n[DELETE draft] ${same ? "一致" : "★差异"}`);
  console.log(`  原版  http=${ro.http} code=${ro.code} msg=${JSON.stringify(ro.message)}`);
  console.log(`  恢复端 http=${rr.http} code=${rr.code} msg=${JSON.stringify(rr.message)}`);
}

const all = [...records, ...delRec];
const same = all.filter((x) => x.same).length;
writeFileSync("evidence/backend-runtime/audit-batch-nn-transfers3-20261015.json", JSON.stringify({
  generated: new Date().toISOString(),
  purpose: "批次 NN 第三轮：PUT 与 DELETE 语义的两端对照",
  base: { orig: ORIG, actual: RECOVERED },
  put: records,
  del: delRec,
  expectedMessages: {
    requiredBoth: both("updateTransferRequest"),
    requiredOnlyTo: onlyTo("updateTransferRequest"),
    requiredOnlyFrom: onlyFrom("updateTransferRequest"),
  },
  summary: { total: all.length, same, differ: all.length - same },
}, null, 2));
console.log(`\n=== 汇总 ${same}/${all.length} 一致 ===`);
