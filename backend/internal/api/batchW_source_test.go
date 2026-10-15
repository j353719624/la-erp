package api

import (
	"testing"
)

// 本文件固化批次 W 取证（2026-10-14）的结论：
//   - 原版允许修改单据/商品的 type 字段（恢复端原先 501）
//   - 调拨单的库位字段只落库、不校验引用完整性（不存在的库位也建单成功）
// 证据见 evidence/backend-runtime/audit-batch-w-20261014.json。

// WW1：允许修改 type（原版 goods → raw 成功）。
func TestSourceTypeFieldIsEditable(t *testing.T) {
	c, _, _, _ := testFixture(t, "WW-TYPE")
	product := c.ok("POST", "/api/v1/products", map[string]any{
		"code": "WW-TYPE-P", "name": "WW 商品",
	}).(map[string]any)
	// 改 product_type
	c.ok("PUT", "/api/v1/products/"+product["id"].(string), map[string]any{
		"code": "WW-TYPE-P", "name": "WW 商品", "product_type": "raw",
	})
	got := c.ok("GET", "/api/v1/products/"+product["id"].(string), nil).(map[string]any)
	if got["product_type"] != "raw" {
		t.Fatalf("product_type should be updatable, got %v", got["product_type"])
	}
	// 改回同值也应通过
	c.ok("PUT", "/api/v1/products/"+product["id"].(string), map[string]any{
		"code": "WW-TYPE-P", "name": "WW 商品", "product_type": "raw",
	})
}

// WW2：调拨单库位字段只落库，不校验引用完整性。
func TestSourceTransferLocationHasNoExistenceCheck(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "WW-TRANSFER")
	target := c.ok("POST", "/api/v1/warehouses", map[string]any{
		"code": "WW-TRF-WH", "name": "WW 调拨目标仓",
	}).(map[string]any)
	location := c.ok("POST", "/api/v1/locations", map[string]any{
		"name": "WW-LOC", "warehouse_id": warehouse["id"],
	}).(map[string]any)
	const zero = "00000000-0000-0000-0000-000000000000"

	// 有效库位：落库且回读一致
	valid := c.ok("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": warehouse["id"], "to_warehouse_id": target["id"],
		"from_location_id": location["id"],
		"lines":            []any{map[string]any{"product_id": product["id"], "qty": 1}},
	}).(map[string]any)
	if valid["from_location_id"] != location["id"] {
		t.Fatalf("from_location_id should be persisted: %#v", valid["from_location_id"])
	}

	// 不存在的库位：原版照常建单，不校验
	for _, key := range []string{"from_location_id", "to_location_id"} {
		body := map[string]any{
			"from_warehouse_id": warehouse["id"], "to_warehouse_id": target["id"],
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1}},
		}
		body[key] = zero
		doc := c.ok("POST", "/api/v1/stock-transfers", body).(map[string]any)
		if doc["id"] == "" {
			t.Fatalf("transfer with a non-existent %s should still be created", key)
		}
	}
}
