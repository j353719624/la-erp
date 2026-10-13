package api

import (
	"context"
	"testing"
)

func TestEquipmentMaintenanceDoneResetsEquipmentStatus(t *testing.T) {
	c, s := setup(t)
	equipment := c.ok("POST", "/api/v1/production-equipments", map[string]any{"equipment_no": "EQ-2099-02", "name": "待维护设备", "status": "maintenance"}).(map[string]any)
	maintenance := c.ok("POST", "/api/v1/equipment-maintenances", map[string]any{"equipment_id": equipment["id"], "record_type": "maintain", "cost": "20"}).(map[string]any)
	done := c.ok("POST", "/api/v1/equipment-maintenances/"+maintenance["id"].(string)+"/done", map[string]any{"result": "已完成"}).(map[string]any)
	if done["status"] != "done" || done["result"] != "已完成" {
		t.Fatalf("unexpected maintenance result: %#v", done)
	}
	rows, err := s.Store.Rows(context.Background(), "SELECT status FROM production_equipments WHERE id=?", equipment["id"])
	if err != nil || len(rows) != 1 || rows[0]["status"] != "idle" {
		t.Fatalf("equipment status not reset: %#v %v", rows, err)
	}
}
