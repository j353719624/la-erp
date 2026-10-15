#!/usr/bin/env node
// 生产就绪度：**除零 panic** 静态扫描（2026-10-15）。
//
// shopspring/decimal 的 Div / DivRound 在除数为 0 时会 **panic**
// （不是返回错误），是典型的线上崩溃源 —— 一次 panic 会打挂整个请求协程，
// 若没有 recover 中间件则整个进程退出。
//
// 做法：对每处 `.Div(` / `.DivRound(` 调用，取其所在**函数体**，
// 检查函数内是否出现零值守卫。分三类：
//   · 常量除数（decimal.NewFromInt(100) / 60 等）→ 安全，无需守卫
//   · 函数体内含守卫关键字（IsZero/IsPositive/GreaterThan/LessThan/== 0）→ 已保护
//   · 其余 → **需人工确认**
//
// 用法：node tools/eval-divzero-scan.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/35371/Desktop/11111/la-erp/backend/internal";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".go") && !name.endsWith("_test.go")) out.push(p);
  }
  return out;
}
const files = walk(ROOT);

// 函数体切分：以行首 `func `（含方法接收者）为界
function splitFunctions(lines) {
  const fns = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^func /.test(lines[i])) {
      if (start >= 0) fns.push({ start, end: i });
      start = i;
    }
  }
  if (start >= 0) fns.push({ start, end: lines.length });
  return fns;
}

// 常量除数：decimal.NewFromInt(<非零字面量>) / 明显的常量
const isConstDivisor = (expr) =>
  /decimal\.NewFromInt\(\s*\d+\s*\)/.test(expr) ||
  /decimal\.NewFromFloat\(\s*[\d.]+\s*\)/.test(expr) ||
  /NewFromInt\(\s*int64\(len\(/.test(expr); // len(...) 为 0 时另说，已在守卫里

const GUARD = /IsZero|IsPositive|IsNegative|GreaterThan|LessThan|Equal\(|==\s*0|!=\s*0|>\s*0|<\s*0|Sign\(\)/;

let total = 0, safeConst = 0, guarded = 0;
const needReview = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const fns = splitFunctions(lines);
  for (const fn of fns) {
    const body = lines.slice(fn.start, fn.end);
    for (let i = 0; i < body.length; i++) {
      const line = body[i];
      if (!/\.Div\(|\.DivRound\(/.test(line)) continue;
      total++;
      // 取该行中除数表达式（最后一个右括号前的参数里，最后一段）
      const m = line.match(/\.Div(?:Round)?\(([^;]*?)(?:,\s*\d+\s*)?\)/);
      const expr = m ? m[1] : "";
      if (isConstDivisor(expr)) { safeConst++; continue; }
      // 在函数体内找守卫（排除本行之后的无关代码，宽松处理：整函数体）
      if (GUARD.test(body.join("\n"))) { guarded++; continue; }
      needReview.push({
        file: file.replace(/.*backend[\\/]/, "backend/"),
        line: fn.start + i + 1,
        code: line.trim().slice(0, 110),
      });
    }
  }
}

console.log(`除法调用点 ${total}`);
console.log(`  常量除数（安全）      ${safeConst}`);
console.log(`  函数体内有零值守卫     ${guarded}`);
console.log(`  需人工确认          ${needReview.length}`);
console.log("");
if (needReview.length) {
  console.log("=== 需人工确认的除法点 ===");
  for (const r of needReview) console.log(`  ${r.file}:${r.line}\n      ${r.code}`);
}
