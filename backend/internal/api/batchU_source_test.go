package api

import (
	"testing"
)

// 本文件固化批次 U 取证（2026-10-14）的结论：serial_nos 的元素类型校验必须
// 在**建单期**生效（与确认期语义不同）。证据见
// 运行快照。
//
// 建单期：数字 / 布尔 / 对象 → HTTP 400「系统内部错误，请稍后重试或联系管理员」
//         null / 空串        → code:0（视为空串）
// 确认期：null / 空串 → 400「序列号不能为空」；正常 → code:0

// UU1：serial_nos 非字符串元素在建单期即被拒绝（与与既有行为一致）。
func TestSourceSerialTypeRejectedAtCreate(t *testing.T) {
	c, _, warehouse, _ := testFixture(t, "UU-CREATE")
	product := c.ok("POST", "/api/v1/products", map[string]any{
		"code": "UU-P", "name": "UU 序列号商品", "is_serial": true,
	}).(map[string]any)
	for _, tc := range []struct {
		name  string
		value any
	}{
		{"数字", 123},
		{"布尔", true},
		{"对象", map[string]any{"a": 1}},
	} {
		_, body := c.request("POST", "/api/v1/stock-ins", map[string]any{
			"warehouse_id": warehouse["id"],
			"lines": []any{map[string]any{
				"product_id": product["id"], "qty": 1, "unit_cost": 1,
				"serial_nos": []any{tc.value},
			}},
		})
		if body["code"] != float64(400) || fmtMessage(body) != "系统内部错误，请稍后重试或联系管理员" {
			t.Fatalf("%s serial at create: want 400/系统内部错误，got %v/%q", tc.name, body["code"], fmtMessage(body))
		}
	}
}

// UU2：null / 空串在建单期放行，确认期报「序列号不能为空」。
func TestSourceBlankSerialRejectedAtConfirm(t *testing.T) {
	c, _, warehouse, _ := testFixture(t, "UU-BLANK")
	product := c.ok("POST", "/api/v1/products", map[string]any{
		"code": "UU-B", "name": "UU 空序列号商品", "is_serial": true,
	}).(map[string]any)
	for _, tc := range []struct {
		name  string
		value any
	}{
		{"null", nil},
		{"空串", ""},
	} {
		doc := c.ok("POST", "/api/v1/stock-ins", map[string]any{
			"warehouse_id": warehouse["id"],
			"lines": []any{map[string]any{
				"product_id": product["id"], "qty": 1, "unit_cost": 1,
				"serial_nos": []any{tc.value},
			}},
		}).(map[string]any)
		_, body := c.request("POST", "/api/v1/stock-ins/"+doc["id"].(string)+"/confirm", nil)
		if body["code"] == float64(0) || fmtMessage(body) != "序列号不能为空" {
			t.Fatalf("%s serial at confirm: %#v", tc.name, body)
		}
	}
}

// UU3：正常序列号两期都通过。
func TestSourceValidSerialFlowsThrough(t *testing.T) {
	c, _, warehouse, _ := testFixture(t, "UU-OK")
	product := c.ok("POST", "/api/v1/products", map[string]any{
		"code": "UU-OK-P", "name": "UU 正常序列号商品", "is_serial": true,
	}).(map[string]any)
	doc := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{
			"product_id": product["id"], "qty": 2, "unit_cost": 1,
			"serial_nos": []any{"UU-S-1", "UU-S-2"},
		}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+doc["id"].(string)+"/confirm", nil)
}
