package api

// 批次 OO 对齐（2026-10-15）：对账报告 62 条差异里**纯路由/纯形态**部分的修复。
//
// ## 本批的取证来源
//   tools/replay-batch-oo-methods.js  → 证明 22 条「既有实现=absent」是探测方法噪声
//   tools/replay-batch-oo-shapes.js   → 纯路由带 token 的形态对照（35 条）
//   tools/replay-batch-oo-shapes2.js  → 正确参数名 + 近合法载荷的递进对照（28 条）
// 证据落盘 运行快照,json}。
//
// ## 三条本批确立的准则
//   ① 既有实现 500 仍按铁律④不作语义证据；但本实现**绝不能**把 SQL 原文回给客户端
//      （opening-balances 的「sql: no rows in result set」、approval-flows 的
//      「constraint failed: NOT NULL constraint failed: ...」都是实现泄漏）。
//   ② 时间解析一律用 time.RFC3339（**不带纳秒**）。既有实现错误信息里是
//      "2006-01-02T15:04:05Z07:00"，本实现多处用了 RFC3339Nano，串不一样。
//   ③ gin 的 required 校验形态是
//      `请求参数错误: Key: '<Struct>.<Field>' Error:Field validation for
//       '<Field>' failed on the 'required' tag`，与本实现通用的
//      `请求参数错误：<中文名> 为必填字段` 是两套，不能混用。

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"la-erp/backend/internal/business"
)

var ooPeriodRe = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}$`)

// ---------------------------------------------------------------------------
// 考勤申请：既有实现的校验顺序是 request_type → start_date 非空 → start_date 解析
// ---------------------------------------------------------------------------

// prepareAttendanceRequest 复刻既有实现考勤申请的写校验链。
//
// 回放 OO（2026-10-15，audit-batch-oo-shapes2-20261015.json）三条定序证据：
//
//	POST {}                                  → 200/10000「申请类型无效（leave 请假 / overtime 加班）」
//	POST {request_type:leave}                → 200/10000「开始日期不能为空」
//	POST {request_type:leave,start_date:2026-10-01} → 400「参数错误: parsing time ...」
//
// 注意 request_type 只判**非空**，不判合法性：{request_type:"BAD"} 既有实现同样放行到
// 日期解析那一步（回放里返回的是日期解析错误，不是类型无效）。文案里虽然列了合法值，
// 但它起的是提示作用，不是白名单 —— 这点不能凭直觉扩成枚举校验。
func (s *Server) prepareAttendanceRequest(w http.ResponseWriter, data map[string]any) bool {
	if text(data, "request_type") == "" {
		businessFailure(w, errors.New("申请类型无效（leave 请假 / overtime 加班）"), false)
		return false
	}
	start := text(data, "start_date")
	if start == "" {
		businessFailure(w, errors.New("开始日期不能为空"), false)
		return false
	}
	// 既有实现错误信息里的 layout 是 RFC3339（无纳秒），与本实现默认的 RFC3339Nano 不同。
	if _, err := time.Parse(time.RFC3339, start); err != nil {
		fail(w, 400, "参数错误: "+err.Error())
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// 期初余额：既有实现校验顺序是 period 格式 → entries 非空 → 科目存在
// ---------------------------------------------------------------------------

// prepareOpeningBalances 复刻既有实现期初余额的入参校验。
//
// 回放 OO 三条定序证据（period 一律用 2099-12，避免覆盖真实期初余额）：
//
//	{period:"BAD"}                              → 200/10000「期间格式错误，应为 YYYY-MM」
//	{period:"2099-12"}                          → 200/10000「期初余额分录不能为空」
//	{period:"2099-12",entries:[{account_id:NIL}]} → 200/10000「会计科目不存在」
//
// 关键结论：既有实现**不校验期间是否存在**（2099-12 并不存在，却一路走到了科目检查）。
// 本实现原来第一句就是 SELECT status FROM accounting_periods，期间不存在时把
// `sql.ErrNoRows` 的原文「sql: no rows in result set」回给了客户端。
func (s *Server) prepareOpeningBalances(w http.ResponseWriter, data map[string]any) bool {
	period := text(data, "period")
	if !ooPeriodRe.MatchString(period) {
		businessFailure(w, errors.New("期间格式错误，应为 YYYY-MM"), false)
		return false
	}
	raw, _ := data["entries"].([]any)
	if len(raw) == 0 {
		businessFailure(w, errors.New("期初余额分录不能为空"), false)
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// 审批流：既有实现缺必填字段时不暴露 SQL，本实现必须同样收口
// ---------------------------------------------------------------------------

// prepareApprovalFlow 复刻既有实现审批流建单的必填校验。
//
// 回放 OO：{code,name,biz_type} 齐全时两端都是 200/code0；缺任意一个既有实现 500。
// 500 按铁律④不作语义证据，但本实现原来返回的是
// `200/10000 constraint failed: NOT NULL constraint failed: approval_flows.code (1299)`
// —— 把建表约束名直接回给客户端。这里对齐成既有实现的裸 500 + 通用文案：
// 文案是既有实现逐字（回放已取到），状态码也是既有实现的 500。
func (s *Server) prepareApprovalFlow(w http.ResponseWriter, data map[string]any) bool {
	missing := ""
	switch {
	case text(data, "code") == "":
		missing = "code"
	case text(data, "name") == "":
		missing = "name"
	case text(data, "biz_type") == "":
		missing = "biz_type"
	}
	if missing != "" {
		businessFailure(w, business.ErrKnownNoMessage{
			Status: 500,
			Note:   "系统内部错误，请稍后重试或联系管理员",
		}, false)
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// 门户：既有实现商品/分类必须持客户 token，本实现原来完全不鉴权
// ---------------------------------------------------------------------------

// ooPortalCustomer 校验门户客户 token，失败时按既有文案回 401 并返回 false。
//
// 回放 OO（audit-batch-oo-shapes-20261015.json）：
//
//	GET /portal/categories 无 token   → 401「登录状态无效」
//	GET /portal/categories 主 token   → 401「非客户登录，无权访问门户」
//
// 本实现原来直接返回 200 + 数据，等于**门户商品与分类对匿名开放**。
// 注意 /portal/orders 原本就有鉴权，文案是「客户登录已失效」（另一条文案，不动）。
func (s *Server) ooPortalCustomer(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	// 「无 token」实际有三种形态，都要算无 token，否则会错报成「非客户登录」：
	//   完全不带 Authorization 头 / 头为空 / 头只有 "Bearer"（尾随空格会被 HTTP 层吃掉）。
	// 回放时 curl -H "Authorization: Bearer " 命中的正是第三种。
	raw := strings.TrimSpace(r.Header.Get("Authorization"))
	token := strings.TrimSpace(strings.TrimPrefix(raw, "Bearer"))
	if token == "" || strings.EqualFold(raw, "Bearer") {
		fail(w, 401, "登录状态无效")
		return nil, false
	}
	_, customer, err := s.Auth.AuthenticateCustomer(r.Context(), token)
	if err != nil || customer == nil {
		// 带上 token 但不是客户 token（主站用户/过期令牌）统一走这一条，
		// 与回放到的主 token 形态一致；不细分是为了不自造第三种文案。
		fail(w, 401, "非客户登录，无权访问门户")
		return nil, false
	}
	return customer, true
}

// ---------------------------------------------------------------------------
// auth/refresh：缺 refresh_token 走 gin 的 required 形态
// ---------------------------------------------------------------------------

// ooRefreshRequired 复刻 gin binding 对 RefreshRequest.RefreshToken 的 required 校验。
//
// 回放 OO：POST /auth/refresh {} → 400
//
//	请求参数错误: Key: 'RefreshRequest.RefreshToken' Error:Field validation
//	for 'RefreshToken' failed on the 'required' tag
//
// 而 {refresh_token:"bad"} 两端一致（401「刷新令牌无效或已过期」）—— 说明只有
// **字段缺失**走 validator，值不对走业务分支，两者不能合并。
// （形态与 transfers.go 的 transferRequired 同族，文案逐字来自回放。）
func ooRefreshRequired(w http.ResponseWriter, data map[string]any) bool {
	if _, ok := data["refresh_token"]; !ok {
		fail(w, 400, "请求参数错误: Key: 'RefreshRequest.RefreshToken' Error:Field validation for 'RefreshToken' failed on the 'required' tag")
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// 固定响应：既有实现把这些子路径当作 {id} 处理，本实现通用注册器却给了别的语义
// ---------------------------------------------------------------------------

// ooRegisterFixedHandlers 注册既有实现有固定响应、而本实现会走错分支的子路径。
//
// 回放 OO：
//
//	PUT|DELETE /attendance-requests/summary      → 400「无效的考勤申请ID」
//	PUT|DELETE /assemblies/bom-components        → 400「无效的组装单ID」
//
// 这两条都是探针打到「集合下的子路径」上，既有实现把它当 /{id} 解析，id 不是合法 UUID
// 就回上述文案。本实现的通用注册器把 summary / bom-components 当独立资源注册了
// PUT/DELETE，于是跑出了 200/10000 或 404 的另一种形态。
// 前端两者都不调用（frontend/src/api 只用了 GET），所以这里只对齐形态。
func (s *Server) ooRegisterFixedHandlers() {
	s.mux.Handle("PUT /api/v1/attendance-requests/summary", s.protected("attendance_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail(w, 400, "无效的考勤申请ID")
	})))
	s.mux.Handle("DELETE /api/v1/attendance-requests/summary", s.protected("attendance_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail(w, 400, "无效的考勤申请ID")
	})))
	s.mux.Handle("PUT /api/v1/assemblies/bom-components", s.protected("assembly", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail(w, 400, "无效的组装单ID")
	})))
	s.mux.Handle("DELETE /api/v1/assemblies/bom-components", s.protected("assembly", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail(w, 400, "无效的组装单ID")
	})))
}
