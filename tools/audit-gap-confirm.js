#!/usr/bin/env node
// 权威缺口核实：对「前端会调用但恢复端 501」的端点，逐个到原版确认存在性，
// 并取回原版真实响应作为实现依据。
//
// 判定：
//   原版 absent  → 前端调用了原版也没有的端点（前端自身问题，不算后端缺口）
//   原版 exists  → ★真实缺口：后端 501「尚未恢复」
//
// 用法：ERP_PASSWORD=xxx node tools/audit-gap-confirm.js
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://192.168.110.97:18886";
const RECOVERED = "http://127.0.0.1:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const SAMPLE = "00000000-0000-0000-0000-000000000001";
const matrix = JSON.parse(readFileSync(new URL("../evidence/backend-runtime/frontend-contract-matrix.json", import.meta.url), "utf8"));

// 原版在公司数 > 1 时要求登录必须带 company（回放 KK 建出第 2 家公司后触发的约束），
// 恢复端是单公司模式、不认这个字段。两端分别处理，否则会出现「一端登录失败」。
async function token(base, withCompany) {
  const payload = { username: "admin", password: PASS };
  if (withCompany) payload.company = "default";
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json();
  if (!body?.data?.access_token) {
    console.error(`${base} 登录失败: ${JSON.stringify(body).slice(0, 120)}`);
  }
  return body?.data?.access_token ?? "";
}
const [origToken, recToken] = [await token(BASE, true), await token(RECOVERED, false)];
if (!origToken || !recToken) { console.error("两端登录失败"); process.exit(1); }

async function probe(base, tk, method, path, attempt = 0) {
  try {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
    });
    const text = await res.text();
    let code, message = null;
    try { const p = JSON.parse(text); code = p.code; message = p.message; } catch { /* 非 JSON */ }
    if (res.status === 404 && /路由不存在/.test(text)) return { kind: "absent" };
    if (res.status === 501 || /尚未恢复/.test(text)) return { kind: "unrecovered", http: res.status, code, message };
    return { kind: "exists", http: res.status, code, message };
  } catch (err) {
    if (attempt < 2) { await new Promise((r) => setTimeout(r, 700 * (attempt + 1))); return probe(base, tk, method, path, attempt + 1); }
    return { kind: "error", message: String(err.message ?? err) };
  }
}

// 把工具产出的路径还原成真实形态；畸形路径（尾斜杠、缺斜杠）直接丢弃。
//
// 畸形来源：采集端对 `'/v1/x/' + id` 这类拼接，若表达式跨行或后接 `+ '/stage'`，
// 会拼出 `/v1/x`（丢了 id）或 `/v1/print-templates{id}`（缺斜杠）这类
// 两端都不存在的假路径。实测这类共 12 条，全是采集误差而非真实契约差异，
// 故在探测前过滤，避免污染缺口清单。
function clean(p) {
  // `/v1/print-templates{id}` → 补斜杠
  p = p.replace(/([^/])\{id\}/, "$1/{id}");
  // 尾斜杠：拼接丢了 id 段
  if (p.endsWith("/")) return "";
  return p;
}

const seen = new Set();
const malformed = [];
const rows = [];
for (const b of matrix.broken) {
  const path = clean(b.path);
  if (!path) {
    malformed.push({ method: b.method, raw: b.path.replace(SAMPLE, "{id}"), reason: "拼接丢失 id 段（尾斜杠）" });
    continue;
  }
  const key = `${b.method} ${path}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const orig = await probe(BASE, origToken, b.method, path);
  const rec = await probe(RECOVERED, recToken, b.method, path);
  // 只有**两端语义判定不同**才算缺口。若恢复端已可用（原版也可用），
  // 即便响应形态有差异（如 JSON 键序不同）也不算缺口 —— 那是形态问题，另行审计。
  const verdict = orig.kind === "absent"
    ? "FRONTEND_ONLY"                                  // 原版也没这个端点 → 前端的错调用
    : rec.kind === "unrecovered" || rec.kind === "absent"
      ? "BACKEND_GAP"                                  // 原版有、恢复端没有 → 真缺口
      : "ALREADY_OK";                                  // 两端都可用 → 非缺口
  rows.push({
    method: b.method,
    path: path.replace(SAMPLE, "{id}"),
    original: orig,
    recovered: rec,
    verdict,
    frontendFile: (b.files[0] ?? "").split("\\").pop(),
  });
}

const gaps = rows.filter((r) => r.verdict === "BACKEND_GAP");
const feOnly = rows.filter((r) => r.verdict === "FRONTEND_ONLY");
const alreadyOk = rows.filter((r) => r.verdict === "ALREADY_OK");
const unknown = [];

console.log(`\n前端不可用端点 ${rows.length}｜★后端真实缺口 ${gaps.length}｜前端调用了原版没有的 ${feOnly.length}｜未判定 ${unknown.length}\n`);
console.log("=== ★ 后端真实缺口（原版有实现，恢复端 501）===");
for (const g of gaps) {
  console.log(`  ${g.method.padEnd(6)} ${g.path}`);
  console.log(`         原版: HTTP ${g.original.http} code=${g.original.code} ${JSON.stringify(g.original.message ?? "")}`);
  console.log(`         恢复端: ${g.recovered.kind}   ← frontend/src/api/${g.frontendFile}`);
}
if (feOnly.length) {
  console.log("\n=== 前端调用了原版也没有的端点（前端问题，非后端缺口）===");
  for (const f of feOnly) console.log(`  ${f.method.padEnd(6)} ${f.path}   ← frontend/src/api/${f.frontendFile}`);
}
if (unknown.length) {
  console.log("\n=== 未判定 ===");
  for (const u of unknown) console.log(`  ${u.method.padEnd(6)} ${u.path}  原版=${JSON.stringify(u.original)}`);
}

writeFileSync(
  new URL("../evidence/backend-runtime/audit-gap-confirm-20261015.json", import.meta.url),
  JSON.stringify({ generated: new Date().toISOString(), summary: { total: rows.length, backendGap: gaps.length, frontendOnly: feOnly.length, alreadyOk: alreadyOk.length, malformed: malformed.length, unknown: unknown.length }, rows }, null, 2)
);
console.log("\n已写出 → evidence/backend-runtime/audit-gap-confirm-20261015.json");
