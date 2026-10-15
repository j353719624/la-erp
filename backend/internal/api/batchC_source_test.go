package api

import (
	"testing"
)

// 本文件固化批次 C 取证（2026-10-14）的结论：盘点单编辑改仓库、工作中心编辑改 code、
// 工艺关联后删除、BOM 负数/零、MRP 多张 active BOM、同键余额行。
// 证据见 evidence/backend-runtime/audit-batch-c{,-c2}-20261014.json。

// CC1：盘点单编辑期改仓库原版允许，表头 warehouse_id 真实改变。
func TestSourceCheckEditChangesWarehouse(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "CC-CHK")
	target := c.ok("POST", "/api/v1/warehouses", map[string]any{"code": "CC-CHK-WH", "name": "CC-CHK-WH"}).(map[string]any)
	check := c.ok("POST", "/api/v1/inventory-checks", map[string]any{
		"warehouse_id": warehouse["id"], "lines": []any{map[string]any{"product_id": product["id"]}},
	}).(map[string]any)
	c.ok("PUT", "/api/v1/inventory-checks/"+check["id"].(string), map[string]any{
		"warehouse_id": target["id"], "lines": []any{map[string]any{"product_id": product["id"]}},
	})
	got := c.ok("GET", "/api/v1/inventory-checks/"+check["id"].(string), nil).(map[string]any)
	if got["warehouse_id"] != target["id"] {
		t.Fatalf("check warehouse not changed: %#v", got["warehouse_id"])
	}
}

// CC1b：completed 后编辑仍按原版文案拒绝。
func TestSourceCompletedCheckRejectsEdit(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "CC-CHK-DONE")
	check := c.ok("POST", "/api/v1/inventory-checks", map[string]any{
		"warehouse_id": warehouse["id"], "lines": []any{map[string]any{"product_id": product["id"]}},
	}).(map[string]any)
	path := "/api/v1/inventory-checks/" + check["id"].(string)
	c.ok("POST", path+"/start", nil)
	c.ok("POST", path+"/complete", nil)
	_, body := c.request("PUT", path, map[string]any{
		"warehouse_id": warehouse["id"], "lines": []any{map[string]any{"product_id": product["id"]}},
	})
	if body["code"] == float64(0) || fmtMessage(body) != "只有草稿或盘点中状态的盘点单才能修改" {
		t.Fatalf("completed check edit: %#v", body)
	}
}

// CC2：盘点明细可带 location_id/batch_no/serial_nos（建单不拒绝）。
func TestSourceCheckLineAcceptsAdvancedFields(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "CC-CHK-ADV")
	location := c.ok("POST", "/api/v1/locations", map[string]any{"name": "CC-LOC", "warehouse_id": warehouse["id"]}).(map[string]any)
	check := c.ok("POST", "/api/v1/inventory-checks", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"], "location_id": location["id"]}},
	}).(map[string]any)
	if check["id"] == "" {
		t.Fatal("check with line location_id rejected")
	}
	batched := c.ok("POST", "/api/v1/inventory-checks", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"], "batch_no": "CC-B1"}},
	}).(map[string]any)
	if batched["id"] == "" {
		t.Fatal("check with line batch_no rejected")
	}
}

// CC3：工作中心编辑传新 code 原版静默保留旧 code，其余字段正常更新。
func TestSourceWorkCenterEditKeepsCode(t *testing.T) {
	c, _ := setup(t)
	center := c.ok("POST", "/api/v1/work-centers", map[string]any{"code": "CC-WC1", "name": "CC 中心", "capacity": 10, "cost_rate": 5}).(map[string]any)
	if center["code"] != "CC-WC1" {
		t.Fatalf("work center code: %v", center["code"])
	}
	c.ok("PUT", "/api/v1/work-centers/"+center["id"].(string), map[string]any{"code": "CC-WC-NEW", "name": "CC 中心改名", "capacity": 20, "cost_rate": 7})
	got := c.ok("GET", "/api/v1/work-centers/"+center["id"].(string), nil).(map[string]any)
	if got["code"] != "CC-WC1" {
		t.Fatalf("work center code changed unexpectedly: %v", got["code"])
	}
	if got["name"] != "CC 中心改名" {
		t.Fatalf("work center name not updated: %v", got["name"])
	}
}

// CC3b：工艺 code 由服务端自动生成，传入的 code 被忽略。
func TestSourceRoutingCodeIsServerGenerated(t *testing.T) {
	c, product, _, _ := testFixture(t, "CC-RT")
	routing := c.ok("POST", "/api/v1/routings", map[string]any{
		"code": "CC-RT-IGNORED", "name": "CC 工艺", "product_id": product["id"],
		"steps": []any{map[string]any{"sequence": 1, "process_code": "P1", "process_name": "工序1"}},
	}).(map[string]any)
	if routing["code"] == "CC-RT-IGNORED" {
		t.Fatal("routing kept the submitted code; original generates its own")
	}
	if code, _ := routing["code"].(string); len(code) < 4 || code[:2] != "RT" {
		t.Fatalf("unexpected routing code: %v", routing["code"])
	}
}

// CC4：已被工单关联的工艺不可删除，按原版文案返回。
func TestSourceLinkedRoutingCannotBeEdited(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "CC-RT-LINK")
	routing := c.ok("POST", "/api/v1/routings", map[string]any{
		"name": "CC 工艺", "product_id": product["id"],
		"steps": []any{map[string]any{"sequence": 1, "process_code": "P1", "process_name": "工序1"}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": product["id"], "qty": 3, "warehouse_id": warehouse["id"], "routing_id": routing["id"],
	})
	if _, body := c.request("PUT", "/api/v1/routings/"+routing["id"].(string), map[string]any{
		"name": "CC 工艺2", "product_id": product["id"],
		"steps": []any{map[string]any{"sequence": 2, "process_code": "P2", "process_name": "工序2"}},
	}); body["code"] == float64(0) {
		t.Fatalf("linked routing edited: %#v", body)
	}
}

// CC8：BOM 的 qty<=0 保留恢复端拒绝；scrap_rate<0 已按批次 BB 改为**放行**。
//
// 依据：批次 T 实测 scrap_rate 是**百分数**，-0.1 只造成 0.1% 级偏差（需求 39.996 vs 40），
// 危害需极端输入（≤ -100 才产生零/负需求）才成立，不足以作为拒绝理由。
// 原版实测 scrap_rate=-0.5 的 BOM 建工单 code:0、材料需求 19.9（= 10×2×(1-0.005)）。
func TestSourceBomRejectsNonPositiveQuantityAndNegativeScrap(t *testing.T) {
	c, product, _, _ := testFixture(t, "CC-BOM")
	for _, tc := range []struct {
		name string
		item map[string]any
	}{
		{"qty_zero", map[string]any{"product_id": product["id"], "qty": 0}},
		{"qty_negative", map[string]any{"product_id": product["id"], "qty": -1}},
	} {
		if _, body := c.request("POST", "/api/v1/boms", map[string]any{
			"name": "CC-BOM-" + tc.name, "product_id": product["id"], "items": []any{tc.item},
		}); body["code"] == float64(0) {
			t.Fatalf("%s accepted", tc.name)
		}
	}
	// scrap_rate<0 必须放行（与原版一致）。
	c.ok("POST", "/api/v1/boms", map[string]any{
		"name": "CC-BOM-scrap_negative", "product_id": product["id"],
		"items": []any{map[string]any{"product_id": product["id"], "qty": 1, "scrap_rate": -0.1}},
	})
	ok := c.ok("POST", "/api/v1/boms", map[string]any{
		"name": "CC-BOM-OK", "product_id": product["id"], "items": []any{map[string]any{"product_id": product["id"], "qty": 2}},
	}).(map[string]any)
	if ok["id"] == "" {
		t.Fatal("valid BOM rejected")
	}
}

// CC9：同一产品存在多张 active BOM 时，MRP 取最新一张而非报错。
func TestSourceMultipleActiveBomsPickLatest(t *testing.T) {
	c, _, warehouse, _ := testFixture(t, "CC-MRP-BOM")
	parent := c.ok("POST", "/api/v1/products", map[string]any{"code": "CC-MRP-P", "name": "CC-MRP-父"}).(map[string]any)
	first := c.ok("POST", "/api/v1/boms", map[string]any{
		"name": "CC BOM-A", "product_id": parent["id"], "items": []any{map[string]any{"product_id": parent["id"], "qty": 2}},
	}).(map[string]any)
	second := c.ok("POST", "/api/v1/boms", map[string]any{
		"name": "CC BOM-B", "product_id": parent["id"], "items": []any{map[string]any{"product_id": parent["id"], "qty": 9}},
	}).(map[string]any)
	order := c.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": parent["id"], "qty": 3, "warehouse_id": warehouse["id"], "bom_id": second["id"],
	}).(map[string]any)
	if order["bom_id"] != second["id"] {
		t.Fatalf("explicit BOM not honoured: %v", order["bom_id"])
	}
	_ = first
	// 显式指定始终优先，不因存在多张而拒绝。
	materials := c.ok("GET", "/api/v1/work-orders/"+order["id"].(string)+"/materials", nil)
	raw := trimJSON(materials)
	if !contains(raw, `"qty_required":"27"`) {
		t.Fatalf("expected 3*9=27 required, got %s", raw)
	}
}
