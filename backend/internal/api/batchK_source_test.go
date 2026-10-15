package api

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// 本文件固化批次 K 取证（2026-10-14）的结论。
//
// **凭证创建契约**（此前一直无法构造，卡住 vouchers.go 与 cashflow.go 两处取证，
//  由 evidence/backend-runtime/report-classification-contracts.json 反查得到）：
//   每条分录必须同时给 account_id + account_code + account_name，
//   顶层给 type / voucher_date / total_debit / total_credit / entries。
//   缺 account_name → 原版 400（Go 结构体绑定失败）。
//
// **cashflow.go 三处守卫全部是误拒**：原版现金流量表对以下情形一律 code:0：
//   对方科目在白名单之外（6401 / 6602）→ 归经营；两个现金科目 → 取其一；非两行凭证 → 照算。
//
// 证据见 evidence/backend-runtime/audit-batch-k-20261014.json。

type batchKEnv struct {
	client *client
	server *Server
	acct   map[string]map[string]any
}

func batchKSetup(t *testing.T, code string) batchKEnv {
	t.Helper()
	c, s := setup(t)
	rows, err := s.Store.Rows(context.Background(), "SELECT * FROM accounts")
	if err != nil {
		t.Fatal(err)
	}
	acct := map[string]map[string]any{}
	for _, r := range rows {
		acct[fmt.Sprint(r["code"])] = r
	}
	for _, need := range []string{"1001", "1002", "1122", "1405", "1601", "2001", "6001"} {
		if acct[need] == nil {
			t.Fatalf("缺少科目 %s", need)
		}
	}
	_ = code
	return batchKEnv{c, s, acct}
}

// entry 构造原版认可的分录形态（三字段齐全）。
func (e batchKEnv) entry(code, direction string, amount int, seq int) map[string]any {
	a := e.acct[code]
	return map[string]any{
		"sequence": seq, "account_id": a["id"], "account_code": code,
		"account_name": a["name"], "direction": direction, "amount": amount,
	}
}

func (e batchKEnv) voucher(remark string, entries ...map[string]any) map[string]any {
	debit, credit := 0, 0
	for _, x := range entries {
		if x["direction"] == "debit" {
			debit += x["amount"].(int)
		} else {
			credit += x["amount"].(int)
		}
	}
	return e.client.ok("POST", "/api/v1/vouchers", map[string]any{
		"type": "general", "voucher_date": time.Now().UTC().Format(time.RFC3339Nano),
		"remark": remark, "total_debit": debit, "total_credit": credit, "entries": entries,
	}).(map[string]any)
}

func (e batchKEnv) cashFlow() map[string]any {
	return e.client.ok("GET", "/api/v1/reports/finance/cash-flow?start_date=2026-01-01&end_date=2026-12-31", nil).(map[string]any)
}

func (e batchKEnv) cashNet(category string) string {
	for _, raw := range e.cashFlow()["items"].([]any) {
		item := raw.(map[string]any)
		if item["category"] == category {
			return item["net"].(string)
		}
	}
	return "missing"
}

// KK5：凭证的 type/source/currency 原版全部接受，恢复端不得拒。
func TestSourceVoucherAcceptsTypeSourceAndCurrency(t *testing.T) {
	e := batchKSetup(t, "KK-VOUCHER")
	base := map[string]any{
		"type": "general", "voucher_date": time.Now().UTC().Format(time.RFC3339Nano),
		"total_debit": 1, "total_credit": 1,
		"entries": []any{e.entry("1001", "debit", 1, 1), e.entry("6001", "credit", 1, 2)},
	}
	for _, tc := range []struct {
		name  string
		patch map[string]any
	}{
		{"type_adjustment", map[string]any{"type": "adjustment"}},
		{"source", map[string]any{"source_id": "00000000-0000-0000-0000-000000000001", "source_type": "x"}},
		{"currency", map[string]any{"currency_code": "USD"}},
	} {
		body := map[string]any{}
		for k, v := range base {
			body[k] = v
		}
		for k, v := range tc.patch {
			body[k] = v
		}
		if _, out := e.client.request("POST", "/api/v1/vouchers", body); out["code"] == float64(0) {
			continue
		} else {
			t.Fatalf("%s should be accepted by the original: %#v", tc.name, out)
		}
	}
	// 借贷不等仍拒绝，文案与原版逐字一致。
	unbalanced := map[string]any{}
	for k, v := range base {
		unbalanced[k] = v
	}
	unbalanced["entries"] = []any{e.entry("1001", "debit", 2, 1), e.entry("6001", "credit", 1, 2)}
	_, body := e.client.request("POST", "/api/v1/vouchers", unbalanced)
	if body["code"] == float64(0) || fmtMessage(body) != "借方金额与贷方金额必须相等" {
		t.Fatalf("unbalanced voucher: %#v", body)
	}
}

// KK1：对方科目在白名单之外时现金流量表仍 code:0，且该笔计入经营。
func TestSourceCashFlowFallsBackToOperating(t *testing.T) {
	e := batchKSetup(t, "KK-CF-6401")
	// 6401/6602 是恢复端原白名单之外的科目；用库里存在的任意非白名单科目兜底。
	other := ""
	for code := range e.acct {
		switch code {
		case "1001", "1002", "1122", "1405", "1601", "2001", "2202", "6001", "6401", "6602":
			continue
		}
		other = code
		break
	}
	if other == "" {
		t.Skip("库中没有白名单外的可用科目")
	}
	before := e.cashNet("operating")
	doc := e.voucher("KK-其他科目", e.entry("1001", "debit", 13, 1), e.entry(other, "credit", 13, 2))
	e.client.ok("POST", "/api/v1/vouchers/"+doc["id"].(string)+"/post", nil)
	after := e.cashNet("operating")
	if before == after {
		t.Fatalf("voucher with counter account %s was silently dropped: %s", other, after)
	}
}

// KK2：同一凭证含两个现金科目时现金流量表仍 code:0。
func TestSourceCashFlowToleratesTwoCashAccounts(t *testing.T) {
	e := batchKSetup(t, "KK-CF-2CASH")
	doc := e.voucher("KK-两个现金科目",
		e.entry("1001", "debit", 3, 1),
		e.entry("1002", "debit", 4, 2),
		e.entry("1122", "credit", 7, 3),
	)
	e.client.ok("POST", "/api/v1/vouchers/"+doc["id"].(string)+"/post", nil)
	// 只要报表可返回即可（原版亦为 code:0）。
	if !strings.Contains(trimJSON(e.cashFlow()), "operating") {
		t.Fatal("cash flow report broken after a two-cash-account voucher")
	}
}

// KK3：现金凭证不是两行（四行）时现金流量表仍 code:0。
func TestSourceCashFlowToleratesNonPairVoucher(t *testing.T) {
	e := batchKSetup(t, "KK-CF-4LINE")
	doc := e.voucher("KK-四行",
		e.entry("1001", "debit", 5, 1),
		e.entry("1122", "credit", 5, 2),
		e.entry("6001", "debit", 5, 3),
		e.entry("1405", "credit", 5, 4),
	)
	e.client.ok("POST", "/api/v1/vouchers/"+doc["id"].(string)+"/post", nil)
	if !strings.Contains(trimJSON(e.cashFlow()), "operating") {
		t.Fatal("cash flow report broken after a four-line voucher")
	}
}

// KK7：凭证动作不存在时的文案逐字对齐原版。
func TestSourceVoucherActionMessages(t *testing.T) {
	e := batchKSetup(t, "KK-VOU-ACT")
	const missing = "00000000-0000-0000-0000-000000000000"
	for _, tc := range []struct{ action, want string }{
		{"approve", "凭证不存在或状态不允许审批"},
		{"post", "凭证不存在或状态不允许过账"},
		{"cancel", "凭证不存在或状态不允许取消"},
	} {
		path := "/api/v1/vouchers/" + missing + "/" + tc.action
		if tc.action == "approve" {
			path += "?approver_id=00000000-0000-0000-0000-000000000001"
		}
		if _, body := e.client.request("POST", path, nil); fmtMessage(body) != tc.want {
			t.Fatalf("%s message: %#v", tc.action, body)
		}
	}
	// 恢复端同样只注册 approve/post/cancel + HTTP DELETE 四个动作
	// （见 internal/api/vouchers.go 的动作列表），不额外探测原版 404 的动作。
}

// KK6：已过账凭证的 HTTP DELETE 与取消文案逐字对齐原版。
func TestSourceVoucherDeleteAndCancelGuards(t *testing.T) {
	e := batchKSetup(t, "KK-VOU-DEL")
	draft := e.voucher("KK-草稿", e.entry("1001", "debit", 2, 1), e.entry("6001", "credit", 2, 2))
	e.client.ok("POST", "/api/v1/vouchers/"+draft["id"].(string)+"/post", nil)
	if _, body := e.client.request("DELETE", "/api/v1/vouchers/"+draft["id"].(string), nil); fmtMessage(body) != "只有草稿状态的凭证才能删除" {
		t.Fatalf("delete posted voucher: %#v", body)
	}
	cancelled := e.client.ok("POST", "/api/v1/vouchers/"+draft["id"].(string)+"/cancel", nil).(map[string]any)
	if cancelled["status"] != "cancelled" {
		t.Fatalf("cancel posted voucher: %v", cancelled["status"])
	}
}
