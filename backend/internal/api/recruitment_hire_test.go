package api

import (
	"context"
	"testing"
)

func TestRecruitmentHireCreatesEmployeeAndLinksCandidate(t *testing.T) {
	c, s := setup(t)
	candidate := c.ok("POST", "/api/v1/recruitment-candidates", map[string]any{"code": "CAN-2099-01", "name": "候选员工"}).(map[string]any)
	employee := c.ok("POST", "/api/v1/recruitment-candidates/"+candidate["id"].(string)+"/hire", map[string]any{"position": "工程师", "base_salary": "8000"}).(map[string]any)
	if employee["name"] != "候选员工" || employee["status"] != "active" {
		t.Fatalf("unexpected employee: %#v", employee)
	}
	rows, err := s.Store.Rows(context.Background(), "SELECT status,employee_id FROM recruitment_candidates WHERE id=?", candidate["id"])
	if err != nil || len(rows) != 1 || rows[0]["status"] != "hired" || rows[0]["employee_id"] != employee["id"] {
		t.Fatalf("candidate link missing: %#v %v", rows, err)
	}
}
