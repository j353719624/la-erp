package api

import "testing"

func TestPerformanceFinalizeStateGuard(t *testing.T) {
	c, _ := setup(t)
	a := c.ok("POST", "/api/v1/perf-assessments", map[string]any{"employee_name": "定案员工", "period": "2099-06", "items": []any{map[string]any{"indicator": "质量", "weight": "100", "score": "90"}}}).(map[string]any)
	final := c.ok("POST", "/api/v1/perf-assessments/"+a["id"].(string)+"/finalize", nil).(map[string]any)
	if final["status"] != "finalized" {
		t.Fatalf("unexpected finalized state: %#v", final)
	}
	status, response := c.request("POST", "/api/v1/perf-assessments/"+a["id"].(string)+"/finalize", nil)
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("duplicate finalize response=%d %#v", status, response)
	}
}
