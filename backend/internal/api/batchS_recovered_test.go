package api

import (
	"testing"
)

// 本文件固化批次 S 取证（2026-10-14）的结论：带料外协的材料行校验必须按原版的
// 形态分层 —— 类型错 400、空数组走业务文案、product_id 空 400、product_id 不存在 500。
// 证据见 evidence/backend-runtime/audit-batch-s-20261014.json。

// SS1：material_lines 与 product_id 的各种畸形输入，状态码与文案逐条对齐原版。
func TestRecoveredSubcontractMaterialShapeMatchesOriginal(t *testing.T) {
	c, product, _, party := recoveredFixture(t, "SS-SHAPE")
	supplier := party["supplier"].(map[string]any)
	const zero = "00000000-0000-0000-0000-000000000000"
	cases := []struct {
		name   string
		extra  map[string]any
		status int
		code   float64
		msg    string
	}{
		{"material_lines 字符串", map[string]any{"material_lines": "abc"}, 400, 400, "系统内部错误，请稍后重试或联系管理员"},
		{"material_lines 数字", map[string]any{"material_lines": 123}, 400, 400, "系统内部错误，请稍后重试或联系管理员"},
		{"数组内非对象", map[string]any{"material_lines": []any{"x"}}, 400, 400, "系统内部错误，请稍后重试或联系管理员"},
		{"product_id 空串", map[string]any{"material_lines": []any{map[string]any{"product_id": "", "qty": 1}}}, 400, 400, "参数错误: invalid UUID length: 0"},
		{"product_id 不存在", map[string]any{"material_lines": []any{map[string]any{"product_id": zero, "qty": 1}}}, 500, 500, "系统内部错误，请稍后重试或联系管理员"},
	}
	for _, tc := range cases {
		body := map[string]any{"supplier_id": supplier["id"], "qty": 2, "mode": "with_material"}
		for k, v := range tc.extra {
			body[k] = v
		}
		status, resp := c.request("POST", "/api/v1/subcontract-orders", body)
		if status != tc.status || resp["code"] != tc.code || fmtMessage(resp) != tc.msg {
			t.Fatalf("%s: want %d/%v/%q, got %d/%v/%q", tc.name,
				tc.status, tc.code, tc.msg, status, resp["code"], fmtMessage(resp))
		}
	}
	// 合法输入必须成功
	order := c.ok("POST", "/api/v1/subcontract-orders", map[string]any{
		"supplier_id": supplier["id"], "qty": 2, "mode": "with_material",
		"material_lines": []any{map[string]any{"product_id": product["id"], "qty": 1}},
	}).(map[string]any)
	if order["id"] == "" {
		t.Fatal("valid subcontract with materials rejected")
	}
}

// SS2：带料外协不传材料 / 传空数组走业务文案（原版同样先撞数量校验后的空材料校验）。
func TestRecoveredSubcontractRequiresMaterials(t *testing.T) {
	c, _, _, party := recoveredFixture(t, "SS-NOMAT")
	supplier := party["supplier"].(map[string]any)
	for _, extra := range []map[string]any{
		{},
		{"material_lines": []any{}},
	} {
		body := map[string]any{"supplier_id": supplier["id"], "qty": 2, "mode": "with_material"}
		for k, v := range extra {
			body[k] = v
		}
		_, resp := c.request("POST", "/api/v1/subcontract-orders", body)
		if resp["code"] == float64(0) {
			t.Fatalf("with-material subcontract without materials accepted: %#v", resp)
		}
		// 原版对「不传 / 空数组」走**业务文案**（10000），不是 400。
		// 「类型错」才走 400 —— 两者必须区分，见 SS1。
		if resp["code"] != float64(10000) || fmtMessage(resp) != "带料外协必须至少指定一种发料材料" {
			t.Fatalf("missing/empty materials must use the original business message, got %#v", resp)
		}
	}
}
