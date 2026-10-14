package api

import (
	"io"
	"net/http"
	"testing"
)

func TestCustomReportRunSQLReadOnlyContract(t *testing.T) {
	c, _ := setup(t)
	data := c.ok("POST", "/api/v1/custom-reports/run-sql", map[string]any{
		"query_sql": "SELECT 7 AS probe_value, 'ok' AS probe_status",
		"columns": []map[string]any{{"key": "probe_value", "label": "Probe Value"}},
	}).(map[string]any)
	rows := data["rows"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["probe_value"] != float64(7) { t.Fatalf("rows=%#v", rows) }
	// 原版回放 DD（2026-10-14，evidence/backend-runtime/audit-batch-d-20261014.json）：
	// 只读边界与恢复端一致，但原版返回业务错误文案而非 501——
	// 非 SELECT/WITH → 「仅支持 SELECT 查询语句」；含分号 → 「不支持多条语句」。
	// 本测试原先断言 501，已按取证结论改为比对原文案。
	status, body := c.request("POST", "/api/v1/custom-reports/run-sql", map[string]any{"query_sql": "UPDATE products SET name='bad'"})
	if status != 200 || body["code"] == float64(0) || body["message"] != "仅支持 SELECT 查询语句" {
		t.Fatalf("unsafe query: %d %#v", status, body)
	}
	status, body = c.request("POST", "/api/v1/custom-reports/run-sql", map[string]any{"query_sql": "SELECT 1; DELETE FROM products"})
	if status != 200 || body["code"] == float64(0) || body["message"] != "不支持多条语句" {
		t.Fatalf("multi-statement query: %d %#v", status, body)
	}
	// WITH 与小写 select 原版放行。
	probes := c.ok("POST", "/api/v1/custom-reports/run-sql", map[string]any{
		"query_sql": "with probe as (select 5 as v) select v from probe",
	}).(map[string]any)
	if rows := probes["rows"].([]any); len(rows) != 1 || rows[0].(map[string]any)["v"] != float64(5) {
		t.Fatalf("with clause rejected: %#v", probes)
	}
}

func TestCustomReportDefinitionAndCSVExport(t *testing.T) {
	c, _ := setup(t)
	created := c.ok("POST", "/api/v1/custom-reports", map[string]any{
		"report_code": "product_list_test", "report_name": "商品清单",
		"category": "custom", "query_sql": "SELECT code AS 商品编码, name AS 商品名称, status AS 状态 FROM products ORDER BY code",
		"status": "active",
	}).(map[string]any)
	id := created["id"].(string)
	c.ok("POST", "/api/v1/custom-reports/"+id+"/run", nil)
	req, err := http.NewRequest("GET", c.server.URL+"/api/v1/custom-reports/"+id+"/export", nil)
	if err != nil { t.Fatal(err) }
	req.Header.Set("Authorization", "Bearer "+c.token)
	res, err := http.DefaultClient.Do(req)
	if err != nil { t.Fatal(err) }
	defer res.Body.Close()
	if res.StatusCode != 200 { t.Fatalf("export status=%d", res.StatusCode) }
	if got := res.Header.Get("Content-Disposition"); got != `attachment; filename="product_list_test.csv"` { t.Fatalf("filename=%q", got) }
	raw, err := io.ReadAll(res.Body)
	if err != nil { t.Fatal(err) }
	if string(raw) == "" || string(raw[:len("商品编码,商品名称,状态")]) != "商品编码,商品名称,状态" {
		t.Fatalf("unexpected csv=%q", string(raw))
	}
}
