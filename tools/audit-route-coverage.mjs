#!/usr/bin/env node
// 路由覆盖对账：用「无 token 探测」判断某路径在两端是否存在。
//
//   原版   401「未提供认证令牌」→ 路由存在；404「路由不存在」→ 不存在
//   恢复端 401 → 路由存在；501「该业务接口尚未实现」→ 不存在
//
// 候选路径来源：
//   1. evidence/backend-runtime/**.json（历史回放记录里的 endpoint/path/url）
//   2. frontend/src/api/**.ts（前端真实调用）
// 归一化：去掉查询串；`${...}` 与 `{...}` 统一替换为样例 UUID。
//
// 用法：node tools/audit-route-coverage.mjs [--orig URL] [--actual URL]
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/35371/Desktop/11111/la-erp";
const ORIG = arg("--orig", "http://192.168.110.97:18886");
const ACTUAL = arg("--actual", "http://127.0.0.1:18886");
const SAMPLE = "00000000-0000-0000-0000-000000000001";

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function walk(dir, pred, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(dir === ROOT ? p : p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// ---------- 收集候选路径 ----------
// 三种来源都要覆盖，缺一会漏：
//   1. evidence/backend-runtime/**.json（历史回放里的绝对路径 /api/v1/...）
//   2. frontend/src/api/**.ts（前端用相对路径 /v1/...，需补 /api 前缀）
//   3. backend/internal/**.go（恢复端自己的路由注册串）
//   4. docs/original-frontend-api-contracts.txt 与 docs/original-binary-routes.txt
//      （原版路由清单，含前端没调用、恢复端也没注册的入口）
const candidates = new Set();
const addFrom = (text) => {
  for (const m of text.matchAll(/\/api\/v1\/[A-Za-z0-9\-_/${}.]+/g)) {
    let p = m[0].replace(/\?.*$/, "").replace(/[),;'"`]+$/, "");
    p = p.replace(/\$\{[^}]*\}/g, SAMPLE).replace(/\{[a-zA-Z_]+\}/g, SAMPLE);
    p = p.replace(/\/+$/, "");
    if (p.split("/").length >= 4 && !p.includes("$")) candidates.add(p);
  }
  for (const m of text.matchAll(/\/v1\/[A-Za-z0-9\-_/${}.]+/g)) {
    let p = m[0].replace(/\?.*$/, "").replace(/[),;'"`]+$/, "");
    p = p.replace(/\$\{[^}]*\}/g, SAMPLE).replace(/\{[a-zA-Z_]+\}/g, SAMPLE);
    p = p.replace(/\/+$/, "");
    // 先补 /api 前缀再做段数判断：/v1/print-templates 只有两段，补前缀后才是四段
    const full = "/api" + p;
    if (full.split("/").length >= 4 && !full.includes("$")) candidates.add(full);
  }
};

for (const f of walk(join(ROOT, "evidence/backend-runtime"), (p) => p.endsWith(".json"))) addFrom(readFileSync(f, "utf8"));
for (const f of walk(join(ROOT, "frontend/src"), (p) => p.endsWith(".ts") || p.endsWith(".tsx"))) addFrom(readFileSync(f, "utf8"));
for (const f of walk(join(ROOT, "backend/internal"), (p) => p.endsWith(".go") && !p.endsWith("_test.go"))) addFrom(readFileSync(f, "utf8"));
for (const f of ["docs/original-frontend-api-contracts.txt", "docs/original-binary-routes.txt"]) {
  try { addFrom(readFileSync(join(ROOT, f), "utf8")); } catch { /* 文件可选 */ }
}

// ---------- 探测 ----------
// 判定规则：GET/POST 任一「已注册」（401/400/405/200 等）即视为存在；
// 两者都 404/501 才视为不存在。注意 GET 命中 POST-only 路由时
// Go ServeMux 回 405、原版（Gin）回 404，故不能用 GET 单次结果下结论。
async function probe(base, path) {
  let sawMissing = false;
  for (const method of ["GET", "POST"]) {
    try {
      const res = await fetch(base + path, { method, redirect: "manual" });
      const body = await res.text();
      if (res.status === 404 && /路由不存在/.test(body)) { sawMissing = true; continue; }
      if (res.status === 501 || /尚未实现/.test(body)) { sawMissing = true; continue; }
      return "exists"; // 401/400/405/200/业务 404 都说明路由已注册
    } catch {
      return "error";
    }
  }
  return sawMissing ? "missing" : "absent";
}

// ---------- 带凭据的逐方法探测（批次 KK 用）----------
//
// 只看「路由在不在」不够：同一路径在两端的**失败形态**可能不同，
// 而这正是契约差异。批次 KK 实测（2026-10-15）：
//
//	原版   POST /work-orders/{id}/confirm  → 200 code:10000「工单不存在」
//	恢复端 POST /work-orders/{id}/confirm  → 404「记录不存在」
//
// 两端路由都在（探针都判 exists），但**对不存在记录的行为不一致**。
// 故对「两端都判 exists」的路径追加一次带 token 的逐方法比对，
// 把「存在但语义不同」这类差异也纳入报告。
//
// 另一个盲区在探针方法集合上：原版 Gin 对 POST-only 路由的 GET 直接回
// 404「路由不存在」（不是 405），所以只发 GET 会误判「不存在」；
// 但反过来，恢复端若用 `{id}` 通配兜住了路径，POST 会返回业务 404，
// 同样会被误判成「存在」。两边都需要逐方法比对才能定性。
const METHODS = ["GET", "POST", "PUT", "DELETE"];
async function probeDetailed(base, path, token) {
  const headers = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : {};
  const out = {};
  for (const method of METHODS) {
    try {
      const res = await fetch(base + path, { method, headers, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
      const body = await res.text();
      let kind;
      if (res.status === 404 && /路由不存在/.test(body)) kind = "absent";
      else if (res.status === 501 || /尚未实现/.test(body)) kind = "unimplemented";
      else if (res.status === 401) kind = "registered";
      else if (res.status === 405) kind = "method-mismatch";
      else {
        try {
          const parsed = JSON.parse(body);
          kind = `http${res.status}/code${parsed.code}`;
        } catch { kind = `http${res.status}`; }
      }
      out[method] = kind;
    } catch {
      out[method] = "error";
    }
  }
  return out;
}

// ---------- 两处误判的修正 ----------
// (1) 无 token 探测时，恢复端的受保护路由一律回 401（=「已注册」），因此无法区分
//     「真注册了」与「注册了但内容就是 404 路由不存在」。批次 HH 后恢复端有 9 条
//     详情路由是**故意注册**并逐字返回 404「路由不存在」的（与原版一致），必须
//     带 token 复探才能看清。复探只打恢复端（本地一次性库），不影响原版。
// (2) probe 只发 GET/POST，PUT-only 路由（如 /notifications/read-all）在原版被
//     判为缺失。这类已用带凭据回放逐条确认过，见 verifiedOnOriginal。
const ACTUAL_PASS = process.env.ERP_PASSWORD;
let srcToken = "";
let originalToken = "";
if (ACTUAL_PASS) {
  // 原版登录**必须带 company=default**（批次 HH 起的既有约定）；恢复端不需要。
  // 少了这个参数原版登录会失败，脚本静默退回「无 token 口径」—— 而那个口径下
  // 受保护路由一律 401，看不出「存在但语义不同」，报出的缺口数是假的。
  const login = async (base, withCompany) => {
    const payload = { username: "admin", password: ACTUAL_PASS };
    if (withCompany) payload.company = "default";
    try {
      const r = await fetch(`${base}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return (await r.json())?.data?.access_token ?? "";
    } catch { return ""; }
  };
  // 原版也登录：批次 KK 要比对「存在但语义不同」，无 token 只能看到 401，看不出差异。
  originalToken = await login(ORIG, true);
  srcToken = await login(ACTUAL, false);
  if (!originalToken || !srcToken) {
    console.error("带凭据复探需要两端都能登录（ERP_PASSWORD），已退回无 token 口径。");
  }
}

async function probeAuthorized(base, path, token) {
  for (const method of ["GET", "POST"]) {
    const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}` } });
    const body = await res.text();
    if (res.status === 404 && /路由不存在/.test(body)) return "missing";
    if (res.status === 501 || /尚未实现/.test(body)) return "missing";
    return "exists";
  }
  return "missing";
}

// 已在原版上用带凭据回放确认存在、但 GET/POST 探测看不出来的路由。
// 证据：evidence/backend-runtime/audit-batch-hh-notifications-20261014.json
const verifiedOnOriginal = new Set([
  "/api/v1/notifications/read-all", // PUT，原版 200 {updated:121}
]);

const rows = [];
for (const path of [...candidates].sort()) {
  let orig = await probe(ORIG, path);
  let rec = await probe(ACTUAL, path);
  if (verifiedOnOriginal.has(path) && orig !== "exists") {
    orig = "exists";
  }
  // 原版缺失、恢复端「存在」的，带 token 复探恢复端；若其真实语义就是
  // 404「路由不存在」，说明两端一致（都不该有），不再算作恢复端独有。
  if (orig !== "exists" && rec === "exists" && srcToken) {
    rec = await probeAuthorized(ACTUAL, path, srcToken);
  }
  const row = { path, orig, actual: rec };
  // 两端都判「存在」时，追加逐方法语义比对（批次 KK）。
  // 只在「方法集合或失败形态不一致」时记录，避免报告被上百条一致项淹没。
  if (orig === "exists" && rec === "exists" && originalToken && srcToken) {
    const [o, r] = await Promise.all([
      probeDetailed(ORIG, path, originalToken),
      probeDetailed(ACTUAL, path, srcToken),
    ]);
    const diff = [];
    for (const method of METHODS) {
      // 恢复端 501「尚未实现」视为缺失（原版没这个概念）
      const recoverKind = r[method] === "unimplemented" ? "absent" : r[method];
      if (o[method] !== recoverKind) diff.push(`${method}: 原版=${o[method]} 恢复端=${recoverKind}`);
    }
    if (diff.length) row.methodDiff = diff;
  }
  rows.push(row);
}

const gap = rows.filter((r) => r.orig === "exists" && r.actual !== "exists");
const srcOnly = rows.filter((r) => r.orig !== "exists" && r.actual === "exists");
const both = rows.filter((r) => r.orig === "exists" && r.actual === "exists");
const methodDiff = rows.filter((r) => r.methodDiff);

const out = {
  generated: new Date().toISOString(),
  base: { original: ORIG, actual: ACTUAL },
  summary: {
    candidates: rows.length,
    bothExist: both.length,
    originalOnly: gap.length,
    srcOnly: srcOnly.length,
    methodMismatch: methodDiff.length,
  },
  gap,
  srcOnly,
  methodMismatch: methodDiff,
};
writeFileSync(join(ROOT, "evidence/backend-runtime/route-coverage.json"), JSON.stringify(out, null, 2));

console.log(`候选路径 ${rows.length}｜两端都有 ${both.length}｜原版有恢复端无 ${gap.length}｜仅恢复端有 ${srcOnly.length}｜存在但方法/形态不一致 ${methodDiff.length}`);
for (const g of gap) console.log("  ✗ " + g.path);
for (const m of methodDiff) console.log(`  ≠ ${m.path}\n      ${m.methodDiff.join("\n      ")}`);
for (const r of srcOnly) console.log("  + " + r.path + "（恢复端独有）");
