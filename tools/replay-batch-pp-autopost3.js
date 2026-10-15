#!/usr/bin/env node
// 批次 PP · 剩余 4 处自动过账点的端到端对照（2026-10-15）。
//
// ## 背景
// 批次 PP 已验证应收开票（payments.go:102）、工资计提（payroll_confirm.go:38）、
// 费用报销（expense_claims.go:74/91）三条。剩余 4 条尚未取证：
//   payments.go:354     收付款单 confirm（且 cash_account_code 非空）
//   service.go:1019     出入库 confirm（且 type 不是 other/空）
//   returns.go:126      退货 approve
//   tax_payment.go:49   税金缴纳（且 post_voucher=true）
//
// ## 观测口径：看**凭证产物**，不看 account balance
// 上一轮已证明 GET /accounts/{id}/balance 按 period 升序取首条，而原版库存在
// 0001-01-01 的脏数据行，任何真实日期都大不过它 → balance 观测失效。
// 故改为观测 vouchers：列表按 created_at 倒序（新增在最前），
// 动作后取 page=1&page_size=1 即得本次产生的凭证，再取详情读分录。
//
// ## 比较口径
// 只比**动作返回码 + 凭证增量 + 凭证头字段 + 分录（科目/方向/金额）**。
// 不比 id、created_at、单号数值 —— 两端是独立库，这些必然不同。
//
// 用法：ERP_PASSWORD=xxx node tools/replay-batch-pp-autopost3.js
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

// ---------- 种子数据 ----------
async function seeds(base, tk) {
  const pick = async (path) => ((await call(base, tk, "GET", path)).json?.data?.list ?? [])[0];
  const accounts = (await call(base, tk, "GET", "/api/v1/accounts?page=1&page_size=500")).json?.data?.list ?? [];
  return {
    customer: await pick("/api/v1/customers?page=1&page_size=1"),
    supplier: await pick("/api/v1/suppliers?page=1&page_size=1"),
    product: await pick("/api/v1/products?page=1&page_size=1"),
    warehouse: await pick("/api/v1/warehouses?page=1&page_size=1"),
    bank: accounts.find((a) => String(a.code).startsWith("1002")) ?? accounts.find((a) => String(a.code).startsWith("1001")),
    taxAccount: accounts.find((a) => String(a.code).startsWith("2221")) ?? accounts[0],
  };
}
const S = { 原版: await seeds(ORIG, oTk), 恢复端: await seeds(RECOVERED, rTk) };

// 两端是各自独立的库，`startsWith("2221")` 取到的第一条可能不同（原版是 2221、
// 恢复端是 2221.07），会让凭证分录科目对不上 —— 属**种子数据差异**而非逻辑差异。
// 故税费科目统一取「两端都存在」的代码（优先 2221，其次任一交集）。
{
  const list = async (tag) => ((await call(tag === "原版" ? ORIG : RECOVERED,
    tag === "原版" ? oTk : rTk, "GET", "/api/v1/accounts?page=1&page_size=500")).json?.data?.list ?? []);
  const codes = (await Promise.all([list("原版"), list("恢复端")]))
    .map((l) => new Set(l.map((a) => String(a.code))));
  const shared = [...codes[0]].filter((c) => codes[1].has(c));
  const pick = shared.includes("2221") ? "2221" : shared.find((c) => c.startsWith("2221")) ?? shared[0];
  for (const tag of ["原版", "恢复端"]) S[tag].taxAccount = { code: pick };
  say(`税费科目统一取 ${pick}（两端共有的科目代码 ${shared.length} 个）`);
}

// ---------- 凭证观测 ----------
async function voucherTotal(base, tk) {
  const r = await call(base, tk, "GET", "/api/v1/vouchers?page=1&page_size=1");
  return r.json?.data?.total ?? -1;
}
async function voucherDetail(base, tk, id) {
  const d = await call(base, tk, "GET", "/api/v1/vouchers/" + id);
  const v = d.json?.data ?? {};
  const entries = v.edges?.entries ?? [];
  const lines = entries.map((e) => `${e.account_code}/${e.direction}/${e.amount}`).join(" + ");
  return `type=${v.type} status=${v.status} src=${v.source_type} remark="${v.remark}" D=${v.total_debit} C=${v.total_credit} | 分录[${entries.length}] ${lines}`;
}

// ⚠️ 不要用「取列表第一条」来定位新凭证 —— 原版列表的排序不稳定，
// 首版脚本这样做时取到的是**上一次动作**留下的旧凭证（工资计提 / 采购入库），
// 于是 ①②④⑦⑧ 全部误报成不一致。
// 改为按 source_id（税金缴纳按 source_type，它的 source_id 是空串）**精确定位**。
async function findVoucher(base, tk, { sourceId, sourceType }, exclude = new Set()) {
  const match = sourceId
    ? (v) => v.source_id === sourceId
    : (v) => v.source_type === sourceType;
  for (let page = 1; page <= 8; page++) {
    const r = await call(base, tk, `GET`, `/api/v1/vouchers?page=${page}&page_size=50`);
    const list = r.json?.data?.list ?? [];
    const hit = list.find((v) => !exclude.has(v.id) && match(v));
    if (hit) return await voucherDetail(base, tk, hit.id);
    if (list.length < 50) break;
  }
  return "<未找到匹配的凭证>";
}

// ---------- 用例骨架 ----------
// 每个用例：build 建单 → act 执行动作；两端各自独立跑一遍
const CASES = [
  {
    name: "① 收款单 confirm（payment-receipts）",
    async build(base, tk, sd, no) {
      return call(base, tk, "POST", "/api/v1/payment-receipts", {
        customer_id: sd.customer?.id,
        receipt_date: "2026-05-20T00:00:00+08:00",
        amount: 500,
        receipt_type: "银行转账",
        cash_account_id: sd.bank?.id,
        cash_account_code: sd.bank?.code,
        remark: "过账验证" + no,
      });
    },
    act: (base, tk, id) => call(base, tk, "POST", `/api/v1/payment-receipts/${id}/confirm`, {}),
  },
  {
    name: "② 付款单 confirm（payments）",
    async build(base, tk, sd, no) {
      return call(base, tk, "POST", "/api/v1/payments", {
        supplier_id: sd.supplier?.id,
        payment_date: "2026-05-21T00:00:00+08:00",
        amount: 300,
        payment_type: "银行转账",
        cash_account_id: sd.bank?.id,
        cash_account_code: sd.bank?.code,
        remark: "过账验证" + no,
      });
    },
    act: (base, tk, id) => call(base, tk, "POST", `/api/v1/payments/${id}/confirm`, {}),
  },
  {
    name: "③ 采购入库 confirm（stock-ins, type= purchase）",
    async build(base, tk, sd, no) {
      return call(base, tk, "POST", "/api/v1/stock-ins", {
        supplier_id: sd.supplier?.id,
        warehouse_id: sd.warehouse?.id,
        stock_in_date: "2026-05-22T00:00:00+08:00",
        type: "purchase",
        remark: "过账验证" + no,
        lines: [{ product_id: sd.product?.id, qty: 2, unit_cost: 10 }],
      });
    },
    act: (base, tk, id) => call(base, tk, "POST", `/api/v1/stock-ins/${id}/confirm`, {}),
  },
  {
    name: "④ 销售出库 confirm（stock-outs, type=sale）",
    async build(base, tk, sd, no) {
      return call(base, tk, "POST", "/api/v1/stock-outs", {
        customer_id: sd.customer?.id,
        warehouse_id: sd.warehouse?.id,
        stock_out_date: "2026-05-23T00:00:00+08:00",
        type: "sale",
        remark: "过账验证" + no,
        lines: [{ product_id: sd.product?.id, qty: 1, unit_cost: 10 }],
      });
    },
    act: (base, tk, id) => call(base, tk, "POST", `/api/v1/stock-outs/${id}/confirm`, {}),
  },
  // 退货的过账点在 **approve**，但 approve 要求单据先处于「已确认」状态
  // （首版直接 approve，两端都回「只有已确认的…才能审批」，等于没测到过账）。
  // 故这里 build 之后先 confirm，act 阶段再 approve。
  {
    name: "⑤ 销售退货 confirm→approve（sales-returns）",
    confirmFirst: "/api/v1/sales-returns",
    async build(base, tk, sd, no) {
      return call(base, tk, "POST", "/api/v1/sales-returns", {
        customer_id: sd.customer?.id,
        warehouse_id: sd.warehouse?.id,
        order_date: "2026-05-24T00:00:00+08:00",
        total_amount: 200,
        remark: "过账验证" + no,
        lines: [{ product_id: sd.product?.id, qty: 1, unit_cost: 10, amount: 200 }],
      });
    },
    act: (base, tk, id) => call(base, tk, "POST", `/api/v1/sales-returns/${id}/approve`, {}),
  },
  {
    name: "⑥ 采购退货 confirm→approve（purchase-returns）",
    confirmFirst: "/api/v1/purchase-returns",
    async build(base, tk, sd, no) {
      return call(base, tk, "POST", "/api/v1/purchase-returns", {
        supplier_id: sd.supplier?.id,
        warehouse_id: sd.warehouse?.id,
        order_date: "2026-05-25T00:00:00+08:00",
        total_amount: 150,
        remark: "过账验证" + no,
        lines: [{ product_id: sd.product?.id, qty: 1, unit_cost: 10, amount: 150 }],
      });
    },
    act: (base, tk, id) => call(base, tk, "POST", `/api/v1/purchase-returns/${id}/approve`, {}),
  },
  {
    name: "⑦ 税金缴纳 post_voucher=true（tax-accruals/pay）",
    build: null, // 无需建单，直接调 pay
    voucherSourceType: "tax_payment",
    async act(base, tk, _id, sd, no) {
      return call(base, tk, "POST", "/api/v1/tax-accruals/pay", {
        items: [{ account_code: sd.taxAccount?.code, amount: 88 }],
        bank_code: sd.bank?.code,
        pay_date: "2026-05-26T00:00:00+08:00",
        post_voucher: true,
        remark: "过账验证" + no,
      });
    },
  },
  {
    name: "⑧ 税金缴纳 post_voucher=false（对照：只建草稿凭证）",
    build: null,
    voucherSourceType: "tax_payment",
    async act(base, tk, _id, sd, no) {
      return call(base, tk, "POST", "/api/v1/tax-accruals/pay", {
        items: [{ account_code: sd.taxAccount?.code, amount: 66 }],
        bank_code: sd.bank?.code,
        pay_date: "2026-05-27T00:00:00+08:00",
        post_voucher: false,
        remark: "过账验证" + no,
      });
    },
  },
];

let diff = 0;
for (const tc of CASES) {
  say(`\n=== ${tc.name} ===`);
  const out = {};
  for (const [tag, base, tk] of [["原版", ORIG, oTk], ["恢复端", RECOVERED, rTk]]) {
    const sd = S[tag];
    // 税金缴纳的凭证 remark 会**原样带上**传入的 remark，若带 O/R 后缀
    // 会让两端 remark 不同 → 假不一致。故统一用一个取样戳。
    // （单据类用例不受影响：它们的单号由各自库生成，比较串里不含 no。）
    const no = stamp;
    const before = await voucherTotal(base, tk);
    // 税金缴纳的 source_id 是空串，只能按 source_type 定位 —— 必须**先记录已有的
    // 同类型凭证并排除**，否则会命中上一次动作留下的旧凭证（首版因此误报 2 条）。
    let exclude = new Set();
    if (tc.voucherSourceType) {
      for (let page = 1; page <= 8; page++) {
        const r = await call(base, tk, "GET", `/api/v1/vouchers?page=${page}&page_size=50`);
        const list = r.json?.data?.list ?? [];
        for (const v of list) if (v.source_type === tc.voucherSourceType) exclude.add(v.id);
        if (list.length < 50) break;
      }
    }
    let id = "", buildMsg = "";
    if (tc.build) {
      const b = await tc.build(base, tk, sd, no);
      id = b.json?.data?.id ?? "";
      buildMsg = `建单 http${b.http} code=${b.json?.code ?? "-"}`;
      if (!id) { out[tag] = `${buildMsg} ${b.json?.message ?? "success"} ⇒ 建单失败，跳过动作`; continue; }
      // 退货类用例：过账点在 approve，而 approve 要求先 confirm
      if (tc.confirmFirst) {
        const cf = await call(base, tk, "POST", `${tc.confirmFirst}/${id}/confirm`, {});
        buildMsg += ` | confirm http${cf.http} code=${cf.json?.code ?? "-"} ${cf.json?.message ?? "success"}`;
      }
    }
    const a = await tc.act(base, tk, id, sd, no);
    const after = await voucherTotal(base, tk);
    const delta = after - before;
    const voucher = delta > 0
      ? await findVoucher(base, tk, { sourceId: id, sourceType: tc.voucherSourceType }, exclude)
      : "<未产生新凭证>";
    out[tag] = `${buildMsg} | 动作 http${a.http} code=${a.json?.code ?? "-"} ${a.json?.message ?? "success"} | 凭证增量=${delta} | ${voucher}`;
  }
  const same = out["原版"] === out["恢复端"];
  if (!same) diff++;
  say(`${same ? "  " : "!!"} 原版 : ${out["原版"] ?? "<未跑>"}`);
  say(`     恢复端: ${out["恢复端"] ?? "<未跑>"}`);
}
say(`\n不一致 = ${diff} / ${CASES.length}`);

writeFileSync(
  "C:/Users/35371/Desktop/11111/la-erp/evidence/backend-runtime/audit-batch-pp-autopost3-20261015.txt",
  log.join("\n") + "\n",
);
