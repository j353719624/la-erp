#!/usr/bin/env node
// 扫描「写路径记录不存在」的响应形态差异。
//
// 起因（批次 KK 第三轮）：前端会调用 PUT/DELETE 改删的端点里，有一批在两端
// 都以「记录不存在」失败，但形态不同 ——
//	原版   200 + code 10000 +「商机不存在」
//	恢复端 404 + code 404   +「商机不存在」
// 之前只核对过「路由在不在」「列表形状」，没核对过写路径的失败形态。
//
// 本脚本对 Resources 里每张表的 PUT/DELETE 各打一次「不存在的 id」，
// 两端对比 code 与文案，输出差异清单。
//
// 用法：ERP_PASSWORD=xxx node tools/scan-write-labels.mjs
import { readFileSync, writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const ACTUAL = "http://127.0.0.1:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }
const S = "00000000-0000-0000-0000-000000000001";

// 从 server.go 的 Resources map 里提取路由表
const src = readFileSync("backend/internal/api/server.go", "utf8");
const start = src.indexOf("var Resources = map[string]Resource{");
const end = src.indexOf("\n}", start);
const body = src.slice(start, end);
const routes = [];
for (const line of body.split("\n")) {
  const m = line.match(/^\t"([a-z0-9-]+)":\s*\{"([a-z_]+)"/);
  if (m) routes.push({ route: m[1], table: m[2] });
}
console.log(`Resources 表数: ${routes.length}\n`);

async function token(base, withCompany) {
  const payload = { username: "admin", password: PASS };
  if (withCompany) payload.company = "default";
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await r.json())?.data?.access_token ?? "";
}
const to = await token(ORIG, true);
const tr = await token(ACTUAL, false);
if (!to || !tr) { console.error("两端登录失败"); process.exit(1); }

async function probe(base, tk, method, path) {
  try {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
    });
    const text = await res.text();
    let code = null, message = "";
    try { const p = JSON.parse(text); code = p.code; message = p.message ?? ""; } catch { /* 非 JSON */ }
    return { http: res.status, code, message };
  } catch (err) {
    return { http: 0, code: null, message: String(err.message ?? err) };
  }
}

const diffs = [];
const same = [];
for (const { route } of routes) {
  for (const method of ["PUT", "DELETE"]) {
    const path = `/api/v1/${route}/${S}`;
    const [o, r] = [await probe(ORIG, to, method, path), await probe(ACTUAL, tr, method, path)];
    // 只看「两端都因记录不存在而失败」的情况；两边任一不是 404/10000 说明路由或鉴权不同，跳过
    const oMissing = o.code === 404 || o.code === 10000;
    const rMissing = r.code === 404 || r.code === 10000;
    if (!oMissing || !rMissing) continue;
    if (o.http === r.http && o.code === r.code && o.message === r.message) { same.push(`${method} ${route}`); continue; }
    diffs.push({ method, route, original: o, actual: r });
  }
}

console.log(`两端一致: ${same.length}｜形态不一致: ${diffs.length}\n`);
for (const d of diffs) {
  console.log(`${d.method.padEnd(6)} /api/v1/${d.route}/{id}`);
  console.log(`       原版   ${d.original.http} code=${d.original.code} ${JSON.stringify(d.original.message)}`);
  console.log(`       恢复端 ${d.actual.http} code=${d.actual.code} ${JSON.stringify(d.actual.message)}`);
}

// 落盘：供后续按实测配置 notFound 形态
writeFileSync(
  "evidence/backend-runtime/audit-batch-kk-write-labels-20261015.json",
  JSON.stringify({ generated: new Date().toISOString(), same: same.length, diffs }, null, 2)
);
console.log("\n已写出 → evidence/backend-runtime/audit-batch-kk-write-labels-20261015.json");
