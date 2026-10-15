package api

import (
	"net/http"
	"testing"
)

// 批次 MM 缺口 B 第 1 点：库存调整单空载荷的必填校验。
//
// 实测取证（2026-10-15 原版回放，见 docs/UNSUPPORTED-AUDIT-LOG.md 37.1）：
//
//	POST /api/v1/inventory-adjusts  {}
//	  原版   400「请求参数错误: Key: 'createAdjustRequest.WarehouseID'
//	                Error:Field validation for 'WarehouseID' failed on the 'required' tag」
//	  恢复端 200 + code:10000「仓库不存在」
//
// 即原版**先过 struct validator 才进业务层**，缺失必填字段时压根不会走到
// 「仓库存在性」那一步。恢复端此前缺这道校验，直接落到业务层的存在性检查，
// 于是状态码（200 vs 400）与文案都错了。
func TestSourceAdjustmentValidatesRequiredWarehouse(t *testing.T) {
	c, _ := setup(t)

	const want = "请求参数错误: Key: 'createAdjustRequest.WarehouseID' Error:Field validation for 'WarehouseID' failed on the 'required' tag"
	status, body := c.request("POST", "/api/v1/inventory-adjusts", map[string]any{})
	if status != http.StatusBadRequest || fmtMessage(body) != want {
		t.Fatalf("POST /inventory-adjusts {} = %d %v, want 400/%s", status, body, want)
	}

	// 仓库存在性仍由业务层把关：warehouse_id 传了但指向不存在的记录时，
	// 走的是「仓库不存在」，不是 validator 文案。此处固化**两道校验的分工**，
	// 避免后续把存在性检查一并吞掉。
	status, body = c.request("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": "00000000-0000-0000-0000-000000000001",
		"lines":        []any{map[string]any{"product_id": "00000000-0000-0000-0000-000000000002", "qty": 1}},
	})
	if status != http.StatusOK || fmtMessage(body) != "仓库不存在" {
		t.Fatalf("missing warehouse_id record: %d %v, want 200/仓库不存在", status, body)
	}
}
