package api

import "testing"

func TestReworkOrderLifecycleGuards(t *testing.T) {
	c, _ := setup(t)
	row := c.ok("POST", "/api/v1/rework-orders", map[string]any{"qty_rework": "3", "qty_good": "2", "qty_bad": "1", "reason": "返工测试"}).(map[string]any)
	id := row["id"].(string)
	c.ok("POST", "/api/v1/rework-orders/"+id+"/confirm", map[string]any{})
	completed := c.ok("POST", "/api/v1/rework-orders/"+id+"/complete", map[string]any{}).(map[string]any)
	if completed["status"] != "completed" {
		t.Fatalf("unexpected rework state: %#v", completed)
	}
	status, response := c.request("POST", "/api/v1/rework-orders/"+id+"/cancel", map[string]any{})
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("completed cancel response=%d %#v", status, response)
	}
}
