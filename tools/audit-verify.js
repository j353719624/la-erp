#!/usr/bin/env node
// 清单第 8 项：把审计台账中「已实施」的修正与代码现状做一致性核对，
// 并统计剩余未取证分支，避免台账与代码脱节。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BIZ = "backend/internal/business";
const LOG = "docs/UNSUPPORTED-AUDIT-LOG.md";

const GUARD_FNS = new Set(["rejectAdvanced", "rejectAdvancedDocumentLine", "rejectOrderLine"]);
const files = readdirSync(BIZ).filter((f) => f.endsWith(".go"));

let total = 0, guards = 0;
const byFile = {};
for (const f of files) {
  const lines = readFileSync(join(BIZ, f), "utf8").split("\n");
  lines.forEach((raw, i) => {
    if (!/return\s+(nil,\s*)?ErrUnsupported/.test(raw)) return;
    total++;
    let fn = "<unknown>";
    for (let k = i; k >= 0 && k > i - 150; k--) {
      const m = (lines[k] ?? "").match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)\s*\(/);
      if (m) { fn = m[1]; break; }
    }
    const isGuard = GUARD_FNS.has(fn);
    if (isGuard) guards++;
    else byFile[f] = (byFile[f] || 0) + 1;
  });
}

const logText = readFileSync(LOG, "utf8");
const implemented = (logText.match(/已实施|已移除|已对齐/g) || []).length;

console.log("=== 当前 ErrUnsupported 现状 ===");
console.log(`总引用 ${total}｜字段守卫 ${guards}｜条件分支 ${total - guards}`);
console.log("\n按文件（条件分支）:");
Object.entries(byFile).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`  ${f.padEnd(22)} ${n}`));

console.log(`\n=== 台账登记 ===`);
console.log(`已实施/已移除/已对齐 标记出现 ${implemented} 处`);

// 抽取台账中所有「待原版回放」的行，提示仍需取证的分支
const pending = logText.split("\n").filter((l) => l.includes("待原版回放") && l.startsWith("|"));
console.log(`\n=== 台账中仍标记「待原版回放」的分支：${pending.length} 条 ===`);
pending.forEach((l) => {
  const cells = l.split("|").map((s) => s.trim()).filter(Boolean);
  if (cells.length >= 3) console.log(`  ${cells[0]} ${cells[1]}  ${String(cells[2]).slice(0, 52)}`);
});