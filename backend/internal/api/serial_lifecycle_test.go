package api

import "testing"

func TestSerialNumberLifecycleGuards(t *testing.T) {
	c, _ := setup(t)
	data := c.ok("POST", "/api/v1/serial-numbers", map[string]any{"serial_nos": []any{"SN-2099-01"}, "product_name": "序列产品"}).(map[string]any)
	if data["registered"] != float64(1) {
		t.Fatalf("unexpected registration: %#v", data)
	}
	status, response := c.request("POST", "/api/v1/serial-numbers", map[string]any{"serial_nos": []any{"SN-2099-01"}})
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("duplicate registration response=%d %#v", status, response)
	}
	row := c.ok("GET", "/api/v1/serial-numbers?page_size=10", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	id := row["id"].(string)
	out := c.ok("POST", "/api/v1/serial-numbers/"+id+"/out", map[string]any{}).(map[string]any)
	if out["status"] != "out" {
		t.Fatalf("unexpected out status: %#v", out)
	}
	status, response = c.request("POST", "/api/v1/serial-numbers/"+id+"/out", map[string]any{})
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("duplicate out response=%d %#v", status, response)
	}
}
