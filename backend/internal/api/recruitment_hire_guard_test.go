package api

import "testing"

func TestRecruitmentHireRejectsDuplicateHire(t *testing.T) {
	c, _ := setup(t)
	candidate := c.ok("POST", "/api/v1/recruitment-candidates", map[string]any{"code": "CAN-2099-02", "name": "重复录用"}).(map[string]any)
	id := candidate["id"].(string)
	c.ok("POST", "/api/v1/recruitment-candidates/"+id+"/hire", map[string]any{})
	status, response := c.request("POST", "/api/v1/recruitment-candidates/"+id+"/hire", map[string]any{})
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("duplicate hire response=%d %#v", status, response)
	}
}
