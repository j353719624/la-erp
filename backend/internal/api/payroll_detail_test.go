package api

import "testing"

func TestPayrollBatchDetailIncludesItems(t *testing.T) {
	c, _ := setup(t)
	batch := c.ok("POST", "/api/v1/payrolls", map[string]any{
		"batch_no": "PAY-2099-03",
		"period":   "2099-03",
		"items":    []any{map[string]any{"employee_name": "工资员工", "base_salary": "100", "bonus": "0", "allowance": "0", "deduction": "0"}},
	}).(map[string]any)
	detail := c.ok("GET", "/api/v1/payrolls/"+batch["id"].(string), nil).(map[string]any)
	if rows, ok := detail["edges"].(map[string]any)["items"].([]any); !ok || len(rows) != 1 {
		t.Fatalf("payroll items edge missing: %#v", detail)
	}
}
