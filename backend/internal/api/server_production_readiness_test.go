package api

// 生产就绪度（2026-10-15）· panic 兜底与尾斜杠归一化的回归锁定。
//
// 这两项都是**横切行为**：一旦被后续改动破坏，不会有任何业务测试报错，
// 但线上会表现为「连接被掐断」或「带尾斜杠的请求全线 404」，故必须单独锁住。

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestServeHTTPRecoversPanic 锁定：处理器 panic 后返回原版通用 500，而不是掐断连接。
//
// 修复前：ServeHTTP 没有 recover。net/http 的 conn.serve 虽有兜底（进程不会退出），
// 但会直接关闭连接 —— 客户端拿到的是空响应/网络错误，且标准错误里只有堆栈，
// 没有 method/path，无法定位是哪个接口触发的。
func TestServeHTTPRecoversPanic(t *testing.T) {
	c, s := setup(t)
	// 注入一个必然 panic 的处理器；生产代码里不存在这条路由
	s.mux.Handle("GET /api/v1/__panic_probe__", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("injected by TestServeHTTPRecoversPanic")
	}))
	status, body := c.request("GET", "/api/v1/__panic_probe__", nil)
	if status != 500 {
		t.Fatalf("期望 panic 被兜底为 500，实际 http=%d body=%v", status, body)
	}
	// 形态与已取证的原版通用 500 一致（business.ErrKnownNoMessage 同文案）
	if text, _ := body["message"].(string); !strings.Contains(text, "系统内部错误，请稍后重试或联系管理员") {
		t.Fatalf("期望原版通用 500 文案，实际 %v", body["message"])
	}
	// 服务仍然可用（进程没被打挂）
	if after, _ := c.request("GET", "/api/v1/auth/me", nil); after != 200 {
		t.Fatalf("panic 之后服务应仍可用，实际 http=%d", after)
	}
}

// TestTrailingSlashNormalized 锁定：/api/v1/xxx/ 与 /api/v1/xxx 等价。
//
// 原版（Gin）把两者视为同一路由；Go ServeMux 不会，修复前所有带尾斜杠的
// 请求一律落到 404「路由不存在」。已取样 8 个资源（含带 id / 不带 id）确认原版
// 行为，再全量扫描 105 个资源验证修复（见 eval-trailing-slash-sweep）。
func TestTrailingSlashNormalized(t *testing.T) {
	c, _ := setup(t)
	for _, path := range []string{"/api/v1/products", "/api/v1/customers", "/api/v1/warehouses"} {
		plain, _ := c.request("GET", path, nil)
		slash, _ := c.request("GET", path+"/", nil)
		if plain != slash {
			t.Fatalf("%s 期望与 %s/ 同状态，实际 %d vs %d", path, path, plain, slash)
		}
		if plain != 200 {
			t.Fatalf("%s 期望 200，实际 %d", path, plain)
		}
	}
	// 边界：/api/ 与 /api/v1/ 本身两端都不处理，保持 404
	for _, path := range []string{"/api/", "/api/v1/"} {
		if got, _ := c.request("GET", path, nil); got != 404 {
			t.Fatalf("%s 期望保持 404，实际 %d", path, got)
		}
	}
}

// TestLoginThrottle 锁定：登录失败限流的阈值、文案与冷却行为。
//
// 生产就绪度（2026-10-15）：恢复端此前**完全无限流**，口令可被枚举。
// 原版取证（audit-batch-pp-login-throttle-20261015.txt，冷却满 5 分钟后重跑取得）：
//   · 连续失败 10 次仍是 401，**第 11 次**起 429
//   · 文案逐字「登录尝试过于频繁，请 5 分钟后再试」
//   · 按**用户名**计数：换一个用户名登录不受他人冷却影响
//   · 冷却期内即使口令正确也被拒
func TestLoginThrottle(t *testing.T) {
	c, _ := setup(t) // 登录探测不需要 token，但要拿到测试服务器地址
	base := c.server.URL

	const text429 = "登录尝试过于频繁，请 5 分钟后再试"
	post := func(username, password string) (int, map[string]any) {
		body, _ := json.Marshal(map[string]any{"username": username, "password": password, "company": "default"})
		res, err := http.Post(base+"/api/v1/auth/login", "application/json", strings.NewReader(string(body)))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}

	// 用一次性用户名，避免与别的测试共享限流计数
	victim := "throttle-probe-" + fmt.Sprintf("%d", time.Now().UnixNano())
	for i := 1; i <= 10; i++ {
		status, _ := post(victim, "wrong-password")
		if status != 401 {
			t.Fatalf("第 %d 次失败应为 401，实际 %d", i, status)
		}
	}
	status, body := post(victim, "wrong-password")
	if status != 429 {
		t.Fatalf("第 11 次失败应进入冷却（429），实际 %d", status)
	}
	if body["message"] != text429 {
		t.Fatalf("冷却文案应为 %q，实际 %v", text429, body["message"])
	}

	// 按用户名计数：另一个用户名不受影响
	if status, _ := post(victim+"-other", "wrong-password"); status != 401 {
		t.Fatalf("其他用户名不应受冷却影响，实际 %d", status)
	}

	// 冷却期内即使口令正确也被拒（原版实测第 ④ 组）
	if status, _ := post(victim, "admin123"); status != 429 {
		t.Fatalf("冷却期内正确口令也应被拒（429），实际 %d", status)
	}
}

// TestApprovalListShape 锁定：审批资源列表是**裸数组**且忽略分页。
//
// 原版实测（audit-batch-pp-approvalflows-20261015.txt）：
// 裸数组、page_size=2 仍返回全部、created_at 升序、不含 is_active。
// 恢复端原先走通用注册器输出 {list,total} + 降序 + 带 is_active。
func TestApprovalListShape(t *testing.T) {
	c, _ := setup(t)
	for _, res := range []string{"approval-flows", "approval-records"} {
		data := c.ok("GET", "/api/v1/"+res+"?page=1&page_size=2", nil)
		if _, ok := data.([]any); !ok {
			t.Fatalf("%s 期望返回裸数组，实际 %T", res, data)
		}
		// 忽略分页：page_size=2 与 500 应返回同样条数
		small := len(c.ok("GET", "/api/v1/"+res+"?page=1&page_size=2", nil).([]any))
		large := len(c.ok("GET", "/api/v1/"+res+"?page=1&page_size=500", nil).([]any))
		if small != large {
			t.Fatalf("%s 应忽略分页，page_size=2 得 %d 条、500 得 %d 条", res, small, large)
		}
	}
	// 字段：不含 is_active
	c.ok("POST", "/api/v1/approval-flows", map[string]any{
		"code": "AFPROBE", "name": "审批流形态锁定", "biz_type": "sales_order",
	})
	rows := c.ok("GET", "/api/v1/approval-flows?page=1&page_size=500", nil).([]any)
	found := false
	for _, row := range rows {
		m := row.(map[string]any)
		if m["code"] == "AFPROBE" {
			found = true
			if _, bad := m["is_active"]; bad {
				t.Fatal("审批流列表不应包含 is_active")
			}
		}
	}
	if !found {
		t.Fatal("未找到刚创建的审批流，无法校验字段")
	}
}
