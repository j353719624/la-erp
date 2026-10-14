#!/usr/bin/env node
// 逐分支审计 v2：提取每处 ErrUnsupported 的**真实触发条件**，而不是按引用数判定缺口。
//
// 依据 SESSION-HANDOFF.md 第 37 行要求：
//   "静态引用包含非法输入保护，不能按引用数直接认定缺失功能"
//   需逐分支建立「条件、原版结果、恢复结果、测试矩阵」。
//
// 本脚本只做第一步：把 117 处引用还原成可读的触发条件清单，供人工/原版回放逐条定性。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BIZ = "backend/internal/business";
const files = readdirSync(BIZ).filter((f) => f.endsWith(".go")).sort();

// 通用字段守卫函数：其内部的 ErrUnsupported 属输入保护，非业务缺口
const GUARD_FNS = new Set(["rejectAdvanced", "rejectAdvancedDocumentLine", "rejectOrderLine"]);

function enclosing(lines, idx) {
  for (let i = idx; i >= 0 && i > idx - 150; i--) {
    const m = lines[i]?.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)\s*\(/);
    if (m) return m[1];
  }
  return "<unknown>";
}

// 向上收集该 return 所属的 if 条件链（过滤 err 噪声，不跨函数边界）
const NOISE = /^(if\s+)?err\s*!=\s*nil\b|^\{\s*return err\s*\}$|^if\s+!?ok\s*$/;
function conditionChain(lines, idx) {
  const chain = [];
  const funcLine = enclosingLine(lines, idx);
  for (let i = idx - 1; i >= 0 && i > idx - 40; i--) {
    if (/^func\s/.test(lines[i] ?? "")) break;      // 不跨函数
    if (i < funcLine) break;
    const t = (lines[i] ?? "").trim();
    if (NOISE.test(t)) continue;
    if (t.startsWith("if ") || t.startsWith("} else if ") || t.startsWith("for ")) {
      const cond = t
        .replace(/^(}\s*)?(else\s*)?if\s+/, "")
        .replace(/\s*\{$/, "")
        .replace(/^!\s*/, "")
        .trim();
      chain.unshift(cond);
      if (chain.length >= 3) break;
    }
  }
  return chain;
}

function enclosingLine(lines, idx) {
  for (let i = idx; i >= 0 && i > idx - 150; i--) {
    if (/^func\s/.test(lines[i] ?? "")) return i;
  }
  return 0;
}

// 批次 N 已取证：各 *Action 函数的 default 分支不可达 —— API 层用 []string{...} 限定动作白名单，
// 且原版实测动作集与恢复端逐项一致（evidence/backend-runtime/audit-batch-n-20261014.json）。
// 这些分支已被单独归入「四、已结案」章节，不计入待办存量。
// 批次 Q 已取证：同一「商品+仓库+库位+货架+批次」的余额行由数据库 UNIQUE 索引保证唯一
// （schema.sql 的 idx_inventory_balance_key 用 COALESCE 归一化 NULL），
// 因此 service.go 两处 `len(rows) > 1` 分支永不可达。
const DB_UNIQUE_GUARDS = new Set([
  "service.go:trackingBalance",
  "service.go:balance",
]);

const UNREACHABLE_ACTIONS = new Set([
  "AdjustmentAction", "AssemblyAction", "AttendanceAction", "CheckAction",
  "ExpenseAction", "ReworkAction", "SubcontractAction", "ToolingAction",
  "TransferAction", "VoucherAction", "WorkOrderAction", "WorkProcessAction",
]);

const rows = [];
for (const f of files) {
  const src = readFileSync(join(BIZ, f), "utf8");
  const lines = src.split("\n");
  lines.forEach((raw, i) => {
    const isUnsupported = /return\s+(nil,\s*)?ErrUnsupported/.test(raw);
    const isDefect = /return\s+(nil,\s*)?ErrOriginalDefect/.test(raw);
    if (!isUnsupported && !isDefect) return;
    const fn = enclosing(lines, i);
    // 已结案：default 分支经批次 N 取证确认不可达（API 层已用 []string{...} 限定动作白名单，
    // 且原版实测动作集与恢复端逐项一致）。这类分支不会再被触发，不计入待办存量。
    // 判据：在函数体内向上回溯最近的 "default:" 行，且该函数属已取证的动作白名单。
    let unreachable = false;
    for (let k = i - 1; k > 0 && !lines[k].startsWith("func "); k--) {
      if (lines[k].trim() === "default:") {
        unreachable = UNREACHABLE_ACTIONS.has(fn);
        break;
      }
    }
    // 批次 Q：两处「同键余额多行」已由数据库 UNIQUE 索引证明不可能，属防御性断言，
    // 同样从待办存量中移出（见 DB_UNIQUE_GUARDS 与 schema.sql 的 idx_inventory_balance_key）。
    if (DB_UNIQUE_GUARDS.has(`${f}:${fn}`)) {
      const tail = lines.slice(Math.max(0, i - 6), i).join(" ");
      if (tail.includes("len(rows) > 1")) unreachable = true;
    }
    rows.push({
      file: f,
      line: i + 1,
      func: fn,
      kind: isDefect ? "defect"
        : unreachable ? "unreachable"
        : GUARD_FNS.has(fn) ? "guard"
        : "conditional",
      cond: conditionChain(lines, i).join("  ⟸  ") || "(无外层条件)",
    });
  });
}

const guards = rows.filter((r) => r.kind === "guard");
const conds = rows.filter((r) => r.kind === "conditional");
const defects = rows.filter((r) => r.kind === "defect");
const unreachable = rows.filter((r) => r.kind === "unreachable");

// 按业务模块归类（对应交接清单 1-8 项）
const MODULE = [
  [/production|workorder|routings|boms|assembl|process|rework|tooling|mrp/i, "生产/工单", "清单1、5"],
  [/payment|invoice|voucher|cashflow|financereport|aging|account|expense|statement|bank/i, "财务/收付款", "清单2、3"],
  [/subcontract/i, "外协", "清单4"],
  [/return/i, "退货", "清单7"],
  [/approval|permission|role|scope/i, "审批/权限", "清单6"],
  [/adjustment|check|transfer|fulfillment|batch_allocation|serial|photo|photo/i, "库存/调拨/盘点", "清单8"],
  [/custom_report|cashflow|report/i, "报表", "清单8"],
  [/service/i, "通用单据", "清单8"],
];

function moduleOf(file, func) {
  const s = `${file} ${func}`;
  for (const [re, name, item] of MODULE) if (re.test(s)) return { name, item };
  return { name: "其他", item: "清单8" };
}

let md = `# ErrUnsupported 逐分支审计清单（自动生成）\n\n`;
md += `> 生成：\`node tools/audit-unsupported.mjs\`　生成时间：2026-10-13\n\n`;
md += `## 为什么不能按引用数判定缺口\n\n`;
md += `SESSION-HANDOFF.md 明确要求：*"静态引用包含非法输入保护，不能按引用数直接认定缺失功能"*，\n`;
md += `需**逐分支建立条件、原版结果、恢复结果、测试矩阵**。\n\n`;
md += `本次提取 ${rows.length} 处引用，分类如下：\n\n`;
md += `| 类别 | 数量 | 含义 |\n|---|---:|---|\n`;
md += `| \`guard\` | ${guards.length} | 通用字段守卫（rejectAdvanced 等）内部，命中即正确拒绝，**非缺口** |\n`;
md += `| \`conditional\` | ${conds.length} | 具名业务条件分支，**需逐条定性** |\n`;
md += `| \`defect\` | ${defects.length} | **有意不对齐原版缺陷**，属终态决策，**不计入待办存量** |\n`;
md += `| \`unreachable\` | ${unreachable.length} | **default 分支已取证不可达**（API 层白名单限定 + 原版动作集逐项一致），**不计入待办存量** |\n\n`;
md += `> 待办存量 = \`conditional\` **${conds.length}** 处（\`guard\`/\`defect\`/\`unreachable\` 均已结案）。\n\n`;
md += `## 一、字段守卫（非缺口）\n\n| 文件 | 行 | 函数 |\n|---|---|---|\n`;
for (const r of guards) md += `| ${r.file} | ${r.line} | \`${r.func}\` |\n`;

md += `\n## 三、有意不对齐原版缺陷（终态决策，非待办）\n\n`;
md += `> 这些分支的原版行为**已取证且已确认有害**，恢复端按交接文档\n`;
md += `> 「不复制未证实的错误行为」原则保留拒绝，用 \`ErrOriginalDefect\` 标识。\n\n`;
md += `| 文件 | 行 | 函数 | 触发条件 |\n|---|---|---|---|\n`;
for (const r of defects) {
  md += `| ${r.file} | ${r.line} | \`${r.func}\` | \`${r.cond.replace(/\|/g, "\\|")}\` |\n`;
}
md += `\n`;

md += `## 四、已结案：default 分支不可达（批次 N）\n\n`;
md += `> 这些 \`*Action\` 函数的 default 分支，API 层已用 \`[]string{...}\` 限定动作白名单，\n`;
md += `> 且原版实测动作集与恢复端**逐项一致**（2026-10-14 批次 N，\n`;
md += `> evidence/backend-runtime/audit-batch-n-20261014.json），故不会被触发。\n\n`;
md += `| 文件 | 行 | 函数 | 触发条件 |\n|---|---|---|---|\n`;
for (const r of unreachable) {
  md += `| ${r.file} | ${r.line} | \`${r.func}\` | \`${r.cond.replace(/\|/g, "\\|")}\` |\n`;
}
md += `\n`;

md += `## 二、条件分支（需原版回放定性）\n\n`;
const byMod = {};
for (const r of conds) {
  const m = moduleOf(r.file, r.func);
  (byMod[m.name] ??= { item: m.item, rows: [] }).rows.push(r);
}
for (const [name, g] of Object.entries(byMod)) {
  md += `### ${name}　<sub>对应 ${g.item}</sub>\n\n`;
  md += `| 文件 | 行 | 函数 | 触发条件 |\n|---|---|---|---|\n`;
  for (const r of g.rows) {
    md += `| ${r.file} | ${r.line} | \`${r.func}\` | \`${r.cond.replace(/\|/g, "\\|")}\` |\n`;
  }
  md += `\n`;
}

writeFileSync("docs/UNSUPPORTED-AUDIT.md", md);
console.log(`总引用 ${rows.length}｜字段守卫 ${guards.length}｜条件分支 ${conds.length}｜有意不对齐缺陷 ${defects.length}｜不可达 default ${unreachable.length}`);
console.log("\n按模块：");
for (const [n, g] of Object.entries(byMod)) console.log(`  ${n.padEnd(12)} ${g.rows.length} 项  (${g.item})`);