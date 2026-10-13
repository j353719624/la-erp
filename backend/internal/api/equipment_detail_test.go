package api

import "testing"

func TestProductionEquipmentDetailIncludesMaintenances(t *testing.T) {
	c, _ := setup(t)
	equipment := c.ok("POST", "/api/v1/production-equipments", map[string]any{
		"equipment_no": "EQ-2099-01",
		"name":         "测试设备",
	}).(map[string]any)
	c.ok("POST", "/api/v1/equipment-maintenances", map[string]any{
		"equipment_id": equipment["id"],
		"record_type":  "maintain",
		"cost":         "10",
	})
	detail := c.ok("GET", "/api/v1/production-equipments/"+equipment["id"].(string), nil).(map[string]any)
	edges := detail["edges"].(map[string]any)
	if rows, ok := edges["maintenances"].([]any); !ok || len(rows) != 1 {
		t.Fatalf("maintenance edge missing: %#v", detail)
	}
}
