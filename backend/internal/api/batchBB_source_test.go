package api

import (
	"strings"
	"testing"
)

// 本文件固化批次 BB 取证（2026-10-14）的结论：
//   - 负 scrap_rate 的 BOM 行放行（批次 T 已证 scrap_rate 是百分数，危害仅 0.5% 级）
//   - 返工单的工单状态白名单与原版逐字一致
// 证据见 evidence/backend-runtime/audit-batch-bb-20261014.json。

// BB1：负 scrap_rate 的 BOM 用于建工单必须放行。
func TestSourceNegativeScrapRateIsAccepted(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "BB-SCRAP")
	material := c.ok("POST", "/api/v1/products", map[string]any{
		"code": "BB-MAT", "name": "BB 组件",
	}).(map[string]any)
	bom := c.ok("POST", "/api/v1/boms", map[string]any{
		"name": "BB-SCRAP-BOM", "product_id": product["id"], "qty_per": 1,
		"items": []any{map[string]any{"product_id": material["id"], "qty": 2, "scrap_rate": -0.5}},
	}).(map[string]any)
	order := c.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": product["id"], "qty": 10,
		"warehouse_id": warehouse["id"], "bom_id": bom["id"],
	}).(map[string]any)
	mats := c.ok("GET", "/api/v1/work-orders/"+order["id"].(string)+"/materials", nil)
	// scrap_rate 是百分数：10 × 2 × (1 - 0.005) = 19.9
	if !strings.Contains(trimJSON(mats), `"qty_required":"19.9"`) {
		t.Fatalf("requirement should be 19.9 for scrap_rate=-0.5: %s", trimJSON(mats))
	}
}

// BB2：返工单的工单状态白名单 —— completed/cancelled 拒绝文案逐字对齐原版。
func TestSourceReworkWorkOrderStateMessages(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "BB-REWORK")
	confirm := func(order map[string]any) {
		c.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/confirm", nil)
	}
	newOrder := func() map[string]any {
		return c.ok("POST", "/api/v1/work-orders", map[string]any{
			"product_id": product["id"], "qty": 5, "warehouse_id": warehouse["id"],
		}).(map[string]any)
	}

	// draft / confirmed 应放行
	draft := newOrder()
	c.ok("POST", "/api/v1/rework-orders", map[string]any{"work_order_id": draft["id"], "qty_rework": 1})
	ok1 := newOrder()
	confirm(ok1)
	c.ok("POST", "/api/v1/rework-orders", map[string]any{"work_order_id": ok1["id"], "qty_rework": 1})

	// cancelled 拒绝，文案逐字对齐
	cancelled := newOrder()
	c.ok("POST", "/api/v1/work-orders/"+cancelled["id"].(string)+"/cancel", nil)
	_, body := c.request("POST", "/api/v1/rework-orders", map[string]any{
		"work_order_id": cancelled["id"], "qty_rework": 1,
	})
	if body["code"] == float64(0) ||
		!strings.Contains(fmtMessage(body), "不允许新建领料/入库/退料单") {
		t.Fatalf("cancelled work order must be rejected with the original message: %#v", body)
	}

	// 不存在的工单 → 「工单不存在」
	const zero = "00000000-0000-0000-0000-000000000000"
	_, body2 := c.request("POST", "/api/v1/rework-orders", map[string]any{
		"work_order_id": zero, "qty_rework": 1,
	})
	if body2["code"] == float64(0) || fmtMessage(body2) != "工单不存在" {
		t.Fatalf("unknown work order must report 工单不存在: %#v", body2)
	}
}
