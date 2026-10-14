// Package api contains recovered, explicitly implemented HTTP contracts.
// Missing business operations return 501; they never report a fabricated success.
package api

import (
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
	"attendance-requests":     {"attendance_requests", "attendance", "考勤申请", []string{"code", "employee_name", "request_type", "start_date"}, true},
	"recruitment-positions":   {"recruitment_positions", "recruitment", "招聘职位", []string{"code", "title"}, true},
	"recruitment-candidates":  {"recruitment_candidates", "recruitment", "招聘候选人", []string{"code", "name"}, true},
	"training-records":        {"training_records", "training", "培训记录", []string{"code", "title", "training_date"}, true},
	"perf-templates":          {"perf_templates", "performance", "绩效模板", []string{"name"}, true},
	"perf-assessments":        {"perf_assessments", "performance", "绩效考核", []string{"code", "employee_name", "period"}, true},
	"piecework-rates":         {"piece_rates", "piecework", "计件工资标准", []string{"name"}, true},
	"piecework-records":       {"piecework_records", "piecework", "计件工资记录", []string{"code", "employee_name", "item_name", "qty", "work_date"}, true},
	"approval-flows":          {"approval_flows", "approval", "审批流", []string{"code", "name", "biz_type"}, true},
	"approval-records":        {"approval_records", "approval", "审批记录", []string{"biz_type"}, true},
	"payrolls":                {"payroll_batches", "payroll", "工资批次", []string{"batch_no", "period"}, true},
	"payment-plans":           {"payment_plans", "payment", "收付款计划", []string{"plan_no", "plan_type", "total_amount"}, true},
	"tax-accruals":            {"tax_accruals", "tax", "税金计提", []string{"code", "period", "tax_type", "base_amount", "rate", "amount"}, true},
	"crm-opportunities":       {"crm_opportunities", "crm", "商机", []string{"code", "name"}, true},
	"crm-activities":          {"crm_activities", "crm", "跟进记录", []string{"target_type", "target_id", "type", "content"}, true},
	"expense-claims":          {"expense_claims", "expense", "费用报销", []string{"claim_no", "employee_name", "claim_date", "total_amount"}, true},
	"fixed-assets":            {"fixed_assets", "fixed_asset", "固定资产", []string{"asset_no", "name", "acquisition_date", "original_value"}, true},
	"loan-orders":             {"loan_orders", "warehouse", "借用单", []string{"loan_no", "loan_type", "warehouse_id"}, true},
	"consignments":            {"consignment_orders", "warehouse", "寄售单", []string{"consignment_no", "warehouse_id"}, true},
	"leads":                   {"leads", "crm", "线索", []string{"lead_no", "name"}, true},
	"employee-changes":        {"employee_changes", "employee", "员工异动", []string{"employee_id", "employee_name", "change_type", "effective_date"}, true},
	"accounting-periods":      {"accounting_periods", "accounting", "会计期间", []string{"period", "start_date", "end_date"}, false},
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
		period := text(input, "period")
		raw, ok := input["entries"].([]any)
		if period == "" || !ok {
			fail(w, 400, "period 和 entries 必填")
			return
		}
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
		data, err := s.Auth.CustomerLogin(r.Context(), account, password)
		if err != nil {
			fail(w, 401, err.Error())
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
		rows, err := s.Store.Rows(r.Context(), "SELECT c.id,c.name,COUNT(p.id) product_count FROM categories c JOIN products p ON p.category_id=c.id AND p.deleted_at IS NULL AND p.status='active' WHERE c.deleted_at IS NULL GROUP BY c.id,c.name ORDER BY c.name")
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, rows)
	}))
	s.mux.Handle("GET /api/v1/portal/products", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

func (s *Server) registerCRMActions() {
	s.mux.Handle("POST /api/v1/crm-opportunities/{id}/stage", s.protected("crm_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		stage, _ := input["stage"].(string)
		if stage == "" {
			fail(w, 400, "stage is required")
			return
		}
		allowed := map[string]bool{"prospecting": true, "qualification": true, "proposal": true, "negotiation": true, "won": true, "lost": true}
		if !allowed[stage] {
			fail(w, 400, "无效的商机阶段")
			return
		}
		current, err := s.Store.Get(r.Context(), "crm_opportunities", r.PathValue("id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		oldStage, _ := current["stage"].(string)
		if (oldStage == "won" || oldStage == "lost") && stage != oldStage {
			fail(w, 409, "终态商机不能回退")
			return
		}
		ch := map[string]any{"stage": stage, "updated_at": time.Now()}
		if v := input["lost_reason"]; v != nil {
			ch["lost_reason"] = v
		}
		if stage == "won" {
			ch["won_at"] = time.Now()
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
		next.ServeHTTP(w, r)
	}))
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
	var validation *validationError
	if errors.As(err, &validation) {
		fail(w, 400, validation.Error())
	} else if errors.Is(err, database.ErrNotFound) {
		fail(w, 404, label+"不存在")
	} else if strings.Contains(err.Error(), "UNIQUE constraint") {
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
	s.mux.Handle("GET "+base+"/{id}", s.protected(view, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.get(w, r, res) })))
	if name == "permissions" {
		return
	}
	s.mux.Handle("POST "+base, s.protected(res.Permission+"_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.create(w, r, res) })))
	s.mux.Handle("PUT "+base+"/{id}", s.protected(res.Permission+"_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.update(w, r, res) })))
	s.mux.Handle("DELETE "+base+"/{id}", s.protected(res.Permission+"_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.delete(w, r, res) })))
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
	if res.Table == "approval_flows" {
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
		s.failure(w, err, res.Label)
		return
	}
	row, err := s.Store.Get(r.Context(), res.Table, record["id"].(string))
	if err != nil {
		s.failure(w, err, res.Label)
		return
	}
	respond(w, 200, s.public(r, res, row))
}
func (s *Server) update(w http.ResponseWriter, r *http.Request, res Resource) {
	id := r.PathValue("id")
	old, err := s.Store.Get(r.Context(), res.Table, id)
	if err == nil {
		err = s.checkScope(r, res, old)
	}
	if err != nil {
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
func (s *Server) delete(w http.ResponseWriter, r *http.Request, res Resource) {
	id := r.PathValue("id")
	row, err := s.Store.Get(r.Context(), res.Table, id)
	if err == nil {
		err = s.checkScope(r, res, row)
	}
	if err != nil {
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
