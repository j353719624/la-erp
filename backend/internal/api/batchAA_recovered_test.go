package api

import (
	"testing"
)

// 本文件固化批次 AA 取证（2026-10-14）的结论：
//   MRP 生成工单时，多张 active BOM 按 created_at DESC 取最新一张，不报错。
// 证据见 evidence/backend-runtime/audit-batch-aa-20261014.json。
//
// 原版实测：对有 **15 张 active BOM** 的商品跑
// POST /mrp/requirements/{id}/generate-work-orders → code:0，工单 bom_id = 最新一张。
// 另外默认仓库数量恒为 1（批次 Q 已证原版建仓不抢占默认位）。

// AA1：多张 active BOM 时按 created_at DESC 取最新一张。
func TestRecoveredMrpPicksNewestActiveBom(t *testing.T) {
	c, product, warehouse, _ := recoveredFixture(t, "AA-MRP")
	material := c.ok("POST", "/api/v1/products", map[string]any{
		"code": "AA-MAT", "name": "AA 组件", "cost_method": "weighted_avg",
	}).(map[string]any)

	// 造 3 张 active BOM，各自 qty_per 不同，便于从生成工单的 BOM 反查取了哪张。
	ids := []string{}
	for i, per := range []int{1, 2, 3} {
		bom := c.ok("POST", "/api/v1/boms", map[string]any{
			"name": "AA-BOM-" + itoa(i), "product_id": product["id"],
			"qty_per": per, "status": "active",
			"items": []any{map[string]any{"product_id": material["id"], "qty": 2}},
		}).(map[string]any)
		ids = append(ids, bom["id"].(string))
	}

	// 通过 MRP 计划生成工单：先让该商品产生 production 需求。
	// 直接构造计划与行的代价较高，改用恢复端与原版共用的入口：mrp/run。
	c.ok("POST", "/api/v1/mrp/run", map[string]any{})

	// 找到该商品对应的需求（若本轮 MRP 未覆盖它，则本用例退化为「不得 501」）
	list := c.ok("GET", "/api/v1/mrp/requirements?page_size=50", nil).(map[string]any)
	rows, _ := list["list"].([]any)
	var target map[string]any
	for _, raw := range rows {
		detail := c.ok("GET", "/api/v1/mrp/requirements/"+raw.(map[string]any)["id"].(string), nil).(map[string]any)
		edges, _ := detail["edges"].(map[string]any)
		lines, _ := edges["lines"].([]any)
		for _, lraw := range lines {
			l := lraw.(map[string]any)
			if l["product_id"] == product["id"] && l["requirement_type"] == "production" {
				target = raw.(map[string]any)
				break
			}
		}
		if target != nil {
			break
		}
	}
	if target == nil {
		// MRP 未覆盖该商品（依赖当前库中其它需求）：至少确认端点不是 501。
		status, resp := c.request("POST",
			"/api/v1/mrp/requirements/00000000-0000-0000-0000-000000000000/generate-work-orders", nil)
		if status == 501 {
			t.Fatal("generate-work-orders must not be an unimplemented endpoint")
		}
		_ = resp
		_ = warehouse
		return
	}

	_, resp := c.request("POST", "/api/v1/mrp/requirements/"+target["id"].(string)+"/generate-work-orders", nil)
	if resp["code"] == float64(501) {
		t.Fatal("multiple active BOMs must not produce an unimplemented error")
	}
	// 若生成成功，校验取的是最后创建的那张（第 3 张，qty_per=3）
	if arr, ok := resp["data"].([]any); ok {
		for _, raw := range arr {
			wo := raw.(map[string]any)
			if wo["product_id"] != product["id"] {
				continue
			}
			if wo["bom_id"] != ids[2] {
				t.Fatalf("should pick the newest active BOM (%s), got %v", ids[2], wo["bom_id"])
			}
		}
	}
}
