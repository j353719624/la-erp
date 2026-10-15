package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"la-erp-recovered/backend/internal/database"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

type client struct {
	t      *testing.T
	server *httptest.Server
	token  string
}

func (c *client) request(method, route string, body any) (int, map[string]any) {
	c.t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, err := http.NewRequest(method, c.server.URL+route, bytes.NewReader(raw))
	if err != nil {
		c.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var result map[string]any
	if err = json.NewDecoder(res.Body).Decode(&result); err != nil {
		c.t.Fatal(err)
	}
	return res.StatusCode, result
}
func (c *client) ok(method, route string, body any) any {
	c.t.Helper()
	status, response := c.request(method, route, body)
	if status != 200 || response["code"] != float64(0) {
		c.t.Fatalf("%s %s: %d %v", method, route, status, response)
	}
	return response["data"]
}
func setup(t *testing.T) (*client, *Server) {
	t.Helper()
	store, err := database.Open(filepath.Join(t.TempDir(), "erp.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err = store.Seed(context.Background(), "admin123"); err != nil {
		t.Fatal(err)
	}
	s := New(store, "test-secret-long-enough-for-tests-only")
	httpServer := httptest.NewServer(s)
	t.Cleanup(httpServer.Close)
	c := &client{t: t, server: httpServer}
	login := c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "admin", "password": "admin123"}).(map[string]any)
	c.token = login["access_token"].(string)
	return c, s
}
func TestRecoveredSchemaAndDefaults(t *testing.T) {
	c, s := setup(t)
	var tables int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&tables); err != nil {
		t.Fatal(err)
	}
	// 163 = 162（原版新鲜安装快照）+ companies（批次 KK 恢复 console/companies 写路径时新增）
	if tables != 163 {
		t.Fatalf("tables=%d", tables)
	}
	data := c.ok("GET", "/api/v1/permissions?page_size=1000", nil).(map[string]any)
	if data["total"] != float64(334) {
		t.Fatalf("permissions=%v", data)
	}
	data = c.ok("GET", "/api/v1/units", nil).(map[string]any)
	if data["total"] != float64(16) {
		t.Fatalf("units=%v", data)
	}
	me := c.ok("GET", "/api/v1/auth/me", nil).(map[string]any)
	if !reflect.DeepEqual(me["permissions"], []any{"*"}) {
		t.Fatal(me)
	}
	if err := s.Store.Seed(context.Background(), "changed123"); err != nil {
		t.Fatal(err)
	}
	c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "admin", "password": "admin123"})
}
func TestSessionsPasswordAndRBAC(t *testing.T) {
	c, s := setup(t)
	if status, _ := c.request("POST", "/api/v1/auth/login", map[string]any{"username": "admin", "password": "wrong"}); status != 401 {
		t.Fatal(status)
	}
	login := c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "admin", "password": "admin123"}).(map[string]any)
	refresh := login["refresh_token"].(string)
	renewed := c.ok("POST", "/api/v1/auth/refresh", map[string]any{"refresh_token": refresh}).(map[string]any)
	if status, _ := c.request("POST", "/api/v1/auth/refresh", map[string]any{"refresh_token": refresh}); status != 401 {
		t.Fatalf("refresh reuse=%d", status)
	}
	c.token = renewed["access_token"].(string)
	c.ok("POST", "/api/v1/auth/logout", nil)
	if status, _ := c.request("GET", "/api/v1/users", nil); status != 401 {
		t.Fatalf("logout=%d", status)
	}
	login = c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "admin", "password": "admin123"}).(map[string]any)
	c.token = login["access_token"].(string)
	user := c.ok("POST", "/api/v1/users", map[string]any{"username": "ordinary", "password": "ordinary123", "name": "普通用户"}).(map[string]any)
	regularLogin := c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "ordinary", "password": "ordinary123"}).(map[string]any)
	regular := &client{t: t, server: c.server, token: regularLogin["access_token"].(string)}
	if status, _ := regular.request("GET", "/api/v1/users", nil); status != 403 {
		t.Fatalf("RBAC=%d", status)
	}
	reset := c.ok("POST", "/api/v1/users/"+user["id"].(string)+"/reset-password", map[string]any{}).(map[string]any)
	if status, _ := regular.request("GET", "/api/v1/auth/me", nil); status != 401 {
		t.Fatalf("reset invalidation=%d", status)
	}
	regular.ok("POST", "/api/v1/auth/login", map[string]any{"username": "ordinary", "password": reset["temp_password"]})
	c.ok("POST", "/api/v1/users/change-password", map[string]any{"old_password": "admin123", "new_password": "changed123"})
	if status, _ := c.request("GET", "/api/v1/auth/me", nil); status != 401 {
		t.Fatalf("password invalidation=%d", status)
	}
	c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "admin", "password": "changed123"})
	s.Auth.AccessTTL = -time.Second
	login = c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "admin", "password": "changed123"}).(map[string]any)
	c.token = login["access_token"].(string)
	if status, _ := c.request("GET", "/api/v1/auth/me", nil); status != 401 {
		t.Fatalf("expiration=%d", status)
	}
}
func TestBasicCRUDAndDepartmentCycles(t *testing.T) {
	c, _ := setup(t)
	for _, resource := range []string{"units", "warehouses", "categories", "departments", "users", "customers", "suppliers", "products"} {
		t.Run(resource, func(t *testing.T) {
			route := "/api/v1/" + resource
			if status, _ := c.request("POST", route, map[string]any{}); status != 400 {
				t.Fatalf("required fields=%d", status)
			}
			fields := map[string]any{"name": "恢复测试", "code": "TEST-" + resource}
			if resource == "users" {
				fields["username"] = "test_user"
				fields["password"] = "test123456"
			}
			if resource == "categories" {
				fields["entity_code"] = "product"
			}
			data := c.ok("POST", route, fields).(map[string]any)
			id := data["id"].(string)
			c.ok("GET", route+"/"+id, nil)
			c.ok("PUT", route+"/"+id, map[string]any{"name": "已修改"})
			c.ok("DELETE", route+"/"+id, nil)
			if status, _ := c.request("GET", route+"/"+id, nil); status != 404 {
				t.Fatalf("soft delete=%d", status)
			}
		})
	}
	parent := c.ok("POST", "/api/v1/departments", map[string]any{"code": "CYCLE-A", "name": "A"}).(map[string]any)
	child := c.ok("POST", "/api/v1/departments", map[string]any{"code": "CYCLE-B", "name": "B", "parent_id": parent["id"]}).(map[string]any)
	if status, _ := c.request("PUT", "/api/v1/departments/"+parent["id"].(string)+"/move", map[string]any{"parent_id": child["id"]}); status != 400 {
		t.Fatalf("cycle=%d", status)
	}
	c.ok("PUT", "/api/v1/departments/"+child["id"].(string)+"/move", map[string]any{"parent_id": nil})
	// 批次 PP（2026-10-15）：原版对一切未注册 /api/ 路径逐字返回
	// 404 +「路由不存在」（tools/replay-batch-oo-catchall.js，8 条对照 100%）。
	if status, body := c.request("POST", "/api/v1/work-orders/unknown/finish", map[string]any{}); status != 404 || body["message"] != "路由不存在" {
		t.Fatalf("unrecovered operation = %d %v, want 404 路由不存在", status, body)
	}
}
func fields(value map[string]any) []string {
	result := []string{}
	for key := range value {
		if key == "id" || strings.HasSuffix(key, "_at") {
			continue
		}
		result = append(result, key)
	}
	return result
}
func TestOriginalCreateResponseContracts(t *testing.T) {
	c, _ := setup(t)
	raw, err := readEvidenceSnapshot(t, "backend-runtime/api-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var contracts []struct {
		Method   string         `json:"method"`
		Endpoint string         `json:"endpoint"`
		Status   int            `json:"status"`
		Body     map[string]any `json:"body"`
	}
	if err = json.Unmarshal(raw, &contracts); err != nil {
		t.Fatal(err)
	}
	covered := 0
	for _, original := range contracts {
		if original.Method != "POST" || original.Status != 200 || !strings.HasPrefix(original.Endpoint, "/api/v1/") {
			continue
		}
		name := strings.TrimPrefix(original.Endpoint, "/api/v1/")
		if _, ok := Resources[name]; !ok {
			continue
		}
		expected, ok := original.Body["data"].(map[string]any)
		if !ok {
			continue
		}
		input := map[string]any{"name": "恢复测试", "code": fmt.Sprintf("CONTRACT-%s", name)}
		if name == "users" {
			input["username"] = "contract_user"
			input["password"] = "test123456"
		}
		if name == "products" {
			input["product_type"] = "finished"
			input["unit_id"] = nil
		}
		actual := c.ok("POST", original.Endpoint, input).(map[string]any)
		for _, key := range fields(expected) {
			if _, ok := actual[key]; !ok {
				t.Errorf("%s missing original response field %s", name, key)
			}
		}
		for _, key := range fields(actual) {
			if _, ok := expected[key]; !ok {
				t.Errorf("%s extra response field %s", name, key)
			}
		}
		for _, key := range []string{"tenant_id", "status", "product_type", "cost_method", "safety_stock", "min_order_qty", "payment_term", "portal_enabled"} {
			if expected[key] != nil && !reflect.DeepEqual(expected[key], actual[key]) {
				t.Errorf("%s %s: expected %v actual %v", name, key, expected[key], actual[key])
			}
		}
		covered++
	}
	if covered != 7 {
		t.Fatalf("original contracts checked=%d", covered)
	}
}

func normalizeContract(value any) any {
	switch data := value.(type) {
	case map[string]any:
		result := map[string]any{}
		for key, item := range data {
			if strings.HasSuffix(key, "_at") || key == "last_login_at" || key == "signature" || key == "token_version" {
				continue
			}
			result[key] = normalizeContract(item)
		}
		return result
	case []any:
		result := []any{}
		for _, item := range data {
			result = append(result, normalizeContract(item))
		}
		sort.Slice(result, func(i, j int) bool {
			a, _ := json.Marshal(result[i])
			b, _ := json.Marshal(result[j])
			return string(a) < string(b)
		})
		return result
	default:
		return value
	}
}
func TestOriginalCollectionContracts(t *testing.T) {
	c, _ := setup(t)
	raw, err := readEvidenceSnapshot(t, "backend-runtime/api-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var contracts []struct {
		Method   string         `json:"method"`
		Endpoint string         `json:"endpoint"`
		Status   int            `json:"status"`
		Body     map[string]any `json:"body"`
	}
	if err = json.Unmarshal(raw, &contracts); err != nil {
		t.Fatal(err)
	}
	// 批次 EE（2026-10-14）：/api/v1/combo-products 端点族已恢复，解除忽略。
	// 原版契约为空列表（total=0 / list=[]），恢复端同形态，纳入比对。
	ignored := map[string]bool{"/api/v1/portal/admin/orders": true, "/api/v1/portal/admin/customers": true, "/api/v1/work-order-processes/pending": true}
	checked := 0
	for _, original := range contracts {
		expected, ok := original.Body["data"].(map[string]any)
		if original.Method != "GET" || original.Status != 200 || !ok || expected["total"] == nil || expected["list"] == nil || ignored[original.Endpoint] {
			continue
		}
		t.Run(strings.TrimPrefix(original.Endpoint, "/api/v1/"), func(t *testing.T) {
			actual := c.ok("GET", original.Endpoint+"?page_size=1000", nil).(map[string]any)
			if !reflect.DeepEqual(expected["total"], actual["total"]) {
				t.Errorf("total expected %v actual %v", expected["total"], actual["total"])
			}
			byID := map[string]map[string]any{}
			for _, v := range actual["list"].([]any) {
				record := v.(map[string]any)
				byID[fmt.Sprint(record["id"])] = record
			}
			for _, item := range expected["list"].([]any) {
				record := item.(map[string]any)
				result := byID[fmt.Sprint(record["id"])]
				if result == nil {
					t.Errorf("original seed record missing: %v", record["id"])
					continue
				}
				a, b := normalizeContract(record), normalizeContract(result)
				if !reflect.DeepEqual(a, b) {
					wanted, _ := json.Marshal(a)
					got, _ := json.Marshal(b)
					t.Errorf("response mismatch\nexpected: %s\nactual: %s", wanted, got)
				}
			}
		})
		checked++
	}
	// 81 → 82：批次 EE 恢复 /api/v1/combo-products 后，原版该契约（空列表）纳入比对。
	if checked != 82 {
		t.Fatalf("checked original collection contracts=%d", checked)
	}
}
