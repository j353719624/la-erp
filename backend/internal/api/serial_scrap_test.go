package api

import "testing"

func TestSerialNumberScrapStateGuard(t *testing.T) {
	c, _ := setup(t)
	c.ok("POST", "/api/v1/serial-numbers", map[string]any{"serial_nos": []any{"SN-2099-02"}})
	list := c.ok("GET", "/api/v1/serial-numbers?page_size=10", nil).(map[string]any)["list"].([]any)
	id := list[0].(map[string]any)["id"].(string)
	row := c.ok("POST", "/api/v1/serial-numbers/"+id+"/scrap", map[string]any{}).(map[string]any)
	if row["status"] != "scrapped" {
		t.Fatalf("unexpected scrap status: %#v", row)
	}
	status, response := c.request("POST", "/api/v1/serial-numbers/"+id+"/scrap", map[string]any{})
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("duplicate scrap response=%d %#v", status, response)
	}
}
