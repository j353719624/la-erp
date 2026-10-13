package api

import "testing"

func TestRecruitmentCandidateDetailIncludesEmployee(t *testing.T) {
	c, _ := setup(t)
	candidate := c.ok("POST", "/api/v1/recruitment-candidates", map[string]any{"code": "CAN-2099-03", "name": "关联员工"}).(map[string]any)
	id := candidate["id"].(string)
	c.ok("POST", "/api/v1/recruitment-candidates/"+id+"/hire", map[string]any{})
	detail := c.ok("GET", "/api/v1/recruitment-candidates/"+id, nil).(map[string]any)
	edges := detail["edges"].(map[string]any)
	if employee, ok := edges["employee"].(map[string]any); !ok || employee["name"] != "关联员工" {
		t.Fatalf("employee edge missing: %#v", detail)
	}
}
