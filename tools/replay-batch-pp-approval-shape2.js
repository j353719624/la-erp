#!/usr/bin/env node
// 批次 PP · 审批流列表的**软删除与字段**取证（2026-10-15）。
//
// 上一轮（replay-batch-pp-approvalflows.js）已确认 4 项差异：
// 结构（原版裸数组）/ 尾斜杠 404 / 排序（原版 created_at 升序）/ 多余字段 is_active。
// 改代码前还需确认两件事，否则会猜错：
//   ① 软删除的审批流是否还出现在列表里（决定 SQL 要不要加 deleted_at IS NULL）
//   ② 列表项的确切键集合（决定要剔除哪些字段）
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-approval-shape2.js
import { writeFileSync } from "node:fs";

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

async function call(base, tk, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { __nonJson: true }; }
  return { http: res.status, json };
}

const log = [];
const say = (s) => { log.push(s); console.log(s); };
const stamp = Date.now().toString().slice(-6);
const SIDE = [["原版", ORIG, oTk], ["恢复端", ACTUAL, rTk]];

const rowsOf = (data) => (Array.isArray(data) ? data : (data?.list ?? []));

say("=== ① 软删除后是否仍在列表 ===");
for (const [tag, base, tk] of SIDE) {
  const before = rowsOf((await call(base, tk, "GET", "/api/v1/approval-flows?page=1&page_size=500")).json?.data);
  const c = await call(base, tk, "POST", "/api/v1/approval-flows", {
    code: `DEL${stamp}`, name: `待删除${stamp}`, biz_type: "sales_order",
  });
  const id = c.json?.data?.id;
  if (!id) { say(`[${tag}] 建单失败 http${c.http} ${JSON.stringify(c.json).slice(0, 120)}`); continue; }
  const d = await call(base, tk, "DELETE", `/api/v1/approval-flows/${id}`);
  const after = rowsOf((await call(base, tk, "GET", "/api/v1/approval-flows?page=1&page_size=500")).json?.data);
  const stillThere = after.some((x) => x?.code === `DEL${stamp}`);
  say(`[${tag}] 建单 code=${c.json?.code} → 删除 http${d.http} code=${d.json?.code} ${d.json?.message ?? "success"}`);
  say(`[${tag}] 删除前 ${before.length} 条 → 删除后 ${after.length} 条；被删记录仍在列表 = ${stillThere}`);
  say(`[${tag}] 结论：SQL 需${stillThere ? "要" : "不需要"}加 deleted_at IS NULL`);
}

say("");
say("=== ② 列表项键集合 ===");
for (const [tag, base, tk] of SIDE) {
  const r = await call(base, tk, "GET", "/api/v1/approval-flows?page=1&page_size=500");
  const rows = rowsOf(r.json?.data);
  const keys = [...new Set(rows.flatMap((x) => Object.keys(x ?? {})))].sort();
  say(`[${tag}] ${keys.join(", ")}`);
}

say("");
say("=== ③ approval-records 键集合（原版为空，仅取字段；有数据时比排序）===");
for (const [tag, base, tk] of SIDE) {
  const r = await call(base, tk, "GET", "/api/v1/approval-records?page=1&page_size=500");
  const rows = rowsOf(r.json?.data);
  const keys = [...new Set(rows.flatMap((x) => Object.keys(x ?? {})))].sort();
  say(`[${tag}] 条数=${rows.length} 键=${keys.join(", ") || "(空)"}`);
}

writeFileSync(
  new URL(`../evidence/backend-runtime/audit-batch-pp-approval-shape2-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`, import.meta.url),
  log.join("\n") + "\n",
  "utf8",
);
say("证据已落盘。");
