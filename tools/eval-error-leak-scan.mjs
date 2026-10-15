#!/usr/bin/env node
// 生产就绪度：**错误响应信息泄漏**扫描（2026-10-15）。
//
// 面向外部的错误响应里若出现 SQL 原文、约束名、堆栈、文件路径，等于把
// 内部实现（表名、列名、ORM、部署路径）暴露给调用方 —— 属安全问题，
// 也是「错误处理可用性」的反面：真实原因没告诉运维，反倒告诉了攻击者。
//
// 本项目历史上有过此类问题并已收口（台账 44.3 凭证 type 泄漏、
// 42.3/45.x 的 `constraint failed: NOT NULL constraint failed: xxx.yyy (1299)`），
// 故把扫描固化下来，防止回潮。
//
// 用法：ERP_PASSWORD=xxx node tools/eval-error-leak-scan.mjs
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

// 泄漏特征（大小写不敏感）
const PATTERNS = [
  ["SQL 原文", /\b(select|insert into|update|delete from)\s+["'`[]?\w+/i],
  ["sqlite 错误", /sqlite[_\s]?(error|constraint|busy|locked)/i],
  ["约束名", /constraint\s+failed|not null constraint|unique constraint|foreign key constraint/i],
  ["表/列名", /\b(?:from|table)\s+["'`[]?(?:t_)?[a-z_]{3,}\.[a-z_]{3,}/i],
  ["ORM 原文", /record not found|no rows in result set|scan error|sql:/i],
  ["Go 堆栈", /goroutine \d+|\\n\\t|\.go:\d+:/i],
  ["文件路径", /[A-Za-z]:\\|\/(?:Users|home|var|tmp|app)\//i],
  ["panic", /\bpanic\b|runtime error/i],
];

async function probe(base, tk, method, path, body) {
  try {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { http: res.status, text };
  } catch (e) { return { http: -1, text: String(e) }; }
}

// 触发错误的高风险输入
const CASES = [];
const CASES_RAW = [
  ["缺必填", "POST", "/api/v1/products", {}],
  ["空载荷", "POST", "/api/v1/stock-ins", {}],
  ["空载荷", "POST", "/api/v1/vouchers", {}],
  ["空载荷", "POST", "/api/v1/approval-flows", {}],
  ["空载荷", "POST", "/api/v1/sales-orders", {}],
  ["空载荷", "POST", "/api/v1/purchase-orders", {}],
  ["空载荷", "POST", "/api/v1/work-orders", {}],
  ["空载荷", "POST", "/api/v1/boms", {}],
  ["空载荷", "POST", "/api/v1/payments", {}],
  ["空载荷", "POST", "/api/v1/payment-receipts", {}],
  ["空载荷", "POST", "/api/v1/stock-outs", {}],
  ["空载荷", "POST", "/api/v1/transfers", {}],
  ["空载荷", "POST", "/api/v1/adjustments", {}],
  ["空载荷", "POST", "/api/v1/checks", {}],
  ["空载荷", "POST", "/api/v1/expense-claims", {}],
  ["空载荷", "POST", "/api/v1/payrolls", {}],
  ["空载荷", "POST", "/api/v1/subcontracts", {}],
  ["空载荷", "POST", "/api/v1/reworks", {}],
  ["空载荷", "POST", "/api/v1/accounts", {}],
  ["空载荷", "POST", "/api/v1/currencies", {}],
  ["非法UUID详情", "GET", "/api/v1/products/not-a-uuid", undefined],
  ["非法UUID改", "PUT", "/api/v1/products/zzz", { name: "x" }],
  ["非法UUID删", "DELETE", "/api/v1/vouchers/zzz", undefined],
  ["错误类型", "POST", "/api/v1/products", { code: 1, name: [] }],
  ["超长值", "POST", "/api/v1/products", { code: "x".repeat(5000), name: "y" }],
];
for (const c of CASES_RAW) CASES.push(c);

const log = [];
const say = (s) => { log.push(s); console.log(s); };

for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", ACTUAL, rTk]]) {
  say(`\n=== ${tag} ===`);
  const hits = [];
  for (const [name, method, path, body] of CASES) {
    const r = await probe(base, tk, method, path, body);
    for (const [label, re] of PATTERNS) {
      if (re.test(r.text)) {
        hits.push(`  [${label}] ${method} ${path}\n      ${r.text.slice(0, 220)}`);
      }
    }
  }
  if (hits.length === 0) say("  无泄漏特征");
  else say(hits.join("\n"));
  say(`  泄漏命中 ${hits.length} 处 / ${CASES.length} 组请求`);
}

writeFileSync(
  new URL(`../evidence/backend-runtime/eval-error-leak-scan-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`, import.meta.url),
  log.join("\n") + "\n",
  "utf8",
);
say("\n证据已落盘。");
