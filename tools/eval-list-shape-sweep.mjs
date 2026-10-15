#!/usr/bin/env node
// 产品完成度评估：批量扫描所有资源的**列表响应形态**，找出
// 「原版返回裸数组、恢复端返回 {list,total}」这一类结构性缺口。
//
// ## 背景
// 评估时发现 approval-flows 有 4 项差异（结构 / 尾斜杠 / 排序 / 字段）。
// 关键问题：这是孤例，还是一批？若恢复端把一批「原版裸数组」的资源
// 统统实现成了分页对象，那是一类系统性缺口，必须批量定位。
//
// ## 方法
// 对 frontend/src/api 里出现的全部资源路径，两端各打一次
// `GET /api/v1/<res>?page=1&page_size=2`，只比**响应结构**
// （数组 vs 分页对象）+ http 状态 + 业务 code。不比数据内容（两端库不同）。
//
// 用法：ERP_PASSWORD=xxx node tools/eval-list-shape-sweep.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const ACTUAL = process.env.OO_ACTUAL ?? "http://127.0.0.1:18886";
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
const rTk = await token(ACTUAL, false);
if (!oTk || !rTk) { console.error("登录失败"); process.exit(1); }

// 从前端 api 源码里抓资源路径
const dir = new URL("../frontend/src/api/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
const paths = new Set();
for (const f of files) {
  const src = readFileSync(new URL(f, dir), "utf8");
  // 前端 http 客户端带 baseURL `/api`，源码里写的是 `/v1/...`
  for (const m of src.matchAll(/['"`]\/v1\/([a-z0-9-]+)/g)) paths.add(m[1]);
}
const list = [...paths].sort();
console.log(`前端资源路径 ${list.length} 个，开始扫描…`);

async function probe(base, tk, path) {
  try {
    const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json();
    return { http: r.status, code: j?.code ?? "-", data: j?.data };
  } catch (e) {
    return { http: -1, code: "-", data: null, err: String(e).slice(0, 60) };
  }
}
const shapeOf = (d) => {
  if (Array.isArray(d)) return `数组[${d.length}]`;
  if (d && typeof d === "object" && Array.isArray(d.list)) return `分页{total=${d.total},n=${d.list.length}}`;
  if (d === null) return "null";
  return `对象(${Object.keys(d ?? {}).slice(0, 4).join(",")})`;
};

const rows = [];
let structural = 0, httpDiff = 0;
for (const res of list) {
  const path = `/api/v1/${res}?page=1&page_size=2`;
  const o = await probe(ORIG, oTk, path);
  const r = await probe(ACTUAL, rTk, path);
  const so = shapeOf(o.data), sr = shapeOf(r.data);
  const shapeDiff = so.replace(/\[\d+\]|\{total=\d+,n=\d+\}/g, "") !== sr.replace(/\[\d+\]|\{total=\d+,n=\d+\}/g, "");
  const statusDiff = o.http !== r.http || String(o.code) !== String(r.code);
  if (shapeDiff) structural++;
  if (statusDiff) httpDiff++;
  rows.push({ res, o: `http${o.http}/${o.code} ${so}`, r: `http${r.http}/${r.code} ${sr}`, shapeDiff, statusDiff });
}

console.log("\n=== 结构不一致（数组 vs 分页对象）===");
for (const x of rows.filter((v) => v.shapeDiff)) {
  console.log(`  ${x.res.padEnd(32)} 原版 ${x.o.padEnd(30)} 恢复端 ${x.r}`);
}
console.log("\n=== 状态/业务码不一致 ===");
for (const x of rows.filter((v) => v.statusDiff)) {
  console.log(`  ${x.res.padEnd(32)} 原版 ${x.o.padEnd(30)} 恢复端 ${x.r}`);
}
console.log(`\n结构不一致 ${structural} / ${list.length}｜状态不一致 ${httpDiff} / ${list.length}`);

const out = rows.map((x) => `${x.res}\t${x.o}\t${x.r}\t${x.shapeDiff ? "结构差异" : ""}${x.statusDiff ? "状态差异" : ""}`).join("\n");
writeFileSync(
  new URL(`../evidence/backend-runtime/eval-list-shape-sweep-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`, import.meta.url),
  `资源\t原版\t恢复端\t判定\n${out}\n`,
  "utf8",
);
console.log("证据已落盘。");
