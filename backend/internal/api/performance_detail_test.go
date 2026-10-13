package api

import "testing"

func TestPerformanceAssessmentDetailIncludesItems(t *testing.T) {
	c, _ := setup(t)
	assessment := c.ok("POST", "/api/v1/perf-assessments", map[string]any{
		"employee_name": "绩效员工", "period": "2099-05", "items": []any{map[string]any{"indicator": "及时性", "weight": "100", "score": "80"}},
	}).(map[string]any)
	detail := c.ok("GET", "/api/v1/perf-assessments/"+assessment["id"].(string), nil).(map[string]any)
	if rows, ok := detail["edges"].(map[string]any)["items"].([]any); !ok || len(rows) != 1 {
		t.Fatalf("performance items edge missing: %#v", detail)
	}
}
