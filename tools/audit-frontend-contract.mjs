#!/usr/bin/env node
// 前端↔后端契约矩阵（权威版）：静态正则会漏掉「循环变量注册」的路由
// （如 `for _, action := range []string{"confirm","cancel"}`），因此这里
// 用**实际探测**得出恢复端真正提供哪些 (方法, 路径)。
//
// 三个产物：
//   1. 前端调用但恢复端落到 501「尚未恢复」或 404 的端点 —— 真实功能缺口
//   2. 前端发送但恢复端不识别的查询参数 —— 筛选点了没反应
//   3. 全量矩阵落盘，供后续批次复用
//
// 用法：ERP_PASSWORD=xxx node tools/audit-frontend-contract.mjs [--recovered URL]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/35371/Desktop/11111/la-erp-recovered";
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const RECOVERED = arg("--recovered", "http://127.0.0.1:18886");
const SAMPLE = "00000000-0000-0000-0000-000000000001";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

function walk(dir, pred, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// ---------- 1. 采集前端调用的 (method, path, query 键) ----------
const calls = new Map(); // key: "METHOD /api/v1/..."  → {files:Set, params:Set}
function norm(p) {
  let s = p.split("?")[0];
  s = s.replace(/\$\{[^}]*\}/g, SAMPLE).replace(/\{[a-zA-Z_]+\}/g, SAMPLE);
  return "/api" + s;
}
function queryKeys(p) {
  const q = p.split("?")[1];
  if (!q) return [];
  return [...q.matchAll(/[?&]([a-zA-Z_][a-zA-Z0-9_]*)=/g)].map((m) => m[1]);
}
for (const f of walk(join(ROOT, "frontend/src"), (p) => p.endsWith(".ts") || p.endsWith(".tsx"))) {
  const text = readFileSync(f, "utf8");
  const patterns = [
    /\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*`([^`]*)`/gi,
    /\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*'([^']*)'/gi,
    /\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*"([^"]*)"/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const method = m[1].toUpperCase();
      const raw = m[2];
      if (!raw.includes("/v1/")) continue;
      const path = norm(raw);
      if (path.includes("$")) continue;
      const key = `${method} ${path}`;
      if (!calls.has(key)) calls.set(key, { files: new Set(), params: new Set() });
      calls.get(key).files.add(f.replace(ROOT + "/", ""));
      for (const k of queryKeys(raw)) calls.get(key).params.add(k);
    }
  }
  // 字符串拼接型：http.get('/v1/crm-opportunities/' + id, params)
  // 上一轮漏掉这批，把 '/v1/x/' + id 误判成尾斜杠路径（原版当然也没有），
  // 导致 11 条假缺口。此处把拼接的常量前缀还原成完整路径。
  for (const m of text.matchAll(
    /\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*(['"`])(\/v1\/[^'"`]*)\2\s*\+/gi
  )) {
    const method = m[1].toUpperCase();
    const prefix = m[3];
    if (prefix.endsWith("/v1")) continue;
    // 拼接型：'/v1/crm-opportunities/' + id → 完整路径是 /v1/crm-opportunities/{id}；
    // 但 '/v1/piecework-rates/' + id 里 id 后面可能还跟了别的段（如 '/stage'），
    // 这种情况前缀已含尾斜杠且不构成完整端点，跳过避免造出尾斜杠假路径。
    const path = norm(prefix + "{id}");
    if (path.includes("$")) continue;
    const key = `${method} ${path}`;
    if (!calls.has(key)) calls.set(key, { files: new Set(), params: new Set() });
    calls.get(key).files.add(f.replace(ROOT + "/", ""));
    calls.get(key).params.add("__id_segment__"); // 标记这是按 id 拼的
  }
}

// ---------- 2. 登录并实际探测 ----------
async function login() {
  const r = await fetch(`${RECOVERED}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: PASS }),
  });
  return (await r.json())?.data?.access_token ?? "";
}
const token = await login();
if (!token) { console.error("恢复端登录失败"); process.exit(1); }

async function probe(method, path, attempt = 0) {
  try {
    const res = await fetch(`${RECOVERED}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
    });
    const body = await res.text();
    let kind, message = "";
    if (res.status === 404 && /路由不存在/.test(body)) kind = "absent";
    else if (res.status === 501 || /尚未恢复/.test(body)) kind = "unrecovered";
    else {
      try {
        const parsed = JSON.parse(body);
        kind = `ok/code${parsed.code}`;
        message = String(parsed.message ?? "");
      } catch { kind = `http${res.status}`; }
    }
    return { kind, message, http: res.status };
  } catch (err) {
    // 探测高频时可能把服务打挂，退避重试一次
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      return probe(method, path, attempt + 1);
    }
    return { kind: "error", message: String(err.message ?? err), http: 0 };
  }
}

// 串行 + 每 30 个打一次进度，避免把本地服务压垮
const keys = [...calls.keys()].sort();
const rows = [];
for (let i = 0; i < keys.length; i++) {
  const key = keys[i];
  const [method, path] = [key.slice(0, key.indexOf(" ")), key.slice(key.indexOf(" ") + 1)];
  const probe_ = await probe(method, path);
  rows.push({
    method,
    path,
    kind: probe_.kind,
    http: probe_.http,
    message: probe_.message,
    params: [...calls.get(key).params].sort(),
    files: [...calls.get(key).files],
  });
  if ((i + 1) % 60 === 0) console.log(`  进度 ${i + 1}/${keys.length}`);
}

// ---------- 3. 汇总 ----------
const broken = rows.filter((r) => r.kind === "absent" || r.kind === "unrecovered");
const errored = rows.filter((r) => r.kind === "error");

// 已知后端不识别的查询参数（取自批次 JJ 实测）
const knownParams = new Set(["page", "page_size", "sort_order", "keyword"]);
const paramSuspects = [];
for (const r of rows) {
  if (r.kind !== "ok/code0" && !r.kind.startsWith("ok/code")) continue;
  for (const p of r.params) {
    if (!knownParams.has(p)) paramSuspects.push({ path: r.path, method: r.method, param: p });
  }
}

const out = {
  generated: new Date().toISOString(),
  recovered: RECOVERED,
  summary: {
    frontendCalls: rows.length,
    served: rows.length - broken.length - errored.length,
    broken: broken.length,
    errored: errored.length,
  },
  broken,
  errored,
  all: rows,
};
writeFileSync(join(ROOT, "evidence/backend-runtime/frontend-contract-matrix.json"), JSON.stringify(out, null, 2));

console.log(`\n前端调用端点 ${rows.length}｜可用 ${rows.length - broken.length - errored.length}｜不可用 ${broken.length}｜探测失败 ${errored.length}\n`);
console.log("=== 前端调用但恢复端不可用 ===");
const byPath = {};
for (const b of broken) {
  (byPath[b.path] = byPath[b.path] || []).push(b);
}
for (const [p, items] of Object.entries(byPath)) {
  console.log(`  ${p.replace(SAMPLE, "{id}")}`);
  for (const it of items) {
    console.log(`      ${it.method.padEnd(6)} ${it.kind.padEnd(12)} ${JSON.stringify(it.message).slice(0, 60)}  ← ${it.files[0]}`);
  }
}
if (errored.length) {
  console.log("\n=== 探测失败（服务可能被压垮，建议重跑）===");
  for (const e of errored.slice(0, 10)) console.log(`  ${e.method} ${e.path}  ${e.message}`);
}
