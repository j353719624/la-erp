package api

import "testing"

func TestApprovalRecordLifecycle(t *testing.T) {
	c, _ := setup(t)
	bizType := "expense_claim"
	flow := c.ok("POST", "/api/v1/approval-flows", map[string]any{"code": "FLOW-RECOVER-02", "name": "记录验证审批", "biz_type": bizType}).(map[string]any)
	c.ok("POST", "/api/v1/approval-flows/"+flow["id"].(string)+"/activate", nil)
	input := map[string]any{"biz_type": bizType, "biz_id": "approval-test-id", "biz_no": "APP-TEST"}
	c.ok("POST", "/api/v1/approval-records/submit", input)
	c.ok("POST", "/api/v1/approval-records/approve", map[string]any{"biz_type": bizType, "biz_id": "approval-test-id"})
	if _, body := c.request("POST", "/api/v1/approval-records/reject", map[string]any{"biz_type": bizType, "biz_id": "approval-test-id"}); body["code"] == float64(0) {
		t.Fatal("approved record accepted rejection")
	}
}

func TestApprovalFlowCreateAndToggle(t *testing.T) {
	c, s := setup(t)
	flow := c.ok("POST", "/api/v1/approval-flows", map[string]any{"code": "FLOW-RECOVER-01", "name": "恢复验证审批", "biz_type": "expense_claim", "steps": []any{map[string]any{"name": "主管审批", "approver_type": "user", "approver_name": "管理员"}}}).(map[string]any)
	id := flow["id"].(string)
	if edges, ok := flow["edges"].(map[string]any); !ok || len(edges["steps"].([]any)) != 1 {
		t.Fatalf("steps not persisted: %#v", flow)
	}
	c.ok("POST", "/api/v1/approval-flows/"+id+"/deactivate", nil)
	var activeFlag bool
	if err := s.Store.DB.QueryRow("SELECT is_active FROM approval_flows WHERE id=?", id).Scan(&activeFlag); err != nil || activeFlag {
		t.Fatalf("deactivation failed: %v %v", err, activeFlag)
	}
	active := c.ok("POST", "/api/v1/approval-flows/"+id+"/activate", nil).(map[string]any)
	if active["is_active"] != true {
		t.Fatalf("activation failed: %#v", active)
	}
	updated := c.ok("PUT", "/api/v1/approval-flows/"+id, map[string]any{"name": "更新审批", "steps": []any{map[string]any{"name": "财务审批", "approver_type": "role"}, map[string]any{"name": "总经理审批", "approver_type": "user"}}}).(map[string]any)
	if len(updated["edges"].(map[string]any)["steps"].([]any)) != 2 {
		t.Fatalf("step replacement failed: %#v", updated)
	}
	c.ok("DELETE", "/api/v1/approval-flows/"+id, nil)
	var steps int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM approval_steps WHERE approval_flow_steps=?", id).Scan(&steps); err != nil || steps != 0 {
		t.Fatalf("orphan approval steps: %v %d", err, steps)
	}
}
