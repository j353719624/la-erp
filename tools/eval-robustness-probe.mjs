#!/usr/bin/env node
// 生产就绪度：**畸形输入健壮性**探测（2026-10-15）。
//
// 目标：确认越界/畸形输入不会导致**进程崩溃（panic）或 5xx**。
// 判定口径（按原版对照，不臆造「应该返回什么」）：
//   · 4xx（400/401/404/422）        → 正常拒绝，OK
//   · 200 + code 10000 + 中文文案   → 原版的业务错误形态，OK
//   · 5xx                          → **缺陷**：内部错误未处理
//   · 连接中断 / 空响应             → **缺陷**：panic 导致进程崩溃
//
// 每轮探测后都检查服务是否还活着（/health），挂了就立即报告。
//
// 用法：ERP_PASSWORD=xxx node tools/eval-robustness-probe.mjs
import { writeFileSync } from "node:fs";

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

const log = [];
const say = (s) => { log.push(s); console.log(s); };

const BIG = "9".repeat(40);
const LONG = "测".repeat(5000);
const INJECT = "'; DROP TABLE products; --";
const DEEP = JSON.parse("[" + "[".repeat(60) + "]".repeat(60) + "]");

// [名称, 方法, 路径, body]
const CASES = [
  ["超大数值", "POST", "/api/v1/products", { code: "P" + Date.now(), name: "x", purchase_price: BIG, sale_price: BIG }],
  ["负数量", "POST", "/api/v1/products", { code: "P" + Date.now(), name: "x", safety_stock: -99999 }],
  ["超长字符串", "POST", "/api/v1/products", { code: "P" + Date.now(), name: LONG }],
  ["SQL注入串", "POST", "/api/v1/products", { code: "P" + Date.now(), name: INJECT }],
  ["深层嵌套JSON", "POST", "/api/v1/products", { code: "P" + Date.now(), name: "x", edges: DEEP }],
  ["错误类型", "POST", "/api/v1/products", { code: 12345, name: { a: 1 } }],
  ["空body", "POST", "/api/v1/products", {}],
  ["非法UUID", "GET", "/api/v1/products/not-a-uuid", undefined],
  ["超长UUID", "GET", "/api/v1/products/" + "a".repeat(500), undefined],
  ["超大分页", "GET", "/api/v1/products?page=1&page_size=999999999", undefined],
  ["负数分页", "GET", "/api/v1/products?page=-5&page_size=-5", undefined],
  ["非数字分页", "GET", "/api/v1/products?page=abc&page_size=xyz", undefined],
  ["注入式排序", "GET", "/api/v1/products?sort=" + encodeURIComponent(INJECT), undefined],
  ["非法日期", "GET", "/api/v1/stock-ins?start_date=not-a-date&end_date=;--", undefined],
  ["超长查询串", "GET", "/api/v1/products?keyword=" + "x".repeat(20000), undefined],
  ["路径穿越", "GET", "/api/v1/products/../../etc/passwd", undefined],
  ["空JSON", "PUT", "/api/v1/products/00000000-0000-0000-0000-000000000000", {}],
  ["数组当对象", "POST", "/api/v1/stock-ins", [1, 2, 3]],
  ["负数金额", "POST", "/api/v1/payment-receipts", { amount: -1e30, receipt_date: "2026-01-01T00:00:00+08:00" }],
  ["科学计数溢出", "POST", "/api/v1/payment-receipts", { amount: 1e400, receipt_date: "2026-01-01T00:00:00+08:00" }],
];

const isDeadly = (r) => r.http >= 500 || r.broken;

async function probe(base, tk, method, path, body) {
  try {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // 必须消费掉响应体，否则连接不复用
    await res.text();
    return { http: res.status, broken: false };
  } catch (e) {
    return { http: -1, broken: true, err: String(e).slice(0, 80) };
  }
}
async function alive(base) {
  try {
    const r = await fetch(base + "/health", { signal: AbortSignal.timeout(3000) });
    return r.status === 200;
  } catch { return false; }
}

say("=== 畸形输入健壮性探测（只看恢复端；崩溃/5xx 即缺陷）===");
let deadly = 0, crashed = 0;
for (const [name, method, path, body] of CASES) {
  const r = await probe(RECOVERED, rTk, method, path, body);
  const ok = await alive(RECOVERED);
  let verdict = "OK";
  if (!ok) { verdict = "!! 进程崩溃"; crashed++; deadly++; }
  else if (r.http >= 500) { verdict = "!! 5xx 未处理错误"; deadly++; }
  else if (r.broken) { verdict = "!! 连接中断"; crashed++; deadly++; }
  say(`  ${name.padEnd(16)} ${method.padEnd(6)} http${r.http}  ${verdict}${r.err ? " " + r.err : ""}`);
}

say("");
say("=== 同组请求打原版作对照（原版 5xx 不等于缺陷，仅用于判断差异）===");
let origDeadly = 0;
for (const [name, method, path, body] of CASES) {
  const r = await probe(ORIG, oTk, method, path, body);
  if (isDeadly(r)) {
    origDeadly++;
    say(`  ${name.padEnd(16)} 原版亦 http${r.http}${r.broken ? " 连接中断" : ""}`);
  }
}
say(`  原版 5xx/中断 ${origDeadly} / ${CASES.length}`);

say("");
say("=== 结论 ===");
say(`恢复端：崩溃 ${crashed}｜5xx/缺陷 ${deadly} / ${CASES.length}`);
say(`服务存活：${(await alive(RECOVERED)) ? "是" : "否"}（原版 ${(await alive(ORIG)) ? "是" : "否"}）`);

writeFileSync(
  new URL(`../evidence/backend-runtime/eval-robustness-probe-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`, import.meta.url),
  log.join("\n") + "\n",
  "utf8",
);
