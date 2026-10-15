package api

import (
	"strings"
	"testing"
)

// 本文件固化批次 R 取证（2026-10-14）的结论：
//   1. plainProduct 的 is_combo 守卫是**死代码** —— 原版不存在 is_combo=true 的商品行
//      （传入 true / 1 均被静默忽略，回读 undefined，combo-products 列表恒为 0）；
//      而 product_type=combo 会正常落库，且该商品出入库完全正常。
//   2. 表头 discount / discount_rate 原版**一律静默忽略**（四种单据实测 code:0），
//      恢复端原先 501 拒绝，属与批次 N/O/P 同源的误拒。
// 证据见 evidence/backend-runtime/audit-batch-r-20261014.json。

// RR1：普通商品（product_type=combo）必须能正常走出入库，不被任何组合件守卫拦下。
func TestSourceComboTypedProductStillTrades(t *testing.T) {
	c, _, warehouse, _ := testFixture(t, "RR-COMBOTRADE")
	product := c.ok("POST", "/api/v1/products", map[string]any{
		"code": "RR-COMBO", "name": "RR 组合件", "product_type": "combo",
	}).(map[string]any)
	// 原版回读 product_type=combo，且 is_combo 恒为 undefined
	if product["product_type"] != "combo" {
		t.Fatalf("product_type must be persisted as combo: %#v", product["product_type"])
	}
	if product["is_combo"] != nil {
		t.Fatalf("is_combo must stay unset (the original ignores it): %#v", product["is_combo"])
	}
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"], "qty": 3, "unit_cost": 4}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
}

// RR2：is_combo 传值被原版忽略，不得触发 501。
func TestSourceIsComboFlagIsIgnored(t *testing.T) {
	c, _, warehouse, _ := testFixture(t, "RR-ISCOMBO")
	for i, flag := range []any{true, 1} {
		product := c.ok("POST", "/api/v1/products", map[string]any{
			"code": "RR-FLAG-" + itoa(i), "name": "RR flag", "is_combo": flag,
		}).(map[string]any)
		if product["is_combo"] != nil {
			t.Fatalf("is_combo must not be persisted: %#v", product["is_combo"])
		}
		in := c.ok("POST", "/api/v1/stock-ins", map[string]any{
			"warehouse_id": warehouse["id"],
			"lines":        []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 1}},
		}).(map[string]any)
		c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	}
}

// RR3：表头 discount / discount_rate 放行且不落库（订单与采购单）。
func TestSourceHeaderDiscountFieldsAreIgnored(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "RR-DISCOUNT")
	customer := party["customer"].(map[string]any)
	supplier := party["supplier"].(map[string]any)
	line := []any{map[string]any{"product_id": product["id"], "qty": 2, "price": 10}}

	for _, tc := range []struct {
		name  string
		route string
		base  map[string]any
		extra map[string]any
	}{
		{"order_discount", "/api/v1/sales-orders", map[string]any{
			"customer_id": customer["id"], "warehouse_id": warehouse["id"]}, map[string]any{"discount": 10}},
		{"order_discount_rate", "/api/v1/sales-orders", map[string]any{
			"customer_id": customer["id"], "warehouse_id": warehouse["id"]}, map[string]any{"discount_rate": 0.1}},
		{"purchase_discount", "/api/v1/purchase-orders", map[string]any{
			"supplier_id": supplier["id"], "warehouse_id": warehouse["id"]}, map[string]any{"discount": 10}},
	} {
		body := map[string]any{"lines": line}
		for k, v := range tc.base {
			body[k] = v
		}
		for k, v := range tc.extra {
			body[k] = v
		}
		doc := c.ok("POST", tc.route, body).(map[string]any)
		for k := range tc.extra {
			if doc[k] != nil {
				t.Fatalf("%s: %s must not be persisted: %#v", tc.name, k, doc[k])
			}
		}
	}

	// 入库单同样放行
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"], "discount": 10,
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 1}},
	}).(map[string]any)
	if in["discount"] != nil {
		t.Fatalf("stock-in discount must not be persisted: %#v", in["discount"])
	}
}

// RR4：表头 discount_amount 仍按原版落库但不计入 total_amount。
func TestSourceHeaderDiscountAmountDoesNotAffectTotal(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "RR-DISCOUNTAMT")
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
		"discount_amount": 50,
		"lines":           []any{map[string]any{"product_id": product["id"], "qty": 2, "price": 10}},
	}).(map[string]any)
	if order["discount_amount"] != "50" {
		t.Fatalf("discount_amount must be persisted: %#v", order["discount_amount"])
	}
	// 原版 total_amount 不扣减 discount_amount（2026-10-13 B2 回放同结论）
	if !strings.Contains(trimJSON(order), `"total_amount":"20"`) {
		t.Fatalf("total_amount must stay 20 (discount_amount excluded): %s", trimJSON(order))
	}
}
