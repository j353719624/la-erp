#!/usr/bin/env node
// 批次 NN 第二轮取证（2026-10-15）：计件两张表与打印模板的**完整校验链**两端对照。
//
// 第一轮只跑了「空载荷 / 完整载荷」两个点，不足以定出校验顺序。本轮逐条递增：
//   · piecework-rates：unit_price 解码 → 名称 → 同名 → 单价非负 → 状态
//   · piecework-records：qty 解码 → work_date 解码 → 数量>0 → 作业日期 → 计件项 → 员工
//   · print-templates：DELETE 幂等（已软删再删）、PUT 空载荷、POST 缺任一项
//
// 用法：ERP_PASSWORD=xxx [NN_RECOVERED=url] node tools/replay-batch-nn-piecework2.js
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

// 两端各自用**互不相同**的名字/UUID，避免「同名」这类唯一约束互相干扰；
// 每条用例的载荷按 base 前缀加序号，两端序号独立互不影响。
let seq = 0;
const mkName = (tag) => `${tag}-${Date.now()}-${seq++}`;
const NOPE = "00000000-0000-0000-0000-000000000001";

const records = [];

// ── piecework-rates ──
{
  const cases = [
    { n: "空载荷", b: () => ({}) },
    { n: "unit_price 负、无 name", b: () => ({ unit_price: -1 }) },
    { n: "unit_price 非数字、无 name", b: () => ({ unit_price: "abc" }) },
    { n: "新名 + unit_price 非数字", b: () => ({ name: mkName("NN"), unit_price: "abc" }) },
    { n: "新名 + unit_price 负", b: () => ({ name: mkName("NN"), unit_price: -1 }) },
    { n: "新名 + status 非法", b: () => ({ name: mkName("NN"), unit_price: 1, status: "x" }) },
    { n: "新名 + unit_price 0", b: () => ({ name: mkName("NN"), unit_price: 0 }) },
    { n: "新名（正常建单）", b: () => ({ name: mkName("NN"), unit_price: 1 }) },
    { n: "新名 + status=disabled", b: () => ({ name: mkName("NN"), unit_price: 1, status: "disabled" }) },
  ];
  for (const c of cases) {
    const o = flat(await call(ORIG, origToken, "POST", "/api/v1/piecework-rates", c.b()));
    const r = flat(await call(RECOVERED, recToken, "POST", "/api/v1/piecework-rates", c.b()));
    const same = o.http === r.http && o.code === r.code && o.message === r.message;
    records.push({ res: "piecework-rates", case: c.n, orig: o, recovered: r, same });
    console.log(`[piecework-rates · ${c.n}] ${same ? "一致" : "★差异"}`);
    if (!same) console.log(`  原版 ${o.http}/${o.code} ${JSON.stringify(o.message)}\n  恢复端 ${r.http}/${r.code} ${JSON.stringify(r.message)}`);
  }
  // 同名（各端用自己刚建的同一名字）
  for (const [tag, tk, base] of [["原版", origToken, ORIG], ["恢复端", recToken, RECOVERED]]) {
    const name = mkName("DUP");
    const a = flat(await call(base, tk, "POST", "/api/v1/piecework-rates", { name, unit_price: 1 }));
    const b = flat(await call(base, tk, "POST", "/api/v1/piecework-rates", { name, unit_price: 1 }));
    console.log(`[piecework-rates · 同名(${tag})] 首次=${a.code} 再次=${b.code} ${JSON.stringify(b.message)}`);
  }
  // PUT 同名排除自身 + PUT 空名
  for (const [tag, tk, base] of [["原版", origToken, ORIG], ["恢复端", recToken, RECOVERED]]) {
    const name = mkName("PUT");
    const made = await call(base, tk, "POST", "/api/v1/piecework-rates", { name, unit_price: 1 });
    const id = made.json?.data?.id;
    if (!id) { console.log(`[PUT 同名(${tag})] 建单失败`); continue; }
    const self = flat(await call(base, tk, "PUT", `/api/v1/piecework-rates/${id}`, { name, unit_price: 2 }));
    const empty = flat(await call(base, tk, "PUT", `/api/v1/piecework-rates/${id}`, { unit_price: 2 }));
    console.log(`[piecework-rates · PUT(${tag})] 同名自身=${self.code}/${JSON.stringify(self.message)} 空名=${empty.code}/${JSON.stringify(empty.message)}`);
  }
}

// ── piecework-records ──
{
  const cases = [
    { n: "空载荷", b: () => ({}) },
    { n: "qty=0", b: () => ({ qty: 0 }) },
    { n: "qty=-1", b: () => ({ qty: -1 }) },
    { n: "qty 非数字", b: () => ({ qty: "abc" }) },
    { n: "qty=1（缺日期）", b: () => ({ qty: 1 }) },
    { n: "qty=1 + work_date 非法格式", b: () => ({ qty: 1, work_date: "2030-01-01" }) },
    { n: "qty=1 + work_date（缺计件项）", b: () => ({ qty: 1, work_date: "2030-01-01T00:00:00+08:00" }) },
    { n: "employee_id 不存在", b: () => ({ qty: 1, work_date: "2030-01-01T00:00:00+08:00", item_name: "项A", employee_id: NOPE }) },
    { n: "正常建单", b: () => ({ qty: 2, work_date: "2030-01-01T00:00:00+08:00", item_name: "项A", employee_name: "张三" }) },
  ];
  for (const c of cases) {
    const o = flat(await call(ORIG, origToken, "POST", "/api/v1/piecework-records", c.b()));
    const r = flat(await call(RECOVERED, recToken, "POST", "/api/v1/piecework-records", c.b()));
    const same = o.http === r.http && o.code === r.code && o.message === r.message;
    records.push({ res: "piecework-records", case: c.n, orig: o, recovered: r, same });
    console.log(`[piecework-records · ${c.n}] ${same ? "一致" : "★差异"}`);
    if (!same) console.log(`  原版 ${o.http}/${o.code} ${JSON.stringify(o.message)}\n  恢复端 ${r.http}/${r.code} ${JSON.stringify(r.message)}`);
  }
  // 编号形状（JJ + 日期 + 4 位流水）
  for (const [tag, tk, base] of [["原版", origToken, ORIG], ["恢复端", recToken, RECOVERED]]) {
    const made = await call(base, tk, "POST", "/api/v1/piecework-records", {
      qty: 1, work_date: "2030-01-01T00:00:00+08:00", item_name: "项A", employee_name: "李四",
    });
    console.log(`[piecework-records · code(${tag})] ${JSON.stringify(made.json?.data?.code)}`);
  }
}

// ── print-templates ──
{
  for (const c of [
    { n: "只有 doc_type", b: () => ({ doc_type: "sale_order" }) },
    { n: "只有 name", b: () => ({ name: mkName("NN") }) },
    { n: "doc_type 空串 + name", b: () => ({ doc_type: "", name: mkName("NN") }) },
    { n: "doc_type + name 空串", b: () => ({ doc_type: "sale_order", name: "" }) },
  ]) {
    const o = flat(await call(ORIG, origToken, "POST", "/api/v1/print-templates", c.b()));
    const r = flat(await call(RECOVERED, recToken, "POST", "/api/v1/print-templates", c.b()));
    const same = o.http === r.http && o.code === r.code && o.message === r.message;
    records.push({ res: "print-templates", case: c.n, orig: o, recovered: r, same });
    console.log(`[print-templates · ${c.n}] ${same ? "一致" : "★差异"}`);
    if (!same) console.log(`  原版 ${o.http}/${o.code} ${JSON.stringify(o.message)}\n  恢复端 ${r.http}/${r.code} ${JSON.stringify(r.message)}`);
  }
  // PUT 空载荷（原版放行）/ DELETE 幂等（已删再删仍 code 0）
  for (const [tag, tk, base] of [["原版", origToken, ORIG], ["恢复端", recToken, RECOVERED]]) {
    const made = await call(base, tk, "POST", "/api/v1/print-templates", { doc_type: "sale_order", name: mkName("NN") });
    const id = made.json?.data?.id;
    if (!id) { console.log(`[print-templates(${tag})] 建单失败`); continue; }
    const put = flat(await call(base, tk, "PUT", `/api/v1/print-templates/${id}`, {}));
    const d1 = flat(await call(base, tk, "DELETE", `/api/v1/print-templates/${id}`));
    const d2 = flat(await call(base, tk, "DELETE", `/api/v1/print-templates/${id}`));
    console.log(`[print-templates(${tag})] PUT 空载荷=${put.http}/${put.code}/${JSON.stringify(put.message)} DELETE1=${d1.code} DELETE2=${d2.code}/${JSON.stringify(d2.message)}`);
  }
}

const same = records.filter((x) => x.same).length;
writeFileSync("evidence/backend-runtime/audit-batch-nn-piecework2-20261015.json", JSON.stringify({
  generated: new Date().toISOString(),
  purpose: "批次 NN 第二轮：计件两张表与打印模板的完整校验链",
  base: { orig: ORIG, recovered: RECOVERED },
  cases: records,
  summary: { total: records.length, same, differ: records.length - same },
}, null, 2));
console.log(`\n=== 汇总 ${same}/${records.length} 一致 ===`);
