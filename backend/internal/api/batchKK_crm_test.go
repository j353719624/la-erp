package api

import (
	"fmt"
	"net/http"
	"testing"
)

// 本文件固化批次 KK 第二轮取证的结论（2026-10-15 回归回放（参考实例）：
// crm-opportunities 的阶段机与 purchase-reconciliations 的删除路径。

// TestKKCrmOpportunityStageMachine 商机阶段机。
//
// 本实现此前的四处偏差（均以实测为准）：
//
//	① 只校验 code+name，既有实现**只校验 name**（缺 name → 200/10000「商机名称不能为空」）
//	② 非法阶段返回 400「无效的商机阶段」，既有实现是 200/10000「阶段无效」
//	③ 允许**回退**阶段，既有实现只允许向前（回退 → 「只能向前推进阶段（当前：初步接触）」）
//	④ 推进阶段时**不改 probability**，既有实现按阶段同步改写（10→30→50→70→100）
//
// 终态锁定文案也不同：既有实现是「已赢单/已输单的商机不可再推进（当前：已赢单）」
// 且**同阶段**也拒绝，本实现原先只拦「不同阶段」。
func TestKKCrmOpportunityStageMachine(t *testing.T) {
	c, _, _, party := testFixture(t, "KK-CRM")
	cid := party["customer"].(map[string]any)["id"].(string)

	// ① 只校验 name，不校验 code
	status, body := c.request("POST", "/api/v1/crm-opportunities", map[string]any{})
	if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != "商机名称不能为空" {
		t.Fatalf("POST crm-opportunities 空载荷 = %d %v, want 200/10000/商机名称不能为空", status, body)
	}
	status, body = c.request("POST", "/api/v1/crm-opportunities", map[string]any{"code": "KK001"})
	if status != http.StatusOK || body["message"] != "商机名称不能为空" {
		t.Fatalf("POST 只给 code = %d %v, want 200/10000/商机名称不能为空（说明 code 非必填）", status, body)
	}

	// 默认值：stage=prospecting、probability=10
	created := c.ok("POST", "/api/v1/crm-opportunities", map[string]any{
		"name": "KK商机", "customer_id": cid,
	}).(map[string]any)
	id := created["id"].(string)
	if created["stage"] != "prospecting" {
		t.Fatalf("新建商机 stage = %v, want prospecting", created["stage"])
	}
	if got := fmt.Sprint(created["probability"]); got != "10" {
		t.Fatalf("新建商机 probability = %v, want 10", got)
	}

	// ② 非法阶段 → 200/10000「阶段无效」
	for _, stage := range []string{"lead", "qualified", "invalid"} {
		status, body = c.request("POST", "/api/v1/crm-opportunities/"+id+"/stage", map[string]any{"stage": stage})
		if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != "阶段无效" {
			t.Fatalf("stage=%s = %d %v, want 200/10000/阶段无效", stage, status, body)
		}
	}

	// ④ 逐阶段推进，probability 同步变化 10→30→50→70→100
	for _, tc := range []struct{ stage, probability string }{
		{"qualification", "30"}, {"proposal", "50"}, {"negotiation", "70"}, {"won", "100"},
	} {
		c.ok("POST", "/api/v1/crm-opportunities/"+id+"/stage", map[string]any{"stage": tc.stage})
		got := c.ok("GET", "/api/v1/crm-opportunities/"+id, nil).(map[string]any)
		if got["stage"] != tc.stage {
			t.Fatalf("推进后 stage = %v, want %s", got["stage"], tc.stage)
		}
		if p := fmt.Sprint(got["probability"]); p != tc.probability {
			t.Fatalf("推进到 %s 后 probability = %v, want %s", tc.stage, p, tc.probability)
		}
	}

	// 终态锁定：连**同阶段**都被拒，文案带中文阶段名
	const lockedMsg = "已赢单/已输单的商机不可再推进（当前：已赢单）"
	for _, stage := range []string{"won", "qualification", "lost"} {
		status, body = c.request("POST", "/api/v1/crm-opportunities/"+id+"/stage", map[string]any{"stage": stage})
		if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != lockedMsg {
			t.Fatalf("已赢单后推 %s = %d %v, want 200/10000/%s", stage, status, body, lockedMsg)
		}
	}

	// 记录不存在 → 200/10000「商机不存在」
	status, body = c.request("POST", "/api/v1/crm-opportunities/"+zeroUUID+"/stage", map[string]any{"stage": "won"})
	if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != "商机不存在" {
		t.Fatalf("不存在商机推阶段 = %d %v, want 200/10000/商机不存在", status, body)
	}
}

// TestKKCrmOpportunityCannotRegress 商机阶段**不可回退**（既有实现只允许向前，跳级允许）。
func TestKKCrmOpportunityCannotRegress(t *testing.T) {
	c, _, _, party := testFixture(t, "KK-CRM-REG")
	cid := party["customer"].(map[string]any)["id"].(string)
	created := c.ok("POST", "/api/v1/crm-opportunities", map[string]any{
		"name": "KK商机", "customer_id": cid,
	}).(map[string]any)
	id := created["id"].(string)

	c.ok("POST", "/api/v1/crm-opportunities/"+id+"/stage", map[string]any{"stage": "proposal"})

	// 回退到初步接触
	status, body := c.request("POST", "/api/v1/crm-opportunities/"+id+"/stage", map[string]any{"stage": "prospecting"})
	const regressMsg = "只能向前推进阶段（当前：方案报价）"
	if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != regressMsg {
		t.Fatalf("回退阶段 = %d %v, want 200/10000/%s", status, body, regressMsg)
	}
	if got := c.ok("GET", "/api/v1/crm-opportunities/"+id, nil).(map[string]any); got["stage"] != "proposal" {
		t.Fatalf("回退被拒后 stage 应仍为 proposal，实际 %v", got["stage"])
	}
	// 跳级向前是允许的
	c.ok("POST", "/api/v1/crm-opportunities/"+id+"/stage", map[string]any{"stage": "won"})
	if got := c.ok("GET", "/api/v1/crm-opportunities/"+id, nil).(map[string]any); got["stage"] != "won" {
		t.Fatalf("跳级推进应被允许，实际 stage = %v", got["stage"])
	}
}

// TestKKReconciliationDelete 对账单删除路径。
// 前端 purchaseReconApi.remove(id) 会调它，本实现此前落 501。
func TestKKReconciliationDelete(t *testing.T) {
	c, _, _, party := testFixture(t, "KK-RECON-DEL")
	supplierID := party["supplier"].(map[string]any)["id"].(string)

	// 记录不存在 → 200/10000「对账单不存在」
	status, body := c.request("DELETE", "/api/v1/purchase-reconciliations/"+zeroUUID, nil)
	if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != "对账单不存在" {
		t.Fatalf("DELETE 不存在的对账单 = %d %v, want 200/10000/对账单不存在", status, body)
	}

	// 真实记录可删，且删后从列表消失
	created := c.ok("POST", "/api/v1/purchase-reconciliations/generate", map[string]any{
		"supplier_id": supplierID, "period_start": "2026-10-01", "period_end": "2026-10-31",
	}).(map[string]any)
	id := created["id"].(string)
	c.ok("DELETE", "/api/v1/purchase-reconciliations/"+id, nil)

	rows := c.ok("GET", "/api/v1/purchase-reconciliations?page=1&page_size=50", nil).(map[string]any)["list"].([]any)
	for _, item := range rows {
		if item.(map[string]any)["id"] == id {
			t.Fatalf("已删的对账单 %s 仍在列表里", id)
		}
	}
}
