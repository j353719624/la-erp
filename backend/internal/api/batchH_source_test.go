package api

import (
	"strings"
	"testing"
)

// 本文件固化批次 H 取证（2026-10-14）的结论：照片库位不做归属校验、
// 工艺 sequence 必须是 JSON 整数。证据见 运行快照。

// HH2：照片的 location_id/rack_id 不做仓库与货架归属校验（既有实现五种情况全部放行）。
func TestSourcePhotoLocationHasNoOwnershipCheck(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "HH-PHOTO")
	location := c.ok("POST", "/api/v1/locations", map[string]any{"name": "HH-LOC", "warehouse_id": warehouse["id"]}).(map[string]any)
	rack := c.ok("POST", "/api/v1/racks", map[string]any{"name": "HH-RACK", "warehouse_id": warehouse["id"]}).(map[string]any)
	// 属于另一个仓库的库位与货架。
	other := c.ok("POST", "/api/v1/warehouses", map[string]any{"code": "HH-PHOTO-WH", "name": "HH-PHOTO-WH"}).(map[string]any)
	foreignLocation := c.ok("POST", "/api/v1/locations", map[string]any{"name": "HH-FOREIGN", "warehouse_id": other["id"]}).(map[string]any)
	foreignRack := c.ok("POST", "/api/v1/racks", map[string]any{"name": "HH-FOREIGN-RACK", "warehouse_id": other["id"]}).(map[string]any)

	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 5, "unit_cost": 5},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	path := "/api/v1/stock-ins/" + in["id"].(string) + "/photos"

	cases := []struct {
		name  string
		photo map[string]any
	}{
		{"own_location", map[string]any{"url": "/uploads/images/p1.png", "location_id": location["id"]}},
		{"own_rack", map[string]any{"url": "/uploads/images/p2.png", "rack_id": rack["id"]}},
		{"location_string", map[string]any{"url": "/uploads/images/p3.png", "location": "A-01-02"}},
		{"foreign_location", map[string]any{"url": "/uploads/images/p4.png", "location_id": foreignLocation["id"]}},
		{"foreign_rack", map[string]any{"url": "/uploads/images/p5.png", "rack_id": foreignRack["id"]}},
		{"rack_without_location", map[string]any{"url": "/uploads/images/p6.png", "rack_id": rack["id"]}},
	}
	for i, tc := range cases {
		c.ok("POST", path, map[string]any{"photos": []any{tc.photo}})
		_ = i
	}
	// 不存在的库位仍应被拒绝（引用完整性）。
	if status, body := c.request("POST", path, map[string]any{"photos": []any{
		map[string]any{"url": "/uploads/images/x.png", "location_id": "00000000-0000-0000-0000-0000000000bb"},
	}}); status == 200 && body["code"] == float64(0) {
		t.Fatalf("unknown location accepted: %#v", body)
	}
}

// HH7：工艺工序的 sequence 必须是 JSON 整数；字符串与小数既有实现都拒绝（HTTP 400 无文案），
// 负整数放行。
func TestSourceRoutingSequenceRequiresJSONInteger(t *testing.T) {
	c, product, _, _ := testFixture(t, "HH-SEQ")
	// 字符串 "2" 被既有实现拒绝，本实现不应放行。
	if _, body := c.request("POST", "/api/v1/routings", map[string]any{
		"name": "HH-SEQ-STR", "product_id": product["id"],
		"steps": []any{map[string]any{"sequence": "2", "process_code": "P1", "process_name": "工序1"}},
	}); body["code"] == float64(0) {
		t.Fatalf("string sequence accepted, original rejects it: %#v", body)
	}
	// 小数 1.5 既有实现同样拒绝（HTTP 400 且无业务文案）；本实现无原文案可对齐，
	// 保留 501 未恢复。此处只断言「未伪造成功」，不断言具体返回形态。
	if _, body := c.request("POST", "/api/v1/routings", map[string]any{
		"name": "HH-SEQ-FRAC", "product_id": product["id"],
		"steps": []any{map[string]any{"sequence": 1.5, "process_code": "P1", "process_name": "工序1"}},
	}); body["code"] == float64(0) {
		t.Fatalf("fractional sequence accepted, original rejects it: %#v", body)
	}
	// 负整数既有实现放行。
	ok := c.ok("POST", "/api/v1/routings", map[string]any{
		"name": "HH-SEQ-NEG", "product_id": product["id"],
		"steps": []any{map[string]any{"sequence": -1, "process_code": "P1", "process_name": "工序1"}},
	}).(map[string]any)
	if ok["id"] == "" {
		t.Fatal("negative integer sequence rejected but original accepts it")
	}
	// 空 steps 既有实现放行。
	if empty := c.ok("POST", "/api/v1/routings", map[string]any{
		"name": "HH-SEQ-EMPTY", "product_id": product["id"], "steps": []any{},
	}).(map[string]any); empty["id"] == "" {
		t.Fatal("empty steps rejected but original accepts it")
	}
}

// HH8：删除不存在的主数据返回既有实现原文案。
func TestSourceProductionMasterDeleteMessages(t *testing.T) {
	c, _ := setup(t)
	_, body := c.request("DELETE", "/api/v1/routings/00000000-0000-0000-0000-000000000000", nil)
	if body["code"] == float64(0) || fmtMessage(body) != "工艺路线不存在" {
		t.Fatalf("routing delete message: %#v", body)
	}
	_, body = c.request("DELETE", "/api/v1/work-centers/00000000-0000-0000-0000-000000000000", nil)
	if body["code"] == float64(0) || fmtMessage(body) != "工作中心不存在" {
		t.Fatalf("work center delete message: %#v", body)
	}
}

// HH3：调整单状态守卫与原文案一致。
func TestSourceAdjustmentStateGuards(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "HH-ADJ")
	over := c.ok("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": warehouse["id"], "adjust_type": "loss",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 999}},
	}).(map[string]any)
	if _, body := c.request("POST", "/api/v1/inventory-adjusts/"+over["id"].(string)+"/confirm", nil); fmtMessage(body) != "库存不足" {
		t.Fatalf("over-loss confirm: %#v", body["message"])
	}
	gain := c.ok("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": warehouse["id"], "adjust_type": "gain",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 5}},
	}).(map[string]any)
	path := "/api/v1/inventory-adjusts/" + gain["id"].(string)
	c.ok("POST", path+"/confirm", nil)
	if _, body := c.request("POST", path+"/confirm", nil); !strings.Contains(fmtMessage(body), "只有草稿状态") {
		t.Fatalf("repeated confirm: %#v", body["message"])
	}
	if _, body := c.request("DELETE", path, nil); !strings.Contains(fmtMessage(body), "只有草稿状态") {
		t.Fatalf("delete confirmed: %#v", body["message"])
	}
}

// HH5：调拨单状态守卫与原文案一致。
func TestSourceTransferStateGuards(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "HH-TRF")
	target := c.ok("POST", "/api/v1/warehouses", map[string]any{"code": "HH-TRF-WH", "name": "HH-TRF-WH"}).(map[string]any)
	srcSeedStock(t, c, product, warehouse, 10, 10)
	// 同进同出仓。
	if _, body := c.request("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": warehouse["id"], "to_warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1}},
	}); fmtMessage(body) != "调出仓与调入仓不能相同" {
		t.Fatalf("same warehouse: %#v", body["message"])
	}
	transfer := c.ok("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": warehouse["id"], "to_warehouse_id": target["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1}},
	}).(map[string]any)
	path := "/api/v1/stock-transfers/" + transfer["id"].(string)
	c.ok("POST", path+"/dispatch", nil)
	c.ok("POST", path+"/complete", nil)
	if _, body := c.request("POST", path+"/cancel", nil); fmtMessage(body) != "只有草稿或运输中的调拨单才能取消" {
		t.Fatalf("cancel completed transfer: %#v", body["message"])
	}
}

// HH6：返工单已完成不可取消，既有实现原文案。
func TestSourceReworkStateGuards(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "HH-RW")
	order := c.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": product["id"], "qty": 3, "warehouse_id": warehouse["id"],
	}).(map[string]any)
	rework := c.ok("POST", "/api/v1/rework-orders", map[string]any{
		"work_order_id": order["id"], "qty_rework": 1, "reason": "缺陷", "remark": "HH",
	}).(map[string]any)
	path := "/api/v1/rework-orders/" + rework["id"].(string)
	c.ok("POST", path+"/confirm", nil)
	c.ok("POST", path+"/complete", nil)
	if _, body := c.request("POST", path+"/cancel", nil); fmtMessage(body) != "已完成的返工单不能取消" {
		t.Fatalf("cancel completed rework: %#v", body["message"])
	}
	// 已取消的工单不允许新建返工单。
	c.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/cancel", nil)
	if _, body := c.request("POST", "/api/v1/rework-orders", map[string]any{
		"work_order_id": order["id"], "qty_rework": 1, "reason": "x",
	}); body["code"] == float64(0) || !strings.Contains(fmtMessage(body), "不允许新建领料/入库/退料单") {
		t.Fatalf("rework on cancelled order: %#v", body)
	}
}
