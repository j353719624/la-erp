package api

// 批次 PP（2026-10-15）：费用报销状态机五个动作的文案与 cancel 准入规则。
//
// 依据：
//   - tools/replay-batch-pp-expense.js（8 用例，audit-batch-pp-expense-20261015.txt）
//   - tools/replay-batch-pp-expense2.js（E9/E10/E11，audit-batch-pp-expense2-20261015.txt）
//
// 原版文案一律是「只有<状态>的报销单才能<动作>」，恢复端此前是简写形态，
// 五个动作**逐条不同**，不得只改一条就推广。

import (
	"net/http"
	"testing"
)

// ppNewClaim 建一张草稿报销单，返回 id。
func ppNewClaim(t *testing.T, c *client, remark string) string {
	t.Helper()
	data := c.ok(http.MethodPost, "/api/v1/expense-claims", map[string]any{
		"employee_name": "PP报销取证",
		"claim_date":    "2026-04-10T00:00:00+08:00",
		"total_amount":  100,
		"remark":        remark,
		"lines": []any{map[string]any{
			"expense_date": "2026-04-10T00:00:00+08:00",
			"category":     "差旅费",
			"amount":       100,
		}},
	}).(map[string]any)
	return data["id"].(string)
}

func ppAct(c *client, id, action string) (int, map[string]any) {
	return c.request(http.MethodPost, "/api/v1/expense-claims/"+id+"/"+action, map[string]any{})
}

// TestPPExpenseActionMessages 五个动作在「状态不满足」时的逐字文案。
func TestPPExpenseActionMessages(t *testing.T) {
	c, _ := setup(t)
	for _, tc := range []struct {
		action string
		// prep 为 nil 表示直接对草稿单执行；否则先跑前置动作
		prep   []string
		want   string
	}{
		{"approve", nil, "只有已提交的报销单才能审批"},
		{"reject", nil, "只有已提交的报销单才能驳回"},
		{"paid", nil, "只有已审批的报销单才能标记付款"},
		{"submit", []string{"submit"}, "只有草稿状态的报销单才能提交"},
		{"cancel", []string{"submit"}, "只有草稿状态的报销单才能取消"},
	} {
		id := ppNewClaim(t, c, "PP-"+tc.action)
		for _, p := range tc.prep {
			if status, body := ppAct(c, id, p); status != 200 || body["code"] != float64(0) {
				t.Fatalf("前置 %s 失败: %d %v", p, status, body)
			}
		}
		status, body := ppAct(c, id, tc.action)
		if status != 200 || body["code"] != float64(10000) || body["message"] != tc.want {
			t.Errorf("expense %s = %d %v, want 200/10000 %s", tc.action, status, body["message"], tc.want)
		}
	}
}

// TestPPExpenseCancelOnlyDraft cancel 是**逻辑差异**而非仅文案：
// 原版 submitted → cancel 被拒，恢复端原先放行。
func TestPPExpenseCancelOnlyDraft(t *testing.T) {
	c, _ := setup(t)
	// draft → cancel 必须成功（两端一致）
	id := ppNewClaim(t, c, "PP-cancel-draft")
	if status, body := ppAct(c, id, "cancel"); status != 200 || body["code"] != float64(0) {
		t.Errorf("draft cancel = %d %v, want 200/0", status, body)
	}
	// submitted → cancel 必须被拒
	id2 := ppNewClaim(t, c, "PP-cancel-submitted")
	if status, _ := ppAct(c, id2, "submit"); status != 200 {
		t.Fatalf("submit = %d", status)
	}
	if status, body := ppAct(c, id2, "cancel"); status != 200 || body["message"] != "只有草稿状态的报销单才能取消" {
		t.Errorf("submitted cancel = %d %v, want 拒绝", status, body)
	}
	if status, body := c.request(http.MethodGet, "/api/v1/expense-claims/"+id2, nil); status != 200 {
		t.Fatalf("get = %d", status)
	} else if got := body["data"].(map[string]any)["status"]; got != "submitted" {
		t.Errorf("被拒后状态应保持 submitted，实际 %v", got)
	}
}

// TestPPExpenseHappyPath 完整成功链路不被守卫误伤：
// submit → approve（过账 借6602/贷2211）→ paid（过账 借2211/贷1001）。
func TestPPExpenseHappyPath(t *testing.T) {
	c, _ := setup(t)
	id := ppNewClaim(t, c, "PP-happy")
	for _, action := range []string{"submit", "approve", "paid"} {
		if status, body := ppAct(c, id, action); status != 200 || body["code"] != float64(0) {
			t.Fatalf("%s = %d %v, want 200/0", action, status, body)
		}
	}
	body := c.ok(http.MethodGet, "/api/v1/expense-claims/"+id, nil).(map[string]any)
	if body["status"] != "paid" || body["payment_status"] != "paid" {
		t.Errorf("终态 = %v/%v, want paid/paid", body["status"], body["payment_status"])
	}
}
