package api

import "testing"

func TestAttendanceRequestLifecycleAndSummary(t *testing.T) {
	c, _ := setup(t)
	data := c.ok("POST", "/api/v1/attendance-requests", map[string]any{
		"code":          "ATT-20990310",
		"employee_name": "考勤员工",
		"request_type":  "leave",
		"start_date":    "2099-03-10T00:00:00Z",
		"days":          "2",
	}).(map[string]any)
	id := data["id"].(string)
	c.ok("POST", "/api/v1/attendance-requests/"+id+"/submit", nil)
	c.ok("POST", "/api/v1/attendance-requests/"+id+"/approve", nil)
	summary := c.ok("GET", "/api/v1/attendance-requests/summary?period=2099-03", nil).([]any)
	if len(summary) != 1 {
		t.Fatalf("summary rows=%d, want 1: %#v", len(summary), summary)
	}
	row := summary[0].(map[string]any)
	if row["employee_name"] != "考勤员工" || row["leave_count"] != float64(1) {
		t.Fatalf("unexpected attendance summary: %#v", row)
	}
}
