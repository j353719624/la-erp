package api

import (
	"testing"
)

// 本文件固化批次 J 取证（2026-10-14）的结论：订单的 source / source_id / source_no
// 被既有实现一律静默忽略，本实现原先把它们变成 501。
// 证据见 运行快照。

// JJ1/JJ5：订单传 source 系列的任何值都放行，且一律落库为 manual。
func TestSourceOrderSourceFieldsAreIgnored(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "JJ-SOURCE")
	customer := party["customer"].(map[string]any)
	for _, v := range []string{"manual", "sales", "purchase", "garbage"} {
		order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
			"customer_id": customer["id"], "warehouse_id": warehouse["id"], "source": v,
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 10}},
		}).(map[string]any)
		if order["source"] != "manual" {
			t.Fatalf("source %q persisted as %v, original normalizes everything to manual", v, order["source"])
		}
	}
}

// JJ1：订单带 source_id/source_no 既有实现 code:0 且两字段不落库。
func TestSourceOrderIgnoresSourceIdAndNo(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "JJ-SRCID")
	customer := party["customer"].(map[string]any)
	source := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": customer["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 2, "price": 30}},
	}).(map[string]any)
	linked := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": customer["id"], "warehouse_id": warehouse["id"],
		"source_id": source["id"], "source_no": source["order_no"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 30}},
	}).(map[string]any)
	if linked["id"] == "" {
		t.Fatal("order with source_id rejected, original accepts it")
	}
	got := c.ok("GET", "/api/v1/sales-orders/"+linked["id"].(string), nil).(map[string]any)
	if got["source_id"] != nil || got["source_no"] != nil {
		t.Fatalf("source_id/source_no should not be persisted: %#v", got)
	}
}

// JJ1b：退货单同样接受 source 系列字段。
func TestSourceSalesReturnIgnoresSourceFields(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "JJ-RETURN")
	customer := party["customer"].(map[string]any)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": customer["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 2, "price": 30}},
	}).(map[string]any)
	for _, key := range []string{"source_id", "sales_order_id"} {
		ret := c.ok("POST", "/api/v1/sales-returns", map[string]any{
			"customer_id": customer["id"], "warehouse_id": warehouse["id"],
			key: order["id"], "source_no": order["order_no"], "sales_order_no": order["order_no"],
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 30}},
		}).(map[string]any)
		if ret["id"] == "" {
			t.Fatalf("sales return with %s rejected, original accepts it", key)
		}
	}
}

// JJ3：不存在的单据 GET 返回 404 + 单据级文案（订单亦然）。
func TestSourceMissingDocumentGetMessages(t *testing.T) {
	c, _ := setup(t)
	const missing = "00000000-0000-0000-0000-000000000000"
	for _, tc := range []struct {
		route string
		want  string
	}{
		{"stock-ins", "入库单不存在"},
		{"stock-outs", "出库单不存在"},
		{"sales-orders", "销售订单不存在"},
		{"purchase-orders", "采购订单不存在"},
		{"inventory-adjusts", "库存调整单不存在"},
		{"inventory-checks", "盘点单不存在"},
		{"stock-transfers", "调拨单不存在"},
		{"work-orders", "工单不存在"},
		{"vouchers", "凭证不存在"},
	} {
		if status, body := c.request("GET", "/api/v1/"+tc.route+"/"+missing, nil); status != 404 || fmtMessage(body) != tc.want {
			t.Fatalf("%s GET missing: %d %#v", tc.route, status, body)
		}
	}
}

// JJ2：已确认订单不可编辑，与既有文案一致。
func TestSourceConfirmedOrderRejectsEdit(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "JJ-EDIT")
	srcSeedStock(t, c, product, warehouse, 10, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 2, "price": 30}},
	}).(map[string]any)
	path := "/api/v1/sales-orders/" + order["id"].(string)
	c.ok("POST", path+"/confirm", nil)
	_, body := c.request("PUT", path, map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 99, "price": 30}},
	})
	if body["code"] == float64(0) || fmtMessage(body) != "只有草稿状态的销售订单才能修改" {
		t.Fatalf("confirmed order edit: %#v", body)
	}
}

// JJ6：库存单接受合法 source_id，非法 UUID 既有实现返回 400。
func TestSourceStockDocumentSourceIdContract(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "JJ-STOCKSRC")
	doc := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"], "source_id": "00000000-0000-0000-0000-000000000001", "source_no": "X",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 1}},
	}).(map[string]any)
	if doc["source_id"] != "00000000-0000-0000-0000-000000000001" {
		t.Fatalf("stock-in source_id not persisted: %#v", doc["source_id"])
	}
	if status, body := c.request("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"], "source_id": "not-a-uuid",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 1}},
	}); status != 400 || body["code"] == float64(0) {
		t.Fatalf("invalid source_id UUID must be rejected at create time: %d %#v", status, body)
	}
	// 格式合法但订单不存在：既有实现建单放行（JJ6）。
	orphan := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"], "source_id": "00000000-0000-0000-0000-000000000000",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 1}},
	}).(map[string]any)
	if orphan["id"] == "" {
		t.Fatal("stock-in with a non-existent but well-formed source_id rejected, original accepts it")
	}
}
