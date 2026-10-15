#!/usr/bin/env node
// 自造中文文案复核：确保恢复端**没有编造原版业务文案**。
//
// 项目铁律：原版有文案就逐字照抄；原版无文案（500/400 无 message）就不得自造。
// 本脚本比对 git diff 中新增的 errors.New/fmt.Errorf 字面量与两个来源：
//   1. 基线 HEAD 版本已有的文案（→ 历史文案，非本轮自造）
//   2. evidence/backend-runtime/**/*.json 里原版实测返回的 message（→ 有证据）
// 差集 = 本轮自造，必须撤回。
//
// 唯一豁免：ErrOriginalDefect 的标识文本本身 —— 它是**分类标记**而非业务文案，
// 用于区分「有意不对齐原版缺陷」（终态决策）与「尚未恢复」（待办）。
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/35371/Desktop/11111/la-erp-recovered";
const EXEMPT = new Set([
  "原版该行为存在数据风险，恢复端有意拒绝而非复刻", // ErrOriginalDefect 标识文本
]);

// 业务文案的两种写法，都必须纳入提取范围：
//   ① errors.New("中文…") / fmt.Errorf("中文…") —— 内联字面量
//   ② XxxYyy = "中文…"                          —— 导出的业务文案常量
// ② 容易被漏审（批次 PP 就漏过一次：新加的三条装配明细文案全是常量形态，
// 审计脚本只认 ①，报「无自造」而实际有一条是自造的）。
// 过滤条件：含中文（排除 "last_out_at" 之类的内部枚举值）+ 用 = 而非 :=（后者是局部变量）。
const CJK = /[一-鿿]/;
const INLINE = /(?:errors\.New|fmt\.Errorf)\("([^"]{4,})"/g;
const CONST = /^\+?\s*([A-Za-z_]\w*)\s*=\s*"([^"]{4,})"/g;

function collectLiterals(text, out, linePrefix) {
  for (const raw of text.split("\n")) {
    const line = linePrefix ? raw.slice(1) : raw; // 去掉 diff 的 "+"
    for (const m of line.matchAll(INLINE)) out.add(m[1]);
    for (const m of line.matchAll(CONST)) {
      if (CJK.test(m[2])) out.add(m[2]);
    }
  }
}

function walk(dir, pred, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

const baseFiles = execSync('git ls-tree -r --name-only HEAD backend/', { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((f) => f.endsWith(".go"));
const baseline = new Set();
for (const f of baseFiles) {
  const s = execSync(`git show HEAD:${f}`, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  collectLiterals(s, baseline, false);
}

const original = new Set();
for (const f of walk(join(ROOT, "evidence/backend-runtime"), (p) => p.endsWith(".json"))) {
  let d;
  try { d = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
  (function scan(o) {
    if (Array.isArray(o)) return o.forEach(scan);
    if (o && typeof o === "object") {
      const m = o.message;
      if (typeof m === "string" && m.trim() && m.trim() !== "success"
          && !/^(该业务|路由不存在|系统内部错误|请求参数错误|参数错误|无效的ID)/.test(m.trim())) {
        original.add(m.trim());
      }
      Object.values(o).forEach(scan);
    }
  })(d);
}

const diff = execSync('git diff -- backend/', { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const added = new Set();
collectLiterals(
  diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n"),
  added,
  true,
);

const hasEvidence = (c) => {
  const pat = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%[sd]/g, ".*?");
  return [...original].some((o) => new RegExp(`^${pat}$`).test(o));
};

const bad = [...added].filter((c) => !baseline.has(c) && !hasEvidence(c) && !EXEMPT.has(c)).sort();
console.log(`新增中文文案 ${added.size} 条｜自造 ${bad.length} 条`);
for (const c of bad) console.log(`  ✗ ${c}`);
if (!bad.length) console.log("  ✅ 无自造业务文案");
process.exit(bad.length ? 1 : 0);
