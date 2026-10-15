package api

import (
	"strings"
	"testing"
)

// 本文件固化批次 E 取证（2026-10-14）的结论：生产单据建单期与确认期的状态校验位置、
// 同材料多行、换 BOM 后旧材料行、外协发料材料的三类错误文案。
// 证据见 evidence/backend-runtime/audit-batch-e-20261014.json。

type batchEEnv struct {
	client    *client
	product   map[string]any
	component map[string]any
	warehouse map[string]any
	supplier  map[string]any
	bom       map[string]any
}

func batchESetup(t *testing.T, code string) batchEEnv {
	t.Helper()
	c, _ := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": code, "name": code}).(map[string]any)
	component := c.ok("POST", "/api/v1/products", map[string]any{"code": code + "-M", "name": code + "-料"}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"code": code + "-S", "name": code + "-供应商"}).(map[string]any)
	bom := c.ok("POST", "/api/v1/boms", map[string]any{
		"name": code + "-BOM", "product_id": product["id"],
		"items": []any{map[string]any{"product_id": product["id"], "qty": 2}, map[string]any{"product_id": component["id"], "qty": 3}},
	}).(map[string]any)
	return batchEEnv{c, product, component, warehouse, supplier, bom}
}

// EE1：草稿工单可建领料单（校验在确认期而非建单期）。
func TestSourceProductionDocumentAcceptsDraftWorkOrder(t *testing.T) {
	e := batchESetup(t, "EE-PICK")
	order := e.client.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": e.product["id"], "qty": 5, "warehouse_id": e.warehouse["id"], "bom_id": e.bom["id"],
	}).(map[string]any)
	pick := e.client.ok("POST", "/api/v1/production-pickings", map[string]any{
		"work_order_id": order["id"], "warehouse_id": e.warehouse["id"],
		"lines": []any{map[string]any{"product_id": e.component["id"], "qty": 2}},
	}).(map[string]any)
	if pick["id"] == "" {
		t.Fatal("draft work order rejected at create time")
	}
	_, body := e.client.request("POST", "/api/v1/production-pickings/"+pick["id"].(string)+"/confirm", nil)
	if body["code"] == float64(0) {
		t.Fatal("draft work order picking confirmed")
	}
	if !strings.Contains(fmtMessage(body), "不允许确认执行") {
		t.Fatalf("unexpected confirm message: %#v", body["message"])
	}
}

// EE2：同一材料在领料单中出现两行时原版放行。
func TestSourcePickingAcceptsDuplicateComponentRows(t *testing.T) {
	e := batchESetup(t, "EE-DUP")
	order := e.client.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": e.product["id"], "qty": 5, "warehouse_id": e.warehouse["id"], "bom_id": e.bom["id"],
	}).(map[string]any)
	e.client.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/confirm", nil)
	seed := e.client.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": e.warehouse["id"], "lines": []any{
		map[string]any{"product_id": e.component["id"], "qty": 20, "unit_cost": 5},
	}}).(map[string]any)
	e.client.ok("POST", "/api/v1/stock-ins/"+seed["id"].(string)+"/confirm", nil)
	// 原版无 start 动作：approve 直接把工单推进到 in_progress。
	e.client.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/approve", nil)
	pick := e.client.ok("POST", "/api/v1/production-pickings", map[string]any{
		"work_order_id": order["id"], "warehouse_id": e.warehouse["id"],
		"lines": []any{
			map[string]any{"product_id": e.component["id"], "qty": 1},
			map[string]any{"product_id": e.component["id"], "qty": 2},
		},
	}).(map[string]any)
	lines := pick["edges"].(map[string]any)["lines"].([]any)
	if len(lines) != 2 {
		t.Fatalf("duplicate component rows dropped: %d", len(lines))
	}
	e.client.ok("POST", "/api/v1/production-pickings/"+pick["id"].(string)+"/confirm", nil)
}

// EE6：换 BOM 后新 BOM 不含的旧材料行被清除；已领料的则拒绝移除。
func TestSourceWorkOrderBomChangeRebuildsMaterials(t *testing.T) {
	e := batchESetup(t, "EE-BOMSWAP")
	order := e.client.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": e.product["id"], "qty": 10, "warehouse_id": e.warehouse["id"], "bom_id": e.bom["id"],
	}).(map[string]any)
	materialsOf := func() []any {
		return e.client.ok("GET", "/api/v1/work-orders/"+order["id"].(string)+"/materials", nil).([]any)
	}
	if len(materialsOf()) != 2 {
		t.Fatalf("expected 2 material rows, got %d", len(materialsOf()))
	}
	single := e.client.ok("POST", "/api/v1/boms", map[string]any{
		"name": "EE-BOMSWAP-SINGLE", "product_id": e.product["id"],
		"items": []any{map[string]any{"product_id": e.component["id"], "qty": 7}},
	}).(map[string]any)
	e.client.ok("PUT", "/api/v1/work-orders/"+order["id"].(string), map[string]any{
		"product_id": e.product["id"], "qty": 10, "warehouse_id": e.warehouse["id"], "bom_id": single["id"],
	})
	materials := materialsOf()
	if len(materials) != 1 {
		t.Fatalf("stale material row survived BOM change: %d rows", len(materials))
	}
	if materials[0].(map[string]any)["product_id"] != e.component["id"] {
		t.Fatalf("wrong material survived: %#v", materials[0])
	}
}

// EE1b：已取消的工单不允许新建生产单据（这条原版在**建单期**就拒绝）。
func TestSourceCancelledWorkOrderRejectsProductionDocument(t *testing.T) {
	e := batchESetup(t, "EE-CANCEL")
	order := e.client.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": e.product["id"], "qty": 1, "warehouse_id": e.warehouse["id"],
	}).(map[string]any)
	e.client.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/cancel", nil)
	_, body := e.client.request("POST", "/api/v1/production-pickings", map[string]any{
		"work_order_id": order["id"], "warehouse_id": e.warehouse["id"],
		"lines": []any{map[string]any{"product_id": e.component["id"], "qty": 1}},
	})
	if body["code"] == float64(0) || !strings.Contains(fmtMessage(body), "不允许新建领料/入库/退料单") {
		t.Fatalf("cancelled work order accepted a picking: %#v", body)
	}
}

// EE3：领料明细带 batch_no / serial_nos 时原版放行。
func TestSourcePickingLineAcceptsTrackingFields(t *testing.T) {
	e := batchESetup(t, "EE-TRACK")
	order := e.client.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": e.product["id"], "qty": 5, "warehouse_id": e.warehouse["id"], "bom_id": e.bom["id"],
	}).(map[string]any)
	pick := e.client.ok("POST", "/api/v1/production-pickings", map[string]any{
		"work_order_id": order["id"], "warehouse_id": e.warehouse["id"],
		"lines": []any{map[string]any{"product_id": e.component["id"], "qty": 1, "batch_no": "EE-T1", "serial_nos": []any{"EE-S1"}}},
	}).(map[string]any)
	if pick["id"] == "" {
		t.Fatal("picking line with tracking fields rejected")
	}
	located := e.client.ok("POST", "/api/v1/production-pickings", map[string]any{
		"work_order_id": order["id"], "warehouse_id": e.warehouse["id"],
		"location_id": "00000000-0000-0000-0000-000000000009",
		"lines":       []any{map[string]any{"product_id": e.component["id"], "qty": 1}},
	}).(map[string]any)
	if located["id"] == "" {
		t.Fatal("picking header location_id rejected")
	}
}

// EE8：外协发料材料的三类错误 —— 非数组、商品不存在、重复材料。
func TestSourceSubcontractMaterialErrorMessages(t *testing.T) {
	e := batchESetup(t, "EE-SUB")
	base := map[string]any{
		"supplier_id": e.supplier["id"], "product_id": e.product["id"], "qty": 5, "mode": "with_material",
	}
	dup := map[string]any{}
	for k, v := range base {
		dup[k] = v
	}
	dup["material_lines"] = []any{
		map[string]any{"product_id": e.component["id"], "qty": 10},
		map[string]any{"product_id": e.component["id"], "qty": 5},
	}
	if _, body := e.client.request("POST", "/api/v1/subcontract-orders", dup); body["code"] == float64(0) {
		t.Fatal("duplicate material accepted")
	} else if fmtMessage(body) != "发料材料不能重复" {
		t.Fatalf("duplicate material message: %#v", body["message"])
	}
	missing := map[string]any{}
	for k, v := range base {
		missing[k] = v
	}
	missing["material_lines"] = []any{map[string]any{"product_id": "00000000-0000-0000-0000-0000000000ff", "qty": 1}}
	// 原版 EE8：商品不存在时返回 HTTP 500 且**无业务文案**，恢复端无原文案可对齐，
	// 保留 501 未恢复。此处断言「未伪造成功」，不断言具体文案。
	if status, body := e.client.request("POST", "/api/v1/subcontract-orders", missing); status == 200 && body["code"] == float64(0) {
		t.Fatal("unknown material product accepted")
	}
	ok := map[string]any{}
	for k, v := range base {
		ok[k] = v
	}
	ok["material_lines"] = []any{map[string]any{"product_id": e.component["id"], "qty": 10}}
	created := e.client.ok("POST", "/api/v1/subcontract-orders", ok).(map[string]any)
	if created["id"] == "" {
		t.Fatal("valid material rejected")
	}
}

// EE7：未领足材料时工单不可完成，保留原有守卫文案。
func TestSourceWorkOrderCannotCompleteWithPendingMaterials(t *testing.T) {
	e := batchESetup(t, "EE-PENDING")
	order := e.client.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": e.product["id"], "qty": 5, "warehouse_id": e.warehouse["id"], "bom_id": e.bom["id"],
	}).(map[string]any)
	e.client.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/confirm", nil)
	// 原版无 start 动作：approve 直接把工单推进到 in_progress。
	e.client.ok("POST", "/api/v1/work-orders/"+order["id"].(string)+"/approve", nil)
	if _, body := e.client.request("POST", "/api/v1/work-orders/"+order["id"].(string)+"/complete", nil); body["code"] == float64(0) {
		t.Fatal("work order completed with pending materials")
	} else if !strings.Contains(fmtMessage(body), "无法完成工单") && !strings.Contains(fmtMessage(body), "尚有") {
		t.Fatalf("unexpected completion message: %#v", body["message"])
	}
}
