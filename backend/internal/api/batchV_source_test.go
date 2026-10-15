package api

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// 本文件固化批次 V 取证（2026-10-14）的结论：
//   - aging / statement 对**非法日期一律 code:0**（静默忽略），本实现原先 501
//   - 凭证分录**无行数上限**（既有实现 1500 行通过），本实现原先限制 2..1000
// 证据见 运行快照。

// VV1：aging 对非法 as_of 放行（视为未指定）。
func TestSourceAgingIgnoresInvalidAsOf(t *testing.T) {
	c, _, _, _ := testFixture(t, "VV-AGING")
	for _, q := range []string{"", "?as_of=2026-13-45", "?as_of=abc", "?kind=xx"} {
		_, body := c.request("GET", "/api/v1/reports/finance/aging"+q, nil)
		if body["code"] != float64(0) {
			t.Fatalf("aging%s should succeed, got %#v", q, body)
		}
	}
	// 合法日期同样放行。
	if _, body := c.request("GET", "/api/v1/reports/finance/aging?as_of=2026-01-01", nil); body["code"] != float64(0) {
		t.Fatalf("aging with a valid as_of failed: %#v", body)
	}
}

// VV2：对账单对非法日期放行，且不得因此清空结果集。
func TestSourceStatementIgnoresInvalidDates(t *testing.T) {
	c, _, _, party := testFixture(t, "VV-STMT")
	// 先造一笔应收，确保合法区间能查出行。
	customer := party["customer"].(map[string]any)
	c.ok("POST", "/api/v1/ar-invoices", map[string]any{
		"customer_id": customer["id"], "invoice_date": batchBDate(), "total_amount": 100,
	})
	legal := c.ok("GET", "/api/v1/reports/finance/statement/customer?start_date=2000-01-01&end_date=2099-12-31", nil)
	illegal := c.ok("GET", "/api/v1/reports/finance/statement/customer?start_date=bad&end_date=bad", nil)
	// 非法日期被忽略 ⇒ 等价于不限定区间 ⇒ 行数不应少于合法区间。
	countRows := func(v any) int {
		m, _ := v.(map[string]any)
		n := 0
		for _, raw := range m {
			if _, ok := raw.(map[string]any); ok {
				n++
			}
		}
		return n
	}
	if countRows(illegal) < countRows(legal) {
		t.Fatalf("invalid dates must be ignored, not narrow the result: illegal=%d legal=%d (%s)",
			countRows(illegal), countRows(legal), trimJSON(illegal))
	}
}

// VV3：凭证分录无行数上限（既有实现 1500 行通过）。
func TestSourceVoucherHasNoEntryCountCap(t *testing.T) {
	c, s, _, _, _ := testFixtureWithServer(t, "VV-ENTRIES")
	rows, err := s.Store.Rows(context.Background(), "SELECT * FROM accounts")
	if err != nil || len(rows) == 0 {
		t.Fatal(err)
	}
	acc := map[string]map[string]any{}
	for _, r := range rows {
		acc[fmt.Sprint(r["code"])] = r
	}
	// 行数必须是偶数（借贷各半才能平衡）；1001 行既有实现同样报「借贷必须相等」，
	// 那与行数上限无关，故此处用 1002 与 1500 验证「无上限」。
	for _, n := range []int{2, 100, 1002, 1500} {
		entries := make([]any, 0, n)
		for i := 0; i < n; i++ {
			code := "1001"
			direction := "debit"
			if i%2 == 1 {
				code, direction = "6001", "credit"
			}
			entries = append(entries, map[string]any{
				"sequence": i + 1, "account_id": acc[code]["id"], "account_code": code,
				"account_name": acc[code]["name"], "direction": direction, "amount": 1,
			})
		}
		_, body := c.request("POST", "/api/v1/vouchers", map[string]any{
			"type": "general", "voucher_date": time.Now().UTC().Format(time.RFC3339Nano),
			"entries": entries,
		})
		if body["code"] != float64(0) {
			t.Fatalf("%d entries should be accepted by the original, got %#v", n, body)
		}
	}
	// 空分录仍拒绝，文案逐字对齐。
	_, body := c.request("POST", "/api/v1/vouchers", map[string]any{
		"type": "general", "voucher_date": time.Now().UTC().Format(time.RFC3339Nano),
		"entries": []any{},
	})
	if body["code"] == float64(0) || !strings.Contains(fmtMessage(body), "凭证分录不能为空") {
		t.Fatalf("empty entries must be rejected with the original message: %#v", body)
	}
}
