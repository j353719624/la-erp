package api

import "testing"

func TestPerformanceTemplateDetailIncludesItems(t *testing.T) {
	c, _ := setup(t)
	template := c.ok("POST", "/api/v1/perf-templates", map[string]any{"name": "模板测试", "items": []any{map[string]any{"indicator": "质量", "weight": "100", "description": "质量指标"}}}).(map[string]any)
	detail := c.ok("GET", "/api/v1/perf-templates/"+template["id"].(string), nil).(map[string]any)
	if rows, ok := detail["edges"].(map[string]any)["items"].([]any); !ok || len(rows) != 1 {
		t.Fatalf("template items edge missing: %#v", detail)
	}
}
