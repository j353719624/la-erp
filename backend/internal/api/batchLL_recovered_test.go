package api

import (
	"net/http"
	"testing"
)

// 本文件固化批次 LL 的取证结论（2026-10-15 原版回放 192.168.110.97:18886）：
// 动作端点（/{id}/<action>）「记录不存在」的响应形态。
//
// 起因：前几轮核对了「路由存在性」「列表/详情形状」「写路径 notFound」，
// 但从未核对动作端点的 notFound 形态。这些是前端高频按钮，
// 文案或状态码错了用户立刻看到。
//
// 证据：evidence/backend-runtime/audit-batch-ll-actions-20261015.json
// （25 资源 × 36 动作，两端都存在的 40 组里 35 组不一致）

// TestLLActionNotFoundShape 动作端点 notFound 形态（代表性抽样 + 配置表完整性）。
func TestLLActionNotFoundShape(t *testing.T) {
	c, _ := setup(t)
	const absent = zeroUUID

	// ① 原版用业务错误形态（200 + 10000 + 中文文案），恢复端此前是 404
	for _, tc := range []struct{ route, action, message string }{
		{"accounting-periods", "close", "会计期间不存在"},
		{"accounting-periods", "reopen", "会计期间不存在"},
		{"payrolls", "confirm", "工资批次不存在"},
		{"work-orders", "confirm", "工单不存在"},
		{"work-order-processes", "complete", "工序不存在"},
	} {
		status, body := c.request("POST", "/api/v1/"+tc.route+"/"+absent+"/"+tc.action, map[string]any{})
		if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != tc.message {
			t.Fatalf("POST /%s/{id}/%s = %d %v, want 200/10000/%s", tc.route, tc.action, status, body, tc.message)
		}
	}

	// ② 原版 400（形态不同），恢复端此前是 404
	for _, tc := range []struct{ route, action, message string }{
		{"payment-plans", "cancel", "收付款计划不存在"},
	} {
		status, body := c.request("POST", "/api/v1/"+tc.route+"/"+absent+"/"+tc.action, map[string]any{})
		if status != http.StatusBadRequest || body["message"] != tc.message {
			t.Fatalf("POST /%s/{id}/%s = %d %v, want 400/%s", tc.route, tc.action, status, body, tc.message)
		}
	}

	// ③ 原版 500 通用文案，恢复端此前是 200/10000
	for _, action := range []string{"confirm", "cancel"} {
		status, body := c.request("POST", "/api/v1/assemblies/"+absent+"/"+action, map[string]any{})
		if status != http.StatusInternalServerError || body["message"] != "系统内部错误，请稍后重试或联系管理员" {
			t.Fatalf("POST /assemblies/{id}/%s = %d %v, want 500/通用文案", action, status, body)
		}
	}

	// ④ 仅文案不同（形态同为 200/10000）
	for _, tc := range []struct{ route, action, message string }{
		{"expense-claims", "approve", "报销单不存在"},
		{"expense-claims", "cancel", "报销单不存在"},
		{"expense-claims", "submit", "报销单不存在"},
		{"expense-claims", "reject", "报销单不存在"},
		{"labor-contracts", "terminate", "合同不存在"},
	} {
		status, body := c.request("POST", "/api/v1/"+tc.route+"/"+absent+"/"+tc.action, map[string]any{})
		if status != http.StatusOK || body["message"] != tc.message {
			t.Fatalf("POST /%s/{id}/%s = %d %v, want 200/%s", tc.route, tc.action, status, body, tc.message)
		}
	}

	// 配置表完整性：回放实测 35 组不一致
	if len(actionNotFoundShapes) != 35 {
		t.Fatalf("actionNotFoundShapes 配了 %d 组，回放实测 35 组", len(actionNotFoundShapes))
	}
}

// TestLLActionSameResourceDifferentText 同一资源的不同动作文案可以不同，
// 故配置表必须按「资源|动作」而非按资源做键。
//
// 实测：purchase-requisitions 的 convert 是「采购申请单不存在」，
// 而 submit/approve 等是「采购申请不存在」。
func TestLLActionSameResourceDifferentText(t *testing.T) {
	c, _ := setup(t)
	const absent = zeroUUID

	status, body := c.request("POST", "/api/v1/purchase-requisitions/"+absent+"/convert", map[string]any{})
	if status != http.StatusOK || body["message"] != "采购申请不存在" {
		t.Fatalf("convert = %d %v, want 200/采购申请不存在", status, body)
	}
	// approve/cancel 走的是「采购申请单不存在」
	status, body = c.request("POST", "/api/v1/purchase-requisitions/"+absent+"/approve", map[string]any{})
	if status != http.StatusOK || body["message"] != "采购申请单不存在" {
		t.Fatalf("approve = %d %v, want 200/采购申请单不存在", status, body)
	}
	// 配置表里两个键必须各自存在，不能共用
	if _, ok := actionNotFoundShapes["purchase-requisitions|convert"]; !ok {
		t.Fatal("配置表缺少 purchase-requisitions|convert")
	}
	if _, ok := actionNotFoundShapes["purchase-requisitions|approve"]; !ok {
		t.Fatal("配置表缺少 purchase-requisitions|approve")
	}
}

// TestLLActionPassthroughUnconfigured 未配置的动作端点必须**完全透传**，
// 不能被中间件改写。
func TestLLActionPassthroughUnconfigured(t *testing.T) {
	c, _ := setup(t)
	const absent = zeroUUID

	// crm-opportunities/{id}/stage 未在配置表里（回放未覆盖），应保持恢复端原行为
	_, before := c.request("POST", "/api/v1/crm-opportunities/"+absent+"/stage", map[string]any{"stage": "won"})
	// 恢复端对「商机不存在」回 200/10000
	if before["message"] != "商机不存在" {
		t.Fatalf("未配置动作被改写: %v", before)
	}
	// 未注册的动作端点落到兜底：批次 PP（2026-10-15）取证原版对一切未注册
	// /api/ 路径逐字返回 404 + code 404 +「路由不存在」
	// （tools/replay-batch-oo-catchall.js，8 条对照 100%），
	// 恢复端原先的 501「该业务接口尚未恢复」是自造占位形态，已对齐。
	status, body := c.request("POST", "/api/v1/products/"+absent+"/no-such-action", map[string]any{})
	if status != http.StatusNotFound || body["message"] != "路由不存在" {
		t.Fatalf("未注册动作 = %d %v, want 404 路由不存在", status, body)
	}
}

// TestLLActionNotFoundOnlyOnMissing 改写只在「记录不存在」时发生；
// 记录存在但业务校验失败时必须透传原响应。
func TestLLActionNotFoundOnlyOnMissing(t *testing.T) {
	c, product, warehouse, party := recoveredFixture(t, "LL-ACT")
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 10}},
	}).(map[string]any)

	// 草稿订单的 cancel 应成功（不是 notFound），响应必须原样透传
	status, body := c.request("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/cancel", nil)
	if status != http.StatusOK || body["code"] != float64(0) {
		t.Fatalf("真实记录的 cancel = %d %v, want 200/0（不应被改写）", status, body)
	}
	// 数据确实变了
	got := c.ok("GET", "/api/v1/sales-orders/"+order["id"].(string), nil).(map[string]any)
	if got["status"] != "cancelled" {
		t.Fatalf("cancel 未生效: status=%v", got["status"])
	}
	// 再次对已取消的订单 approve → 业务校验失败（不是「记录不存在」）。
	// sales-orders|approve 不在配置表里（回放实测原版该动作对不存在记录也是
	// 404，故未配置），所以响应必须保持恢复端原样透传。
	_, body = c.request("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/approve", nil)
	if body["code"] != float64(10000) {
		t.Fatalf("已取消订单的 approve 应为业务错误形态: %v", body)
	}
	if body["message"] == "" {
		t.Fatalf("业务失败文案被清空: %v", body)
	}
}
