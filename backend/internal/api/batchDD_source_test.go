package api

import (
	"strings"
	"testing"
)

// 本文件固化批次 DD 取证（2026-10-14）的结论：
// 领退料单**可以包含不在工单 BOM 里的物料** —— 原版放行，库存与台账照常处理，
// 只是不回写工单材料行。恢复端原先返回 501 属误拒。
// 证据见 evidence/backend-runtime/audit-batch-dd-20261014.json。

// DD1：领料单领非 BOM 物料应放行，且库存/台账照常处理。
func TestSourcePickingMaterialOutsideBomIsAllowed(t *testing.T) {
	c, parent, warehouse, _ := testFixture(t, "DD-PICK")
	// 找一个不同于父件的商品作「组件」，再建一个不在 BOM 里的物料
	all := c.ok("GET", "/api/v1/products?page_size=50", nil).(map[string]any)
	list, _ := all["list"].([]any)
	component := list[1].(map[string]any)
	outside := list[2].(map[string]any)

	// BOM 只含 component
	bom := c.ok("POST", "/api/v1/boms", map[string]any{
		"name": "DD-BOM", "product_id": parent["id"], "qty_per": 1,
		"items": []any{map[string]any{"product_id": component["id"], "qty": 5}},
	}).(map[string]any)
	order := c.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": parent["id"], "qty": 10,
		"warehouse_id": warehouse["id"], "bom_id": bom["id"],
	}).(map[string]any)
	c.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/confirm", nil)
	// 领退料确认期要求工单处于 in_progress（即 confirmed 之后还要 approve）
	c.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/approve", nil)

	// 给 outside 补库存
	seed := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": outside["id"], "qty": 50, "unit_cost": 1}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+seed["id"].(string)+"/confirm", nil)
	before := srcBalance(c, outside["id"].(string), warehouse["id"].(string))

	// 领 outside（不在 BOM 里）
	picking := c.ok("POST", "/api/v1/production-pickings", map[string]any{
		"work_order_id": order["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": outside["id"], "qty": 2}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/production-pickings/"+picking["id"].(string)+"/confirm", nil)

	after := srcBalance(c, outside["id"].(string), warehouse["id"].(string))
	if after != before-2 {
		t.Fatalf("stock must be deducted even for a material outside the BOM: %v → %v", before, after)
	}

	// 工单材料行不应被写入（outside 无对应 material 行）
	mats := c.ok("GET", "/api/v1/work-orders/"+order["id"].(string)+"/materials", nil)
	if strings.Contains(trimJSON(mats), outside["id"].(string)) {
		t.Fatalf("a material outside the BOM must not appear in the work order's material rows: %s", trimJSON(mats))
	}
}

// DD2：退料单退非 BOM 物料同样放行。
func TestSourceReturnMaterialOutsideBomIsAllowed(t *testing.T) {
	c, parent, warehouse, _ := testFixture(t, "DD-RETURN")
	all := c.ok("GET", "/api/v1/products?page_size=50", nil).(map[string]any)
	list, _ := all["list"].([]any)
	component := list[1].(map[string]any)
	outside := list[2].(map[string]any)

	bom := c.ok("POST", "/api/v1/boms", map[string]any{
		"name": "DD-BOM-R", "product_id": parent["id"], "qty_per": 1,
		"items": []any{map[string]any{"product_id": component["id"], "qty": 5}},
	}).(map[string]any)
	order := c.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": parent["id"], "qty": 10,
		"warehouse_id": warehouse["id"], "bom_id": bom["id"],
	}).(map[string]any)
	c.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/confirm", nil)
	c.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/approve", nil)

	ret := c.ok("POST", "/api/v1/production-returns", map[string]any{
		"work_order_id": order["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": outside["id"], "qty": 1}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/production-returns/"+ret["id"].(string)+"/confirm", nil)
}

// srcBalance 汇总某商品在某仓库的可用库存。
func srcBalance(c *client, productID, warehouseID string) float64 {
	list := c.ok("GET", "/api/v1/inventory-balances?product_id="+productID+"&warehouse_id="+warehouseID, nil).(map[string]any)
	rows, _ := list["list"].([]any)
	total := 0.0
	for _, raw := range rows {
		row := raw.(map[string]any)
		total += parseFloatOrZero(row["qty_available"])
	}
	return total
}

func parseFloatOrZero(v any) float64 {
	s, ok := v.(string)
	if !ok {
		return 0
	}
	var f float64
	for _, ch := range s {
		if ch == '.' || (ch >= '0' && ch <= '9') {
			f = f*10 + float64(ch-'0')
		}
	}
	return f
}
