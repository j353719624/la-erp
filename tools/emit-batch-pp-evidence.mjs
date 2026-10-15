#!/usr/bin/env node
// 把批次 PP 的 .txt 取证输出转成结构化 JSON 证据。
//
// ## 为什么需要这一步
// tools/audit-self-authored-text.mjs 只扫 `evidence/backend-runtime/**/*.json`
// 里的 `message` 字段来判定「文案是否有原版证据」。本轮批次 PP 的取证脚本
// 只写了 .txt，导致刚从原版逐字抄来的文案被误判成「自造」。
//
// 本脚本把 .txt 里「原版 : <形态>」行解析成 {message, http, code, source} 记录，
// 供审计脚本引用。**只搬运实测输出，不新增任何未经回放的文案**。
//
// 用法：node tools/emit-batch-pp-evidence.mjs
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "C:/Users/35371/Desktop/11111/la-erp-recovered";
const EVIDENCE = ROOT + "/evidence/backend-runtime";

const FILES = [
  "audit-batch-pp-expense-20261015.txt",   // 报销状态机 8 用例
  "audit-batch-pp-expense2-20261015.txt",  // 报销 cancel 逻辑 E9/E10/E11
  "audit-batch-pp-statemachine-20261015.txt", // 考勤/装配/绩效/工资
  "audit-batch-pp-assembly-20261015.txt",  // 装配建单明细
  "audit-batch-pp-assembly5-20261015.txt", // 装配库存副作用终验
  "audit-batch-pp-create-guards-20261015.txt", // 绩效/装配建单明细校验
  "audit-batch-pp-lines-shape-20261015.txt",  // 装配明细形状（A/B/E 段）
  "audit-batch-pp-lines-shape2-20261015.txt", // 行内字段（C/D/F/G 段）
  "audit-batch-pp-lines-shape3-20261015.txt", // 校验顺序反例 ⑨-⑬
  "audit-batch-pp-lines-shape4-20261015.txt", // 商品 vs 数量顺序 ⑭/⑮
  "audit-batch-pp-lines-shape5-20261015.txt", // 数值 vs 商品顺序、unit_cost 符号
  "audit-batch-pp-put-lines-20261015.txt",    // PUT 整体重写语义
  "audit-batch-pp-put-lines2-20261015.txt",   // PUT 复用 B/C/D/E 段、不校验 G
  "audit-batch-pp-put-lines3-20261015.txt",   // PUT 的 D/F 段与落库值
];

// 一行里可能出现多步（用 | 分隔），也可能形如「原版 : approve: http200 code=10000 <文案>」。
// 逐段匹配 http<code> code=<code> <文案>，再由调用方确认该行属于原版。
const SEG = /http(\d+)\s+code=(\d+)\s+([^|]*)/g;

const records = [];
for (const file of FILES) {
  let text;
  try {
    text = readFileSync(`${EVIDENCE}/${file}`, "utf8");
  } catch {
    console.warn(`跳过（不存在）: ${file}`);
    continue;
  }
  let step = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // 记录当前步骤（形如 "!! approve" 或 "confirm"）
    if (line && !line.startsWith("原版") && !line.startsWith("恢复端") && !line.startsWith("=")) {
      if (/^!?!?\s*\w+/.test(line) && line.length < 40 && !line.includes("http")) step = line.replace(/^!!\s*/, "");
    }
    // 只取原版行
    const isOrig = line.startsWith("原版 :") || line.startsWith("[原版]");
    if (!isOrig) continue;
    for (const m of line.matchAll(SEG)) {
      // 去掉残留的 "status=-" / "id=xxx" 等尾部字段
      let message = m[3].replace(/\s*(status|id|total)=\S*/g, "").trim();
      if (!message || message === "success") continue;
      records.push({
        source: file,
        step,
        http: Number(m[1]),
        code: Number(m[2]),
        message,
      });
    }
  }
}

const out = `${EVIDENCE}/audit-batch-pp-statemachine-evidence-20261015.json`;
writeFileSync(out, JSON.stringify(records, null, 2));
console.log(`已写出 ${records.length} 条原版实测记录 → ${out}`);
const uniq = [...new Set(records.map((r) => r.message))];
console.log(`去重后文案 ${uniq.length} 条:`);
for (const m of uniq) console.log(`   ${m}`);
