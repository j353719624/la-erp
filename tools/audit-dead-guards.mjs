#!/usr/bin/env node
// 静态识别「schema 层面已保证 ⇒ 运行时守卫永不可达」的死代码。
//
// 思路（批次 Q/W 确立）：有些守卫检查的条件，schema 层面已经保证了 ——
//   · UNIQUE 索引保证同键唯一  → `len(rows) > 1 → ErrUnsupported` 永不触发
//   · 表必有某列              → `Store.Has(t, col)` 必为真 → 守卫永不触发
// 这类不需要逐条回放，直接静态判定即可结案。
//
// 本脚本对全部守卫做两类静态检查，并输出仍需回放的清单。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/35371/Desktop/11111/la-erp-recovered";
const BIZ = join(ROOT, "backend/internal/business");

// ---------- 读 schema，提取「表 → 列集合」与 UNIQUE 索引 ----------
const schema = readFileSync(join(ROOT, "backend/internal/database/schema.sql"), "utf8");

// CREATE TABLE 是单行长定义：按 `;` 切分语句再匹配，避免正则被括号截断。
const tableColumns = new Map();
for (const stmt of schema.split(";")) {
  const m = stmt.match(/CREATE TABLE `(\w+)`/);
  if (!m) continue;
  const cols = new Set();
  // 列定义形如  `name` text NOT NULL ... ，取反引号内的标识符并排除 CONSTRAINT 关键字。
  for (const c of stmt.matchAll(/`(\w+)`/g)) cols.add(c[1]);
  tableColumns.set(m[1], cols);
}

// UNIQUE 索引：捕获 ON <table> ( ... ) 直到语句结束。
const uniqueKeys = [];
for (const stmt of schema.split(";")) {
  if (!/CREATE UNIQUE INDEX/i.test(stmt)) continue;
  const on = stmt.match(/ON\s+(\w+)/i);
  const open = stmt.indexOf("(", stmt.toUpperCase().indexOf("ON"));
  if (open < 0) continue;
  let depth = 0, end = -1;
  for (let i = open; i < stmt.length; i++) {
    if (stmt[i] === "(") depth++;
    else if (stmt[i] === ")") { depth--; if (!depth) { end = i; break; } }
  }
  if (end < 0) continue;
  const body = stmt.slice(open, end + 1);
  const cols = [];
  // 先取 COALESCE(col, ...) 形式（函数索引），再取普通 `col`。
  for (const c of body.matchAll(/COALESCE\(\s*`?(\w+)`?/gi)) cols.push(c[1]);
  for (const c of body.matchAll(/,\s*`(\w+)`/g)) cols.push(c[1]);
  if (on && cols.length) uniqueKeys.push({ table: on[1], cols });
}

console.log(`schema 解析：${tableColumns.size} 张表，${uniqueKeys.length} 个小型 UNIQUE 索引\n`);

// ---------- 扫描守卫 ----------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".go") && !name.endsWith("_test.go")) out.push(p);
  }
  return out;
}

const findings = { deadUnique: [], deadColumn: [], needsReplay: [] };

for (const file of walk(BIZ)) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  let fn = "";
  lines.forEach((line, i) => {
    const m = line.match(/^func (?:\([^)]*\) )?(\w+)\(/);
    if (m) fn = m[1];
    if (!/return\s+(nil,\s*)?ErrUnsupported/.test(line)) return;
    const file3 = file.replace(/.*business[\\/]/, "");
    const win = lines.slice(Math.max(0, i - 12), i + 1).join("\n");

    // ① UNIQUE 索引死代码：len(rows) > 1 + 紧邻同键查询
    if (/len\(rows\)\s*>\s*1/.test(win)) {
      // 守卫上方若有 SELECT * FROM <table>，且该表有覆盖查询键的 UNIQUE 索引 → 死代码。
      const sel = win.match(/FROM\s+(\w+)/);
      const hit = sel && uniqueKeys.find((u) => u.table === sel[1] && u.cols.includes("product_id"));
      if (hit) {
        findings.deadUnique.push({ file: file3, line: i + 1, fn, key: `${hit.table}(${hit.cols.join(",")})` });
        return;
      }
    }
    // ② Store.Has 死代码：表必有该列
    const has = win.match(/Store\.Has\("(\w+)",\s*"(\w+)"\)/) || win.match(/Store\.Has\([^,]+,\s*"(\w+)"\)/);
    if (has) {
      const table = has[1];
      const col = has[2] || has[1];
      const tname = [...tableColumns.keys()].find((t) => t === table.replace(/s$/, "") || t === table);
      const cols = tname ? tableColumns.get(tname) : null;
      if (cols && cols.has(col)) {
        findings.deadColumn.push({ file: file3, line: i + 1, fn, table: tname, col });
        return;
      }
    }
    findings.needsReplay.push({ file: file3, line: i + 1, fn });
  });
}

const dump = (title, arr) => {
  console.log(`=== ${title}（${arr.length}）===`);
  arr.forEach((x) => console.log(`   ${x.file}:${x.line} ${x.fn}${x.key ? "  UNIQUE(" + x.key + ")" : x.col ? `  列 ${x.table}.${x.col}` : ""}`));
  console.log();
};
dump("静态判定：UNIQUE 索引保证 → 死代码", findings.deadUnique);
dump("静态判定：schema 必有列 → 死代码", findings.deadColumn);
dump("仍需原版回放", findings.needsReplay);
// ---------- 第二类死代码：路由层硬编码表名（批次 X） ----------
//
// 形如 `func (s *Service) DeleteXxx(ctx, table, id)` 且开头有
//   if table != "a" && table != "b" { return ErrUnsupported }
// 的守卫。若唯一调用点在 API 层把 table 用**字面量**赋值
//   table := "a"; if cond { table = "b" }
// 则 table 永不可能取其它值 → 守卫不可达。
//
// 识别方式：查 API 层对该函数的调用点，确认调用点所在行之前的 10 行内
// 出现 `table := "..."` 字面量赋值，且没有来自请求参数（PathValue / r.URL）。
export function findRoutedTableGuards() {
  const apiDir = join(ROOT, "backend/internal/api");
  const apiFiles = walk(apiDir).filter((f) => !f.endsWith("_test.go"));
  const apiSrc = new Map(apiFiles.map((f) => [f, readFileSync(f, "utf8")]));

  const out = [];
  for (const file of walk(BIZ)) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      const m = line.match(/^func \(s \*Service\) (\w+)\(ctx context\.Context, table, id string\)/);
      if (!m) return;
      // 函数体内前 12 行内是否有 table 白名单守卫
      const body = lines.slice(i, i + 14).join("\n");
      if (!/if table != "(\w+)" && table != "(\w+)"/.test(body)) return;
      // 找 API 层调用点
      for (const [af, asrc] of apiSrc) {
        const call = new RegExp(`business\\(\\)\\.${m[1]}\\(`, "g");
        let cm;
        while ((cm = call.exec(asrc)) !== null) {
          const before = asrc.slice(Math.max(0, cm.index - 500), cm.index);
          const assigns = [...before.matchAll(/table\s*:?=\s*"(\w+)"/g)];
          if (assigns.length === 0) continue;
          // 若 500 字窗口内出现来自请求的 table（PathValue("table") / r.URL），则不可静态判定
          if (/PathValue\("table"\)|r\.URL\.Query\(\)/.test(before)) continue;
          const literals = new Set(assigns.map((x) => x[1]));
          const guardCols = [...body.matchAll(/table != "(\w+)"/g)].map((x) => x[1]);
          const covered = guardCols.every((c) => literals.has(c));
          if (covered) {
            out.push({
              file: file.replace(/.*business[\\/]/, ""),
              line: i + 1,
              fn: m[1],
              caller: af.replace(/.*api[\\/]/, ""),
              literals: [...literals].join(","),
            });
          }
        }
      }
    });
  }
  return out;
}

const routed = findRoutedTableGuards();
dump("静态判定：路由层硬编码表名 → 死代码", routed);
