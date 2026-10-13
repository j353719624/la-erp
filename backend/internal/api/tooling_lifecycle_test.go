package api

import "testing"

func TestToolingLifecycleGuards(t *testing.T) {
	c, _ := setup(t)
	tool := c.ok("POST", "/api/v1/toolings", map[string]any{"tooling_no": "TL-2099-01", "name": "测试工装", "life_times": "3", "used_times": "0"}).(map[string]any)
	id := tool["id"].(string)
	used := c.ok("POST", "/api/v1/toolings/"+id+"/use", map[string]any{"times": 2}).(map[string]any)
	if used["status"] != "in_use" {
		t.Fatalf("unexpected use state: %#v", used)
	}
	status, response := c.request("POST", "/api/v1/toolings/"+id+"/use", map[string]any{"times": 2})
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("life guard response=%d %#v", status, response)
	}
	maintained := c.ok("POST", "/api/v1/toolings/"+id+"/maintain", map[string]any{"remark": "保养完成"}).(map[string]any)
	if maintained["status"] != "idle" {
		t.Fatalf("unexpected maintain state: %#v", maintained)
	}
	scrapped := c.ok("POST", "/api/v1/toolings/"+id+"/scrap", map[string]any{"reason": "寿命到期"}).(map[string]any)
	if scrapped["status"] != "scrapped" {
		t.Fatalf("unexpected scrap state: %#v", scrapped)
	}
}
