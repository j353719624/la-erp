package api

import (
	"net/http"
	"testing"
)

// 本文件固化批次 KK 第三轮取证的结论（2026-10-15 原版回放 192.168.110.97:18886）：
// 写路径「记录不存在」的响应形态。
//
// 起因：前两轮核对了「路由在不在」与「列表形状」，但没核对过**写路径的失败形态**。
// 扫描器 tools/scan-write-labels.mjs 对 Resources 里每张表的 PUT/DELETE 各打一次
// 「不存在的 id」，发现 66 处不一致：
//
//	51 处：原版 200 + code 10000 + 中文文案，恢复端 404 + code 404
//	15 处：原版**没有**该写路由（404「路由不存在」），恢复端却注册了
//
// 证据：evidence/backend-runtime/audit-batch-kk-write-labels-20261015.json

// TestKKWriteNotFoundBusiness 51 处「原版返回业务错误形态」的写路径。
func TestKKWriteNotFoundBusiness(t *testing.T) {
	c, _ := setup(t)
	// 逐字文案取自原版回放；这里抽 8 张表做代表性断言，其余由配置表保证。
	cases := []struct{ route, message string }{
		{"products", "商品不存在"},
		{"customers", "客户不存在"},
		{"departments", "部门不存在"},
		{"employees", "员工不存在"},
		{"crm-opportunities", "商机不存在"},
		{"piecework-rates", "计件单价不存在"},
		{"piecework-records", "计件登记不存在"},
		{"loan-orders", "借出借入单不存在"},
	}
	for _, tc := range cases {
		for _, method := range []string{"PUT", "DELETE"} {
			if hasMethod(writeRouteAbsent[tc.route], method) {
				continue // 原版没有该写路由，由另一条用例覆盖
			}
			status, body := c.request(method, "/api/v1/"+tc.route+"/"+zeroUUID, map[string]any{"name": "x"})
			if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != tc.message {
				t.Fatalf("%s /%s/{不存在的id} = %d %v, want 200/10000/%s", method, tc.route, status, body, tc.message)
			}
		}
	}
	// 配置表与回放条数一致（29 张表 × 至少一个方法 = 51 处）
	if len(writeNotFoundBusiness) != 29 {
		t.Fatalf("writeNotFoundBusiness 配了 %d 张表，回放实测 29 张", len(writeNotFoundBusiness))
	}
}

// TestKKWriteRouteAbsent 15 处「原版没有该写路由」的写路径：
// 恢复端不得自动补出，须逐字返回 404「路由不存在」。
//
// 关键：这些是**按方法**而非按表 —— 同一张表可能 DELETE 存在而 PUT 不存在
// （如 crm-activities / expense-claims / fixed-assets / leads 只有 DELETE）。
func TestKKWriteRouteAbsent(t *testing.T) {
	c, _ := setup(t)

	// 整表都没有的（如 employee-changes）
	for _, route := range []string{"employee-changes", "accounting-periods", "approval-records", "production-team-members"} {
		for _, method := range []string{"PUT", "DELETE"} {
			status, body := c.request(method, "/api/v1/"+route+"/"+zeroUUID, map[string]any{"name": "x"})
			if status != http.StatusNotFound || body["message"] != "路由不存在" {
				t.Fatalf("%s /%s = %d %v, want 404/路由不存在", method, route, status, body)
			}
		}
	}
	// 只有 PUT 不存在的（DELETE 存在，且走业务错误形态）
	for _, route := range []string{"crm-activities", "expense-claims", "fixed-assets", "leads", "tax-accruals", "payrolls", "equipment-maintenances"} {
		status, body := c.request("PUT", "/api/v1/"+route+"/"+zeroUUID, map[string]any{"name": "x"})
		if status != http.StatusNotFound || body["message"] != "路由不存在" {
			t.Fatalf("PUT /%s = %d %v, want 404/路由不存在（但 DELETE 应存在）", route, status, body)
		}
		// DELETE 走业务错误形态而非「路由不存在」
		status, body = c.request("DELETE", "/api/v1/"+route+"/"+zeroUUID, nil)
		if status == http.StatusNotFound && body["message"] == "路由不存在" {
			t.Fatalf("DELETE /%s 被误关成「路由不存在」，原版该方法存在", route)
		}
	}
	// 回放实测 11 张表存在「原版无写路由」的情况
	if len(writeRouteAbsent) != 11 {
		t.Fatalf("writeRouteAbsent 配了 %d 张表，回放实测 11 张", len(writeRouteAbsent))
	}
}

// TestKKWriteScopeNotLeaked 安全回归：越权与「记录不存在」必须分开处理。
//
// checkScope 越权时返回的也是 database.ErrNotFound（scope.go:48/51），
// 批次 KK 第一版把两者混在一起，导致越权 PUT 被改写成 200 + 10000
// 「<中文名>不存在」—— 既泄漏了「记录是否存在」，也绕过了数据隔离。
// 本用例钉死：越权仍返回 404，且文案**不是**业务错误形态。
func TestKKWriteScopeNotLeaked(t *testing.T) {
	c, _ := setup(t)
	permissions := c.ok("GET", "/api/v1/permissions?page_size=1000", nil).(map[string]any)["list"].([]any)
	ids := []any{}
	for _, p := range permissions {
		row := p.(map[string]any)
		switch row["code"] {
		case "product_list", "product_view", "product_create", "product_edit", "product_delete":
			ids = append(ids, row["id"])
		}
	}
	role := c.ok("POST", "/api/v1/roles", map[string]any{"code": "kk-scope", "name": "本人资料", "data_scope": "self"}).(map[string]any)
	c.ok("POST", "/api/v1/roles/"+role["id"].(string)+"/permissions", map[string]any{"permission_ids": ids})
	user := c.ok("POST", "/api/v1/users", map[string]any{"username": "kkscoped", "password": "kkscoped123"}).(map[string]any)
	c.ok("POST", "/api/v1/users/"+user["id"].(string)+"/roles", map[string]any{"role_ids": []any{role["id"]}})

	foreign := c.ok("POST", "/api/v1/products", map[string]any{"code": "KK-OTHER", "name": "他人商品"}).(map[string]any)
	login := c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "kkscoped", "password": "kkscoped123"}).(map[string]any)
	regular := &client{t: t, server: c.server, token: login["access_token"].(string)}

	for _, method := range []string{"PUT", "DELETE"} {
		status, body := regular.request(method, "/api/v1/products/"+foreign["id"].(string), map[string]any{"name": "被篡改"})
		// 越权必须仍是 404（s.failure 对 ErrNotFound 的默认处理），
		// **不能**是 200/10000 —— 那会泄漏「该 id 存在但你无权访问」
		if status != http.StatusNotFound {
			t.Fatalf("越权 %s /products/{他人记录} = %d %v，want 404", method, status, body)
		}
		if body["code"] == float64(10000) {
			t.Fatalf("越权 %s 被改写成业务错误形态（泄漏记录存在性）: %v", method, body)
		}
	}
	// 确认数据没被篡改
	after := c.ok("GET", "/api/v1/products/"+foreign["id"].(string), nil).(map[string]any)
	if after["name"] != "他人商品" {
		t.Fatalf("越权写入生效了: %v", after["name"])
	}
	// 但**确实不存在**的记录仍走业务错误形态（200/10000「商品不存在」）
	status, body := regular.request("PUT", "/api/v1/products/"+zeroUUID, map[string]any{"name": "x"})
	if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != "商品不存在" {
		t.Fatalf("不存在记录的 PUT = %d %v, want 200/10000/商品不存在", status, body)
	}
}
