#!/usr/bin/env node
// 生产就绪度：验证「尾斜杠归一化」修复是否对**全部资源**生效。
//
// 原版（Gin）把 /api/v1/xxx/ 与 /api/v1/xxx 视为同一路由；恢复端（Go ServeMux）
// 原本一律 404。已在 ServeHTTP 里统一剥掉尾斜杠，这里扫全部资源验证。
//
// 口径：尾斜杠路径的响应，必须与**无尾斜杠**路径的响应形态一致
// （http 状态 + 业务 code + 数据结构），而不是两端数据相同。
//
// 用法：ERP_PASSWORD=xxx node tools/eval-trailing-slash-sweep.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = process.env.OO_RECOVERED ?? "http://127.0.0.1:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

async function token(base, withCompany) {
  const payload = { username: "admin", password: PASS };
  if (withCompany) payload.company = "default";
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  return (await r.json())?.data?.access_token ?? "";
}
const oTk = await token(ORIG, true);
const rTk = await token(RECOVERED, false);
if (!oTk || !rTk) { console.error("登录失败"); process.exit(1); }

const dir = new URL("../frontend/src/api/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
const paths = new Set();
for (const f of files) {
  const src = readFileSync(new URL(f, dir), "utf8");
  for (const m of src.matchAll(/['"`]\/v1\/([a-z0-9-]+)/g)) paths.add(m[1]);
}
const list = [...paths].sort();

async function probe(base, tk, path) {
  try {
    const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json().catch(() => ({}));
    const d = j?.data;
    const shape = Array.isArray(d) ? "数组"
      : (d && typeof d === "object" && Array.isArray(d.list)) ? "分页"
      : d === null ? "null" : "对象";
    return `http${r.status}/${j?.code ?? "-"} ${shape}`;
  } catch (e) { return "ERR " + String(e).slice(0, 40); }
}

console.log(`扫描 ${list.length} 个资源：尾斜杠 vs 无尾斜杠\n`);
const rows = [];
let srcBad = 0, origBad = 0, crossDiff = 0;
for (const res of list) {
  const plain = `/api/v1/${res}`;
  const slash = `/api/v1/${res}/`;
  const [oP, oS, rP, rS] = await Promise.all([
    probe(ORIG, oTk, plain), probe(ORIG, oTk, slash),
    probe(RECOVERED, rTk, plain), probe(RECOVERED, rTk, slash),
  ]);
  // 自身一致性：尾斜杠应与无尾斜杠同形态
  const oSelf = oP === oS, rSelf = rP === rS;
  // 跨端一致性：恢复端尾斜杠应与原版尾斜杠同形态
  const cross = oS === rS;
  if (!oSelf) origBad++;
  if (!rSelf) srcBad++;
  if (!cross) crossDiff++;
  if (!rSelf || !cross) {
    rows.push(`  ${res.padEnd(30)} 原版 ${oP}→${oS}   恢复端 ${rP}→${rS}`);
  }
}
console.log("=== 不一致明细 ===");
console.log(rows.length ? rows.join("\n") : "  （无）");
console.log(`\n恢复端自身不一致 ${srcBad} / ${list.length}`);
console.log(`恢复端与原版不一致 ${crossDiff} / ${list.length}`);
console.log(`（原版自身不一致 ${origBad} / ${list.length} 作参考，原版自身应全部一致）`);

writeFileSync(
  new URL(`../evidence/backend-runtime/eval-trailing-slash-sweep-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`, import.meta.url),
  `资源\t原版无斜杠\t原版尾斜杠\t恢复端无斜杠\t恢复端尾斜杠\n` +
  rows.join("\n") +
  `\n恢复端自身不一致 ${srcBad}/${list.length}｜跨端不一致 ${crossDiff}/${list.length}\n`,
  "utf8",
);
console.log("证据已落盘。");
