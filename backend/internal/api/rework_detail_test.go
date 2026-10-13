package api

import (
	"context"
	"testing"
)

func TestReworkDetailIncludesWorkOrder(t *testing.T) {
	c, s := setup(t)
	rows, err := s.Store.Rows(context.Background(), "SELECT id FROM work_orders WHERE deleted_at IS NULL AND status IN ('draft','confirmed','in_progress') LIMIT 1")
	if err != nil || len(rows) == 0 {
		t.Skip("no eligible work order")
	}
	rework := c.ok("POST", "/api/v1/rework-orders", map[string]any{"qty_rework": "1", "work_order_id": rows[0]["id"]}).(map[string]any)
	detail := c.ok("GET", "/api/v1/rework-orders/"+rework["id"].(string), nil).(map[string]any)
	if _, ok := detail["edges"].(map[string]any)["work_order"]; !ok {
		t.Fatalf("work order edge missing: %#v", detail)
	}
}
