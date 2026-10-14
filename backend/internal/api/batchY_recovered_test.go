package api

import (
	"testing"
)

// 本文件固化批次 Y 取证（2026-10-14）的结论。
// 证据见 evidence/backend-runtime/audit-batch-y-20261014.json。
//
// ⚠ 本批次最关键的发现：**原版只处理 `steps` 键，传 `lines` 会被完全忽略**
// （返回 code:0 但明细不落库）。批次 Y 首次取证误用 `lines`，得出了
// 「原版不校验 sequence」的**相反结论**，靠变量隔离才纠正过来。
//
// 原版对 `steps` 内容的真实约束（其余字段全部合法时）：
//   process_code / process_name 缺失 → 500「系统内部错误，请稍后重试或联系管理员」
//   sequence 字符串 / 小数           → 400 同上
//   sequence 整数 / 负数 / 不传       → code:0（不传时落库 0）
//   work_center_id 不存在            → code:0（不校验引用完整性）

// YY1：`steps` 的必填字段缺失按原版返回 500 + 原文案。
func TestRecoveredRoutingStepRequiredFieldsMatchOriginal(t *testing.T) {
	c, product, _, _ := recoveredFixture(t, "YY-REQ")
	for _, tc := range []struct {
		name string
		line map[string]any
	}{
		{"缺 process_name", map[string]any{"sequence": 2, "process_code": "P1"}},
		{"缺 process_code", map[string]any{"sequence": 2, "process_name": "工序1"}},
	} {
		body := map[string]any{
			"name": "YY-REQ-" + tc.name, "product_id": product["id"],
			"steps": []any{tc.line},
		}
		status, resp := c.request("POST", "/api/v1/routings", body)
		if status != 500 || resp["code"] != float64(500) {
			t.Fatalf("%s: want 500, got %d/%v", tc.name, status, resp["code"])
		}
		if fmtMessage(resp) != "系统内部错误，请稍后重试或联系管理员" {
			t.Fatalf("%s: message %#v", tc.name, resp["message"])
		}
	}
}

// YY2：sequence 的类型约束 —— 字符串/小数 400，整数/负数/不传放行。
func TestRecoveredRoutingSequenceTypeMatchesOriginal(t *testing.T) {
	c, product, _, _ := recoveredFixture(t, "YY-SEQ")
	for _, tc := range []struct {
		name   string
		seq    any
		status int
	}{
		{"字符串", "2", 400},
		{"小数", 1.5, 400},
		{"整数", 2, 200},
		{"负整数", -1, 200},
		{"不传", nil, 200},
	} {
		line := map[string]any{"process_code": "P1", "process_name": "工序1"}
		if tc.seq != nil {
			line["sequence"] = tc.seq
		}
		status, resp := c.request("POST", "/api/v1/routings", map[string]any{
			"name": "YY-SEQ-" + tc.name, "product_id": product["id"],
			"steps": []any{line},
		})
		if status != tc.status {
			t.Fatalf("sequence %s: want %d, got %d (%v)", tc.name, tc.status, status, resp)
		}
		if tc.status == 400 && fmtMessage(resp) != "系统内部错误，请稍后重试或联系管理员" {
			t.Fatalf("sequence %s message: %#v", tc.name, resp["message"])
		}
	}
}

// YY3：`lines` 键被原版**完全忽略** —— 返回成功但明细不落库。
// 这条测试是本批次教训的固化：若将来有人把 `lines` 当成有效明细键来推断行为会错。
func TestRecoveredRoutingIgnoresLinesKey(t *testing.T) {
	c, product, _, _ := recoveredFixture(t, "YY-LINES")
	routing := c.ok("POST", "/api/v1/routings", map[string]any{
		"name": "YY-LINES", "product_id": product["id"],
		"lines": []any{map[string]any{"sequence": 2, "process_code": "L1", "process_name": "线"}},
	}).(map[string]any)
	detail := c.ok("GET", "/api/v1/routings/"+routing["id"].(string), nil).(map[string]any)
	edges, _ := detail["edges"].(map[string]any)
	steps, _ := edges["steps"].([]any)
	if len(steps) != 0 {
		t.Fatalf("the original ignores the `lines` key — no steps should be persisted, got %d", len(steps))
	}

	// 对照：同样的内容用 `steps` 键则正常落库
	withSteps := c.ok("POST", "/api/v1/routings", map[string]any{
		"name": "YY-STEPS", "product_id": product["id"],
		"steps": []any{map[string]any{"sequence": 2, "process_code": "S1", "process_name": "步"}},
	}).(map[string]any)
	detail2 := c.ok("GET", "/api/v1/routings/"+withSteps["id"].(string), nil).(map[string]any)
	edges2, _ := detail2["edges"].(map[string]any)
	steps2, _ := edges2["steps"].([]any)
	if len(steps2) != 1 {
		t.Fatalf("the `steps` key must be persisted, got %d rows", len(steps2))
	}
}

// YY4：work_center_id 不存在时原版放行（不校验引用完整性）。
func TestRecoveredRoutingWorkCenterReferenceIsNotValidated(t *testing.T) {
	c, product, _, _ := recoveredFixture(t, "YY-ISOLATE")
	const zero = "00000000-0000-0000-0000-000000000000"
	body := map[string]any{
		"name": "YY-ISOLATE", "product_id": product["id"], "work_center_id": zero,
		"steps": []any{map[string]any{"process_code": "P1", "process_name": "工序1", "sequence": 1}},
	}
	if _, resp := c.request("POST", "/api/v1/routings", body); resp["code"] != float64(0) {
		t.Fatalf("a non-existent work_center_id must be accepted: %#v", resp)
	}
}
