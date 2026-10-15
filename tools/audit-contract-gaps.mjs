#!/usr/bin/env node
// 静态对账：把本实现 60 处 ErrUnsupported 守卫，与「仓库内既有证据」交叉比对。
//
// 方法论（批次 K/L 的教训）：不要再做黑盒参数试探——
// 答案通常在 evidence/frontend-api-inventory.json、frontend/src/api/*.ts、
// evidence/backend-runtime/*.json 里已经记录着参考实现的真实契约。
//
// 本脚本做三件事：
//   1. 抽出所有 ErrUnsupported 守卫所在函数
//   2. 找出前端调用了但本实现可能拒绝的字段（从 TS 类型定义反查）
//   3. 标出「前端有专门 API 函数但本实现未实现」的端点
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/35371/Desktop/11111/la-erp";

// ---------- 1. 抽出守卫 ----------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".go") && !name.endsWith("_test.go")) out.push(p);
  }
  return out;
}

const guards = [];
for (const file of walk(join(ROOT, "backend/internal/business"))) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const fnStack = [];
  let fnName = "";
  lines.forEach((line, i) => {
    const fn = line.match(/^func (?:\([^)]*\) )?(\w+)\(/);
    if (fn) fnName = fn[1];
    void fnStack;
    if (/return (nil, )?ErrUnsupported/.test(line)) {
      const snippet = lines.slice(Math.max(0, i - 3), i + 1).join(" ").replace(/\s+/g, " ").trim();
      guards.push({
        file: file.replace(/.*business[\\/]/, ""),
        line: i + 1,
        fn: fnName,
        guard: snippet.slice(-110),
      });
    }
  });
}

console.log(`=== 本实现 ErrUnsupported 守卫（${guards.length} 处）===\n`);
const byFn = {};
guards.forEach((g) => {
  (byFn[g.fn] = byFn[g.fn] || []).push(g);
});
Object.entries(byFn)
  .sort((a, b) => b[1].length - a[1].length)
  .forEach(([fn, gs]) => {
    console.log(`${fn}  (${gs.length})`);
    gs.forEach((g) => console.log(`   ${g.file}:${g.line}  ${g.guard.slice(0, 92)}`));
  });

// ---------- 2. 前端 API 端点全集 ----------
const inv = JSON.parse(readFileSync(join(ROOT, "evidence/frontend-api-inventory.json"), "utf8"));
const endpoints = new Set();
for (const c of inv.calls) {
  const m = String(c.path_expression).match(/'(\/v1\/[^`']+)'|`(\/v1\/[^`]+)`/);
  if (m) endpoints.add(m[1] || m[2]);
}
console.log(`\n=== 前端调用的端点（${endpoints.size} 个）===\n`);

// ---------- 3. 找出前端调了、但本实现路由表里没有的端点 ----------
const apiFiles = walk(join(ROOT, "backend/internal/api"));
let routeSrc = "";
for (const f of apiFiles) routeSrc += readFileSync(f, "utf8");

const missing = [];
for (const ep of endpoints) {
  // 把 /v1/xxx/${id}/yyy 规约为路由片段
  const seg = ep.replace(/^\/v1\//, "").split("/").filter(Boolean).map((s) => {
    if (s.startsWith("${") || s.includes("+")) return "{id}";
    return s;
  });
  if (!seg.length) continue;
  const normalized = seg.join("/");
  const hit = routeSrc.includes(`/${normalized}`) ||
    routeSrc.includes(`api/v1/${seg[0]}`) && seg.length === 1;
  if (!hit) missing.push(ep);
}
console.log(`\n=== 前端调用但本实现路由表未命中（${missing.length} 个，待人工确认）===\n`);
missing.forEach((m) => console.log("  " + m));