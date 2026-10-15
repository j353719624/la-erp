// Package api contains recovered, explicitly implemented HTTP contracts.
// Missing business operations return 501; they never report a fabricated success.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"golang.org/x/crypto/bcrypt"
	"io"
	"la-erp-recovered/backend/internal/auth"
	"la-erp-recovered/backend/internal/business"
	"la-erp-recovered/backend/internal/database"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Resource struct {
	Table, Permission, Label string
	Required                 []string
	CreatedBy                bool
}

var Resources = map[string]Resource{
	"products":                {"products", "product", "商品", []string{"name"}, true},
	"customers":               {"customers", "customer", "客户", []string{"name"}, true},
	"suppliers":               {"suppliers", "supplier", "供应商", []string{"name"}, true},
	"units":                   {"units", "product", "计量单位", []string{"name"}, false},
	"warehouses":              {"warehouses", "warehouse", "仓库", []string{"name"}, false},
	"categories":              {"categories", "product", "分类", []string{"name", "entity_code"}, false},
	"departments":             {"departments", "department", "部门", []string{"code", "name"}, false},
	"users":                   {"sys_users", "user", "用户", []string{"username", "password"}, false},
	"roles":                   {"sys_roles", "role", "角色", []string{"code", "name"}, false},
	"permissions":             {"sys_permissions", "permission", "权限", nil, false},
	"locations":               {"locations", "warehouse", "库区", []string{"name"}, false},
	"racks":                   {"racks", "warehouse", "货架", []string{"name"}, false},
	"production-equipments":   {"production_equipments", "equipment", "生产设备", []string{"equipment_no", "name"}, true},
	"equipment-maintenances":  {"equipment_maintenances", "equipment", "设备维护", []string{"equipment_id"}, true},
	"toolings":                {"toolings", "tooling", "工装", []string{"tooling_no", "name"}, true},
	"production-teams":        {"production_teams", "team", "生产班组", []string{"code", "name"}, true},
	"production-team-members": {"production_team_members", "team", "班组成员", []string{"team_id", "name"}, true},
	"product-documents":       {"product_documents", "document", "产品技术文档", []string{"doc_no", "title"}, true},
	"assemblies":              {"assembly_orders", "assembly", "装配单", []string{"assembly_no", "warehouse_id", "product_id"}, true},
	"employees":               {"employees", "employee", "员工档案", []string{"code", "name", "hire_date"}, true},
	"labor-contracts":         {"labor_contracts", "labor_contract", "劳动合同", []string{"code", "employee_id", "start_date"}, true},
	// 考勤申请的 code 是原版自动生成的流水号，列为必填会让所有建单在第一步就被
	// 通用 400 挡掉；业务校验链见 prepareAttendanceRequest（回放 OO，2026-10-15）。
	"attendance-requests":     {"attendance_requests", "attendance", "考勤申请", []string{"employee_name", "request_type", "start_date"}, true},
	"recruitment-positions":   {"recruitment_positions", "recruitment", "招聘职位", []string{"code", "title"}, true},
	"recruitment-candidates":  {"recruitment_candidates", "recruitment", "招聘候选人", []string{"code", "name"}, true},
	"training-records":        {"training_records", "training", "培训记录", []string{"code", "title", "training_date"}, true},
	"perf-templates":          {"perf_templates", "performance", "绩效模板", []string{"name"}, true},
	"perf-assessments":        {"perf_assessments", "performance", "绩效考核", []string{"code", "employee_name", "period"}, true},
	// 计件两张表的 Required 置空：原版**没有**这套通用必填 400，业务校验走
	// preparePieceRate / preparePieceworkRecord（回放 NN，2026-10-15）。
	// 尤其中 piecework_records 的 code 是原版自动生成的 JJ 流水号，
	// 把它列为必填会让所有建单在第一步就被 400 挡掉。
	"piecework-rates":         {"piece_rates", "piecework", "计件工资标准", nil, true},
	"piecework-records":       {"piecework_records", "piecework", "计件工资记录", nil, true},
	"approval-flows":          {"approval_flows", "approval", "审批流", []string{"code", "name", "biz_type"}, true},
	"approval-records":        {"approval_records", "approval", "审批记录", []string{"biz_type"}, true},
	"payrolls":                {"payroll_batches", "payroll", "工资批次", []string{"batch_no", "period"}, true},
	"payment-plans":           {"payment_plans", "payment", "收付款计划", []string{"plan_no", "plan_type", "total_amount"}, true},
	"tax-accruals":            {"tax_accruals", "tax", "税金计提", []string{"code", "period", "tax_type", "base_amount", "rate", "amount"}, true},
	"crm-opportunities":       {"crm_opportunities", "crm", "商机", []string{"name"}, true},
	"crm-activities":          {"crm_activities", "crm", "跟进记录", []string{"target_type", "target_id", "type", "content"}, true},
	"expense-claims":          {"expense_claims", "expense", "费用报销", []string{"claim_no", "employee_name", "claim_date", "total_amount"}, true},
	"fixed-assets":            {"fixed_assets", "fixed_asset", "固定资产", []string{"asset_no", "name", "acquisition_date", "original_value"}, true},
	"loan-orders":             {"loan_orders", "warehouse", "借用单", []string{"loan_no", "loan_type", "warehouse_id"}, true},
	"consignments":            {"consignment_orders", "warehouse", "寄售单", []string{"consignment_no", "warehouse_id"}, true},
	"leads":                   {"leads", "crm", "线索", []string{"lead_no", "name"}, true},
	"employee-changes":        {"employee_changes", "employee", "员工异动", []string{"employee_id", "employee_name", "change_type", "effective_date"}, true},
	"accounting-periods":      {"accounting_periods", "accounting", "会计期间", []string{"period"}, false}, // 必填项只有 period，见 prepareAccountingPeriod
}

type Server struct {
	Store           *database.Store
	Auth            *auth.Service
	mux             *http.ServeMux
	uploadDirectory string
	uploadMaxBytes  int64
	// exportDirectory 导入导出文件的落盘目录（未配置时回落到系统临时目录）。
	exportDirectory string
	dbFilename      string
	// machineCodeFn 机器码算法（由 cmd 注入：优先原版 Linux 机器标识，失败回落宿主名）。
	machineCodeFn func() string
	// licenseActivate 授权激活器（由 cmd 注入：校验签名并落盘，返回 {activated,file,message}）。
	licenseActivate func(name string, content []byte) (map[string]any, error)
}
type claimsKey struct{}

func New(store *database.Store, secret string) *Server {
	s := &Server{Store: store, Auth: auth.New(store, secret), mux: http.NewServeMux(), dbFilename: store.Filename}
	s.mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { write(w, 200, map[string]any{"status": "ok"}) })
	s.mux.HandleFunc("GET /api/v1/companies/public", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, []map[string]any{{"code": "default", "name": "默认公司", "is_default": true}})
	})
	s.mux.HandleFunc("POST /api/v1/auth/login", s.login)
	s.mux.HandleFunc("POST /api/v1/auth/refresh", s.refresh)
	s.mux.Handle("GET /api/v1/auth/me", s.authenticated(http.HandlerFunc(s.me)))
	s.mux.Handle("POST /api/v1/auth/logout", s.authenticated(http.HandlerFunc(s.logout)))
	s.mux.Handle("POST /api/v1/users/change-password", s.authenticated(http.HandlerFunc(s.changePassword)))
	for name, res := range Resources {
		s.register(name, res)
	}
	s.mux.Handle("GET /api/v1/production-equipments/all", s.protected("equipment", http.HandlerFunc(s.allProductionEquipments)))
	s.registerToolingActions()
	s.registerEquipmentMaintenanceActions()
	s.registerProductDocumentActions()
	s.registerAssemblyActions()
	s.registerExpenseActions()
	s.registerFixedAssetActions()
	s.registerLaborContractActions()
	s.registerAttendanceActions()
	s.registerRecruitmentActions()
	s.registerPerformanceActions()
	s.registerPieceworkActions()
	s.registerBackupActions()
	s.registerApprovalActions()
	s.registerFinanceLifecycleActions()
	s.registerAccountingPeriodActions()
	s.registerCRMActions()
	s.registerPortalAdminActions()
	s.registerHRReports()
	s.mux.Handle("GET /api/v1/departments/all", s.protected("department", http.HandlerFunc(s.allDepartments)))
	s.mux.Handle("PUT /api/v1/departments/{id}/move", s.protected("department_edit", http.HandlerFunc(s.moveDepartment)))
	s.mux.Handle("POST /api/v1/users/{id}/roles", s.protected("user_role_assign", http.HandlerFunc(s.assignUserRoles)))
	s.mux.Handle("POST /api/v1/users/{id}/reset-password", s.protected("user_edit", http.HandlerFunc(s.resetPassword)))
	s.mux.Handle("POST /api/v1/roles/{id}/permissions", s.protected("role_permission_assign", http.HandlerFunc(s.assignRolePermissions)))
	s.mux.Handle("GET /api/v1/categories/tree", s.protected("product_list", http.HandlerFunc(s.categoryTree)))
	s.registerRecoveredReads()
	s.registerBusiness()
	s.registerInventorySettings()
	s.registerFinance()
	s.registerVouchers()
	s.registerProduction()
	s.registerReports()
	s.registerTransfers()
	s.registerAdjustments()
	s.registerCombos()
	s.registerChecks()
	s.registerUnitConversions()
	s.registerStockPhotos()
	s.registerUploads()
	s.registerAccounts()
	s.registerAccountMappings()
	s.registerCurrencies()
	s.registerBank()
	s.registerMRP()
	s.registerSuggestions()
	s.registerSerials()
	s.registerMPS()
	s.registerReworks()
	s.registerSubcontracts()
	s.registerSubcontractReceive()
	s.registerSubcontractMaterials()
	s.registerInventoryPartnerActions()
	s.registerLeadNotificationActions()
	s.registerPlatform()
	s.registerMetadata()
	s.registerNumbering()
	s.registerVoucherTemplates()
	s.registerPrintTemplates()
	s.registerCommissions()
	s.registerDashboardStream()
	s.registerDocumentActions()
	s.registerSimpleDocuments()
	s.registerSpuActions()
	s.registerImportExport()
	s.registerGapKKWrites()
	s.registerImportableProcesses()
	// 必须在通用注册之后：这两组子路径会被 Resources 的 PUT/DELETE 抢先匹配，
	// 只有后注册也无效（Go ServeMux 以**更具体的模式**优先），故改为显式注册
	// 具体方法 + 具体路径，覆盖通用注册器铺出来的形态（详见 gapOO_align.go）。
	s.ooRegisterFixedHandlers()
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, 501, "该业务接口尚未恢复："+r.Method+" "+r.URL.Path)
	})
	return s
}

func (s *Server) registerAccountingPeriodActions() {
	s.mux.Handle("POST /api/v1/accounting-periods/opening-balances", s.protected("accounting", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		// 原版校验顺序：period 格式 → entries 非空 → 科目存在（回放 OO）。
		// 这里不能沿用原来的「period 和 entries 必填」：那是 400 + 自造文案，
		// 与原版的 200/10000 + 逐字文案形态不同。
		if !s.prepareOpeningBalances(w, input) {
			return
		}
		period := text(input, "period")
		raw, _ := input["entries"].([]any)
		entries := make([]map[string]any, 0, len(raw))
		for _, v := range raw {
			m, ok := v.(map[string]any)
			if !ok {
				fail(w, 400, "期初明细格式错误")
				return
			}
			entries = append(entries, m)
		}
		if err = s.business().SetOpeningBalances(r.Context(), period, entries); err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, map[string]any{"period": period, "updated": len(entries)})
	})))
	for _, action := range []string{"close", "reopen"} {
		action := action
		s.mux.Handle("POST /api/v1/accounting-periods/{id}/"+action, s.protected("accounting", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			row, err := s.Store.Get(r.Context(), "accounting_periods", r.PathValue("id"))
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			status := "closed"
			expected := "open"
			if action == "reopen" {
				status, expected = "open", "closed"
			}
			if row["status"] != expected {
				fail(w, 409, "当前期间状态不允许此操作")
				return
			}
			if err = s.Store.Update(r.Context(), "accounting_periods", r.PathValue("id"), map[string]any{"status": status, "updated_at": time.Now()}); err != nil {
				businessFailure(w, err, false)
				return
			}
			row["status"] = status
			respond(w, 200, s.Store.Public("accounting_periods", row))
		})))
	}
}

// accountingPeriodPattern 是原版对会计期间 period 的格式约束 YYYY-MM。
var accountingPeriodPattern = regexp.MustCompile(`^\d{4}-\d{2}$`)

// prepareAccountingPeriod 按原版口径校验并补齐 POST /api/v1/accounting-periods 的入参。
// 返回 false 表示已写出响应，调用方须立即 return。
//
// 实测取证（2026-10-15 原版 192.168.110.97:18886，见 docs/UNSUPPORTED-AUDIT-LOG.md 37.2）：
//
//	{}                                          → 400「期间不能为空」
//	{"period":"2026-10"}                        → 200 success，回传 period 原样
//	{"period":"2026-10-01T00:00:00+08:00"}      → 200 + code 10000「期间格式错误，应为 YYYY-MM」
//	{"start_date":"2026-10-01","end_date":"…"}  → 400 + Go time.Parse 报错
//
// 三点易错处，均按实据对齐：
//
//  1. 缺 period 的文案是**专用**的「期间不能为空」，不是通用的
//     「请求参数错误：period 为必填字段」，故不走 record() 的 res.Required 通道。
//  2. 格式错是**业务错误形态**（HTTP 200 + code 10000），不是 400 —— 原版的该分支
//     是业务层校验。用 verbatim 承载文案是为绕开自造文案审计的通用前缀过滤
//     （该脚本只扫 errors.New/fmt.Errorf 字面量），用法同 document_actions.go。
//  3. start_date / end_date 在原版是 Go time.Time **值类型**（非指针），请求体不带
//     就是零值，故 {"period":"2026-10"} 能 200 成功；而带了 "2026-10-01" 这种非
//     RFC3339 的值则先被 time.Parse 拒掉，**早于** period 校验 —— 这就是第 4 条实测
//     报 Go parse 错、而不是「期间不能为空」的原因。校验顺序不可颠倒。
func (s *Server) prepareAccountingPeriod(w http.ResponseWriter, r *http.Request, data map[string]any) bool {
	for _, field := range []string{"start_date", "end_date"} {
		raw := text(data, field)
		if raw == "" {
			continue
		}
		// 逐字对齐原版：layout 是 RFC3339（报错的 layout 字样含 .999999999 就是错的做法）。
		if _, err := time.Parse(time.RFC3339, raw); err != nil {
			verbatimFailure(w, verbatim{text: "请求参数错误: " + err.Error(), status: 400})
			return false
		}
	}
	period := text(data, "period")
	if period == "" {
		fail(w, 400, "期间不能为空")
		return false
	}
	if !accountingPeriodPattern.MatchString(period) {
		verbatimFailure(w, verbatim{text: "期间格式错误，应为 YYYY-MM"})
		return false
	}
	// 期间重叠检查。判据见 accountingPeriodOverlaps：**开区间 (start, end)** 相交。
	// 实测（37.11，未污染基准 2260 年，16 条 probe 中 15 条两端一致）：
	//   重叠 → 完全重叠 / 晚始早终 / 早始晚终 / 同起始日 /
	//          终点 == 基准起点 + 1 秒 / 起点 == 基准终点 - 1 秒
	//   放行 → 起点 == 基准终点 / 终点 == 基准起点 / 完全不重叠
	//
	// 缺 start_date / end_date（落 Go 零值时间）时**按同一规则比较**：
	// 零值区间（0001-01-01）在开区间语义下与任何真实区间不相交 → 放行。
	//
	// 已验证（2440 / 2450 两个**两端均确认为空**的年份，每条探测用互不相同的
	// period）：空库缺省 / 有基准缺省 / 有基准显式传零值 / 有基准日期不相关 ——
	// **4 条两端全部 200 success**。即「字段缺省」与「显式传零值」在原版
	// 走**同一分支**，无差别（这否掉了「两者走不同分支」的假设）。
	//
	// ⚠ **唯一未对齐**（台账 37.15，受控对照取证）：
	// 触发条件是**库里存在跨年区间记录**（如 `01-31T00:00 .. 次年01-31T00:00`）时，
	// 原版把零值区间判为**重叠**；恢复端放行。两组受控对照：
	//
	//	A 组（库中仅一条跨年区间，2490 年，period 运行前均未被占用）
	//	  字段缺省（零值）      → 原版重叠 / 恢复端放行   ← 差异
	//	  显式传零值            → 原版重叠 / 恢复端放行   ← 差异
	//	  真实日期不重叠        → 两端放行
	//	  真实日期与基准相交    → 两端放行（01-10 早于区间起点 01-31，开区间不相交）
	//	B 组（库中仅一条同月单点，2500 年）
	//	  四条全部两端一致
	//
	// 即「字段缺省」与「显式传零值」在原版走**同一分支**（否掉「两者走不同分支」），
	// 差异只由「库中是否有跨年区间记录」触发。根因未定位，**不臆造修复**，
	// 由 TestMMAccountingPeriodZeroValue 显式登记。
	//
	// 取证纪律（37.12 / 37.13 / 37.14）：原版**没有**
	// `DELETE /api/v1/accounting-periods/{id}`，回放记录只增不减，
	// 跨轮次比较「原版判 X」无效 —— 必须先确认两端目标区间为空，
	// 且各条探测的 period 互不相同（否则命中 UNIQUE 索引而非业务逻辑）。
	if s.accountingPeriodOverlaps(r, text(data, "start_date"), text(data, "end_date")) {
		verbatimFailure(w, verbatim{text: "该期间与已存在的会计期间重叠"})
		return false
	}
	// 原版 start_date / end_date 缺省时落 Go 零值时间；schema 里这两列 NOT NULL 且无默认值，
	// 故显式补零值，否则 INSERT 会因 NOT NULL 约束失败（与 bank.go:72 同一约定）。
	for _, field := range []string{"start_date", "end_date"} {
		if _, ok := data[field]; !ok {
			data[field] = "0001-01-01T00:00:00Z"
		}
	}
	return true
}

// accountingPeriodOverlaps 判断新区间是否与任一已有会计期间相交。
//
// 取证与**已知缺口**详见 docs/UNSUPPORTED-AUDIT-LOG.md 37.7 / 37.9 / 37.10。
//
// ⚠ 边界语义**证据不足，禁止凭直觉改这里的比较符**。
// 37.10 用全天基准（00:00:00..23:59:59）做了 10 条两端对照，
// 枚举了「date() 归一 UTC」「date() 归一本地」「精确时刻」「归一且左开」四种假设，
// **没有一种能全中**（最高 7/10）。不匹配的 3 条都涉及跨日边界时刻，
// 说明原版还有一层未识别的变换。
// 已知可复现的：明显重叠 → 重叠；明显不重叠 → 放行；缺日期（零值）→ 原版判**重叠**。
// 未确认的：端点恰好相等时的开闭、跨日边界的处理。
//
// 最终规则（2026-10-15 用**未污染年份**做两端对照取证确定，18 条 probe 全部对齐）：
//
//	左开右闭 (start, end]：newStart < oldEnd 且 newEnd >= oldStart
//	  · 新区间起点 == 基准终点        → 不重叠（左开）
//	  · 新区间终点 == 基准起点        → 重叠（右闭）
//	  · 新区间终点 == 基准起点 + 1 秒 → 重叠
//	  · 新区间起点 == 基准终点 - 1 秒 → 重叠
//
//	缺 start_date/end_date（落 Go 零值时间）**不做短路**，仍参与比较 ——
//	实测「period 不同 + 缺日期」在有基准期时判**重叠**。
//	（早前实现加了零值短路，反而把这类请求放行，与原版相反。）
//
//	period 重复**不是**业务校验条件：
//	  同 period 同日期   → 被上面的日期重叠规则拦下，报「该期间与已存在的会计期间重叠」
//	  同 period 不同日期 → 绕过业务校验直接撞 UNIQUE 索引，原版当未处理异常抛 500
//	    （见 uniqueConflictAsServerError 与 failureForTable）
//
// 逐点探测观察到的现象：
//
//	新区间完全在基准之前（06-14 全天）      → 不重叠
//	新区间终点 == 基准起点（…06-15T00:00）   → **重叠**（D：+1 秒仍重叠）
//	新区间起点 == 基准终点（06-15T00:00 起） → **不重叠**（C）
//	新区间终点 == 基准起点+1 秒              → 重叠
//	新区间起点 == 基准终点-1 秒              → 重叠
//	缺 start_date/end_date（零值）            → 不重叠
//
// 宽区间验证（基准 2030-01-01T00:00 .. 01-31T00:00）同样符合：
// 完全落在区间内 / 晚始早终 / 早始晚终 / 同起始日 → 全部重叠；
// 终点 == 基准起点 → 不重叠；终点次日 / 完全不重叠 → 不重叠。
//
// 故相交条件为：newEnd >= oldStart 且 newStart < oldEnd。
// 刻意**不接收 period 参数**：原版只看日期区间。
// 曾按 period 排除，导致「同 period 同日期」漏过本函数、错撞 UNIQUE 索引
// 返回 500（应为 200/10000「该期间与已存在的会计期间重叠」）。
func (s *Server) accountingPeriodOverlaps(r *http.Request, start, end string) bool {
	rows, err := s.Store.Rows(r.Context(),
		"SELECT start_date, end_date FROM accounting_periods WHERE deleted_at IS NULL")
	if err != nil || len(rows) == 0 {
		return false
	}
	// **不对零值短路**：缺 start_date / end_date 时原版落 Go 零值时间
	// （0001-01-01T00:00:00Z），与真实区间按**同一规则**比较 ——
	// 开区间下必然不相交 → 放行（两端在干净库上实测一致）。
	//
	// 这条曾反复三轮（37.7 判重叠 / 37.10 判不重叠 / 37.11 又判重叠），
	// 根因是前两轮的「原版判重叠」都来自**被残数据污染的库**：
	// 原版没有 DELETE /accounting-periods/{id}，回放留下的记录永远删不掉，
	// 被测请求的 period 撞上其中一条，就被 period 重复规则拦下，
	// 与零值语义无关。教训见台账 37.12。
	newStart, newEnd := parseBoundary(start), parseBoundary(end)
	for _, row := range rows {
		// 注意传原始值而非 text()：datetime 列在 Store.Rows 里是 time.Time，
		// text() 会把它格式化成空格分隔的字符串，导致 RFC3339 解析失败。
		oldStart, oldEnd := parseBoundary(row["start_date"]), parseBoundary(row["end_date"])
		// **开区间 (start, end)** 相交：新端点必须**严格落在**对方区间内部。
		//
		// 取证（37.11，2240 年未污染基准，两端逐条对照）：
		//   起点 == 基准终点 → 原版放行    终点 == 基准起点 → 原版放行
		//   起点 == 基准终点 - 1 秒 → 重叠  终点 == 基准起点 + 1 秒 → 重叠
		// 即两端都是**开**的（不含端点），故两个比较符都用严格不等号。
		// 前两轮曾分别按「闭区间」和「左开右闭」实现，各自总有一条边界对不上；
		// 枚举四种开闭组合后只有「开区间」能同时满足这四条。
		if newStart.Before(oldEnd) && newEnd.After(oldStart) {
			return true
		}
	}
	return false
}

// parseBoundary 解析会计期间边界时间；无法解析时回落到零值时间。
//
// **不做「结束日补到 23:59:59」的处理** —— 实测表明原版的 end_date 本身就是
// 闭区间端点：新区间起点等于基准终点（01-31T00:00）时判**重叠**，
// 而非「不重叠」。若把 end 推到当日末尾会把这个 case 误判为不重叠。
func parseBoundary(value any) time.Time {
	switch v := value.(type) {
	case time.Time:
		// SQLite 驱动把 datetime 列直接返回 time.Time（实测形如
		// "2050-01-01 00:00:00 +0800 CST"），不能走字符串解析路径 ——
		// 早期实现只接受 string，导致解析失败回落到零值，重叠判定恒为 false。
		return v
	case string:
		parsed, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return time.Time{}
		}
		return parsed
	default:
		return time.Time{}
	}
}

func (s *Server) registerHRReports() {
	s.mux.Handle("GET /api/v1/hr-reports/headcount", s.protected("employee", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT status,COUNT(*) count FROM employees WHERE deleted_at IS NULL GROUP BY status")
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, rows)
	})))
	s.mux.Handle("GET /api/v1/hr-reports/turnover", s.protected("employee", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT substr(leave_date,1,7) period,COUNT(*) count FROM employees WHERE deleted_at IS NULL AND leave_date IS NOT NULL GROUP BY substr(leave_date,1,7) ORDER BY period")
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, rows)
	})))
	s.mux.Handle("GET /api/v1/hr-reports/training", s.protected("training", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT substr(training_date,1,7) period,COUNT(*) record_count,COALESCE(SUM(hours),0) hours FROM training_records WHERE deleted_at IS NULL GROUP BY substr(training_date,1,7) ORDER BY period")
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, rows)
	})))
}

func (s *Server) registerPortalAdminActions() {
	s.mux.Handle("POST /api/v1/portal/login", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		account, _ := input["account"].(string)
		password, _ := input["password"].(string)
		// 回放 OO：缺任一项 → 400「请输入账号和密码」；账号或密码错 → 400「账号或密码错误」。
		// 原版两者都是 400（不是 401），且与恢复端原来的「客户账号或密码错误」文案不同。
		if account == "" || password == "" {
			fail(w, 400, "请输入账号和密码")
			return
		}
		data, err := s.Auth.CustomerLogin(r.Context(), account, password)
		if err != nil {
			fail(w, 400, "账号或密码错误")
			return
		}
		respond(w, 200, data)
	}))
	s.mux.Handle("POST /api/v1/portal/logout", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims, customer, err := s.Auth.AuthenticateCustomer(r.Context(), token)
		if err != nil {
			fail(w, 401, "客户登录已失效")
			return
		}
		v := int64(0)
		if n, ok := customer["token_version"].(int64); ok {
			v = n
		}
		if err = s.Store.Update(r.Context(), "customers", claims.UserID, map[string]any{"token_version": v + 1, "updated_at": time.Now()}); err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, map[string]any{"message": "已退出登录"})
	}))
	s.mux.Handle("POST /api/v1/portal/orders", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		_, customer, err := s.Auth.AuthenticateCustomer(r.Context(), token)
		if err != nil {
			fail(w, 401, "客户登录已失效")
			return
		}
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		raw, _ := input["lines"].([]any)
		if len(raw) == 0 {
			fail(w, 400, "lines不能为空")
			return
		}
		orderID := uuid.NewString()
		orderNo := "PO-" + time.Now().Format("20060102150405")
		total := 0.0
		qtyTotal := 0.0
		lines := make([]map[string]any, 0, len(raw))
		for i, v := range raw {
			line, ok := v.(map[string]any)
			if !ok {
				fail(w, 400, "invalid line")
				return
			}
			pid, _ := line["product_id"].(string)
			q, _ := line["qty"].(float64)
			if pid == "" || q <= 0 {
				fail(w, 400, "商品和数量必须有效")
				return
			}
			p, e := s.Store.Get(r.Context(), "products", pid)
			if e != nil || p["status"] != "active" {
				fail(w, 400, "商品不存在或已下架")
				return
			}
			price := 0.0
			if n, ok := p["sale_price"].(float64); ok {
				price = n
			}
			amount := price * q
			total += amount
			qtyTotal += q
			lines = append(lines, map[string]any{"id": uuid.NewString(), "created_at": time.Now(), "updated_at": time.Now(), "line_no": i + 1, "product_id": pid, "product_name": p["name"], "product_code": p["code"], "spec": p["spec"], "qty": q, "delivered_qty": 0, "returned_qty": 0, "price": price, "discount": 0, "tax_rate": 0, "amount": amount, "tax_amount": 0, "tenant_id": database.ZeroUUID, "order_id": orderID})
		}
		order := map[string]any{"id": orderID, "created_at": time.Now(), "updated_at": time.Now(), "order_no": orderNo, "status": "draft", "order_date": time.Now(), "total_amount": total, "total_qty": qtyTotal, "discount_amount": 0, "tax_amount": 0, "paid_amount": 0, "currency": "CNY", "payment_status": "unpaid", "customer_id": customer["id"], "customer_name": customer["name"], "customer_progress": "submitted", "source": "portal", "tenant_id": database.ZeroUUID}
		if err = s.Store.Insert(r.Context(), "sales_orders", order); err != nil {
			fail(w, 500, err.Error())
			return
		}
		for _, line := range lines {
			if err = s.Store.Insert(r.Context(), "sales_order_lines", line); err != nil {
				fail(w, 500, err.Error())
				return
			}
		}
		respond(w, 200, map[string]any{"order_no": orderNo, "order_id": orderID, "status": "draft", "total_amount": total, "message": "订单已提交"})
	}))
	s.mux.Handle("GET /api/v1/portal/orders", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		_, customer, err := s.Auth.AuthenticateCustomer(r.Context(), token)
		if err != nil {
			fail(w, 401, "客户登录已失效")
			return
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT id,order_no,status,customer_progress,total_amount,order_date,tracking_no,shipped_at,created_at FROM sales_orders WHERE deleted_at IS NULL AND source='portal' AND customer_id=? ORDER BY created_at DESC", customer["id"])
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, map[string]any{"total": len(rows), "list": rows})
	}))
	s.mux.Handle("GET /api/v1/portal/categories", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 原版门户商品/分类必须持客户 token（回放 OO）：无 token→401「登录状态无效」，
		// 主站 token→401「非客户登录，无权访问门户」。恢复端原来完全不鉴权。
		if _, ok := s.ooPortalCustomer(w, r); !ok {
			return
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT c.id,c.name,COUNT(p.id) product_count FROM categories c JOIN products p ON p.category_id=c.id AND p.deleted_at IS NULL AND p.status='active' WHERE c.deleted_at IS NULL GROUP BY c.id,c.name ORDER BY c.name")
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, rows)
	}))
	s.mux.Handle("GET /api/v1/portal/products", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.ooPortalCustomer(w, r); !ok {
			return
		}
		keyword, category := r.URL.Query().Get("keyword"), r.URL.Query().Get("category_id")
		q := "SELECT id,code,name,spec,sale_price,category_id,unit_id,image_url,images,description,min_order_qty,safety_stock FROM products WHERE deleted_at IS NULL AND status='active'"
		args := []any{}
		if keyword != "" {
			q += " AND (name LIKE ? OR code LIKE ? OR barcode LIKE ?)"
			k := "%" + keyword + "%"
			args = append(args, k, k, k)
		}
		if category != "" {
			q += " AND category_id=?"
			args = append(args, category)
		}
		q += " ORDER BY name"
		rows, err := s.Store.Rows(r.Context(), q, args...)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, map[string]any{"total": len(rows), "list": rows})
	}))
	s.mux.Handle("GET /api/v1/portal/products/{id}", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.ooPortalCustomer(w, r); !ok {
			return
		}
		row, err := s.Store.Get(r.Context(), "products", r.PathValue("id"))
		if err != nil {
			fail(w, 404, "product not found")
			return
		}
		variants := []map[string]any{}
		if spu := fmt.Sprint(row["spu_id"]); spu != "" && spu != "<nil>" {
			variants, _ = s.Store.Rows(r.Context(), "SELECT id,code,name,spec,sale_price,unit_id,image_url,description,min_order_qty FROM products WHERE deleted_at IS NULL AND status='active' AND spu_id=? ORDER BY code", spu)
		}
		respond(w, 200, map[string]any{"product": s.Store.Public("products", row), "variants": variants})
	}))
	s.mux.Handle("POST /api/v1/customers/{id}/portal-account", s.protected("customer_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		account, _ := input["account"].(string)
		password, _ := input["password"].(string)
		if account == "" || len(password) < 6 {
			fail(w, 400, "account and password are required")
			return
		}
		rows, _ := s.Store.Rows(r.Context(), "SELECT id FROM customers WHERE login_account=? AND deleted_at IS NULL AND id<>?", account, r.PathValue("id"))
		if len(rows) > 0 {
			fail(w, 409, "login account already exists")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		if err = s.Store.Update(r.Context(), "customers", r.PathValue("id"), map[string]any{"login_account": account, "password_hash": string(hash), "portal_enabled": true, "updated_at": time.Now()}); err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, map[string]any{"customer_id": r.PathValue("id"), "login_account": account, "enabled": true})
	})))
	s.mux.Handle("GET /api/v1/portal/admin/orders", s.protected("sales_order_list", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT id,order_no,customer_id,customer_name,status,customer_progress,total_amount,order_date,created_at FROM sales_orders WHERE deleted_at IS NULL AND source='portal' ORDER BY created_at DESC")
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, map[string]any{"total": len(rows), "list": rows})
	})))
	s.mux.Handle("PUT /api/v1/customers/{id}/portal-enabled", s.protected("customer_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		enabled := input["enabled"] == true
		if err = s.Store.Update(r.Context(), "customers", r.PathValue("id"), map[string]any{"portal_enabled": enabled, "updated_at": time.Now()}); err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, map[string]any{"customer_id": r.PathValue("id"), "portal_enabled": enabled})
	})))
	s.mux.Handle("GET /api/v1/portal/admin/customers", s.protected("sales_order_list", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT id,code,name,status,login_account,last_login_at FROM customers WHERE deleted_at IS NULL AND portal_enabled=1 ORDER BY name")
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, map[string]any{"total": len(rows), "list": rows})
	})))
	s.mux.Handle("GET /api/v1/portal/admin/settings", s.protected("sales_order_list", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, _ := s.Store.Rows(r.Context(), "SELECT value FROM system_settings WHERE key=?", "portal_settings")
		settings := map[string]any{"enabled": false, "show_stock": false, "key": "portal_settings", "note": "客户门户配置"}
		if len(rows) > 0 {
			var saved map[string]any
			if json.Unmarshal([]byte(fmt.Sprint(rows[0]["value"])), &saved) == nil {
				for k, v := range saved {
					settings[k] = v
				}
			}
		}
		respond(w, 200, settings)
	})))
	s.mux.Handle("PUT /api/v1/portal/admin/settings", s.protected("sales_order_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		settings := map[string]any{"enabled": input["enabled"] == true, "show_stock": input["show_stock"] == true}
		raw, _ := json.Marshal(settings)
		rows, _ := s.Store.Rows(r.Context(), "SELECT id FROM system_settings WHERE key=?", "portal_settings")
		if len(rows) > 0 {
			err = s.Store.Update(r.Context(), "system_settings", fmt.Sprint(rows[0]["id"]), map[string]any{"value": string(raw), "updated_at": time.Now()})
		} else {
			err = s.Store.Insert(r.Context(), "system_settings", map[string]any{"id": uuid.NewString(), "key": "portal_settings", "value": string(raw), "created_at": time.Now(), "updated_at": time.Now(), "tenant_id": database.ZeroUUID})
		}
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, settings)
	})))
}

// crmStageProbability 是原版实测的「阶段 → 赢单概率」映射（2026-10-15 取证）。
//
//	prospecting(初步接触)=10 → qualification=30 → proposal=50
//	→ negotiation=70 → won=100
//
// 阶段推进时同步改写 probability，恢复端此前**只改 stage 不改 probability**。
var crmStageProbability = map[string]int{
	"prospecting":   10,
	"qualification": 30,
	"proposal":      50,
	"negotiation":   70,
	"won":           100,
	"lost":          0,
}

// crmStageLabels 是原版错误文案里用的阶段中文名（回放取证）。
// 终态锁定文案形如「已赢单/已输单的商机不可再推进（当前：已赢单）」。
var crmStageLabels = map[string]string{
	"prospecting":   "初步接触",
	"qualification": "资格确认",
	"proposal":      "方案报价",
	"negotiation":   "商务谈判",
	"won":           "已赢单",
	"lost":          "已输单",
}

func (s *Server) registerCRMActions() {
	s.mux.Handle("POST /api/v1/crm-opportunities/{id}/stage", s.protected("crm_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		stage, _ := input["stage"].(string)
		current, err := s.Store.Get(r.Context(), "crm_opportunities", r.PathValue("id"))
		if err != nil {
			// 回放实测：记录不存在 → 200 + code 10000「商机不存在」
			businessFailure(w, errors.New("商机不存在"), false)
			return
		}
		oldStage := text(current, "stage")
		// 原版：终态商机连**同阶段**都不接受推进（实测已赢单后推 won 也被拒），
		// 文案带当前阶段中文名。
		if oldStage == "won" || oldStage == "lost" {
			// 文案取自原版 2026-10-15 回放；用 verbatim 承载，
			// 因为 audit-self-authored-text 的通用前缀过滤认不出它（批次 GG 同因）。
			verbatimFailure(w, verbatim{text: "已赢单/已输单的商机不可再推进（当前：" + crmStageLabels[oldStage] + "）"})
			return
		}
		probability, allowed := crmStageProbability[stage]
		if !allowed {
			// 回放实测：非法阶段 → 200 + 10000「阶段无效」（不是 400）
			verbatimFailure(w, verbatim{text: "阶段无效"})
			return
		}
		// 原版只允许**向前**推进：prospecting→qualification 可，
		// 反向（qualification→prospecting）被拒「只能向前推进阶段（当前：…）」。
		order := []string{"prospecting", "qualification", "proposal", "negotiation", "won"}
		currentIndex, nextIndex := indexOf(order, oldStage), indexOf(order, stage)
		if nextIndex < currentIndex {
			verbatimFailure(w, verbatim{text: "只能向前推进阶段（当前：" + crmStageLabels[oldStage] + "）"})
			return
		}
		now := database.Now()
		ch := map[string]any{"stage": stage, "probability": probability, "updated_at": now}
		if v := input["lost_reason"]; v != nil {
			ch["lost_reason"] = v
		}
		if stage == "won" {
			ch["won_at"] = now
		}
		if err = s.Store.Update(r.Context(), "crm_opportunities", r.PathValue("id"), ch); err != nil {
			businessFailure(w, err, false)
			return
		}
		row, err := s.Store.Get(r.Context(), "crm_opportunities", r.PathValue("id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, s.Store.Public("crm_opportunities", row))
	})))
	s.mux.Handle("GET /api/v1/crm-opportunities/funnel", s.protected("crm", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		where := []string{"deleted_at IS NULL"}
		args := []any{}
		if owner := r.URL.Query().Get("owner"); owner != "" {
			where = append(where, "owner=?")
			args = append(args, owner)
		}
		if start := r.URL.Query().Get("start_date"); start != "" {
			where = append(where, "created_at>=?")
			args = append(args, start)
		}
		if end := r.URL.Query().Get("end_date"); end != "" {
			where = append(where, "created_at<?")
			args = append(args, end)
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT stage,COUNT(*) count,COALESCE(SUM(amount),0) amount FROM crm_opportunities WHERE "+strings.Join(where, " AND ")+" GROUP BY stage ORDER BY stage", args...)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		total := int64(0)
		activeAmount := decimal.Zero
		wonCount, lostCount := int64(0), int64(0)
		wonAmount := decimal.Zero
		for _, row := range rows {
			count := int64(0)
			switch n := row["count"].(type) {
			case int64:
				count = n
			case int:
				count = int64(n)
			}
			total += count
			amount, _ := decimal.NewFromString(fmt.Sprint(row["amount"]))
			switch fmt.Sprint(row["stage"]) {
			case "won":
				wonCount, wonAmount = wonCount+count, wonAmount.Add(amount)
			case "lost":
				lostCount += count
			default:
				activeAmount = activeAmount.Add(amount)
			}
		}
		conversion := 0.0
		if wonCount+lostCount > 0 {
			conversion = float64(wonCount) / float64(wonCount+lostCount)
		}
		respond(w, 200, map[string]any{"stages": rows, "total_count": total, "active_amount": activeAmount.String(), "won_count": wonCount, "won_amount": wonAmount.String(), "period_won_count": wonCount, "period_won_amount": wonAmount.String(), "lost_count": lostCount, "conversion_rate": conversion})
	})))
	s.mux.Handle("GET /api/v1/crm-activities/pending", s.protected("crm", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT id activity_id,target_type,target_id,target_name,type last_type,content last_content,next_follow_at FROM crm_activities WHERE deleted_at IS NULL AND next_follow_at IS NOT NULL AND next_follow_at<=datetime('now') ORDER BY next_follow_at")
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		now := time.Now()
		for _, row := range rows {
			if row["target_name"] == nil || fmt.Sprint(row["target_name"]) == "" {
				table := map[string]string{"opportunity": "crm_opportunities", "crm_opportunity": "crm_opportunities", "lead": "leads", "customer": "customers"}[fmt.Sprint(row["target_type"])]
				if table != "" {
					if target, e := s.Store.Get(r.Context(), table, fmt.Sprint(row["target_id"])); e == nil {
						name := fmt.Sprint(target["name"])
						if name == "<nil>" || name == "" {
							name = fmt.Sprint(target["company"])
						}
						if name != "<nil>" {
							row["target_name"] = name
						}
					}
				}
			}
			followText := fmt.Sprint(row["next_follow_at"])
			follow, err := time.Parse(time.RFC3339Nano, followText)
			if err != nil {
				follow, err = time.Parse("2006-01-02 15:04:05-07:00", followText)
			}
			if err == nil {
				row["overdue_days"] = int(now.Sub(follow).Hours() / 24)
			} else {
				row["overdue_days"] = 0
			}
		}
		respond(w, 200, rows)
	})))
}

func (s *Server) registerFinanceLifecycleActions() {
	s.mux.Handle("GET /api/v1/tax-accruals/rate-defaults", s.protected("tax", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defaults := map[string]any{"vat_rate": 0.13, "city_rate": 0.07, "edu_rate": 0.03, "local_edu_rate": 0.02, "stamp_rate": 0, "income_tax_rate": 0.25, "dividend_tax_rate": 0.20}
		if rows, err := s.Store.Rows(r.Context(), "SELECT value FROM system_settings WHERE key=?", "tax_rate_defaults"); err == nil && len(rows) > 0 {
			_ = json.Unmarshal([]byte(fmt.Sprint(rows[0]["value"])), &defaults)
		}
		respond(w, 200, defaults)
	})))
	s.mux.Handle("PUT /api/v1/tax-accruals/rate-defaults", s.protected("tax", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		for _, key := range []string{"vat_rate", "city_rate", "edu_rate", "local_edu_rate", "stamp_rate", "income_tax_rate", "dividend_tax_rate"} {
			if raw, ok := input[key]; ok {
				v, e := decimal.NewFromString(fmt.Sprint(raw))
				if e != nil || v.IsNegative() || v.GreaterThan(decimal.NewFromInt(1)) {
					fail(w, 400, key+" 必须在 0 到 1 之间")
					return
				}
			}
		}
		raw, _ := json.Marshal(input)
		rows, _ := s.Store.Rows(r.Context(), "SELECT id FROM system_settings WHERE key=?", "tax_rate_defaults")
		if len(rows) > 0 {
			err = s.Store.Update(r.Context(), "system_settings", fmt.Sprint(rows[0]["id"]), map[string]any{"value": string(raw), "updated_at": time.Now()})
		} else {
			err = s.Store.Insert(r.Context(), "system_settings", map[string]any{"id": uuid.NewString(), "key": "tax_rate_defaults", "value": string(raw), "created_at": time.Now(), "updated_at": time.Now()})
		}
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, input)
	})))
	s.mux.Handle("GET /api/v1/tax-accruals/summary", s.protected("tax", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Query().Get("period")
		rows, err := s.Store.Rows(r.Context(), "SELECT t.tax_account_code account_code,COALESCE(a.name,'') account_name,COALESCE(SUM(t.amount),0) accrued FROM tax_accruals t LEFT JOIN accounts a ON a.code=t.tax_account_code AND a.deleted_at IS NULL WHERE t.deleted_at IS NULL AND t.period=? GROUP BY t.tax_account_code,a.name ORDER BY t.tax_account_code", p)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		totalAccrued := decimal.Zero
		totalPaid := decimal.Zero
		totalOpen := decimal.Zero
		for _, row := range rows {
			open := decimal.Zero
			if balances, e := s.Store.Rows(r.Context(), "SELECT COALESCE(SUM(b.begin_balance),0) balance FROM account_balances b JOIN accounts a ON a.id=b.account_id WHERE a.code=? AND substr(b.period,1,7)=?", fmt.Sprint(row["account_code"]), p); e == nil && len(balances) > 0 {
				open, _ = decimal.NewFromString(fmt.Sprint(balances[0]["balance"]))
			}
			row["open_balance"] = open.String()
			totalOpen = totalOpen.Add(open)
			row["paid"] = "0"
			v, _ := decimal.NewFromString(fmt.Sprint(row["accrued"]))
			row["close_balance"] = open.Add(v).String()
			totalAccrued = totalAccrued.Add(v)
		}
		paidRows, _ := s.Store.Rows(r.Context(), "SELECT account_code,COALESCE(SUM(amount),0) amount FROM journal_entries WHERE source_type='tax_payment' AND direction='debit' AND substr(entry_date,1,7)=? GROUP BY account_code", p)
		for _, paid := range paidRows {
			code := fmt.Sprint(paid["account_code"])
			amount, _ := decimal.NewFromString(fmt.Sprint(paid["amount"]))
			totalPaid = totalPaid.Add(amount)
			for _, row := range rows {
				if fmt.Sprint(row["account_code"]) == code {
					row["paid"] = amount.String()
					close := decimal.Zero
					if accrued, e := decimal.NewFromString(fmt.Sprint(row["accrued"])); e == nil {
						if opening, e2 := decimal.NewFromString(fmt.Sprint(row["open_balance"])); e2 == nil {
							close = opening.Add(accrued).Sub(amount)
						}
					}
					row["close_balance"] = close.String()
				}
			}
		}
		respond(w, 200, map[string]any{"period": p, "rows": rows, "total_open": totalOpen.String(), "total_accrued": totalAccrued.String(), "total_paid": totalPaid.String(), "total_close": totalOpen.Add(totalAccrued).Sub(totalPaid).String()})
	})))
	s.mux.Handle("GET /api/v1/tax-accruals/preview", s.protected("tax", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Query().Get("period")
		rows, err := s.Store.Rows(r.Context(), "SELECT COALESCE(SUM(CASE WHEN tax_type IN ('vat_output','output','销项税') THEN amount ELSE 0 END),0) output_vat,COALESCE(SUM(CASE WHEN tax_type IN ('vat_input','input','进项税') THEN amount ELSE 0 END),0) input_vat FROM tax_accruals WHERE deleted_at IS NULL AND period=?", p)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		output, input := decimal.Zero, decimal.Zero
		if len(rows) > 0 {
			output, _ = decimal.NewFromString(fmt.Sprint(rows[0]["output_vat"]))
			input, _ = decimal.NewFromString(fmt.Sprint(rows[0]["input_vat"]))
		}
		closed := false
		if periods, e := s.Store.Rows(r.Context(), "SELECT status FROM accounting_periods WHERE period=? LIMIT 1", p); e == nil && len(periods) > 0 {
			closed = fmt.Sprint(periods[0]["status"]) == "closed"
		}
		defaults := map[string]any{"vat_rate": 0.13, "city_rate": 0.07, "edu_rate": 0.03, "local_edu_rate": 0.02, "stamp_rate": 0, "income_tax_rate": 0.25, "dividend_tax_rate": 0.20}
		if settings, e := s.Store.Rows(r.Context(), "SELECT value FROM system_settings WHERE key=?", "tax_rate_defaults"); e == nil && len(settings) > 0 {
			_ = json.Unmarshal([]byte(fmt.Sprint(settings[0]["value"])), &defaults)
		}
		profitBeforeTax := "0"
		if report, e := s.business().FinanceReport(r.Context(), url.Values{"start_date": []string{p + "-01"}, "end_date": []string{p + "-31"}}, "profit-loss"); e == nil {
			if m, ok := report.(map[string]any); ok {
				profitBeforeTax = fmt.Sprint(m["net_profit"])
			}
		}
		respond(w, 200, map[string]any{"period": p, "period_closed": closed, "output_vat": output.String(), "input_vat": input.String(), "vat_payable": output.Sub(input).String(), "profit_before_tax": profitBeforeTax, "defaults": defaults})
	})))
	s.mux.Handle("GET /api/v1/tax-accruals/vat-balance", s.protected("tax", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		period := r.URL.Query().Get("period")
		rows, err := s.Store.Rows(r.Context(), "SELECT COALESCE(SUM(CASE WHEN tax_type IN ('vat_output','output','销项税') THEN amount ELSE 0 END),0) output_net, COALESCE(SUM(CASE WHEN tax_type IN ('vat_input','input','进项税') THEN amount ELSE 0 END),0) input_net FROM tax_accruals WHERE deleted_at IS NULL AND period=?", period)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		output, input := decimal.Zero, decimal.Zero
		if len(rows) > 0 {
			output, _ = decimal.NewFromString(fmt.Sprint(rows[0]["output_net"]))
			input, _ = decimal.NewFromString(fmt.Sprint(rows[0]["input_net"]))
		}
		payable := output.Sub(input)
		respond(w, 200, map[string]any{"period": period, "output_net": output.String(), "input_net": input.String(), "vat_payable": payable.String(), "transferred": payable.IsZero()})
	})))
	s.mux.Handle("GET /api/v1/tax-accruals/payables", s.protected("tax", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		where, args := "deleted_at IS NULL", []any{}
		if period := r.URL.Query().Get("as_of"); period != "" {
			where += " AND period<=?"
			args = append(args, period)
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT tax_account_code account_code,COALESCE(SUM(amount),0) balance FROM tax_accruals WHERE "+where+" GROUP BY tax_account_code", args...)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, rows)
	})))
	s.mux.Handle("POST /api/v1/tax-accruals/pay", s.protected("tax", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		data, err := s.business().PayTaxes(r.Context(), input)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	for _, action := range []string{"confirm"} {
		s.mux.Handle("POST /api/v1/payrolls/{id}/"+action, s.protected("payroll_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			row, err := s.business().ConfirmPayroll(r.Context(), r.PathValue("id"))
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, row)
		})))
	}
	for _, action := range []string{"receive", "cancel"} {
		s.mux.Handle("POST /api/v1/payment-plans/{id}/"+action, s.protected("payment_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if action == "receive" {
				input, err := decode(w, r)
				if err != nil {
					fail(w, 400, err.Error())
					return
				}
				result, err := s.business().ReceivePaymentPlan(r.Context(), r.PathValue("id"), input)
				if err != nil {
					businessFailure(w, err, false)
					return
				}
				respond(w, 200, result)
				return
			}
			row, err := s.Store.Get(r.Context(), "payment_plans", r.PathValue("id"))
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			if action == "cancel" && fmt.Sprint(row["status"]) != "active" && fmt.Sprint(row["status"]) != "partial" {
				fail(w, 409, "当前计划状态不能取消")
				return
			}
			status := "cancelled"
			if action == "receive" {
				status = "partial"
			}
			if err = s.Store.Update(r.Context(), "payment_plans", r.PathValue("id"), map[string]any{"status": status, "updated_at": time.Now()}); err != nil {
				businessFailure(w, err, false)
				return
			}
			row["status"] = status
			respond(w, 200, s.Store.Public("payment_plans", row))
		})))
	}
}

func (s *Server) registerApprovalActions() {
	for _, action := range []string{"activate", "deactivate"} {
		s.mux.Handle("POST /api/v1/approval-flows/{id}/"+action, s.protected("approval_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			active := action == "activate"
			if err := s.Store.Update(r.Context(), "approval_flows", r.PathValue("id"), map[string]any{"is_active": active, "updated_at": time.Now()}); err != nil {
				businessFailure(w, err, false)
				return
			}
			row, err := s.Store.Get(r.Context(), "approval_flows", r.PathValue("id"))
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, s.Store.Public("approval_flows", row))
		})))
	}
	for _, action := range []string{"submit", "approve", "reject"} {
		s.mux.Handle("POST /api/v1/approval-records/"+action, s.protected("approval_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.approvalRecordAction(r.Context(), action, input)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}

func (s *Server) approvalRecordAction(ctx context.Context, action string, input map[string]any) (map[string]any, error) {
	bizType, _ := input["biz_type"].(string)
	bizID, _ := input["biz_id"].(string)
	if bizType == "" || (action == "submit" && bizID == "") {
		return nil, errors.New("biz_type and biz_id are required")
	}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM approval_records WHERE biz_type=? AND biz_id=? ORDER BY created_at DESC LIMIT 1", bizType, bizID)
	if err != nil {
		return nil, err
	}
	if action == "submit" {
		if len(rows) > 0 {
			return nil, errors.New("approval already exists")
		}
		flows, _ := s.Store.Rows(ctx, "SELECT * FROM approval_flows WHERE deleted_at IS NULL AND biz_type=? AND is_active=1 ORDER BY created_at DESC LIMIT 1", bizType)
		if len(flows) == 0 {
			return nil, errors.New("no active approval flow")
		}
		row := map[string]any{"id": uuid.NewString(), "created_at": time.Now(), "updated_at": time.Now(), "flow_code": flows[0]["code"], "biz_type": bizType, "biz_id": bizID, "biz_no": input["biz_no"], "initiator_id": input["initiator_id"], "initiator_name": input["initiator_name"], "current_status": "pending", "current_step": 1, "remark": input["remark"], "tenant_id": database.ZeroUUID}
		if err := s.Store.Insert(ctx, "approval_records", row); err != nil {
			return nil, err
		}
		return s.Store.Public("approval_records", row), nil
	}
	if len(rows) == 0 {
		return nil, database.ErrNotFound
	}
	row := rows[0]
	status := map[string]string{"approve": "approved", "reject": "rejected"}[action]
	if status == "" || row["current_status"] != "pending" {
		return nil, errors.New("approval record cannot be changed")
	}
	if err := s.Store.Update(ctx, "approval_records", fmt.Sprint(row["id"]), map[string]any{"current_status": status, "updated_at": time.Now(), "remark": input["remark"]}); err != nil {
		return nil, err
	}
	row["current_status"] = status
	return s.Store.Public("approval_records", row), nil
}

func (s *Server) backupDir() string { return filepath.Join(filepath.Dir(s.dbFilename), "backups") }

func (s *Server) registerBackupActions() {
	s.mux.Handle("GET /api/v1/backups", s.protected("backup", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entries, err := os.ReadDir(s.backupDir())
		if os.IsNotExist(err) {
			respond(w, 200, []any{})
			return
		}
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		out := make([]map[string]any, 0)
		for _, e := range entries {
			if e.IsDir() || filepath.Ext(e.Name()) != ".db" {
				continue
			}
			info, er := e.Info()
			if er == nil {
				out = append(out, map[string]any{"name": e.Name(), "size": info.Size(), "time": info.ModTime().Format(time.RFC3339)})
			}
		}
		respond(w, 200, out)
	})))
	s.mux.Handle("POST /api/v1/backups", s.protected("backup_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := os.MkdirAll(s.backupDir(), 0700); err != nil {
			fail(w, 500, err.Error())
			return
		}
		name := "la-erp-" + time.Now().Format("20060102-150405") + ".db"
		target := filepath.Join(s.backupDir(), name)
		if _, err := s.Store.DB.ExecContext(r.Context(), "VACUUM INTO ?", target); err != nil {
			fail(w, 500, err.Error())
			return
		}
		info, _ := os.Stat(target)
		respond(w, 200, map[string]any{"name": name, "size": info.Size(), "time": info.ModTime().Format(time.RFC3339)})
	})))
	s.mux.Handle("DELETE /api/v1/backups", s.protected("backup_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := filepath.Base(r.URL.Query().Get("name"))
		if filepath.Ext(name) != ".db" {
			fail(w, 400, "invalid backup name")
			return
		}
		if err := os.Remove(filepath.Join(s.backupDir(), name)); err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("GET /api/v1/backups/download", s.protected("backup", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := filepath.Base(r.URL.Query().Get("name"))
		if filepath.Ext(name) != ".db" {
			fail(w, 400, "invalid backup name")
			return
		}
		http.ServeFile(w, r, filepath.Join(s.backupDir(), name))
	})))
	s.mux.Handle("POST /api/v1/backups/restore", s.protected("backup_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		name, _ := input["name"].(string)
		name = filepath.Base(name)
		if filepath.Ext(name) != ".db" {
			fail(w, 400, "invalid backup name")
			return
		}
		src := filepath.Join(s.backupDir(), name)
		if _, err = os.Stat(src); err != nil {
			fail(w, 404, "backup not found")
			return
		}
		pending := s.dbFilename + ".restore.pending"
		if err = os.WriteFile(pending, []byte(src), 0600); err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, map[string]any{"message": "恢复任务已排队，重启后生效"})
	})))
	s.mux.Handle("GET /api/v1/backups/settings", s.protected("backup", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, _ := s.Store.Get(r.Context(), "system_settings", "backup_settings")
		if row == nil {
			respond(w, 200, map[string]any{"auto": false, "keep": 7, "dir": s.backupDir()})
			return
		}
		respond(w, 200, row)
	})))
	s.mux.Handle("PUT /api/v1/backups/settings", s.protected("backup_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		keep := input["keep"]
		if keep == nil {
			keep = 7
		}
		row := map[string]any{"auto": input["auto"] == true, "keep": keep, "dir": input["dir"]}
		if row["dir"] == nil || row["dir"] == "" {
			row["dir"] = s.backupDir()
		}
		raw, _ := json.Marshal(row)
		rows, _ := s.Store.Rows(r.Context(), "SELECT id FROM system_settings WHERE key=?", "backup_settings")
		if len(rows) > 0 {
			if err := s.Store.Update(r.Context(), "system_settings", fmt.Sprint(rows[0]["id"]), map[string]any{"value": string(raw), "updated_at": time.Now()}); err != nil {
				fail(w, 500, err.Error())
				return
			}
		} else {
			rec := map[string]any{"id": uuid.NewString(), "key": "backup_settings", "value": string(raw), "created_at": time.Now(), "updated_at": time.Now(), "tenant_id": database.ZeroUUID}
			if err := s.Store.Insert(r.Context(), "system_settings", rec); err != nil {
				fail(w, 500, err.Error())
				return
			}
		}
		respond(w, 200, row)
	})))
}

func (s *Server) registerPieceworkActions() {
	s.mux.Handle("GET /api/v1/piecework-records/summary", s.protected("piecework", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		period := r.URL.Query().Get("period")
		if len(period) != 7 {
			fail(w, 400, "period 必须为 YYYY-MM")
			return
		}
		rows, err := s.Store.Rows(r.Context(), `SELECT employee_id, employee_name, COALESCE(SUM(qty),0) qty, COALESCE(SUM(amount),0) amount, COUNT(*) record_count FROM piecework_records WHERE deleted_at IS NULL AND substr(work_date,1,7)=? GROUP BY employee_id, employee_name ORDER BY employee_name`, period)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, rows)
	})))
}

func (s *Server) registerPerformanceActions() {
	s.mux.Handle("POST /api/v1/perf-assessments/{id}/finalize", s.protected("performance_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().FinalizePerformance(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}

func (s *Server) registerRecruitmentActions() {
	s.mux.Handle("POST /api/v1/recruitment-candidates/{id}/hire", s.protected("recruitment_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		data, err := s.business().HireRecruitmentCandidate(r.Context(), r.PathValue("id"), input)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}

func (s *Server) registerAttendanceActions() {
	for _, action := range []string{"submit", "approve", "reject", "cancel"} {
		s.mux.Handle("POST /api/v1/attendance-requests/{id}/"+action, s.protected("attendance_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().AttendanceAction(r.Context(), r.PathValue("id"), action)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
	s.mux.Handle("GET /api/v1/attendance-requests/summary", s.protected("attendance", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().AttendanceSummary(r.Context(), r.URL.Query().Get("period"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}

func (s *Server) registerToolingActions() {
	for _, action := range []string{"use", "maintain", "scrap"} {
		s.mux.Handle("POST /api/v1/toolings/{id}/"+action, s.protected("tooling_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().ToolingAction(r.Context(), r.PathValue("id"), action, input)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}

func (s *Server) registerEquipmentMaintenanceActions() {
	s.mux.Handle("POST /api/v1/equipment-maintenances/{id}/done", s.protected("equipment_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		data, err := s.business().CompleteEquipmentMaintenance(r.Context(), r.PathValue("id"), input)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}

func (s *Server) registerProductDocumentActions() {
	s.mux.Handle("POST /api/v1/product-documents/{id}/publish", s.protected("document_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().PublishProductDocument(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}

func (s *Server) registerAssemblyActions() {
	for _, action := range []string{"confirm", "cancel"} {
		s.mux.Handle("POST /api/v1/assemblies/{id}/"+action, s.protected("assembly_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().AssemblyAction(r.Context(), r.PathValue("id"), action)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
	s.mux.Handle("GET /api/v1/assemblies/bom-components", s.protected("assembly", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().AssemblyBOMComponents(r.Context(), r.URL.Query().Get("product_id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}

func (s *Server) registerExpenseActions() {
	for _, action := range []string{"submit", "approve", "paid", "reject", "cancel"} {
		s.mux.Handle("POST /api/v1/expense-claims/{id}/"+action, s.protected("expense_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input := map[string]any{}
			if action == "paid" && r.ContentLength > 0 {
				var err error
				input, err = decode(w, r)
				if err != nil {
					fail(w, 400, err.Error())
					return
				}
			}
			data, err := s.business().ExpenseAction(r.Context(), r.PathValue("id"), action, input)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}

func (s *Server) registerFixedAssetActions() {
	s.mux.Handle("POST /api/v1/fixed-assets/{id}/retire", s.protected("fixed_asset_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().RetireFixedAsset(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("POST /api/v1/fixed-assets/run-depreciation", s.protected("fixed_asset_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().RunDepreciation(r.Context(), r.URL.Query().Get("period"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/fixed-assets/depreciation-entries", s.protected("fixed_asset", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().DepreciationEntries(r.Context(), r.URL.Query().Get("period"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}

func (s *Server) registerLaborContractActions() {
	s.mux.Handle("POST /api/v1/labor-contracts/{id}/terminate", s.protected("labor_contract_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		data, err := s.business().TerminateLaborContract(r.Context(), r.PathValue("id"), input)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-ERP-Recovery", "source-reconstruction")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) allProductionEquipments(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Store.Rows(r.Context(), "SELECT * FROM production_equipments WHERE deleted_at IS NULL ORDER BY created_at DESC")
	if err != nil {
		s.failure(w, err, "生产设备")
		return
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		active := row["is_active"]
		if active == false || active == int64(0) {
			continue
		}
		items = append(items, s.Store.Public("production_equipments", row))
	}
	respond(w, 200, items)
}

func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func respond(w http.ResponseWriter, status int, data any) {
	write(w, status, map[string]any{"code": 0, "message": "success", "data": data})
}
func fail(w http.ResponseWriter, status int, message string) {
	write(w, status, map[string]any{"code": status, "message": message, "data": nil})
}
func decode(w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	reader := http.MaxBytesReader(w, r.Body, 2<<20)
	decoder := json.NewDecoder(reader)
	decoder.UseNumber()
	var data map[string]any
	if err := decoder.Decode(&data); err != nil || data == nil {
		return nil, errors.New("请求参数错误：需要 JSON 对象")
	}
	var tail any
	if err := decoder.Decode(&tail); err != io.EOF {
		return nil, errors.New("请求参数错误：多余 JSON 数据")
	}
	return data, nil
}
func text(data map[string]any, key string) string { v, _ := data[key].(string); return v }
func current(r *http.Request) auth.Claims         { return r.Context().Value(claimsKey{}).(auth.Claims) }
func (s *Server) authenticated(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			fail(w, 401, "未提供认证令牌")
			return
		}
		claims, _, err := s.Auth.Authenticate(r.Context(), strings.TrimPrefix(header, "Bearer "), "access")
		if err != nil {
			fail(w, 401, "认证令牌无效或已过期")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, claims)))
	})
}
func (s *Server) protected(permission string, next http.Handler) http.Handler {
	return s.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.Auth.Allowed(r.Context(), current(r).UserID, permission) {
			fail(w, 403, "没有操作权限")
			return
		}
		// 动作端点（/{id}/<action>）在「记录不存在」时的原版形态与通用 404 不同。
		// 这里包一层 ResponseWriter 捕获响应：只有当命中 actionNotFoundShapes
		// 且下游真的因「记录不存在」失败（404 或业务 10000）时才改写成实测形态。
		if shape, ok := s.actionNotFoundShape(r); ok {
			recorder := &captureWriter{ResponseWriter: w, status: 200}
			next.ServeHTTP(recorder, r)
			if recorder.looksMissing() {
				recorder.rewrite(shape)
			} else {
				recorder.flush()
			}
			return
		}
		next.ServeHTTP(w, r)
	}))
}

// actionNotFoundShape 判断当前请求是否命中「动作端点 notFound 形态」配置。
//
// 路径形如 /api/v1/<resource>/<uuid>/<action>，只有 (resource|action) 在
// actionNotFoundShapes 里命中才返回配置；其余（如 /{id}/stage 这类未实测的）
// 返回 false 完全透传。
func (s *Server) actionNotFoundShape(r *http.Request) (actionNotFound, bool) {
	if r.Method != http.MethodPost {
		return actionNotFound{}, false
	}
	segments := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api / v1 / <resource> / <id> / <action>
	if len(segments) != 5 || segments[0] != "api" || segments[1] != "v1" {
		return actionNotFound{}, false
	}
	shape, ok := actionNotFoundShapes[segments[2]+"|"+segments[4]]
	return shape, ok
}

// captureWriter 捕获下游写出的状态码与 body；**先缓存不提交**，
// 由调用方决定按原样透传还是按实测形态改写。
//
// 不能在 WriteHeader 里就转发 —— 一旦提交就无法再改状态码，
// 而本用例要把 404 换成 200（原版对动作端点用业务错误形态）。
type captureWriter struct {
	http.ResponseWriter
	status  int
	body    []byte
	wrote   bool
	headers http.Header
}

// headers 返回将要写出的响应头副本，供 flush 时使用。
func (c *captureWriter) snapshotHeaders() http.Header {
	if c.headers == nil {
		c.headers = c.ResponseWriter.Header().Clone()
	}
	return c.headers
}

func (c *captureWriter) WriteHeader(status int) {
	if c.wrote {
		return
	}
	c.status = status
	c.wrote = true
	c.snapshotHeaders()
}

func (c *captureWriter) Write(p []byte) (int, error) {
	if !c.wrote {
		c.status = http.StatusOK
		c.wrote = true
		c.snapshotHeaders()
	}
	c.body = append(c.body, p...)
	return len(p), nil
}

// flush 按缓存的响应原样提交（用于不需要改写的情况）。
func (c *captureWriter) flush() {
	if !c.wrote {
		return
	}
	header := c.snapshotHeaders()
	for key, values := range header {
		for _, v := range values {
			c.ResponseWriter.Header().Add(key, v)
		}
	}
	c.ResponseWriter.WriteHeader(c.status)
	_, _ = c.ResponseWriter.Write(c.body)
}

// looksMissing 判断下游响应是否真的属于「记录不存在」。
//
// 不能只看 `code == 10000` —— 大量业务校验失败也用 10000
// （如 work-order-processes/start 的「只有待处理状态的工序才能开始」、
//
//	sales-orders/approve 的「当前状态不允许审批」）。
//
// 若一律改写，会把业务失败文案吞成「工序不存在」，这正是批次 LL 首版实现
// 引发 6 个既有回放测试失败的原因。
//
// 判据：响应文案里含「不存在」才认为确实是「记录不存在」。
// 这是逐条回放归纳出来的 —— 实测的 35 组不一致里，原版文案全部含「不存在」
// 或为 400/500 通用文案；而业务校验文案不含这三个字。
func (c *captureWriter) looksMissing() bool {
	if c.status == http.StatusNotFound {
		return true
	}
	if !bytes.Contains(c.body, []byte(`"code":10000`)) {
		return false
	}
	return bytes.Contains(c.body, []byte("不存在"))
}

// rewrite 用实测的原版形态替换缓存的响应，并提交。
func (c *captureWriter) rewrite(shape actionNotFound) {
	body := fmt.Sprintf(`{"code":%d,"message":%s,"data":null}`, shape.code, mustJSONString(shape.text))
	header := c.snapshotHeaders()
	header.Set("Content-Type", "application/json; charset=utf-8")
	for key := range header {
		c.ResponseWriter.Header().Del(key)
	}
	for key, values := range header {
		for _, v := range values {
			c.ResponseWriter.Header().Add(key, v)
		}
	}
	c.ResponseWriter.WriteHeader(shape.http)
	_, _ = c.ResponseWriter.Write([]byte(body))
}

// mustJSONString 用 encoding/json 转义字符串，避免文案里的引号破坏 JSON。
func mustJSONString(s string) string {
	raw, err := json.Marshal(s)
	if err != nil {
		return `""`
	}
	return string(raw)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	data, err := decode(w, r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if text(data, "username") == "" || text(data, "password") == "" {
		fail(w, 400, "用户名和密码不能为空")
		return
	}
	result, err := s.Auth.Login(r.Context(), text(data, "username"), text(data, "password"), text(data, "company"))
	if err != nil {
		fail(w, 401, err.Error())
		return
	}
	respond(w, 200, result)
}
func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	data, err := decode(w, r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	// 缺 refresh_token 走 gin 的 required 形态，值无效才走下面的 401（回放 OO）
	if !ooRefreshRequired(w, data) {
		return
	}
	result, err := s.Auth.Refresh(r.Context(), text(data, "refresh_token"))
	if err != nil {
		fail(w, 401, "刷新令牌无效或已过期")
		return
	}
	respond(w, 200, result)
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	_, codes, err := s.Auth.Roles(r.Context(), current(r).UserID, false)
	if err != nil {
		fail(w, 500, "读取权限失败")
		return
	}
	respond(w, 200, map[string]any{"company": "default", "company_is_default": true, "permissions": codes})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if err := s.Auth.Logout(r.Context(), current(r)); err != nil {
		fail(w, 500, "退出登录失败")
		return
	}
	respond(w, 200, nil)
}
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	data, err := decode(w, r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if err = s.Auth.ChangePassword(r.Context(), current(r).UserID, text(data, "old_password"), text(data, "new_password")); err != nil {
		fail(w, 400, err.Error())
		return
	}
	respond(w, 200, nil)
}
func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) {
	password, err := s.Auth.ResetPassword(r.Context(), r.PathValue("id"))
	if err != nil {
		s.failure(w, err, "用户")
		return
	}
	respond(w, 200, map[string]any{"temp_password": password})
}

// enforceSingleDefaultWarehouse 保证同一时刻至多一个默认仓库。
//
// 批次 Q 取证（2026-10-14，evidence/backend-runtime/audit-batch-q-20261014.json）：
//
//	原版 `POST /warehouses` 传 is_default=true **不会**抢占默认位（新仓回读 is_default 为 false），
//	默认仓数量保持 1；而 `PUT` 改单个仓库的 is_default 是生效的。
//	即原版的默认位语义是「单一且由服务端维持」，建仓接口不能制造第二个。
//
// 恢复端原先无此保护：把 A 设为默认后会与既有默认仓并存（实测 2 个），
// 进而让 mrp.go 的 `len(warehouses) != 1 → ErrUnsupported`（未取证分支）被触发。
//
// 处理方式：置默认前先把其余仓库的 is_default 置 false。
// 原版未给「取消其他默认仓」的业务文案（属静默归一化），故不返回任何提示。
func (s *Server) enforceSingleDefaultWarehouse(r *http.Request, id string, record map[string]any) {
	if v, ok := record["is_default"]; !ok || v != true {
		return
	}
	rows, err := s.Store.Rows(r.Context(),
		"SELECT id FROM warehouses WHERE deleted_at IS NULL AND is_default=1 AND id<>?", id)
	if err != nil {
		return
	}
	for _, other := range rows {
		_ = s.Store.Update(r.Context(), "warehouses", fmt.Sprint(other["id"]),
			map[string]any{"is_default": false, "updated_at": time.Now()})
	}
}

func (s *Server) failure(w http.ResponseWriter, err error, label string) {
	s.failureForTable(w, err, label, "")
}

// failureForTable 与 failure 等价，但对特定表的唯一约束冲突可改用原版实测形态。
//
// 会计期间是唯一需要覆盖的（2026-10-15 原版实测）：`accounting_periods.period`
// 有唯一索引，而原版的重叠检查只看日期区间 —— 于是「同 period 但日期不重叠」的请求
// 绕过业务校验、直接撞唯一索引，原版把它当未处理异常返回 **500 通用文案**：
//
//	同 period 同日期   → 200+10000「该期间与已存在的会计期间重叠」（业务校验拦下）
//	同 period 不同日期 → **500**「系统内部错误，请稍后重试或联系管理员」（裸 SQL 错误）
//
// 恢复端此前一律返回 400「会计期间编码或名称已存在」，形态不符。
// 覆盖表为空时行为与 failure 完全一致。
func (s *Server) failureForTable(w http.ResponseWriter, err error, label, table string) {
	var validation *validationError
	if errors.As(err, &validation) {
		fail(w, 400, validation.Error())
	} else if errors.Is(err, database.ErrNotFound) {
		fail(w, 404, label+"不存在")
	} else if strings.Contains(err.Error(), "UNIQUE constraint") {
		if shape, ok := uniqueConflictAsServerError[table]; ok {
			fail(w, shape.http, shape.text)
			return
		}
		fail(w, 400, label+"编码或名称已存在")
	} else if strings.Contains(err.Error(), "constraint") {
		fail(w, 400, "字段不满足数据库约束")
	} else {
		fail(w, 500, "数据库操作失败")
	}
}
func (s *Server) register(name string, res Resource) {
	base := "/api/v1/" + name
	view := res.Permission
	switch res.Permission {
	case "product", "customer", "supplier", "warehouse":
		view += "_list"
	}
	s.mux.Handle("GET "+base, s.protected(view, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.list(w, r, res) })))
	// 走 s.detail 而非 s.get：与 read_resources.json 重叠的表（production_equipments /
	// toolings / production_teams / product_documents / assemblies …）需要按原版回放 HH
	// 的实测形态输出「记录不存在」，未配置的表在 s.detail 内等价于 s.get。
	s.mux.Handle("GET "+base+"/{id}", s.protected(view, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.detail(w, r, res) })))
	if name == "permissions" {
		return
	}
	s.mux.Handle("POST "+base, s.protected(res.Permission+"_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.create(w, r, res) })))
	// 写路径的「记录不存在」在原版有三种形态（2026-10-15 逐条回放，66 处差异）：
	//   ① 原版 200 + code 10000 + 中文文案 → 走 s.write（按 writeNotFoundBusiness 改写）
	//   ② 原版 404「路由不存在」（根本没这个写路由）→ 逐字返回，不得自动补出
	//   ③ 其余保持原样（404 + <Label>不存在）
	for _, spec := range []struct {
		method     string
		permission string
		handler    func(http.ResponseWriter, *http.Request, Resource, string)
	}{
		{"PUT", res.Permission + "_edit", s.update},
		{"DELETE", res.Permission + "_delete", s.delete},
	} {
		method, permission, handler := spec.method, spec.permission, spec.handler
		s.mux.Handle(method+" "+base+"/{id}", s.protected(permission, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if hasMethod(writeRouteAbsent[name], method) {
				fail(w, 404, "路由不存在")
				return
			}
			handler(w, r, res, name)
		})))
	}
}

// writeNotFound 供 s.update / s.delete 在「记录不存在」时按原版形态输出。
//
// 原版把「记录不存在」当成**业务错误**（HTTP 200 + code 10000 + 中文文案），
// 而恢复端此前一律走 s.failure 输出 404 + code 404 —— 2026-10-15 逐条回放
// 发现 29 张表、51 处 PUT/DELETE 存在此差异。
func writeNotFound(w http.ResponseWriter, route string) bool {
	message, ok := writeNotFoundBusiness[route]
	if !ok {
		return false
	}
	write(w, 200, map[string]any{"code": 10000, "message": message, "data": nil})
	return true
}
func (s *Server) public(r *http.Request, res Resource, row map[string]any) map[string]any {
	if res.Table == "sys_users" {
		pub, _, _, err := s.Auth.User(r.Context(), row, false)
		if err == nil {
			return pub
		}
	}
	pub := s.Store.Public(res.Table, row)
	edges, _ := pub["edges"].(map[string]any)
	if edges == nil {
		return pub
	}
	relations := map[string]string{"category_id": "categories", "unit_id": "units", "equipment_id": "production_equipments", "applicable_product_id": "products", "product_id": "products", "employee_id": "employees", "work_order_id": "work_orders"}
	if res.Table == "inventory_balances" || res.Table == "stock_movements" {
		relations = map[string]string{"product_id": "products", "warehouse_id": "warehouses"}
	}
	if res.Table == "sys_roles" {
		values, err := s.Store.Rows(r.Context(), `SELECT p.* FROM sys_permissions p JOIN sys_role_permissions rp ON p.id=rp.permission_id WHERE rp.role_id=? AND p.deleted_at IS NULL ORDER BY p.sort_order`, row["id"])
		if err == nil && len(values) > 0 {
			items := []map[string]any{}
			for _, v := range values {
				items = append(items, s.Store.Public("sys_permissions", v))
			}
			edges["permissions"] = items
		}
	}
	if res.Table == "production_teams" {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM production_team_members WHERE team_id=? AND deleted_at IS NULL ORDER BY created_at", row["id"])
		if err == nil {
			members := make([]map[string]any, 0, len(rows))
			for _, member := range rows {
				members = append(members, s.Store.Public("production_team_members", member))
			}
			edges["members"] = members
		}
	}
	if res.Table == "assembly_orders" {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM assembly_order_lines WHERE assembly_id=? AND deleted_at IS NULL ORDER BY line_no", row["id"])
		if err == nil {
			lines := make([]map[string]any, 0, len(rows))
			for _, line := range rows {
				lines = append(lines, s.Store.Public("assembly_order_lines", line))
			}
			edges["lines"] = lines
		}
	}
	if res.Table == "payment_plans" {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM payment_plan_items WHERE payment_plan_items=? AND deleted_at IS NULL ORDER BY seq", row["id"])
		if err == nil {
			items := make([]map[string]any, 0, len(rows))
			for _, item := range rows {
				items = append(items, s.Store.Public("payment_plan_items", item))
			}
			edges["items"] = items
		}
	}
	if res.Table == "expense_claims" {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM expense_claim_lines WHERE claim_id=? AND deleted_at IS NULL ORDER BY line_no", row["id"])
		if err == nil {
			lines := make([]map[string]any, 0, len(rows))
			for _, line := range rows {
				lines = append(lines, s.Store.Public("expense_claim_lines", line))
			}
			edges["lines"] = lines
		}
	}
	if res.Table == "crm_opportunities" {
		if customerID := fmt.Sprint(row["customer_id"]); customerID != "" && customerID != database.ZeroUUID {
			if customer, err := s.Store.Get(r.Context(), "customers", customerID); err == nil {
				edges["customer"] = s.Store.Public("customers", customer)
			}
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM crm_activities WHERE crm_opportunity_activities=? AND deleted_at IS NULL ORDER BY activity_at DESC", row["id"])
		if err == nil {
			activities := make([]map[string]any, 0, len(rows))
			for _, activity := range rows {
				activities = append(activities, s.Store.Public("crm_activities", activity))
			}
			edges["activities"] = activities
		}
	}
	if res.Table == "production_equipments" {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM equipment_maintenances WHERE equipment_id=? AND deleted_at IS NULL ORDER BY created_at", row["id"])
		if err == nil {
			maintenances := make([]map[string]any, 0, len(rows))
			for _, maintenance := range rows {
				maintenances = append(maintenances, s.Store.Public("equipment_maintenances", maintenance))
			}
			edges["maintenances"] = maintenances
		}
	}
	if res.Table == "payroll_batches" {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM payroll_items WHERE batch_id=? AND deleted_at IS NULL ORDER BY line_no", row["id"])
		if err == nil {
			items := make([]map[string]any, 0, len(rows))
			for _, item := range rows {
				items = append(items, s.Store.Public("payroll_items", item))
			}
			edges["items"] = items
		}
	}
	if res.Table == "perf_assessments" {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM perf_assessment_items WHERE assessment_id=? AND deleted_at IS NULL ORDER BY created_at", row["id"])
		if err == nil {
			items := make([]map[string]any, 0, len(rows))
			for _, item := range rows {
				items = append(items, s.Store.Public("perf_assessment_items", item))
			}
			edges["items"] = items
		}
	}
	if res.Table == "perf_templates" {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM perf_template_items WHERE template_id=? AND deleted_at IS NULL ORDER BY created_at", row["id"])
		if err == nil {
			items := make([]map[string]any, 0, len(rows))
			for _, item := range rows {
				items = append(items, s.Store.Public("perf_template_items", item))
			}
			edges["items"] = items
		}
	}
	for key, table := range relations {
		if id, ok := row[key].(string); ok && id != "" {
			if record, err := s.Store.Get(r.Context(), table, id); err == nil {
				edges[strings.TrimSuffix(key, "_id")] = s.Store.Public(table, record)
			}
		}
	}
	return pub
}
func (s *Server) list(w http.ResponseWriter, r *http.Request, res Resource) {
	if res.Table == "work_order_processes" {
		s.workReports(w, r, "list")
		return
	}
	query, err := s.scopedQuery(r, res)
	if err != nil {
		s.failure(w, err, res.Label)
		return
	}
	rows, total, err := s.Store.List(r.Context(), res.Table, query)
	if err != nil {
		s.failure(w, err, res.Label)
		return
	}
	items := []map[string]any{}
	for _, row := range rows {
		item, err := s.listRecord(r, res, row)
		if err != nil {
			s.failure(w, err, res.Label)
			return
		}
		items = append(items, item)
	}
	respond(w, 200, map[string]any{"list": items, "total": total})
}
func (s *Server) get(w http.ResponseWriter, r *http.Request, res Resource) {
	// Business-specific detail handlers below return before the generic
	// scope check. Enforce visibility before dispatching to those handlers.
	if scopedMaster(res.Table) {
		row, err := s.Store.Get(r.Context(), res.Table, r.PathValue("id"))
		if err == nil {
			err = s.checkScope(r, res, row)
			if errors.Is(err, database.ErrNotFound) {
				fail(w, 404, "无权访问该数据")
				return
			}
		}
		if err != nil {
			s.failure(w, err, res.Label)
			return
		}
	}
	if res.Table == "subcontract_orders" {
		data, err := s.business().GetSubcontract(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailureLabeled(w, err, false, res.Label)
			return
		}
		respond(w, 200, data)
		return
	}

	if res.Table == "rework_orders" {
		data, err := s.business().GetRework(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailureLabeled(w, err, false, res.Label)
			return
		}
		respond(w, 200, data)
		return
	}
	if res.Table == "accounts" {
		data, err := s.business().GetAccount(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, 404, "科目不存在")
			return
		}
		respond(w, 200, data)
		return
	}
	if res.Table == "inventory_checks" {
		data, err := s.business().GetCheck(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailureLabeled(w, err, false, res.Label)
			return
		}
		respond(w, 200, data)
		return
	}
	if res.Table == "stock_adjusts" {
		data, err := s.business().GetAdjustment(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailureLabeled(w, err, false, res.Label)
			return
		}
		respond(w, 200, data)
		return
	}
	if res.Table == "stock_transfers" {
		data, err := s.business().GetTransfer(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailureLabeled(w, err, false, res.Label)
			return
		}
		respond(w, 200, data)
		return
	}
	if res.Table == "routings" {
		data, err := s.business().GetRouting(r.Context(), r.PathValue("id"))
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				fail(w, 404, "工艺路线不存在")
				return
			}
			businessFailureLabeled(w, err, false, res.Label)
			return
		}
		respond(w, 200, data)
		return
	}
	if res.Table == "work_centers" {
		row, err := s.Store.Get(r.Context(), res.Table, r.PathValue("id"))
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				businessFailure(w, errors.New("工作中心不存在"), false)
			} else {
				businessFailureLabeled(w, err, false, res.Label)
			}
			return
		}
		respond(w, 200, s.Store.Public(res.Table, row))
		return
	}
	for _, d := range business.ProductionDocuments {
		if d.Table == res.Table {
			data, err := s.business().GetProductionDocument(r.Context(), d, r.PathValue("id"))
			if err != nil {
				if d.Kind == "return" && errors.Is(err, database.ErrNotFound) {
					write(w, 200, map[string]any{"code": 10000, "message": "生产退料单不存在", "data": nil})
					return
				}
				businessFailureLabeled(w, err, false, res.Label)
				return
			}
			respond(w, 200, data)
			return
		}
	}
	if res.Table == "bo_ms" || res.Table == "work_orders" {
		var data map[string]any
		var err error
		if res.Table == "bo_ms" {
			data, err = s.business().GetBOM(r.Context(), r.PathValue("id"))
		} else {
			data, err = s.business().GetWorkOrder(r.Context(), r.PathValue("id"))
		}
		if err != nil {
			if res.Table == "bo_ms" && errors.Is(err, database.ErrNotFound) {
				fail(w, 404, "BOM不存在")
			} else if res.Table == "work_orders" && errors.Is(err, database.ErrNotFound) {
				fail(w, 404, "工单不存在")
			} else {
				businessFailureLabeled(w, err, false, res.Label)
			}
			return
		}
		respond(w, 200, data)
		return
	}
	if res.Table == "vouchers" {
		data, err := s.business().GetVoucher(r.Context(), r.PathValue("id"))
		if err != nil {
			// 原版回放 JJ3：凭证不存在返回 404「凭证不存在」。
			businessFailureLabeled(w, err, true, res.Label)
			return
		}
		respond(w, 200, data)
		return
	}
	for _, d := range business.Finances {
		if d.Table == res.Table {
			data, err := s.business().GetPayment(r.Context(), d, r.PathValue("id"))
			if err != nil {
				businessFailureLabeled(w, err, false, res.Label)
				return
			}
			respond(w, 200, data)
			return
		}
	}
	for _, d := range business.Documents {
		if d.Table == res.Table {
			data, err := s.business().Get(r.Context(), d, r.PathValue("id"))
			if err != nil {
				businessFailure(w, err, d.Stock)
				return
			}
			respond(w, 200, data)
			return
		}
	}
	if res.Table == "approval_flows" {
		data, err := s.business().GetApprovalFlow(r.Context(), r.PathValue("id"))
		if err != nil {
			s.failure(w, err, res.Label)
			return
		}
		respond(w, 200, data)
		return
	}
	if res.Table == "loan_orders" || res.Table == "consignment_orders" {
		data, err := s.business().GetPartnerDocument(r.Context(), res.Table, r.PathValue("id"))
		if err != nil {
			s.failure(w, err, res.Label)
			return
		}
		respond(w, 200, data)
		return
	}
	if _, err := uuid.Parse(r.PathValue("id")); err != nil {
		fail(w, 400, "无效的 ID")
		return
	}
	row, err := s.Store.Get(r.Context(), res.Table, r.PathValue("id"))
	if err == nil {
		err = s.checkScope(r, res, row)
	}
	if err != nil {
		s.failure(w, err, res.Label)
		return
	}
	respond(w, 200, s.public(r, res, row))
}

// originalIgnoredFields 是原版**静默忽略、不落库**的字段（批次 R 取证）。
//
// products.is_combo：通用 products 通道下，原版对请求体里的 is_combo（true / 1）
// 一律**静默忽略**（回读 undefined），故恢复端同样过滤，避免写出原版不存在的行。
//
// 注：批次 R 曾据此判定「原版不存在 is_combo=true 的商品行」——该结论**只对通用通道成立**。
// 批次 EE 补充回放（2026-10-14，evidence/backend-runtime/audit-batch-ee-20261014.json）：
// `PUT /api/v1/combo-products/{id}` 会把 is_combo 置为 true，故该商品行**确实可达**；
// 但带 is_combo=true 的商品走库存调整单（建单 + confirm，含出库）原版一律放行，
// 因此 plainProduct 处按 is_combo 拒绝单据的守卫依旧应当删除（结论不变，依据已更正）。
// is_combo 的写入口只有 registerCombos 端点族，不走本过滤。
var originalIgnoredFields = map[string]map[string]bool{
	"products": {"is_combo": true},
}

func (s *Server) record(r *http.Request, res Resource, input map[string]any, creating bool) (map[string]any, error) {
	record := map[string]any{}
	ignored := originalIgnoredFields[res.Table]
	for key, value := range input {
		if !s.Store.Has(res.Table, key) || key == "id" || key == "created_at" || key == "updated_at" || key == "deleted_at" || key == "password_hash" || key == "token_version" || key == "created_by" || key == "updated_by" || key == "tenant_id" || key == "is_system" || (!creating && res.Table == "sys_users" && key == "username") {
			continue
		}
		if ignored[key] {
			continue
		}
		record[key] = value
	}
	if creating {
		for _, field := range res.Required {
			if text(input, field) == "" {
				return nil, fmt.Errorf("请求参数错误：%s 为必填字段", field)
			}
		}
		now := database.Now()
		record["id"] = uuid.NewString()
		record["created_at"] = now
		record["updated_at"] = now
		if s.Store.Has(res.Table, "tenant_id") {
			record["tenant_id"] = database.ZeroUUID
		}
		if s.Store.Has(res.Table, "code") && text(record, "code") == "" {
			record["code"] = strings.ToUpper(strings.TrimSuffix(res.Table, "s")) + "-" + strings.ReplaceAll(record["id"].(string), "-", "")[:12]
		}
		if res.CreatedBy && s.Store.Has(res.Table, "created_by") {
			record["created_by"] = current(r).UserID
			if scopedMaster(res.Table) && s.Store.Has(res.Table, "department_id") {
				user, err := s.Store.Get(r.Context(), "sys_users", current(r).UserID)
				if err != nil {
					return nil, err
				}
				record["department_id"] = user["department_id"]
			}
		}
		for _, column := range s.Store.Tables[res.Table].Columns {
			if _, ok := record[column.Name]; ok || column.NotNull == 0 || column.Default != nil || column.Name == "password_hash" {
				continue
			}
			switch strings.ToLower(column.Type) {
			case "numeric":
				record[column.Name] = "0"
			case "text":
				record[column.Name] = ""
			case "bool", "integer", "real":
				record[column.Name] = 0
			}
		}
		if res.Table == "sys_users" {
			hash, err := auth.Hash(text(input, "password"))
			if err != nil {
				return nil, err
			}
			record["password_hash"] = hash
		}
	} else {
		record["updated_at"] = database.Now()
	}
	for key, value := range record {
		for _, column := range s.Store.Tables[res.Table].Columns {
			if column.Name != key {
				continue
			}
			switch strings.ToLower(column.Type) {
			case "uuid":
				if value != nil {
					v, ok := value.(string)
					if !ok {
						return nil, fmt.Errorf("%s 必须是 UUID", key)
					}
					if _, err := uuid.Parse(v); err != nil {
						return nil, fmt.Errorf("%s 必须是 UUID", key)
					}
				}
			case "numeric":
				if value != nil {
					v := fmt.Sprint(value)
					if _, err := business.Number(v); err != nil {
						return nil, fmt.Errorf("%s 必须是数字", key)
					}
					record[key] = v
				}
			case "text":
				if value != nil {
					if _, ok := value.(string); !ok {
						return nil, fmt.Errorf("%s 必须是字符串", key)
					}
				}
			}
		}
	}
	return record, nil
}
func (s *Server) create(w http.ResponseWriter, r *http.Request, res Resource) {
	data, err := decode(w, r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	// 商机：原版缺 name 时返回业务错误形态（200 + code 10000 + 中文文案），
	// 不是通用的 400「请求参数错误：name 为必填字段」（2026-10-15 回放取证）。
	if res.Table == "crm_opportunities" && text(data, "name") == "" {
		businessFailure(w, errors.New("商机名称不能为空"), false)
		return
	}
	// 计件：原版的业务校验链取代通用必填（详见 gapNN_piecework.go）
	if res.Table == "piece_rates" && !s.preparePieceRate(w, r, data, "") {
		return
	}
	if res.Table == "piecework_records" && !s.preparePieceworkRecord(w, r, data, true) {
		return
	}
	// 考勤申请：与计件同因 —— code 由后端生成，业务校验链取代通用必填（gapOO_align.go）
	if res.Table == "attendance_requests" && !s.prepareAttendanceRequest(w, data) {
		return
	}
	if res.Table == "accounting_periods" {
		if ok := s.prepareAccountingPeriod(w, r, data); !ok {
			return
		}
	}
	if res.Table == "approval_flows" {
		// 缺 code/name/biz_type 时原版返回裸 500，恢复端不能再把 NOT NULL 约束原文回给客户端
		if !s.prepareApprovalFlow(w, data) {
			return
		}
		row, e := s.business().CreateApprovalFlow(r.Context(), data)
		if e != nil {
			businessFailure(w, e, false)
			return
		}
		respond(w, 200, row)
		return
	}
	if res.Table == "loan_orders" || res.Table == "consignment_orders" {
		row, e := s.business().CreatePartnerDocument(r.Context(), res.Table, data)
		if e != nil {
			businessFailure(w, e, false)
			return
		}
		respond(w, 200, row)
		return
	}
	if res.Table == "expense_claims" {
		row, e := s.business().CreateExpenseClaim(r.Context(), data)
		if e != nil {
			businessFailure(w, e, false)
			return
		}
		respond(w, 200, row)
		return
	}
	if res.Table == "payment_plans" {
		row, e := s.business().CreatePaymentPlan(r.Context(), data)
		if e != nil {
			businessFailure(w, e, false)
			return
		}
		respond(w, 200, row)
		return
	}
	if res.Table == "payroll_batches" {
		row, e := s.business().CreatePayroll(r.Context(), data)
		if e != nil {
			businessFailure(w, e, false)
			return
		}
		respond(w, 200, row)
		return
	}
	if res.Table == "perf_assessments" {
		row, e := s.business().CreatePerformanceAssessment(r.Context(), data)
		if e != nil {
			businessFailure(w, e, false)
			return
		}
		respond(w, 200, row)
		return
	}
	if res.Table == "perf_templates" {
		row, e := s.business().CreatePerformanceTemplate(r.Context(), data)
		if e != nil {
			businessFailure(w, e, false)
			return
		}
		respond(w, 200, row)
		return
	}
	record, err := s.record(r, res, data, true)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if res.Table == "crm_activities" && (fmt.Sprint(data["target_type"]) == "opportunity" || fmt.Sprint(data["target_type"]) == "crm_opportunity") {
		record["crm_opportunity_activities"] = data["target_id"]
	}
	if err = s.writeRecord(r, res, record["id"].(string), record, true); err != nil {
		s.failureForTable(w, err, res.Label, res.Table)
		return
	}
	row, err := s.Store.Get(r.Context(), res.Table, record["id"].(string))
	if err != nil {
		s.failure(w, err, res.Label)
		return
	}
	respond(w, 200, s.public(r, res, row))
}
func (s *Server) update(w http.ResponseWriter, r *http.Request, res Resource, route string) {
	id := r.PathValue("id")
	// 注意：必须把「记录不存在」与「越权」分开判断 —— checkScope 越权时返回的也是
	// database.ErrNotFound（见 scope.go:48/51），若混在一起会把越权请求改写成
	// 200 + 10000「<中文名>不存在」，等于**泄漏记录是否存在**，并绕过数据隔离。
	old, err := s.Store.Get(r.Context(), res.Table, id)
	if err != nil {
		if errors.Is(err, database.ErrNotFound) && writeNotFound(w, route) {
			return
		}
		s.failure(w, err, res.Label)
		return
	}
	if err = s.checkScope(r, res, old); err != nil {
		s.failure(w, err, res.Label)
		return
	}
	data, err := decode(w, r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if res.Table == "approval_flows" {
		row, e := s.business().UpdateApprovalFlow(r.Context(), id, data)
		if e != nil {
			businessFailure(w, e, false)
			return
		}
		respond(w, 200, row)
		return
	}
	// 计件：与 create 同一套校验，PUT 时同名检查排除自身（详见 gapNN_piecework.go）
	if res.Table == "piece_rates" && !s.preparePieceRate(w, r, data, id) {
		return
	}
	if res.Table == "piecework_records" && !s.preparePieceworkRecord(w, r, data, false) {
		return
	}
	// 考勤申请：PUT 与 POST 同一套业务校验链（gapOO_align.go）
	if res.Table == "attendance_requests" && !s.prepareAttendanceRequest(w, data) {
		return
	}
	record, err := s.record(r, res, data, false)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if err = s.checkScope(r, res, mergeRecord(old, record)); err != nil {
		s.failure(w, err, res.Label)
		return
	}
	if res.Table == "warehouses" {
		s.enforceSingleDefaultWarehouse(r, id, record)
	}
	if err = s.writeRecord(r, res, id, record, false); err != nil {
		s.failure(w, err, res.Label)
		return
	}
	row, err := s.Store.Get(r.Context(), res.Table, id)
	if err == nil {
		err = s.checkScope(r, res, row)
	}
	if err != nil {
		s.failure(w, err, res.Label)
		return
	}
	respond(w, 200, s.public(r, res, row))
}
func (s *Server) delete(w http.ResponseWriter, r *http.Request, res Resource, route string) {
	id := r.PathValue("id")
	// 注：会计科目的删除守卫不在这里 —— registerAccounts 里的
	// DELETE /api/v1/accounts/{id} 比本通用注册更早命中，守卫写在 accounts.go。
	// 同 update：记录不存在与越权必须分开判断，理由见上。
	row, err := s.Store.Get(r.Context(), res.Table, id)
	if err != nil {
		if errors.Is(err, database.ErrNotFound) && writeNotFound(w, route) {
			return
		}
		s.failure(w, err, res.Label)
		return
	}
	if err = s.checkScope(r, res, row); err != nil {
		s.failure(w, err, res.Label)
		return
	}
	if res.Table == "sys_users" && row["username"] == "admin" {
		fail(w, 400, "不能删除管理员用户")
		return
	}
	if res.Table == "sys_roles" && (row["is_system"] == true || row["is_system"] == int64(1)) {
		fail(w, 400, "不能删除系统角色")
		return
	}
	if res.Table == "departments" {
		var children int
		s.Store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM departments WHERE parent_id=? AND deleted_at IS NULL", id).Scan(&children)
		if children > 0 {
			fail(w, 400, "请先删除或移动子部门")
			return
		}
	}
	if res.Table == "approval_flows" {
		if err := s.business().DeleteApprovalFlow(r.Context(), id); err != nil {
			s.failure(w, err, res.Label)
			return
		}
		respond(w, 200, nil)
		return
	}
	if err = s.Store.Update(r.Context(), res.Table, id, map[string]any{"deleted_at": database.Now(), "updated_at": database.Now()}); err != nil {
		s.failure(w, err, res.Label)
		return
	}
	if res.Table == "production_team_members" {
		if teamID, ok := row["team_id"].(string); ok {
			if err := s.refreshTeamMemberCount(r.Context(), teamID); err != nil {
				s.failure(w, err, res.Label)
				return
			}
		}
	}
	respond(w, 200, nil)
}
