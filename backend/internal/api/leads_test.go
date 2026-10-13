package api

import (
	"fmt"
	"testing"
)

func TestLeadConversionCreatesCustomerAndOpportunity(t *testing.T) {
	c, _ := setup(t)
	status, body := c.request("POST", "/api/v1/leads", map[string]any{"lead_no": "L-REGRESSION-001", "name": "张三", "company": "测试公司", "phone": "13800000000"})
	if status != 200 {
		t.Fatalf("create lead: %d %#v", status, body)
	}
	id, ok := body["data"].(map[string]any)["id"].(string)
	if !ok {
		t.Fatalf("missing lead id: %#v", body)
	}
	status, body = c.request("POST", "/api/v1/leads/"+id+"/convert", map[string]any{"create_opportunity": true, "amount": "100"})
	if status != 200 {
		t.Fatalf("convert lead: %d %#v", status, body)
	}
	data := body["data"].(map[string]any)
	if data["customer"] == nil || data["opportunity"] == nil {
		t.Fatalf("incomplete conversion: %#v", body)
	}
	opportunity := data["opportunity"].(map[string]any)
	detail := c.ok("GET", "/api/v1/crm-opportunities/"+opportunity["id"].(string), nil).(map[string]any)
	edges, ok := detail["edges"].(map[string]any)
	if !ok || edges["customer"] == nil || edges["activities"] == nil {
		t.Fatalf("opportunity edges missing: %#v", detail)
	}
	c.ok("POST", "/api/v1/crm-activities", map[string]any{"target_type": "opportunity", "target_id": opportunity["id"], "type": "call", "content": "商机跟进", "activity_at": "2099-01-01T00:00:00Z"})
	detail = c.ok("GET", "/api/v1/crm-opportunities/"+opportunity["id"].(string), nil).(map[string]any)
	edges = detail["edges"].(map[string]any)
	if len(edges["activities"].([]any)) != 1 {
		t.Fatalf("opportunity activity edge missing: %#v", detail)
	}
	c.ok("POST", "/api/v1/crm-activities", map[string]any{"target_type": "opportunity", "target_id": opportunity["id"], "type": "call", "content": "逾期跟进", "activity_at": "2099-01-01T00:00:00Z", "next_follow_at": "2020-01-01T00:00:00Z"})
	pending := c.ok("GET", "/api/v1/crm-activities/pending", nil).([]any)
	if len(pending) == 0 {
		t.Fatal("pending follow-up missing")
	}
	pm := pending[0].(map[string]any)
	if pm["target_name"] == nil || pm["overdue_days"] == nil {
		t.Fatalf("pending fields missing: %#v", pm)
	}
	funnel := c.ok("GET", "/api/v1/crm-opportunities/funnel", nil).(map[string]any)
	for _, key := range []string{"active_amount", "won_count", "won_amount", "period_won_count", "period_won_amount", "lost_count", "conversion_rate"} {
		if _, ok := funnel[key]; !ok {
			t.Fatalf("funnel metric missing %s: %#v", key, funnel)
		}
	}
	status, body = c.request("POST", "/api/v1/leads/"+id+"/convert", map[string]any{})
	if status != 200 || body["code"] == nil || fmt.Sprint(body["code"]) == "0" {
		t.Fatalf("duplicate conversion response: %d %#v", status, body)
	}
}
