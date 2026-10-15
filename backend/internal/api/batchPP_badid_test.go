package api

// 批次 PP（2026-10-15）：通用资源「非法 ID」守卫 + 兜底路由形态 + /health 的回归测试。
//
// 依据：
//   - tools/replay-batch-oo-badid.js（129 条对照，运行快照）
//   - tools/replay-batch-oo-badid2.js（合法 UUID 补取证，audit-batch-oo-badid2-20261015.txt）
//   - tools/replay-batch-oo-catchall.js / catchall2.js（兜底与 /health）
//
// 铁律：断言的文案全部来自实测，不得自造。

import (
	"net/http"
	"strings"
	"testing"
)

// TestPPBadIDGuard 三个代表性资源 × 三方法：非法 UUID 的逐字文案。
// 既有实现三套文案（无效的<Label>ID / ID格式错误 / 无效的ID）各抽一个代表。
// 注意「ID格式错误」组的 PUT 既有实现根本无此写路由（404「路由不存在」，
// 见 audit-batch-oo-badid-20261015.json），故只断言 GET/DELETE。
func TestPPBadIDGuard(t *testing.T) {
	c, _ := setup(t)
	const bad = "not-a-uuid-pp"
	for _, tc := range []struct {
		route, want string
	}{
		{"products", "无效的商品ID"},
		{"payrolls", "ID格式错误"},
		{"approval-flows", "无效的ID"},
		{"customers", "无效的客户ID"},
		{"fixed-assets", "ID格式错误"},
	} {
		for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
			want, wantStatus := tc.want, 400
			if method == http.MethodPut && tc.want == "ID格式错误" {
				want, wantStatus = "路由不存在", 404 // 既有实现无该写路由
			}
			status, body := c.request(method, "/api/v1/"+tc.route+"/"+bad, map[string]any{"name": "x"})
			if status != wantStatus || body["message"] != want {
				t.Errorf("%s /%s/{非UUID} = %d %v, want %d %s", method, tc.route, status, body["message"], wantStatus, want)
			}
		}
	}
}

// TestPPCatchAll404 未注册 /api/ 路径逐字返回 404 +「路由不存在」。
// 此前本实现是自造的 501「该业务接口尚未实现」，已按既有实现对齐。
func TestPPCatchAll404(t *testing.T) {
	c, _ := setup(t)
	for _, path := range []string{
		"/api/v1/nope-resource-pp",
		"/api/v1/accounts/nope-sub/deeper",
		"/api/v2/nope-version-pp",
		"/api/nope-no-version-pp",
	} {
		status, body := c.request(http.MethodGet, path, nil)
		if status != 404 || body["message"] != "路由不存在" {
			t.Errorf("GET %s = %d %v, want 404 路由不存在", path, status, body["message"])
		}
	}
}

// TestPPHealth 既有实现 /health 返回 {"status":"OK"}（大写）。
func TestPPHealth(t *testing.T) {
	c, _ := setup(t)
	_, _, body := c.raw(http.MethodGet, "/health", nil)
	if got := strings.TrimSpace(string(body)); got != `{"status":"OK"}` {
		t.Errorf("/health = %s, want {\"status\":\"OK\"}", got)
	}
}

// TestPPAccountsBadID accounts 专门 handler 的非法 UUID 与合法不存在形态。
func TestPPAccountsBadID(t *testing.T) {
	c, _ := setup(t)
	const bad = "not-a-uuid-pp-acc"
	// PUT 非法 UUID → 400「无效的ID格式」
	if status, body := c.request(http.MethodPut, "/api/v1/accounts/"+bad, map[string]any{"name": "x"}); status != 400 || body["message"] != "无效的ID格式" {
		t.Errorf("PUT /accounts/{非UUID} = %d %v, want 400 无效的ID格式", status, body["message"])
	}
	// GET /accounts/{id}/balance 非法 UUID → 400「无效的ID格式」
	if status, body := c.request(http.MethodGet, "/api/v1/accounts/"+bad+"/balance", nil); status != 400 || body["message"] != "无效的ID格式" {
		t.Errorf("GET /accounts/{非UUID}/balance = %d %v, want 400 无效的ID格式", status, body["message"])
	}
	// PUT 合法 UUID 不存在 → 400「科目不存在」（不泄漏 record not found）
	if status, body := c.request(http.MethodPut, "/api/v1/accounts/"+zeroUUID, map[string]any{"name": "x"}); status != 400 || body["message"] != "科目不存在" {
		t.Errorf("PUT /accounts/{零UUID} = %d %v, want 400 科目不存在", status, body["message"])
	}
	// GET /accounts/{非UUID} → 400「无效的ID格式」（read_resources 通道）
	if status, body := c.request(http.MethodGet, "/api/v1/accounts/"+bad, nil); status != 400 || body["message"] != "无效的ID格式" {
		t.Errorf("GET /accounts/{非UUID} = %d %v, want 400 无效的ID格式", status, body["message"])
	}
}

// TestPPReadRouteAbsent GET 详情路由既有实现不存在的资源 → 404「路由不存在」。
func TestPPReadRouteAbsent(t *testing.T) {
	c, _ := setup(t)
	for _, route := range []string{"production-team-members", "approval-records"} {
		status, body := c.request(http.MethodGet, "/api/v1/"+route+"/"+zeroUUID, nil)
		if status != 404 || body["message"] != "路由不存在" {
			t.Errorf("GET /%s/{uuid} = %d %v, want 404 路由不存在", route, status, body["message"])
		}
	}
}

// TestPPDeleteNotFoundShape DELETE 合法 UUID 不存在时的两个特殊文案。
func TestPPDeleteNotFoundShape(t *testing.T) {
	c, _ := setup(t)
	for _, tc := range []struct{ route, want string }{
		{"equipment-maintenances", "保养/维修记录不存在"},
		{"tax-accruals", "计提记录不存在"},
	} {
		status, body := c.request(http.MethodDelete, "/api/v1/"+tc.route+"/"+zeroUUID, nil)
		if status != 400 || body["message"] != tc.want {
			t.Errorf("DELETE /%s/{零UUID} = %d %v, want 400 %s", tc.route, status, body["message"], tc.want)
		}
	}
}

// TestPPWriteOnlyBadID 仅写路径可见的文案：这三张表的 GET/PUT 既有实现是
// 404「路由不存在」，DELETE 却有专用文案，故守卫不能误伤读路径。
func TestPPWriteOnlyBadID(t *testing.T) {
	c, _ := setup(t)
	const bad = "not-a-uuid-pp-wo"
	for _, tc := range []struct{ route, want string }{
		{"equipment-maintenances", "无效的记录ID"},
		{"crm-activities", "无效的记录ID"},
		{"tax-accruals", "无效的ID格式"},
		{"permissions", "无效的权限ID"},
	} {
		for _, method := range []string{http.MethodPut, http.MethodDelete} {
			if method == http.MethodPut && tc.route != "permissions" {
				continue // 这三张表 PUT 既有实现无路由
			}
			status, body := c.request(method, "/api/v1/"+tc.route+"/"+bad, map[string]any{"name": "x"})
			if status != 400 || body["message"] != tc.want {
				t.Errorf("%s /%s/{非UUID} = %d %v, want 400 %s", method, tc.route, status, body["message"], tc.want)
			}
		}
	}
}

// TestPPValidUUIDStillWorks 守卫不误伤正常链路：合法 UUID 的 CRUD 全通。
func TestPPValidUUIDStillWorks(t *testing.T) {
	c, _ := setup(t)
	data := c.ok(http.MethodPost, "/api/v1/warehouses", map[string]any{"name": "PP守卫回归仓"}).(map[string]any)
	id := data["id"].(string)
	if _, body := c.request(http.MethodGet, "/api/v1/warehouses/"+id, nil); body["message"] == "无效的仓库ID" {
		t.Fatal("合法 UUID 被守卫误伤")
	}
	c.ok(http.MethodPut, "/api/v1/warehouses/"+id, map[string]any{"name": "PP守卫回归仓2"})
	c.ok(http.MethodDelete, "/api/v1/warehouses/"+id, nil)
}
