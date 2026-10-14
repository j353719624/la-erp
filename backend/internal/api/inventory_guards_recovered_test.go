package api

import (
	"testing"
)

// 本文件固化第 8 项第十四轮（UA1/UC1/UT1/UA2/UC2/UT2）取证的结论：
// 库存调整、盘点、调拨三处曾对「明细单位与商品主数据不一致」和「库区字段」一律拒绝，
// 但原版三处均接受并按传入值落库。证据见
// evidence/backend-runtime/audit-inventory-guards-20261013.json。

func inventoryGuardFixture(t *testing.T, code string) (*client, map[string]any, map[string]any, map[string]any, map[string]any) {
	t.Helper()
	c, _ := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": code, "name": code}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	target := c.ok("POST", "/api/v1/warehouses", map[string]any{"code": code + "-WH", "name": code + "-WH"}).(map[string]any)
	units := c.ok("GET", "/api/v1/units", nil).(map[string]any)["list"].([]any)
	if len(units) < 2 {
		t.Fatal("需要至少两个计量单位")
	}
	return c, product, warehouse, target, map[string]any{"main": units[0].(map[string]any), "other": units[1].(map[string]any)}
}

func inventorySeed(t *testing.T, c *client, product, warehouse map[string]any, unit map[string]any) {
	t.Helper()
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 100, "unit_cost": 10, "unit_id": unit["id"]},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
}

// UA1：库存调整明细的单位与商品主单位不一致时原版接受，明细 unit_id 按传入值落库。
func TestRecoveredAdjustmentAcceptsForeignUnitOnLine(t *testing.T) {
	c, product, warehouse, _, units := inventoryGuardFixture(t, "REC-ADJ-UNIT")
	inventorySeed(t, c, product, warehouse, units["main"].(map[string]any))
	other := units["other"].(map[string]any)
	adjust := c.ok("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": warehouse["id"], "adjust_type": "decrease",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_id": other["id"]}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/inventory-adjusts/"+adjust["id"].(string)+"/confirm", nil)
	got := c.ok("GET", "/api/v1/inventory-adjusts/"+adjust["id"].(string), nil).(map[string]any)
	lines := got["edges"].(map[string]any)["lines"].([]any)
	if lines[0].(map[string]any)["unit_id"] != other["id"] {
		t.Fatalf("line unit not persisted as sent: %#v", lines[0])
	}
}

// UC1：盘点明细单位不一致时原版接受，start/complete 全程 code:0。
func TestRecoveredCheckAcceptsForeignUnitOnLine(t *testing.T) {
	c, product, warehouse, _, units := inventoryGuardFixture(t, "REC-CHK-UNIT")
	inventorySeed(t, c, product, warehouse, units["main"].(map[string]any))
	other := units["other"].(map[string]any)
	check := c.ok("POST", "/api/v1/inventory-checks", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"], "unit_id": other["id"]}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/inventory-checks/"+check["id"].(string)+"/start", nil)
	c.ok("POST", "/api/v1/inventory-checks/"+check["id"].(string)+"/complete", nil)
	got := c.ok("GET", "/api/v1/inventory-checks/"+check["id"].(string), nil).(map[string]any)
	lines := got["edges"].(map[string]any)["lines"].([]any)
	if lines[0].(map[string]any)["unit_id"] != other["id"] {
		t.Fatalf("check line unit not persisted as sent: %#v", lines[0])
	}
}

// UT1：调拨明细单位不一致时原版接受，dispatch/complete 全程 code:0 且库存划转。
func TestRecoveredTransferAcceptsForeignUnitOnLine(t *testing.T) {
	c, product, warehouse, target, units := inventoryGuardFixture(t, "REC-TRF-UNIT")
	inventorySeed(t, c, product, warehouse, units["main"].(map[string]any))
	other := units["other"].(map[string]any)
	transfer := c.ok("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": warehouse["id"], "to_warehouse_id": target["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 2, "unit_id": other["id"]}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-transfers/"+transfer["id"].(string)+"/dispatch", nil)
	c.ok("POST", "/api/v1/stock-transfers/"+transfer["id"].(string)+"/complete", nil)
	got := c.ok("GET", "/api/v1/stock-transfers/"+transfer["id"].(string), nil).(map[string]any)
	lines := got["edges"].(map[string]any)["lines"].([]any)
	if lines[0].(map[string]any)["unit_id"] != other["id"] {
		t.Fatalf("transfer line unit not persisted as sent: %#v", lines[0])
	}
}

// UC2/UT2：盘点单 location_id 与调拨单 from/to_location_id 落库；
// 调整单无对应列，保持显式拒绝。
func TestRecoveredLocationFieldsPersistWhereColumnsExist(t *testing.T) {
	c, product, warehouse, target, units := inventoryGuardFixture(t, "REC-LOC-FIELDS")
	inventorySeed(t, c, product, warehouse, units["main"].(map[string]any))
	main := units["main"].(map[string]any)
	location := c.ok("POST", "/api/v1/locations", map[string]any{"name": "REC-LOC", "warehouse_id": warehouse["id"]}).(map[string]any)
	rack := c.ok("POST", "/api/v1/racks", map[string]any{"name": "REC-RACK", "warehouse_id": target["id"]}).(map[string]any)

	check := c.ok("POST", "/api/v1/inventory-checks", map[string]any{
		"warehouse_id": warehouse["id"], "location_id": location["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "unit_id": main["id"]}},
	}).(map[string]any)
	if check["location_id"] != location["id"] {
		t.Fatalf("check location_id dropped: %#v", check["location_id"])
	}

	transfer := c.ok("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": warehouse["id"], "to_warehouse_id": target["id"],
		"from_location_id": location["id"], "to_location_id": rack["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_id": main["id"]}},
	}).(map[string]any)
	if transfer["from_location_id"] != location["id"] || transfer["to_location_id"] != rack["id"] {
		t.Fatalf("transfer location fields dropped: %#v", transfer)
	}

	// 库存调整表没有 location 列，按「不静默丢弃字段」保持显式拒绝。
	if status, body := c.request("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": warehouse["id"], "location_id": location["id"], "adjust_type": "increase",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_id": main["id"]}},
	}); status == 200 && body["code"] == float64(0) {
		t.Fatalf("adjustment location_id silently accepted: %d %#v", status, body)
	}
}
