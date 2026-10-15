package api

import (
	"net/http"
	"testing"
)

// 本文件把批次 OO 的两端对照取证固化成回归测试。
//
// 背景：批次 NN 收尾时路由对账报出 62 条差异，其中 30 条是「纯路由」。
// 批次 OO 先做多方法存在性复验（tools/replay-batch-oo-methods.js），证明其中
// 22 条「原版=absent」是**探测噪声**：探针只打 GET/PUT，而原版是 POST-only；
// 且恢复端通用注册器多铺的方法在 frontend/src/api 里**均无调用**。
// 剩下的真差异见 tools/replay-batch-oo-shapes.js（35 条）与 -shapes2.js（28 条）。
//
// ⚠ 本批最重要的一条方法论：**参数名猜错会让整批结论失效**。
// 第一版探测 /assemblies/bom-components 用了我猜的 assembly_id，
// 原版一律回「无效的商品ID」；前端实际用的是 product_id
// （frontend/src/api/production.ts:36），换对参数名后才拿到真实形态。
//
// 证据：evidence/backend-runtime/audit-batch-oo-*-20261015.{txt,json}

const (
	ooGenericServerError = "系统内部错误，请稍后重试或联系管理员"
	ooNIL                = "00000000-0000-0000-0000-000000000001"
)

// ooAnon 返回一个不带 token 的 client，用于验证「无 token」分支。
func ooAnon(c *client) *client { return &client{t: c.t, server: c.server} }

func ooMsg(result map[string]any) string { m, _ := result["message"].(string); return m }
func ooCode(result map[string]any) float64 {
	v, _ := result["code"].(float64)
	return v
}

// ooExpect 断言状态码 + code + message 三元组。
func ooExpect(t *testing.T, tag string, wantHTTP int, wantCode float64, wantMsg string, status int, result map[string]any) {
	t.Helper()
	if status != wantHTTP || ooMsg(result) != wantMsg || (wantCode != 0 && ooCode(result) != wantCode) {
		t.Fatalf("%s: 期望 %d/%v/%q，实际 %d/%v/%q",
			tag, wantHTTP, wantCode, wantMsg, status, ooCode(result), ooMsg(result))
	}
}

func TestOOAccountsDeleteGuard(t *testing.T) {
	c, _ := setup(t)
	// 原版删除科目：非 UUID → 400「无效的ID格式」；查无此行 → 裸 400 + 通用文案。
	// 恢复端原来对两者都返回 200/code0（假装删成功）。
	for _, tc := range []struct {
		tag, id, message string
	}{
		{"非 UUID（tree 子路径）", "tree", "无效的ID格式"},
		{"非 UUID（随机串）", "not-a-uuid", "无效的ID格式"},
		{"合法 UUID 但从未存在", ooNIL, ooGenericServerError},
	} {
		status, result := c.request(http.MethodDelete, "/api/v1/accounts/"+tc.id, nil)
		ooExpect(t, tc.tag, 400, 400, tc.message, status, result)
	}

	// ⚠ 反向用例（防回归）：原版**允许**删除真实科目，且重复删除仍 200/code0。
	// evidence/backend-runtime/account-flow-contracts.json case 29/31 是原版回放证据。
	// 第一版修复曾把「合法 UUID」一律拦成 400，被 TestOriginalBusinessFlowReplay 抓住。
	created := c.ok(http.MethodPost, "/api/v1/accounts", map[string]any{
		"code": "OO-DEL-1", "name": "OO待删科目", "category": "asset",
	}).(map[string]any)
	id := created["id"].(string)
	if status, result := c.request(http.MethodDelete, "/api/v1/accounts/"+id, nil); status != 200 || ooCode(result) != 0 {
		t.Fatalf("删除真实科目: 期望 200/code0，实际 %d/%v", status, result)
	}
	// 软删后重复删除仍成功（幂等）
	if status, result := c.request(http.MethodDelete, "/api/v1/accounts/"+id, nil); status != 200 || ooCode(result) != 0 {
		t.Fatalf("重复删除: 期望 200/code0，实际 %d/%v", status, result)
	}
	if status, _ := c.request(http.MethodGet, "/api/v1/accounts/"+id, nil); status != 404 {
		t.Fatalf("删除后查询: 期望 404，实际 %d", status)
	}
}

func TestOOAccountBalanceNotFound(t *testing.T) {
	c, _ := setup(t)
	// 同一张 accounts 表有**两套** notFound 形态，不能统一：
	//   GET /accounts/{id}         → 404「科目不存在」
	//   GET /accounts/{id}/balance → 200 + code 10000「科目不存在」
	status, result := c.request(http.MethodGet, "/api/v1/accounts/"+ooNIL+"/balance", nil)
	ooExpect(t, "balance notFound", 200, 10000, "科目不存在", status, result)

	status, result = c.request(http.MethodGet, "/api/v1/accounts/"+ooNIL, nil)
	ooExpect(t, "detail notFound", 404, 404, "科目不存在", status, result)
}

func TestOOInvoiceIssueNotFound(t *testing.T) {
	c, _ := setup(t)
	// 开票的「记录不存在」是业务错误形态（200 + code 10000），不是 404。
	for _, tc := range []struct{ route, label string }{
		{"ap-invoices", "应付单"},
		{"ar-invoices", "应收单"},
	} {
		status, result := c.request(http.MethodPost, "/api/v1/"+tc.route+"/"+ooNIL+"/issue", map[string]any{})
		ooExpect(t, tc.route+" issue", 200, 10000, tc.label+"不存在", status, result)
	}
}

func TestOOApprovalFlowRequired(t *testing.T) {
	c, _ := setup(t)
	// 缺 code/name/biz_type 时原版返回裸 500 + 通用文案。
	// 恢复端原来把 `constraint failed: NOT NULL constraint failed: approval_flows.xxx`
	// 直接回给客户端 —— 建表约束名外泄，必须收口。
	for _, tc := range []struct {
		tag  string
		body map[string]any
	}{
		{"空载荷", map[string]any{}},
		{"缺 name/biz_type", map[string]any{"code": "OO-T1"}},
		{"缺 code", map[string]any{"name": "OO流程", "biz_type": "purchase_order"}},
		{"缺 biz_type", map[string]any{"code": "OO-T2", "name": "OO流程"}},
	} {
		status, result := c.request(http.MethodPost, "/api/v1/approval-flows", tc.body)
		ooExpect(t, tc.tag, 500, 500, ooGenericServerError, status, result)
	}
}

func TestOOBOMComponents(t *testing.T) {
	c, _ := setup(t)
	// product_id 缺失或不是合法 UUID → 裸 400「无效的商品ID」；
	// 合法 UUID 才查数据（查无结果也是 200 + 空数组）。
	for _, tc := range []struct {
		tag, query    string
		wantHTTP      int
		wantMsg       string
	}{
		{"无参", "", 400, "无效的商品ID"},
		{"product_id 非法", "?product_id=bad", 400, "无效的商品ID"},
		{"product_id 合法", "?product_id=" + ooNIL, 200, "success"},
	} {
		status, result := c.request(http.MethodGet, "/api/v1/assemblies/bom-components"+tc.query, nil)
		ooExpect(t, tc.tag, tc.wantHTTP, 0, tc.wantMsg, status, result)
	}
	// PUT/DELETE 是子路径被当 {id} 解析的形态，一律 400「无效的组装单ID」。
	for _, m := range []string{http.MethodPut, http.MethodDelete} {
		status, result := c.request(m, "/api/v1/assemblies/bom-components", map[string]any{})
		ooExpect(t, m+" bom-components", 400, 400, "无效的组装单ID", status, result)
	}
}

func TestOOAttendanceRequestValidation(t *testing.T) {
	c, _ := setup(t)
	// 原版校验顺序：request_type 非空 → start_date 非空 → start_date 按 RFC3339 解析。
	// 恢复端原来被通用必填（code）挡在最前，根本走不到这条链。
	//
	// 注意 request_type 只判非空，不判合法性：{request_type:"BAD"} 原版照样放行到
	// 日期解析那一步。文案里的合法值只是提示，不能扩成枚举校验。
	const parseMsg = "参数错误: parsing time \"2026-10-01\" as \"2006-01-02T15:04:05Z07:00\": cannot parse \"\" as \"T\""
	for _, tc := range []struct {
		tag       string
		body      map[string]any
		wantHTTP  int
		wantCode  float64
		wantMsg   string
	}{
		{"空载荷", map[string]any{}, 200, 10000, "申请类型无效（leave 请假 / overtime 加班）"},
		{"缺 request_type", map[string]any{"employee_name": "OO甲"}, 200, 10000, "申请类型无效（leave 请假 / overtime 加班）"},
		{"缺 start_date", map[string]any{"employee_name": "OO甲", "request_type": "leave"}, 200, 10000, "开始日期不能为空"},
		{"start_date 非 RFC3339", map[string]any{"employee_name": "OO甲", "request_type": "leave", "start_date": "2026-10-01"}, 400, 400, parseMsg},
	} {
		status, result := c.request(http.MethodPost, "/api/v1/attendance-requests", tc.body)
		ooExpect(t, tc.tag, tc.wantHTTP, tc.wantCode, tc.wantMsg, status, result)
	}
	// request_type 非法但非空时，原版放行到日期校验（不是报类型无效）
	status, result := c.request(http.MethodPost, "/api/v1/attendance-requests",
		map[string]any{"employee_name": "OO乙", "request_type": "BAD", "start_date": "2026-10-01"})
	ooExpect(t, "request_type 非法但非空", 400, 400, parseMsg, status, result)
}

func TestOOAttendanceSummary(t *testing.T) {
	c, _ := setup(t)
	// period 非法/缺失 → 业务错误形态，文案是「期间格式无效（应为 YYYY-MM）」。
	// 与期初余额的「期间格式错误，应为 YYYY-MM」是两句不同的话，不要合并。
	for _, q := range []string{"", "?period=BAD", "?period=2026-13-01"} {
		status, result := c.request(http.MethodGet, "/api/v1/attendance-requests/summary"+q, nil)
		ooExpect(t, "summary "+q, 200, 10000, "期间格式无效（应为 YYYY-MM）", status, result)
	}
	// PUT/DELETE 是子路径被当 {id} 解析的形态，一律 400「无效的考勤申请ID」
	for _, m := range []string{http.MethodPut, http.MethodDelete} {
		status, result := c.request(m, "/api/v1/attendance-requests/summary", map[string]any{})
		ooExpect(t, m+" summary", 400, 400, "无效的考勤申请ID", status, result)
	}
}

func TestOOOpeningBalancesValidation(t *testing.T) {
	c, _ := setup(t)
	// 原版校验顺序：period 格式 → entries 非空 → 科目存在。
	// ⚠ 原版**不校验期间是否存在**：2099-12 并不存在，却一路走到了科目检查。
	// 恢复端原来第一句就是 SELECT status，期间不存在时把 sql.ErrNoRows 的原文
	// 「sql: no rows in result set」回给了客户端。
	for _, tc := range []struct {
		tag      string
		body     map[string]any
		wantCode float64
		wantMsg  string
	}{
		{"空载荷", map[string]any{}, 10000, "期间格式错误，应为 YYYY-MM"},
		{"period 非法", map[string]any{"period": "BAD"}, 10000, "期间格式错误，应为 YYYY-MM"},
		{"period 合法但无 entries", map[string]any{"period": "2099-12"}, 10000, "期初余额分录不能为空"},
		{"entries 空数组", map[string]any{"period": "2099-12", "entries": []any{}}, 10000, "期初余额分录不能为空"},
		{"科目不存在", map[string]any{"period": "2099-12", "entries": []any{map[string]any{"account_id": ooNIL, "begin_balance": 1}}}, 10000, "会计科目不存在"},
	} {
		status, result := c.request(http.MethodPost, "/api/v1/accounting-periods/opening-balances", tc.body)
		ooExpect(t, tc.tag, 200, tc.wantCode, tc.wantMsg, status, result)
	}
}

func TestOOAuthRefreshRequired(t *testing.T) {
	c, _ := setup(t)
	// 缺 refresh_token 走 gin 的 required 形态；值无效才走 401。两者不能合并。
	status, result := c.request(http.MethodPost, "/api/v1/auth/refresh", map[string]any{})
	ooExpect(t, "refresh 缺参", 400, 400,
		"请求参数错误: Key: 'RefreshRequest.RefreshToken' Error:Field validation for 'RefreshToken' failed on the 'required' tag",
		status, result)

	status, result = c.request(http.MethodPost, "/api/v1/auth/refresh", map[string]any{"refresh_token": "bad"})
	ooExpect(t, "refresh 无效值", 401, 401, "刷新令牌无效或已过期", status, result)
}

func TestOOPortalAuthGuard(t *testing.T) {
	c, _ := setup(t)
	// 门户商品/分类必须持客户 token。恢复端原来完全不鉴权，等于对匿名开放。
	anon := ooAnon(c)
	for _, path := range []string{"/api/v1/portal/categories", "/api/v1/portal/products"} {
		status, result := c.request(http.MethodGet, path, nil)
		ooExpect(t, path+"（带主 token）", 401, 401, "非客户登录，无权访问门户", status, result)

		status, result = anon.request(http.MethodGet, path, nil)
		ooExpect(t, path+"（无 token）", 401, 401, "登录状态无效", status, result)
	}
}

func TestOOPortalLogin(t *testing.T) {
	c, _ := setup(t)
	anon := ooAnon(c)
	// 原版两者都是 400（不是 401），且文案与恢复端原来的「客户账号或密码错误」不同。
	for _, tc := range []struct {
		tag     string
		body    map[string]any
		wantMsg string
	}{
		{"空载荷", map[string]any{}, "请输入账号和密码"},
		{"缺 password", map[string]any{"account": "oo-none"}, "请输入账号和密码"},
		{"缺 account", map[string]any{"password": "x"}, "请输入账号和密码"},
		{"账号不存在", map[string]any{"account": "oo-none", "password": "x"}, "账号或密码错误"},
	} {
		status, result := anon.request(http.MethodPost, "/api/v1/portal/login", tc.body)
		ooExpect(t, tc.tag, 400, 400, tc.wantMsg, status, result)
	}
}
