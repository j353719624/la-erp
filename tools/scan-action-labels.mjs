#!/usr/bin/env node
// 扫描业务层「动作端点」的两端响应形态差异。
//
// 起因（批次 LL，2026-10-15）：前面已核对过
//   · 路由是否存在（逐方法）
//   · 列表/详情形状
//   · 写路径「记录不存在」的形态
// 但**从未核对过动作端点（/{id}/confirm、/approve、/cancel…）在传入不存在记录时**
// 两端返回什么。前端这些按钮是高频触发的，文案/状态码错了用户立刻看到。
//
// 本脚本对每个动作端点各打一次「不存在的 id」，对比两端形态。
//
// 用法：ERP_PASSWORD=xxx node tools/scan-action-labels.mjs
import { readFileSync, writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const RECOVERED = "http://127.0.0.1:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }
const S = "00000000-0000-0000-0000-000000000001";

// 动作名：前端实际会调的那些
const ACTIONS = [
  "confirm", "approve", "cancel", "close", "reopen", "complete", "change", "issue",
  "send", "receive", "finish-receive", "issue-material", "return-material",
  "start", "revert", "bulk-report", "stage", "void", "settle", "pay", "receive-payment",
  "audit", "post", "commit", "terminate", "rescind", "move", "convert", "generate",
  "duplicate", "submit", "reject", "resume", "discard", "deliver", "dispatch",
];

// 从后端源码里提取「哪些资源注册了 /{id}/xxx 形式的动作端点」
const files = [
  "backend/internal/api/server.go",
  "backend/internal/api/document_actions.go",
  "backend/internal/api/production.go",
  "backend/internal/api/subcontracts.go",
  "backend/internal/api/reworks.go",
  "backend/internal/api/finance.go",
  "backend/internal/api/platform.go",
  "backend/internal/api/gapKK_writes.go",
];
const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
const resources = new Set();
// 形如 mux.Handle("POST /api/v1/<resource>/{id}/xxx" 或 "POST /api/v1/<resource>/{id}/"+action
for (const m of src.matchAll(/mux\.Handle\w*\("POST \/api\/v1\/([a-z0-9-]+)\/\{id\}/g)) resources.add(m[1]);
// 资源 × 动作的笛卡尔
const pairs = [];
for (const res of resources) {
  for (const act of ACTIONS) pairs.push(`/api/v1/${res}/${S}/${act}`);
}
console.log(`动作端点候选 ${pairs.length}（资源 ${resources.size} × 动作 ${ACTIONS.length}）\n`);

async function token(base, withCompany) {
  const payload = { username: "admin", password: PASS };
  if (withCompany) payload.company = "default";
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await r.json())?.data?.access_token ?? "";
}
const to = await token(ORIG, true);
const tr = await token(RECOVERED, false);
if (!to || !tr) { console.error("两端登录失败"); process.exit(1); }

async function probe(base, tk, path) {
  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const text = await res.text();
    if (res.status === 404 && /路由不存在/.test(text)) return { kind: "absent" };
    if (res.status === 501 || /尚未实现/.test(text)) return { kind: "unimplemented" };
    let code = null, message = "";
    try { const p = JSON.parse(text); code = p.code; message = p.message ?? ""; } catch { /* 非 JSON */ }
    return { kind: "exists", http: res.status, code, message };
  } catch (err) {
    return { kind: "error", message: String(err.message ?? err) };
  }
}

const both = [], diffs = [];
for (const path of pairs) {
  const [o, r] = [await probe(ORIG, to, path), await probe(RECOVERED, tr, path)];
  if (o.kind !== "exists" || r.kind !== "exists") continue; // 只比对两边都有的
  const same = o.http === r.http && o.code === r.code && o.message === r.message;
  (same ? both : diffs).push({ path, original: o, actual: r });
}

console.log(`两端都存在并比对: ${both.length + diffs.length}｜形态一致 ${both.length}｜不一致 ${diffs.length}\n`);
for (const d of diffs) {
  console.log(`${d.path.replace(S, "{id}")}`);
  console.log(`       原版   ${d.original.http} code=${d.original.code} ${JSON.stringify(d.original.message)}`);
  console.log(`       恢复端 ${d.actual.http} code=${d.actual.code} ${JSON.stringify(d.actual.message)}`);
}

writeFileSync(
  "evidence/backend-runtime/audit-batch-ll-actions-20261015.json",
  JSON.stringify({ generated: new Date().toISOString(), compared: both.length + diffs.length, same: both.length, diffs }, null, 2)
);
console.log("\n已写出 → evidence/backend-runtime/audit-batch-ll-actions-20261015.json");