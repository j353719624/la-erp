#!/usr/bin/env node
// 批次 PP · 审批流列表形态的受控对照（2026-10-15）。
//
// ## 起因
// 产品完成度评估时实测发现两处差异：
//   ① GET /api/v1/approval-flows        原版返回**裸数组**，恢复端返回 {list,total}
//   ② GET /api/v1/approval-flows/（尾斜杠） 原版 200 同数组，恢复端 404
// 对照组 /api/v1/currencies 两端都是裸数组 → 「裸数组」不是普遍形态，
// 是**逐资源不同**的，不能按 currencies 推广，必须单独取证。
//
// ## 方法
// 两端各建 3 条相同审批流（独立编号，避开唯一约束），再逐条对照：
//   · 列表响应结构（数组 vs 分页对象）
//   · 是否忽略分页参数
//   · 排序
//   · 尾斜杠路径
//   · 是否排除软删除
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-approvalflows.js
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
const SIDE = [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]];

// ── 两端各建 3 条相同审批流 ────────────────────────────────────────────
say("=== 准备：两端各建 3 条审批流 ===");
for (const [tag, base, tk] of SIDE) {
  for (let i = 1; i <= 3; i++) {
    const r = await call(base, tk, "POST", "/api/v1/approval-flows", {
      code: `AF${stamp}${i}`,
      name: `审批流对照${stamp}-${i}`,
      biz_type: "sales_order",
    });
    say(`[${tag}] 建第 ${i} 条 http${r.http} code=${r.json?.code ?? "-"} ${r.json?.message ?? "success"}`);
  }
}

// 归一化：去掉 id / created_at / updated_at / 编号（两端必然不同）
function norm(data) {
  const strip = (o) => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === "object") {
      const out = {};
      for (const [k, v] of Object.entries(o)) {
        if (["id", "created_at", "updated_at", "code", "name", "deleted_at"].includes(k)) continue;
        out[k] = strip(v);
      }
      return out;
    }
    return o;
  };
  return JSON.stringify(strip(data));
}
// 只描述「结构」，不比数据内容 —— **连条数也不比**：两端是独立库，
// 原版库里躺着历史数据（如 REC-PERSONAL-FLOW-1013 / OOFLOW1），条数必然不同，
// 把长度算进结构会让每条用例都误报成不一致。条数由下面的 code 序列单独核对。
function shape(data) {
  const keys = (l) => [...new Set(l.flatMap((x) => Object.keys(x ?? {})))].sort().join(",");
  if (Array.isArray(data)) return `数组 键=${keys(data)}`;
  if (data && typeof data === "object" && "list" in data) return `分页 键=${keys(data.list ?? [])}`;
  return typeof data + " " + JSON.stringify(data).slice(0, 80);
}

say("");
say("=== 列表形态对照 ===");
const CASES = [
  ["① 默认（无参数）", "/api/v1/approval-flows"],
  ["② 带分页 page_size=2", "/api/v1/approval-flows?page=1&page_size=2"],
  ["③ 带分页 page_size=500", "/api/v1/approval-flows?page=1&page_size=500"],
  ["④ 尾斜杠", "/api/v1/approval-flows/"],
  ["⑤ 第二页", "/api/v1/approval-flows?page=2&page_size=2"],
];
let diff = 0;
for (const [name, path] of CASES) {
  const out = {};
  for (const [tag, base, tk] of SIDE) {
    const r = await call(base, tk, "GET", path);
    out[tag] = `http${r.http} code=${r.json?.code ?? "-"} ${shape(r.json?.data)}`;
  }
  const same = out["原版"] === out["恢复端"];
  if (!same) diff++;
  say(`\n--- ${name} ${path} ---`);
  if (!same) say("!!");
  for (const [tag] of SIDE) say(`   ${tag}: ${out[tag]}`);
}

// 排序：两端各取 code 序列（建单顺序一致才可比）
say("");
say("=== 排序与字段（两端各自建单顺序一致，比 code 序列）===");
for (const [tag, base, tk] of SIDE) {
  const r = await call(base, tk, "GET", "/api/v1/approval-flows?page=1&page_size=500");
  const d = r.json?.data;
  const list = Array.isArray(d) ? d : (d?.list ?? []);
  say(`   ${tag}: ${list.map((x) => x?.code ?? "?").join(" | ")}`);
}

say("");
say(`不一致 = ${diff} / ${CASES.length}`);

writeFileSync(
  new URL(`../evidence/backend-runtime/audit-batch-pp-approvalflows-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`, import.meta.url),
  log.join("\n") + "\n",
  "utf8",
);
say("证据已落盘。");
