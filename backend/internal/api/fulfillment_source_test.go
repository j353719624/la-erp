package api

import (
	"context"
	"github.com/google/uuid"
	"la-erp/backend/internal/database"
	"strings"
	"testing"
	"time"
)

// 本文件固化第 8 项（fulfillment / service / payments / 序列号台账）逐分支回放取证结论。
// 每条用例的注释标注回归回放编号与日期，证据见 运行快照 下的
// audit-fulfillment-round*.json、audit-product-flags*.json、audit-serial-edges*.json。

// testFixture 返回一个已登录客户端及常用的种子/新建基础数据。
func testFixture(t *testing.T, code string) (*client, map[string]any, map[string]any, map[string]any) {
	t.Helper()
	c, s, product, warehouse, party := testFixtureWithServer(t, code)
	_ = s
	return c, product, warehouse, party
}

func testFixtureWithServer(t *testing.T, code string) (*client, *Server, map[string]any, map[string]any, map[string]any) {
	t.Helper()
	c, s := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": code, "name": code}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": code + "-C", "name": code + "-客户"}).(map[string]any)
	supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"code": code + "-S", "name": code + "-供应商"}).(map[string]any)
	return c, s, product, warehouse, map[string]any{"customer": customer, "supplier": supplier}
}

// srcInsertContract 直接写入一张合同主数据记录，返回其 id。
func srcInsertContract(t *testing.T, s *Server, table, contractNo string) string {
	t.Helper()
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	record := map[string]any{
		"id": uuid.NewString(), "contract_no": contractNo, "total_amount": "0", "status": "draft",
		"created_at": stamp, "updated_at": stamp,
	}
	if s.Store.Has(table, "tenant_id") {
		record["tenant_id"] = database.ZeroUUID
	}
	if err := s.Store.InsertWith(context.Background(), s.Store.DB, table, record); err != nil {
		t.Fatal(err)
	}
	return record["id"].(string)
}

func srcLine(t *testing.T, doc map[string]any, index int) map[string]any {
	t.Helper()
	lines, ok := doc["edges"].(map[string]any)["lines"].([]any)
	if !ok || index >= len(lines) {
		t.Fatalf("document %v has no line %d", doc["id"], index)
	}
	return lines[index].(map[string]any)
}

// seedStock 备货：入库 n 件单价 cost，供出库用例使用。
func srcSeedStock(t *testing.T, c *client, product, warehouse map[string]any, qty, cost int) {
	t.Helper()
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": qty, "unit_cost": cost},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
}

// A2 回放：启用 sales_order 活动审批流后，订单确认与审批仍全部通过——
// 既有实现订单状态机不接入审批流，本实现同样不统计审批流。
func TestSourceActiveApprovalFlowDoesNotBlockOrderLifecycle(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-APPROVAL-FLOW")
	srcSeedStock(t, c, product, warehouse, 10, 10)
	c.ok("POST", "/api/v1/approval-flows", map[string]any{"code": "REC-AF", "name": "销售订单审批流", "biz_type": "sales_order", "is_active": true})
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "price": 50},
	}}).(map[string]any)
	path := "/api/v1/sales-orders/" + order["id"].(string)
	c.ok("POST", path+"/confirm", nil)
	approved := c.ok("POST", path+"/approve", nil).(map[string]any)
	if approved["status"] != "approved" {
		t.Fatal("active approval flow blocked approval", approved)
	}
}

// A2/B1/R2/S6 回放：USD 订单创建、编辑、确认、审批全流程通过且 currency 持久化。
func TestSourceForeignCurrencyOrderLifecycle(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-USD-ORDER")
	srcSeedStock(t, c, product, warehouse, 10, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "currency": "USD",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 3, "price": 12.5}},
	}).(map[string]any)
	if order["currency"] != "USD" {
		t.Fatalf("currency not persisted: %v", order["currency"])
	}
	path := "/api/v1/sales-orders/" + order["id"].(string)
	c.ok("PUT", path, map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "currency": "EUR", "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 4, "price": 12.5},
	}})
	edited := c.ok("GET", path, nil).(map[string]any)
	if edited["currency"] != "EUR" {
		t.Fatalf("foreign currency edit rejected: %v", edited["currency"])
	}
	c.ok("POST", path+"/confirm", nil)
	c.ok("POST", path+"/approve", nil)
}

// B2 回放：头部 discount_amount 落库但不计入 total_amount。
func TestSourceHeaderDiscountPersistsWithoutAffectingTotal(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-HEADER-DISCOUNT")
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "discount_amount": 50,
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 100}},
	}).(map[string]any)
	if order["discount_amount"] != "50" || order["total_amount"] != "100" {
		t.Fatalf("header discount behaviour mismatch: %v", order)
	}
}

// B3/R1 回放：赠品行必须零价；零价赠品落库 is_gift 且不计入合计。
// 注意：订单类失败走 HTTP 200 + code 10000（businessFailure 非 stock 分支）。
func TestSourceGiftLineRequiresZeroPrice(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-GIFT")
	_, body := c.request("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 100, "is_gift": true}},
	})
	if body["code"] == float64(0) {
		t.Fatalf("priced gift line accepted: %#v", body)
	}
	if fmtMessage(body) != "赠品行单价必须为 0" {
		t.Fatalf("gift message mismatch: %#v", body["message"])
	}
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
		"lines": []any{
			map[string]any{"product_id": product["id"], "qty": 1, "price": 100},
			map[string]any{"product_id": product["id"], "qty": 2, "price": 0, "is_gift": true},
		},
	}).(map[string]any)
	if order["total_amount"] != "100" {
		t.Fatalf("gift amount leaked into total: %v", order["total_amount"])
	}
	if gift := srcLine(t, order, 1); gift["is_gift"] != true || gift["amount"] != "0" {
		t.Fatalf("gift line not persisted: %#v", gift)
	}
}

// R3/S5 回放：库存单 type 无白名单，任意值落库，且可与 source 共存。
func TestSourceStockDocumentTypeAcceptsAnyValue(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-TYPE-FREE")
	srcSeedStock(t, c, product, warehouse, 20, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "price": 20},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	for _, kind := range []string{"sales", "purchase", "garbage", "other"} {
		doc := c.ok("POST", "/api/v1/stock-outs", map[string]any{
			"warehouse_id": warehouse["id"], "type": kind, "source_id": order["id"], "source_no": order["order_no"],
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 10}},
		}).(map[string]any)
		if doc["type"] != kind {
			t.Fatalf("type %s not persisted: %v", kind, doc["type"])
		}
	}
}

// R7/S3 回放：库存单 location_id/rack_id 落库；订单表无对应列的 location_id 显式拒绝。
func TestSourceLocationFieldsFollowTableShape(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-LOCATION")
	location := c.ok("POST", "/api/v1/locations", map[string]any{"name": "REC-A区", "warehouse_id": warehouse["id"]}).(map[string]any)
	rack := c.ok("POST", "/api/v1/racks", map[string]any{"name": "REC-A1", "warehouse_id": warehouse["id"]}).(map[string]any)
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"], "location_id": location["id"], "rack_id": rack["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 5, "unit_cost": 3}},
	}).(map[string]any)
	if in["location_id"] != location["id"] || in["rack_id"] != rack["id"] {
		t.Fatalf("stock location fields dropped: %#v", in)
	}
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	// 批次 O 补充实测（2026-10-14）：销售订单带 location_id 既有实现 **code:0 建单成功**
	// （sales_orders 无 location_id 列，既有实现静默忽略）。
	// 本用例原先断言「应被拒绝」，那是按项目原则（不能静默丢弃字段）推导的，
	// 与实测不符，已按证据修正为「放行且不落库」。
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "location_id": location["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 5}},
	}).(map[string]any)
	if order["location_id"] != nil {
		t.Fatalf("order location_id must not be persisted (no such column): %#v", order["location_id"])
	}
	// 同样地，订单带 rack_id / batch_no / serial_nos / production_date 既有实现也一律放行。
	for _, extra := range []map[string]any{
		{"rack_id": rack["id"]},
		{"batch_no": "O-BATCH"},
		{"serial_nos": []any{"O-S1"}},
		{"production_date": "2026-01-01T00:00:00Z"},
	} {
		body := map[string]any{
			"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 5}},
		}
		for k, v := range extra {
			body[k] = v
		}
		if _, resp := c.request("POST", "/api/v1/sales-orders", body); resp["code"] != float64(0) {
			t.Fatalf("order with %v must be accepted by the original: %#v", extra, resp)
		}
	}
}

// S4 回放：销售订单 sales_contract_id 与采购订单 contract_id 落库。
func TestSourceContractForeignKeysPersist(t *testing.T) {
	c, s, product, warehouse, party := testFixtureWithServer(t, "REC-CONTRACT")
	salesContract := srcInsertContract(t, s, "sales_contracts", "REC-S-001")
	purchaseContract := srcInsertContract(t, s, "purchase_contracts", "REC-P-001")
	sales := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "sales_contract_id": salesContract,
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 9}},
	}).(map[string]any)
	if sales["sales_contract_id"] != salesContract {
		t.Fatalf("sales_contract_id dropped: %#v", sales["sales_contract_id"])
	}
	purchase := c.ok("POST", "/api/v1/purchase-orders", map[string]any{
		"supplier_id": party["supplier"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "contract_id": purchaseContract,
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 9}},
	}).(map[string]any)
	if purchase["contract_id"] != purchaseContract {
		t.Fatalf("contract_id dropped: %#v", purchase["contract_id"])
	}
}

// V1/Y1-Y3 回放：同一商品多行来源订单按 line_no 跨行分配，一次发货跨行拆分。
func TestSourceMultiLineSourceOrderAllocatesAcrossLines(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-MULTILINE")
	srcSeedStock(t, c, product, warehouse, 30, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "price": 20},
		map[string]any{"product_id": product["id"], "qty": 3, "price": 18},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{
		"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 5, "unit_cost": 10}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
	got := c.ok("GET", "/api/v1/sales-orders/"+order["id"].(string), nil).(map[string]any)
	if l1, l2 := srcLine(t, got, 0), srcLine(t, got, 1); l1["delivered_qty"] != "2" || l2["delivered_qty"] != "3" {
		t.Fatalf("cross-line allocation mismatch: L1=%v L2=%v", l1["delivered_qty"], l2["delivered_qty"])
	}
	if got["status"] != "closed" {
		t.Fatalf("fully delivered order not closed: %v", got["status"])
	}
}

// V2/Z1/Z4 回放：多行超额按聚合剩余量拒绝，文案含合计剩余与本次数量。
func TestSourceOverDeliveryRejectedWithAggregateRemainder(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-OVERDELIVERY")
	srcSeedStock(t, c, product, warehouse, 30, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "price": 20},
		map[string]any{"product_id": product["id"], "qty": 3, "price": 18},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{
		"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 6, "unit_cost": 10}},
	}).(map[string]any)
	_, body := c.request("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
	if body["code"] == float64(0) {
		t.Fatal("over-delivery accepted", body)
	}
	message, _ := body["message"].(string)
	for _, fragment := range []string{"超发", "剩余可发 5.00", "本次 6.00"} {
		if !contains(message, fragment) {
			t.Fatalf("over-delivery message %q missing %q", message, fragment)
		}
	}
}

// V4/Z2/Z3/Y1-Y3 回放：来源订单三态文案（草稿/已取消/已关闭）逐字对齐。
func TestSourceSourceOrderStateMessages(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-STATE-MSG")
	srcSeedStock(t, c, product, warehouse, 30, 10)
	cases := []struct {
		name    string
		arrange func(order map[string]any) map[string]any
		want    string
	}{
		{"draft", func(o map[string]any) map[string]any { return o }, ""},
		{"cancelled", func(o map[string]any) map[string]any {
			c.ok("POST", "/api/v1/sales-orders/"+o["id"].(string)+"/cancel", nil)
			return o
		}, ""},
		{"closed", func(o map[string]any) map[string]any {
			c.ok("POST", "/api/v1/sales-orders/"+o["id"].(string)+"/confirm", nil)
			c.ok("POST", "/api/v1/sales-orders/"+o["id"].(string)+"/approve", nil)
			first := c.ok("POST", "/api/v1/stock-outs", map[string]any{
				"warehouse_id": warehouse["id"], "type": "sales", "source_id": o["id"], "source_no": o["order_no"],
				"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 10}},
			}).(map[string]any)
			c.ok("POST", "/api/v1/stock-outs/"+first["id"].(string)+"/confirm", nil)
			return o
		}, ""},
	}
	messages := map[string]string{}
	for _, tc := range cases {
		order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
			map[string]any{"product_id": product["id"], "qty": 1, "price": 20},
		}}).(map[string]any)
		tc.arrange(order)
		out := c.ok("POST", "/api/v1/stock-outs", map[string]any{
			"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"],
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 10}},
		}).(map[string]any)
		_, body := c.request("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
		messages[tc.name] = fmtMessage(body)
	}
	if !contains(messages["draft"], "未确认，不能发货（请先确认订单）") {
		t.Fatalf("draft message: %q", messages["draft"])
	}
	if !contains(messages["cancelled"], "已取消，不能发货") {
		t.Fatalf("cancelled message: %q", messages["cancelled"])
	}
	if !contains(messages["closed"], "已关闭，不能继续发货") {
		t.Fatalf("closed message: %q", messages["closed"])
	}
}

// V3/V5 回放：source_no 与仓库不一致均放行，仅按 source_id 关联。
func TestSourceSourceLinkingIgnoresNumberAndWarehouse(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-SOURCE-LINK")
	other := c.ok("POST", "/api/v1/warehouses", map[string]any{"code": "REC-WH2", "name": "REC-WH2"}).(map[string]any)
	// 两个仓库都要有货：订单确认会锁定订单自身仓库的库存，出库则取自出库仓库。
	srcSeedStock(t, c, product, warehouse, 10, 10)
	srcSeedStock(t, c, product, other, 10, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "price": 20},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{
		"warehouse_id": other["id"], "type": "sales", "source_id": order["id"], "source_no": "WRONG",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 10}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
	got := c.ok("GET", "/api/v1/sales-orders/"+order["id"].(string), nil).(map[string]any)
	if srcLine(t, got, 0)["delivered_qty"] != "1" {
		t.Fatal("cross-warehouse source linking rejected", got)
	}
}

// V6 回放：明细单位与来源订单行单位不一致时既有实现放行并正常回写。
func TestSourceDeliveryIgnoresUnitMismatch(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-UNIT-MISMATCH")
	units := c.ok("GET", "/api/v1/units", nil).(map[string]any)["list"].([]any)
	u1, u2 := units[0].(map[string]any), units[1].(map[string]any)
	srcSeedStock(t, c, product, warehouse, 10, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "price": 20, "unit_id": u1["id"]},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{
		"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 10, "unit_id": u2["id"]}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
	got := c.ok("GET", "/api/v1/sales-orders/"+order["id"].(string), nil).(map[string]any)
	if srcLine(t, got, 0)["delivered_qty"] != "1" {
		t.Fatal("unit mismatch blocked delivery", got)
	}
}

// CA1/CA2/CA3/CA5/CA11 回放：库存单 cancel 路由存在；仅草稿可取消；
// 取消后不可重复取消、不可再确认，且不产生库存与来源订单副作用。
func TestSourceStockDocumentCancelRules(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-STOCK-CANCEL")
	srcSeedStock(t, c, product, warehouse, 10, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "price": 20},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{
		"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 10}},
	}).(map[string]any)
	path := "/api/v1/stock-outs/" + out["id"].(string)
	cancelled := c.ok("POST", path+"/cancel", nil).(map[string]any)
	if cancelled["status"] != "cancelled" {
		t.Fatalf("cancel status: %v", cancelled["status"])
	}
	if _, body := c.request("POST", path+"/cancel", nil); body["message"] != "出库单不存在或状态不允许取消" {
		t.Fatalf("repeated cancel: %#v", body["message"])
	}
	if _, body := c.request("POST", path+"/confirm", nil); body["message"] != "出库单不存在或状态不允许确认" {
		t.Fatalf("confirm after cancel: %#v", body["message"])
	}
	got := c.ok("GET", "/api/v1/sales-orders/"+order["id"].(string), nil).(map[string]any)
	if srcLine(t, got, 0)["delivered_qty"] != "0" {
		t.Fatal("cancel touched source order", got)
	}
	// 已确认的出库单不允许取消。
	confirmed := c.ok("POST", "/api/v1/stock-outs", map[string]any{
		"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 10}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+confirmed["id"].(string)+"/confirm", nil)
	if _, body := c.request("POST", "/api/v1/stock-outs/"+confirmed["id"].(string)+"/cancel", nil); body["message"] != "出库单不存在或状态不允许取消" {
		t.Fatalf("confirmed cancel: %#v", body["message"])
	}
	// 库存单不存在时 confirm/cancel 均返回 400 + 文档级文案（CA11）。
	for _, route := range []string{"stock-ins", "stock-outs"} {
		label := "出库单"
		if route == "stock-ins" {
			label = "入库单"
		}
		for _, action := range []string{"confirm", "cancel"} {
			if status, body := c.request("POST", "/api/v1/"+route+"/00000000-0000-0000-0000-000000000000/"+action, nil); status != 400 || body["message"] != label+"不存在" {
				t.Fatalf("%s/%s missing record: %d %#v", route, action, status, body)
			}
		}
	}
}

// W6/X4/CD5 回放：部分发货后的 confirmed 订单仍可取消，delivered_qty 不回滚；
// 但已审批（approved）与已关闭（closed）订单不可取消（CD1/CD3/X6e 回放）。
func TestSourceShippedOrderCanStillBeCancelled(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-CANCEL-SHIPPED")
	srcSeedStock(t, c, product, warehouse, 10, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "price": 20},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{
		"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 10}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/cancel", nil)
	got := c.ok("GET", "/api/v1/sales-orders/"+order["id"].(string), nil).(map[string]any)
	if got["status"] != "cancelled" || srcLine(t, got, 0)["delivered_qty"] != "1" {
		t.Fatalf("shipped order cancel changed delivery: %#v", got)
	}
	// 已审批订单不可取消（CD1）。
	approved := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "price": 20},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+approved["id"].(string)+"/confirm", nil)
	c.ok("POST", "/api/v1/sales-orders/"+approved["id"].(string)+"/approve", nil)
	if _, body := c.request("POST", "/api/v1/sales-orders/"+approved["id"].(string)+"/cancel", nil); fmtMessage(body) != "只有草稿或已确认的销售订单才能取消" {
		t.Fatalf("approved order cancel: %#v", body["message"])
	}
	// 已关闭订单不可取消（CD3/X6e）。
	closed := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "price": 20},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+closed["id"].(string)+"/confirm", nil)
	c.ok("POST", "/api/v1/sales-orders/"+closed["id"].(string)+"/approve", nil)
	closedOut := c.ok("POST", "/api/v1/stock-outs", map[string]any{
		"warehouse_id": warehouse["id"], "type": "sales", "source_id": closed["id"], "source_no": closed["order_no"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 10}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+closedOut["id"].(string)+"/confirm", nil)
	if _, body := c.request("POST", "/api/v1/sales-orders/"+closed["id"].(string)+"/cancel", nil); fmtMessage(body) != "只有草稿或已确认的销售订单才能取消" {
		t.Fatalf("closed order cancel: %#v", body["message"])
	}
}

// P1-P4 回放：成本方法不影响单据可用性；实测 fifo 仍按加权平均计价。
func TestSourceCostMethodDoesNotBlockDocuments(t *testing.T) {
	c, s := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "REC-FIFO", "name": "REC-FIFO", "cost_method": "fifo"}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	first := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 10, "unit_cost": 100},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+first["id"].(string)+"/confirm", nil)
	second := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 10, "unit_cost": 200},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+second["id"].(string)+"/confirm", nil)
	var avg string
	if err := s.Store.DB.QueryRow("SELECT avg_cost FROM inventory_balances WHERE product_id=? AND warehouse_id=?",
		product["id"], warehouse["id"]).Scan(&avg); err != nil {
		t.Fatal(err)
	}
	if avg != "150" {
		t.Fatalf("weighted average mismatch: %s", avg)
	}
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 5, "unit_cost": 0},
	}}).(map[string]any)
	confirmed := c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil).(map[string]any)
	if line := srcLine(t, confirmed, 0); line["unit_cost"] != "150" || line["amount"] != "750" {
		t.Fatalf("fifo outbound cost mismatch: %#v", line)
	}
}

// P1-P3/Q1-Q6 回放：批次与序列号商品在库存单与订单中均可用——批次号可省略，
// 序列号受台账约束（出库必填）。
func TestSourceBatchAndSerialProductsUsableInDocuments(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "REC-BATCH-SERIAL")
	updated := c.ok("PUT", "/api/v1/products/"+product["id"].(string), map[string]any{"name": "REC-BATCH-SERIAL", "is_batch": true, "is_serial": true}).(map[string]any)
	if updated["is_batch"] != true || updated["is_serial"] != true {
		t.Fatalf("product flags not persisted: %#v", updated)
	}
	// 序列号商品入库必须带序列号（台账注册）。
	bare := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 7},
	}}).(map[string]any)
	if _, body := c.request("POST", "/api/v1/stock-ins/"+bare["id"].(string)+"/confirm", nil); fmtMessage(body) != "商品 [REC-BATCH-SERIAL] 为序列号管理，必须填写序列号" {
		t.Fatalf("serial inbound without numbers: %#v", body["message"])
	}
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "unit_cost": 7, "serial_nos": []any{"REC-BS-1", "REC-BS-2"}},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	// 批次+序列号商品可正常进入销售订单。
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "price": 9},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 7},
	}}).(map[string]any)
	_, body := c.request("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
	if body["code"] == float64(0) || fmtMessage(body) != "商品 [REC-BATCH-SERIAL] 为序列号管理，出库必须填写序列号" {
		t.Fatalf("serial outbound without numbers accepted: %#v", body)
	}
	// 批次号可省略（Q5 回放）：带序列号出库成功。
	ok := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 7, "serial_nos": []any{"REC-BS-1"}},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+ok["id"].(string)+"/confirm", nil)
}

// T/U/VD 回放：序列号台账的入库注册、重复拒绝、跨商品拒绝与出库覆写来源。
func TestSourceSerialLedgerLifecycle(t *testing.T) {
	c, s := setup(t)
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "REC-SN-LEDGER", "name": "REC-SN-LEDGER", "is_serial": true}).(map[string]any)
	other := c.ok("POST", "/api/v1/products", map[string]any{"code": "REC-SN-OTHER", "name": "REC-SN-OTHER", "is_serial": true}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "REC-SN-C", "name": "REC-SN-客户"}).(map[string]any)

	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "unit_cost": 4, "serial_nos": []any{"REC-SN-1", "REC-SN-2"}},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	var status, sourceType, sourceNo string
	if err := s.Store.DB.QueryRow("SELECT status, source_type, source_no FROM serial_numbers WHERE serial_no='REC-SN-1'").Scan(&status, &sourceType, &sourceNo); err != nil {
		t.Fatal(err)
	}
	if status != "in_stock" || sourceType != "stock_in" || sourceNo != in["stock_in_no"] {
		t.Fatalf("inbound serial registration: status=%s source=%s/%s (doc %v)", status, sourceType, sourceNo, in["stock_in_no"])
	}
	// 重复序列号拒绝。
	dup := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 4, "serial_nos": []any{"REC-SN-1"}},
	}}).(map[string]any)
	if _, body := c.request("POST", "/api/v1/stock-ins/"+dup["id"].(string)+"/confirm", nil); fmtMessage(body) != "序列号 REC-SN-1 已在台账中存在" {
		t.Fatalf("duplicate serial: %#v", body["message"])
	}
	// 单内重复。
	dupIn := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 2, "unit_cost": 4, "serial_nos": []any{"REC-SN-3", "REC-SN-3"}},
	}}).(map[string]any)
	if _, body := c.request("POST", "/api/v1/stock-ins/"+dupIn["id"].(string)+"/confirm", nil); fmtMessage(body) != "序列号 REC-SN-3 在本单内重复" {
		t.Fatalf("in-document duplicate serial: %#v", body["message"])
	}
	// 数量与序列号个数不一致。
	mismatch := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 3, "unit_cost": 4, "serial_nos": []any{"REC-SN-4"}},
	}}).(map[string]any)
	if _, body := c.request("POST", "/api/v1/stock-ins/"+mismatch["id"].(string)+"/confirm", nil); !contains(fmtMessage(body), "序列号数量(1)与入库数量(3)不一致") {
		t.Fatalf("serial count mismatch: %#v", body["message"])
	}
	// 序列号不属于该商品（U3：库存校验先于序列号校验，故需先备货）。
	otherIn := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": other["id"], "qty": 1, "unit_cost": 4, "serial_nos": []any{"REC-SN-OTHER-1"}},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+otherIn["id"].(string)+"/confirm", nil)
	foreign := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": other["id"], "qty": 1, "unit_cost": 4, "serial_nos": []any{"REC-SN-1"}},
	}}).(map[string]any)
	if _, body := c.request("POST", "/api/v1/stock-outs/"+foreign["id"].(string)+"/confirm", nil); fmtMessage(body) != "序列号 REC-SN-1 不属于该商品" {
		t.Fatalf("foreign serial: %#v", body["message"])
	}
	// 不存在于台账。
	missing := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 4, "serial_nos": []any{"REC-SN-NONE"}},
	}}).(map[string]any)
	if _, body := c.request("POST", "/api/v1/stock-outs/"+missing["id"].(string)+"/confirm", nil); fmtMessage(body) != "序列号 REC-SN-NONE 不存在于台账" {
		t.Fatalf("missing serial: %#v", body["message"])
	}
	// 正常出库：来源覆写为 stock_out。
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{"customer_id": customer["id"], "warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "price": 9},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/approve", nil)
	out := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 4, "serial_nos": []any{"REC-SN-1"}},
	}}).(map[string]any)
	c.ok("POST", "/api/v1/stock-outs/"+out["id"].(string)+"/confirm", nil)
	if err := s.Store.DB.QueryRow("SELECT status, source_type, source_no FROM serial_numbers WHERE serial_no='REC-SN-1'").Scan(&status, &sourceType, &sourceNo); err != nil {
		t.Fatal(err)
	}
	if status != "out" || sourceType != "stock_out" || sourceNo != out["stock_out_no"] {
		t.Fatalf("outbound serial overwrite: status=%s source=%s/%s", status, sourceType, sourceNo)
	}
	// 二次出库：状态非 in_stock。
	again := c.ok("POST", "/api/v1/stock-outs", map[string]any{"warehouse_id": warehouse["id"], "type": "sales", "source_id": order["id"], "source_no": order["order_no"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 4, "serial_nos": []any{"REC-SN-1"}},
	}}).(map[string]any)
	if _, body := c.request("POST", "/api/v1/stock-outs/"+again["id"].(string)+"/confirm", nil); !contains(fmtMessage(body), "当前状态为 out，不能出库") {
		t.Fatalf("already dispatched serial: %#v", body["message"])
	}
	// 台账回写不因后续失败回滚。
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM serial_numbers WHERE product_id=? AND deleted_at IS NULL", product["id"]).Scan(&count)
	if count != 2 {
		t.Fatalf("ledger rows=%d", count)
	}
}

// M1-M5 回放：收付款方式归一化映射；CNY 单据接受非 1 汇率并落库，确认时忽略汇率。
func TestSourcePaymentTypeNormalizationAndCNYRate(t *testing.T) {
	c, s := setup(t)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "REC-收款方式"}).(map[string]any)
	accounts, err := s.Store.Rows(context.Background(), "SELECT * FROM accounts WHERE code='1001'")
	if err != nil || len(accounts) != 1 {
		t.Fatal(err)
	}
	cash := accounts[0]
	date := time.Now().UTC().Format(time.RFC3339Nano)
	invoice := c.ok("POST", "/api/v1/ar-invoices", map[string]any{"customer_id": customer["id"], "invoice_date": date, "total_amount": 100}).(map[string]any)
	create := func(kind string, rate any) map[string]any {
		body := map[string]any{
			"customer_id": customer["id"], "receipt_date": date, "amount": 10, "receipt_type": kind,
			"cash_account_id": cash["id"], "cash_account_code": cash["code"], "cash_account_name": cash["name"],
			"lines": []any{map[string]any{"ar_invoice_id": invoice["id"], "amount": 10}},
		}
		if rate != nil {
			body["currency_code"], body["exchange_rate"] = "CNY", rate
		}
		return c.ok("POST", "/api/v1/payment-receipts", body).(map[string]any)
	}
	want := map[string]string{"bank": "银行转账", "alipay": "支付宝", "wechat": "微信支付", "cash": "现金", "check": "支票", "other": "其他", "garbage": "garbage"}
	for kind, name := range want {
		payment := create(kind, nil)
		if payment["receipt_type"] != name {
			t.Fatalf("receipt_type %s => %v, want %s", kind, payment["receipt_type"], name)
		}
	}
	payment := create("normal", 7.2)
	if payment["exchange_rate"] != "7.2" {
		t.Fatalf("CNY rate not persisted: %v", payment["exchange_rate"])
	}
	c.ok("POST", "/api/v1/payment-receipts/"+payment["id"].(string)+"/confirm", nil)
	got := c.ok("GET", "/api/v1/ar-invoices/"+invoice["id"].(string), nil).(map[string]any)
	if got["received_amount"] != "10" || got["balance"] != "90" {
		t.Fatalf("CNY rate applied despite CNY currency: %#v", got)
	}
	var debit, credit string
	if err := s.Store.DB.QueryRow("SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END),0), COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END),0) FROM journal_entries WHERE source_id=? AND source_type='payment_receipt'",
		payment["id"]).Scan(&debit, &credit); err != nil {
		t.Fatal(err)
	}
	if debit != "10" || credit != "10" {
		t.Fatalf("voucher converted by CNY rate: debit=%s credit=%s", debit, credit)
	}
}

func contains(haystack, needle string) bool { return strings.Contains(haystack, needle) }

func fmtMessage(body map[string]any) string {
	message, _ := body["message"].(string)
	return message
}
