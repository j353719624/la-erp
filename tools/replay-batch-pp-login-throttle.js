#!/usr/bin/env node
// 批次 PP · 登录失败限流的**原版取证**（2026-10-15）。
//
// ## 起因（安全问题）
// 连续 30 次错误口令登录：
//   原版   → 前若干次 401「用户名或密码错误」，之后转为 **429「登录尝试过于频繁…」**
//   恢复端 → 始终 401，**没有任何限流** → 可被暴力破解
// 这是真实缺口，且原版有明确证据，属「对齐原版」而非自造行为。
//
// ## 需要取证的点（不能猜，猜错就是新差异）
//   ① 完整文案（含「请 X 分钟后重试」的 X）
//   ② 阈值：连续失败几次后触发
//   ③ 维度：按 IP 限、按用户名限、还是 IP+用户名
//   ④ 成功登录后是否清零
//   ⑤ 冷却期是否真的会恢复（等满后重试）
//
// ## 注意
// 原版限流是**有状态**的：跑过一轮后当前 IP 会进入冷却，
// 再次跑会得到不同的起点。故脚本先探测当前状态再决定怎么测，
// 并把「当前是否被限流」如实打印出来。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-login-throttle.js
import { writeFileSync } from "node:fs";

const ORIG = "http://192.168.110.97:18886";
const ACTUAL = process.env.OO_ACTUAL ?? "http://127.0.0.1:18886";
const PASS = process.env.ERP_PASSWORD;
if (!PASS) { console.error("缺少 ERP_PASSWORD"); process.exit(1); }

const log = [];
const say = (s) => { log.push(s); console.log(s); };
const stamp = Date.now().toString().slice(-6);

async function attempt(base, username, password) {
  const r = await fetch(base + "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, company: "default" }),
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, code: j?.code, msg: j?.message ?? "" };
}

const fmt = (r) => `http${r.http} code=${r.code ?? "-"} ${r.msg || "success"}`;

// ── ① 完整文案 + ② 阈值 ────────────────────────────────────────────
say("=== ① / ② 完整文案与阈值（原版，连续失败直到出现非 401）===");
let first429 = null;
for (let i = 1; i <= 15; i++) {
  const r = await attempt(ORIG, "admin", "wrong-" + stamp + "-" + i);
  say(`  第 ${String(i).padStart(2)} 次: ${fmt(r)}`);
  if (r.http !== 401 || !r.msg.includes("用户名或密码错误")) {
    first429 = { n: i, msg: r.msg, http: r.http, code: r.code };
    break;
  }
}
if (!first429) {
  say("  15 次内未触发限流（可能已被上一轮计入，或阈值 > 15）");
} else {
  say(`  阈值：第 ${first429.n} 次失败后触发`);
  say(`  文案：${first429.msg}`);
  say(`  状态：http${first429.http} code=${first429.code}`);
}

// ── ③ 限流维度 ────────────────────────────────────────────────────
say("");
say("=== ③ 限流维度：换一个不存在的用户名，看是否仍被限 ===");
{
  const r = await attempt(ORIG, "no-such-user-" + stamp, "wrong-pwd");
  say(`  不存在用户名: ${fmt(r)}`);
  say(`  判定：${r.msg.includes("过于频繁") ? "按 IP（换用户名仍被限）" : "按 用户名（换用户名即放行）"}`);
}

// ── ⑤ 恢复端对照 ──────────────────────────────────────────────────
say("");
say("=== 恢复端同组对照（当前应无限流）===");
for (let i = 1; i <= 12; i++) {
  const r = await attempt(ACTUAL, "admin", "wrong-" + stamp + "-" + i);
  if (i <= 3 || i >= 11) say(`  第 ${String(i).padStart(2)} 次: ${fmt(r)}`);
}

// ── ④ 成功后是否清零（仅当恢复端未实现时才跳过）──────────────────
say("");
say("=== ④ 正确口令登录：验证账号本身未被锁死（原版）===");
{
  const r = await attempt(ORIG, "admin", PASS);
  say(`  正确口令: ${fmt(r)}`);
  say(`  判定：${r.msg.includes("过于频繁") ? "限流未因正确口令解除" : "正确口令可正常登录（若此前被限，说明限流已解除或按用户名计）"}`);
}

writeFileSync(
  new URL(`../evidence/backend-runtime/audit-batch-pp-login-throttle-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`, import.meta.url),
  log.join("\n") + "\n",
  "utf8",
);
say("\n证据已落盘。");
