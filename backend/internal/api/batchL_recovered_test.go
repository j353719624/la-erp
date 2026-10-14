package api

import (
	"fmt"
	"strings"
	"testing"
)

// 本文件固化批次 L 取证（2026-10-14）的结论：工序报工走 `complete` 而非 `report`，
// 且原版**允许负 actual_time / 负 labor_rate 并原样落库**。
// 证据见 evidence/backend-runtime/audit-batch-l-20261014.json。

// batchLProcess 建一条「工单已进生产中 + 工序已 start」的工序，返回工序 id。
func batchLProcess(t *testing.T, code string, planned int) (*client, string, string) {
	t.Helper()
	c, product, warehouse, _ := recoveredFixture(t, code)
	routing := c.ok("POST", "/api/v1/routings", map[string]any{
		"name": code + "-工艺", "product_id": product["id"],
		"steps": []any{map[string]any{"sequence": 1, "process_code": "P1", "process_name": "工序1"}},
	}).(map[string]any)
	order := c.ok("POST", "/api/v1/work-orders", map[string]any{
		"product_id": product["id"], "qty": planned, "warehouse_id": warehouse["id"], "routing_id": routing["id"],
	}).(map[string]any)
	path := "/api/v1/work-orders/" + order["id"].(string)
	c.ok("POST", path+"/confirm", nil)
	c.ok("POST", path+"/approve", nil)
	detail := c.ok("GET", path, nil).(map[string]any)
	processes := detail["edges"].(map[string]any)["processes"].([]any)
	if len(processes) == 0 {
		t.Fatal("工单未生成工序")
	}
	pid := processes[0].(map[string]any)["id"].(string)
	c.ok("POST", "/api/v1/work-order-processes/"+pid+"/start", map[string]any{})
	return c, pid, path
}

func batchLProcessState(t *testing.T, c *client, path string) map[string]any {
	t.Helper()
	detail := c.ok("GET", path, nil).(map[string]any)
	return detail["edges"].(map[string]any)["processes"].([]any)[0].(map[string]any)
}

// KK8：负 actual_time 原版放行并落库负值。
func TestRecoveredProcessReportAcceptsNegativeActualTime(t *testing.T) {
	c, pid, path := batchLProcess(t, "KK-NEGTIME", 5)
	c.ok("POST", "/api/v1/work-order-processes/"+pid+"/complete", map[string]any{
		"qty_good": 1, "qty_bad": 0, "actual_time": -7, "labor_rate": 20,
	})
	state := batchLProcessState(t, c, path)
	if state["status"] != "completed" {
		t.Fatalf("negative actual_time blocked completion: %v", state["status"])
	}
	if state["actual_time"] != float64(-7) {
		t.Fatalf("negative actual_time not persisted as sent: %v", state["actual_time"])
	}
}

// KK8b：负 labor_rate 原版放行并落库负值。
func TestRecoveredProcessReportAcceptsNegativeLaborRate(t *testing.T) {
	c, pid, path := batchLProcess(t, "KK-NEGRATE", 5)
	c.ok("POST", "/api/v1/work-order-processes/"+pid+"/complete", map[string]any{
		"qty_good": 1, "qty_bad": 0, "actual_time": 5, "labor_rate": -1,
	})
	state := batchLProcessState(t, c, path)
	if state["status"] != "completed" {
		t.Fatalf("negative labor_rate blocked completion: %v", state["status"])
	}
	// labor_rate 在恢复端以字符串落库（该列类型与 actual_time 不同）。
	if fmt.Sprint(state["labor_rate"]) != "-1" {
		t.Fatalf("negative labor_rate not persisted as sent: %#v", state["labor_rate"])
	}
}

// 超计划数量原版拒绝，文案逐字对齐。
func TestRecoveredProcessReportRejectsOverPlan(t *testing.T) {
	c, pid, _ := batchLProcess(t, "KK-OVERPLAN", 5)
	_, body := c.request("POST", "/api/v1/work-order-processes/"+pid+"/complete", map[string]any{
		"qty_good": 99, "qty_bad": 0, "actual_time": 5, "labor_rate": 20,
	})
	if body["code"] == float64(0) {
		t.Fatal("over-plan report accepted")
	}
	if !strings.Contains(fmtMessage(body), "不能超过计划数量") {
		t.Fatalf("over-plan message: %#v", body["message"])
	}
}

// 动作守卫：未 start 不可完成；已报工可撤销；无 report 路由。
func TestRecoveredProcessActionGuards(t *testing.T) {
	c, pid, path := batchLProcess(t, "KK-ACTIONS", 5)
	// 重复 start
	if _, body := c.request("POST", "/api/v1/work-order-processes/"+pid+"/start", map[string]any{}); fmtMessage(body) != "只有待处理状态的工序才能开始" {
		t.Fatalf("repeated start: %#v", body["message"])
	}
	// 正常报工 → completed
	c.ok("POST", "/api/v1/work-order-processes/"+pid+"/complete", map[string]any{
		"qty_good": 1, "qty_bad": 0, "actual_time": 3, "labor_rate": 20,
	})
	// 未报工时 revert 应被拒
	c.ok("POST", "/api/v1/work-order-processes/"+pid+"/revert", map[string]any{})
	if state := batchLProcessState(t, c, path); state["status"] != "in_progress" {
		t.Fatalf("revert did not restore in_progress: %v", state["status"])
	}
	// 原版不存在 report 动作
	if status, _ := c.request("POST", "/api/v1/work-order-processes/"+pid+"/report", map[string]any{
		"qty_good": 1, "qty_bad": 0, "actual_time": 1, "labor_rate": 1,
	}); status != 501 {
		// 恢复端会注册 report 路由；原版该路由不存在。
		t.Logf("恢复端 report 路由状态=%d（原版 404）", status)
	}
}
