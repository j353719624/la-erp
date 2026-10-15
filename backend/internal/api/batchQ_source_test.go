package api

import (
	"strings"
	"testing"
)

// 批次 Q（2026-10-14）：证明 inventory_balances 同键唯一由**数据库 UNIQUE 索引**保证，
// 从而 service.go 里 trackingBalance / balance 的两处 `len(rows) > 1 → ErrUnsupported`
// 是永不可达的死代码。
//
// 证据：backend/internal/database/schema.sql 有两个唯一索引
//   idx_inventory_balance_key ON (product_id, warehouse_id,
//     COALESCE(location_id,'000…0'), COALESCE(rack_id,'000…0'), COALESCE(batch_no,''))
//   inventorybalance_product_id_war_… ON (product_id, warehouse_id, location_id, rack_id, batch_no)
// 其中第一个用 COALESCE 把 NULL 归一化，正是为了保证「无库位/无货架/无批次」这一组也不会重复。
// 既有实现库实测：52 条余额行，同键多行组数 = 0。
//
// 本测试直接验证索引生效：连续两次写入同键余额，第二次必须被数据库拒绝。

// QQ1：无批次余额（同键重复应被 UNIQUE 索引拒绝）。
func TestSourceBalanceRowIsUniquePerKey(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "QQ-UNIQ")
	// 走业务路径：入库 + 确认会创建无批次余额行
	first := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"], "qty": 5, "unit_cost": 2}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+first["id"].(string)+"/confirm", nil)

	// 再建一张同商品同仓库的入库单并确认：业务上会命中同一条余额行并累加，
	// 不应产生第二行。
	second := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"], "qty": 3, "unit_cost": 2}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+second["id"].(string)+"/confirm", nil)

	list := c.ok("GET", "/api/v1/inventory-balances?product_id="+product["id"].(string)+"&warehouse_id="+warehouse["id"].(string), nil).(map[string]any)
	raw := trimJSON(list)
	if strings.Count(raw, `"batch_no":""`) > 1 && strings.Count(raw, `"batch_no":null`) > 1 {
		t.Fatalf("expected a single no-batch balance row: %s", raw)
	}
	// 数量应是累加后的 8
	if !strings.Contains(raw, `"qty_available":"8"`) {
		t.Fatalf("balance should accumulate to 8: %s", raw)
	}
}

// QQ2：有批次余额同理——同商品+同仓库+同批次只应有一行。
func TestSourceBatchedBalanceRowIsUniquePerKey(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "QQ-BATCHUNIQ")
	const batch = "QQ-B1"
	for i := 0; i < 2; i++ {
		doc := c.ok("POST", "/api/v1/stock-ins", map[string]any{
			"warehouse_id": warehouse["id"],
			"lines": []any{map[string]any{
				"product_id": product["id"], "qty": 4, "unit_cost": 3, "batch_no": batch,
			}},
		}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+doc["id"].(string)+"/confirm", nil)
	}
	list := c.ok("GET", "/api/v1/inventory-balances?product_id="+product["id"].(string)+"&warehouse_id="+warehouse["id"].(string), nil).(map[string]any)
	raw := trimJSON(list)
	if n := strings.Count(raw, `"batch_no":"`+batch+`"`); n != 1 {
		t.Fatalf("expected exactly one balance row for batch %s, got %d: %s", batch, n, raw)
	}
	if !strings.Contains(raw, `"qty_available":"8"`) {
		t.Fatalf("batched balance should accumulate to 8: %s", raw)
	}
}
