#!/usr/bin/env node
// 路由覆盖对账：用「无 token 探测」判断某路径在两端是否存在。
//
//   原版   401「未提供认证令牌」→ 路由存在；404「路由不存在」→ 不存在
//   恢复端 401 → 路由存在；501「该业务接口尚未恢复」→ 不存在
//
// 候选路径来源：
//   1. evidence/backend-runtime/**.json（历史回放记录里的 endpoint/path/url）
//   2. frontend/src/api/**.ts（前端真实调用）
// 归一化：去掉查询串；`${...}` 与 `{...}` 统一替换为样例 UUID。
//
// 用法：node tools/audit-route-coverage.mjs [--orig URL] [--recovered URL]
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/35371/Desktop/11111/la-erp-recovered";
const ORIG = arg("--orig", "http://192.168.110.97:18886");
const RECOVERED = arg("--recovered", "http://127.0.0.1:18886");
const SAMPLE = "00000000-0000-0000-0000-000000000001";

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function walk(dir, pred, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(dir === ROOT ? p : p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// ---------- 收集候选路径 ----------
// 三种来源都要覆盖，缺一会漏：
//   1. evidence/backend-runtime/**.json（历史回放里的绝对路径 /api/v1/...）
//   2. frontend/src/api/**.ts（前端用相对路径 /v1/...，需补 /api 前缀）
//   3. backend/internal/**.go（恢复端自己的路由注册串）
//   4. docs/original-frontend-api-contracts.txt 与 docs/original-binary-routes.txt
//      （原版路由清单，含前端没调用、恢复端也没注册的入口）
const candidates = new Set();
const addFrom = (text) => {
  for (const m of text.matchAll(/\/api\/v1\/[A-Za-z0-9\-_/${}.]+/g)) {
    let p = m[0].replace(/\?.*$/, "").replace(/[),;'"`]+$/, "");
    p = p.replace(/\$\{[^}]*\}/g, SAMPLE).replace(/\{[a-zA-Z_]+\}/g, SAMPLE);
    p = p.replace(/\/+$/, "");
    if (p.split("/").length >= 4 && !p.includes("$")) candidates.add(p);
  }
  for (const m of text.matchAll(/\/v1\/[A-Za-z0-9\-_/${}.]+/g)) {
    let p = m[0].replace(/\?.*$/, "").replace(/[),;'"`]+$/, "");
    p = p.replace(/\$\{[^}]*\}/g, SAMPLE).replace(/\{[a-zA-Z_]+\}/g, SAMPLE);
    p = p.replace(/\/+$/, "");
    // 先补 /api 前缀再做段数判断：/v1/print-templates 只有两段，补前缀后才是四段
    const full = "/api" + p;
    if (full.split("/").length >= 4 && !full.includes("$")) candidates.add(full);
  }
};

for (const f of walk(join(ROOT, "evidence/backend-runtime"), (p) => p.endsWith(".json"))) addFrom(readFileSync(f, "utf8"));
for (const f of walk(join(ROOT, "frontend/src"), (p) => p.endsWith(".ts") || p.endsWith(".tsx"))) addFrom(readFileSync(f, "utf8"));
for (const f of walk(join(ROOT, "backend/internal"), (p) => p.endsWith(".go") && !p.endsWith("_test.go"))) addFrom(readFileSync(f, "utf8"));
for (const f of ["docs/original-frontend-api-contracts.txt", "docs/original-binary-routes.txt"]) {
  try { addFrom(readFileSync(join(ROOT, f), "utf8")); } catch { /* 文件可选 */ }
}

// ---------- 探测 ----------
// 判定规则：GET/POST 任一「已注册」（401/400/405/200 等）即视为存在；
// 两者都 404/501 才视为不存在。注意 GET 命中 POST-only 路由时
// Go ServeMux 回 405、原版（Gin）回 404，故不能用 GET 单次结果下结论。
async function probe(base, path) {
  let sawMissing = false;
  for (const method of ["GET", "POST"]) {
    try {
      const res = await fetch(base + path, { method, redirect: "manual" });
      const body = await res.text();
      if (res.status === 404 && /路由不存在/.test(body)) { sawMissing = true; continue; }
      if (res.status === 501 || /尚未恢复/.test(body)) { sawMissing = true; continue; }
      return "exists"; // 401/400/405/200/业务 404 都说明路由已注册
    } catch {
      return "error";
    }
  }
  return sawMissing ? "missing" : "absent";
}

const rows = [];
for (const path of [...candidates].sort()) {
  const orig = await probe(ORIG, path);
  const rec = await probe(RECOVERED, path);
  rows.push({ path, orig, recovered: rec });
}

const gap = rows.filter((r) => r.orig === "exists" && r.recovered !== "exists");
const recoveredOnly = rows.filter((r) => r.orig !== "exists" && r.recovered === "exists");
const both = rows.filter((r) => r.orig === "exists" && r.recovered === "exists");

const out = {
  generated: new Date().toISOString(),
  base: { original: ORIG, recovered: RECOVERED },
  summary: {
    candidates: rows.length,
    bothExist: both.length,
    originalOnly: gap.length,
    recoveredOnly: recoveredOnly.length,
  },
  gap,
  recoveredOnly,
};
writeFileSync(join(ROOT, "evidence/backend-runtime/route-coverage.json"), JSON.stringify(out, null, 2));

console.log(`候选路径 ${rows.length}｜两端都有 ${both.length}｜原版有恢复端无 ${gap.length}｜仅恢复端有 ${recoveredOnly.length}`);
for (const g of gap) console.log("  ✗ " + g.path);
for (const r of recoveredOnly) console.log("  + " + r.path + "（恢复端独有）");
