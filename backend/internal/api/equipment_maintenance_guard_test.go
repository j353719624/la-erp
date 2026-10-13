package api

import "testing"

func TestEquipmentMaintenanceDoneRejectsRepeat(t *testing.T) {
	c, _ := setup(t)
	equipment := c.ok("POST", "/api/v1/production-equipments", map[string]any{"equipment_no": "EQ-2099-03", "name": "重复维护设备"}).(map[string]any)
	maintenance := c.ok("POST", "/api/v1/equipment-maintenances", map[string]any{"equipment_id": equipment["id"], "record_type": "maintain", "cost": "5"}).(map[string]any)
	id := maintenance["id"].(string)
	c.ok("POST", "/api/v1/equipment-maintenances/"+id+"/done", map[string]any{})
	status, response := c.request("POST", "/api/v1/equipment-maintenances/"+id+"/done", map[string]any{})
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("repeat done response=%d %#v", status, response)
	}
}
