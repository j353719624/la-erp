package api

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"la-erp/backend/internal/database"
)

// 本文件承载批次 KK 恢复的写路径（2026-10-15 原版回放 192.168.110.97:18886）。
//
// 起因：批次 KK 把路由对账从「只看路由存在性」升级为「逐方法语义比对」后，
// 暴露出 4 组写路径在恢复端完全没有实现（落到 /api/ 兜底 → 501「尚未实现」），
// 而前端在 `frontend/src/api/` 里确实调用它们：
//
//	① price-lists（POST/PUT/DELETE + price 子资源）
//	② permissions（POST/PUT/DELETE）
//	③ shareholders（POST/PUT/DELETE）、console/companies（POST/PUT）
//	④ purchase-reconciliations/generate、piecework-records/import-processes
//
// 证据：evidence/backend-runtime/audit-batch-kk-20261015.json（72 条回放）
//
// 每处的状态码与文案都逐字取自回放，注释里标注对应的步骤号，便于回查。

// registerGapKKWrites 注册批次 KK 恢复的写路径。
func (s *Server) registerGapKKWrites() {
	s.registerPriceListWrites()
	s.registerPermissionWrites()
	s.registerShareholderWrites()
	s.registerCompanyWrites()
	s.registerGapKKActions()
	s.registerContractOptions()
	s.registerReconciliationWrites()
}

// ── ⑥ sales-contracts/options ────────────────────────────────────────────
//
// 前端 `salesContractApi.options()`（frontend/src/api/order.ts:447）在销售订单表单的
// 「关联合同」下拉里调用。恢复端此前没有这个端点，请求落到
// `GET /sales-contracts/{id}` 通配上被当作 id 解析，返回 400「无效的 ID」——
// 表现为下拉框永远加载不出来。
//
// 原版实测（2026-10-15）：
//
//	· 返回**裸数组**，不是 {list,total}
//	· 可选 customer_id 过滤；零 UUID → 空数组（不是错误）
//	· **排除 status='cancelled'**：取消一张合同后 options 条数 5 → 4
//	· 但**包含 status='draft'**（取消前后 draft 都在返回里），
//	  即过滤条件是「非 cancelled」而非「仅 active」
//	  ——前端注释写的「已取消合同不返回」是对的，但别误实现成只返回 active。
func (s *Server) registerContractOptions() {
	s.mux.Handle("GET /api/v1/sales-contracts/options", s.protected("sales_contract_list", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := "SELECT * FROM sales_contracts WHERE deleted_at IS NULL AND status != 'cancelled'"
		args := []any{}
		if customerID := r.URL.Query().Get("customer_id"); customerID != "" {
			query += " AND customer_id=?"
			args = append(args, customerID)
		}
		query += " ORDER BY created_at DESC"
		rows, err := s.Store.Rows(r.Context(), query, args...)
		if err != nil {
			s.failure(w, err, "销售合同")
			return
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			items = append(items, s.Store.Public("sales_contracts", row))
		}
		respond(w, 200, items)
	})))
}

// ── ① price-lists ────────────────────────────────────────────────────────
//
// 回放实测：
//
//	KK-1  POST {}                      → 400 请求参数错误: Key: 'createPriceListRequest.Name'
//	                                        Error:Field validation for 'Name' failed on the 'required' tag
//	KK-2  POST {name}                  → 200 success，回传记录（默认 status=active）
//	KK-3  POST {name} 重复             → 200 success，**不查重**（同名可再建一条）
//	KK-6  PUT 改名称                   → 200 success，data:null
//	KK-7  PUT 不存在的 id              → 500 系统内部错误，请稍后重试或联系管理员
//	KK-8  DELETE 不存在的 id           → 500 同上
//	KK-9  PUT /price-lists/price 空 id → 400 无效的价目表ID
//	KK-10 DELETE /price-lists/price    → 400 同上
//	KK-11 DELETE 启用中的真实记录      → 200 code:10000「启用中的价目表不能删除，请先停用」
//
// 注意 KK-3：原版**不校验重名**，故此处不加唯一性检查（加了就是自造规则）。
// 注意 KK-7/8：原版对不存在记录回 500 通用文案而非 404，照实复刻。
const priceListValidatorMsg = "请求参数错误: Key: 'createPriceListRequest.Name' Error:Field validation for 'Name' failed on the 'required' tag"

func (s *Server) registerPriceListWrites() {
	base := "/api/v1/price-lists"

	s.mux.Handle("POST "+base, s.protected("price_list_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if text(body, "name") == "" {
			fail(w, 400, priceListValidatorMsg)
			return
		}
		record := map[string]any{
			"id":         uuidNew(),
			"created_at": database.Now(),
			"updated_at": database.Now(),
			"tenant_id":  database.ZeroUUID,
			"created_by": current(r).UserID,
		}
		// 只写入请求体里出现的列；list_type / currency / status 走表默认值
		for key, value := range body {
			if key == "id" || key == "created_at" || key == "updated_at" || key == "deleted_at" || key == "tenant_id" || key == "created_by" {
				continue
			}
			if s.Store.Has("price_lists", key) {
				record[key] = value
			}
		}
		if err = s.Store.Insert(r.Context(), "price_lists", record); err != nil {
			s.failure(w, err, "价目表")
			return
		}
		row, err := s.Store.Get(r.Context(), "price_lists", record["id"].(string))
		if err != nil {
			s.failure(w, err, "价目表")
			return
		}
		respond(w, 200, s.Store.Public("price_lists", row))
	})))

	s.mux.Handle("PUT "+base+"/{id}", s.protected("price_list_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		_, err = s.Store.Get(r.Context(), "price_lists", r.PathValue("id"))
		if err != nil {
			// 回放 KK-7：原版对不存在的记录回 500 通用文案（不是 404）
			if errors.Is(err, database.ErrNotFound) {
				fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
				return
			}
			s.failure(w, err, "价目表")
			return
		}
		updates := map[string]any{"updated_at": database.Now()}
		for key, value := range body {
			if key == "id" || key == "created_at" || key == "updated_at" || key == "deleted_at" || key == "tenant_id" {
				continue
			}
			if s.Store.Has("price_lists", key) {
				updates[key] = value
			}
		}
		if err = s.Store.Update(r.Context(), "price_lists", r.PathValue("id"), updates); err != nil {
			s.failure(w, err, "价目表")
			return
		}
		respond(w, 200, nil)
	})))

	s.mux.Handle("DELETE "+base+"/{id}", s.protected("price_list_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "price_lists", r.PathValue("id"))
		if err != nil {
			// 回放 KK-8：同 PUT，也是 500 通用文案
			if errors.Is(err, database.ErrNotFound) {
				fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
				return
			}
			s.failure(w, err, "价目表")
			return
		}
		// 回放 KK-11：启用中的价目表不能删，业务错误形态是 200 + code 10000
		if text(row, "status") != "" && text(row, "status") != "inactive" {
			businessFailure(w, errors.New("启用中的价目表不能删除，请先停用"), false)
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "price_lists", r.PathValue("id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
			s.failure(w, err, "价目表")
			return
		}
		respond(w, 200, nil)
	})))

	// /price-lists/price —— 价目表条目维护。回放 KK-9/KK-10 取到的是
	// 「无效的价目表ID」，即该子资源靠查询参数 price_list_id 定位父记录，
	// 缺参数即 400。条目本身的增删改语义未取证（前端未调用），故只实现
	// 原版已取证的参数校验分支，不自造条目逻辑。
	s.mux.Handle("PUT "+base+"/price", s.protected("price_list_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail(w, 400, "无效的价目表ID")
	})))
	s.mux.Handle("DELETE "+base+"/price", s.protected("price_list_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail(w, 400, "无效的价目表ID")
	})))
}

// ── ② permissions ────────────────────────────────────────────────────────
//
// 回放实测：
//
//	KK-12 POST {}                 → 400 四个字段全 required（Code/Name/Module/Type）
//	KK-13 POST {code}             → 400 剩 Name/Module/Type
//	KK-14 POST {code,name}        → 400 剩 Module/Type
//	KK-15 POST {code,name,module} → 400 剩 Type
//	KK-16 POST 全字段             → 200 success
//	KK-t-* type 取 button/action/api/page/menu/invalid_type **全部接受**，
//	         说明 type 不是枚举、不校验取值
//	KK-17 PUT                     → 200 success，回传更新后的记录
//	KK-18 DELETE                  → 200 success，data:null
//	KK-19 PUT 不存在的 id         → 200 code:10000「权限不存在」（不是 404）
//	KK-20 DELETE 不存在的 id      → 200 code:10000 同上
//
// 注意 KK-12~15：原版一次性列出**所有**缺失字段（不是遇到第一个就停），
// 且每行以 \n 分隔，故必须逐字段收集后一次输出，顺序为 Code/Name/Module/Type。
func permissionValidatorMsg(missing []string) string {
	lines := make([]string, 0, len(missing))
	for _, field := range missing {
		lines = append(lines, "Key: 'CreatePermissionRequest."+field+
			"' Error:Field validation for '"+field+"' failed on the 'required' tag")
	}
	return "请求参数错误: " + strings.Join(lines, "\n")
}

func (s *Server) registerPermissionWrites() {
	base := "/api/v1/permissions"

	s.mux.Handle("POST "+base, s.protected("permission_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		// 回放 KK-12~15：按固定顺序收集全部缺失字段
		missing := []string{}
		for _, field := range []string{"Code", "Name", "Module", "Type"} {
			key := strings.ToLower(field[:1]) + field[1:]
			if text(body, key) == "" {
				missing = append(missing, field)
			}
		}
		if len(missing) > 0 {
			fail(w, 400, permissionValidatorMsg(missing))
			return
		}
		record := map[string]any{
			"id":         uuidNew(),
			"created_at": database.Now(),
			"updated_at": database.Now(),
			"code":       text(body, "code"),
			"name":       text(body, "name"),
			"module":     text(body, "module"),
			"type":       text(body, "type"),
		}
		if body["sort_order"] != nil {
			record["sort_order"] = body["sort_order"]
		}
		if body["parent_id"] != nil {
			record["parent_id"] = body["parent_id"]
		}
		if err = s.Store.Insert(r.Context(), "sys_permissions", record); err != nil {
			s.failure(w, err, "权限")
			return
		}
		row, err := s.Store.Get(r.Context(), "sys_permissions", record["id"].(string))
		if err != nil {
			s.failure(w, err, "权限")
			return
		}
		respond(w, 200, s.Store.Public("sys_permissions", row))
	})))

	s.mux.Handle("PUT "+base+"/{id}", s.protected("permission_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 批次 PP（2026-10-15）：非法 UUID → 400「无效的权限ID」
		// （tools/replay-batch-oo-badid.js，audit-batch-oo-badid-20261015.json）。
		// 权限表在 register() 里提前 return，不经过通用守卫，故在此补。
		if _, err := uuid.Parse(r.PathValue("id")); err != nil {
			fail(w, 400, badIDMessage("sys_permissions"))
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		row, err := s.Store.Get(r.Context(), "sys_permissions", r.PathValue("id"))
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				// 回放 KK-19：业务错误形态（200 + 10000），不是 404
				businessFailure(w, errors.New("权限不存在"), false)
				return
			}
			s.failure(w, err, "权限")
			return
		}
		updates := map[string]any{"updated_at": database.Now()}
		for _, key := range []string{"code", "name", "module", "type", "sort_order", "parent_id"} {
			if value, ok := body[key]; ok {
				updates[key] = value
			}
		}
		if err = s.Store.Update(r.Context(), "sys_permissions", text(row, "id"), updates); err != nil {
			s.failure(w, err, "权限")
			return
		}
		updated, err := s.Store.Get(r.Context(), "sys_permissions", text(row, "id"))
		if err != nil {
			s.failure(w, err, "权限")
			return
		}
		respond(w, 200, s.Store.Public("sys_permissions", updated))
	})))

	s.mux.Handle("DELETE "+base+"/{id}", s.protected("permission_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 批次 PP（2026-10-15）：非法 UUID → 400「无效的权限ID」（同上）。
		if _, err := uuid.Parse(r.PathValue("id")); err != nil {
			fail(w, 400, badIDMessage("sys_permissions"))
			return
		}
		row, err := s.Store.Get(r.Context(), "sys_permissions", r.PathValue("id"))
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				businessFailure(w, errors.New("权限不存在"), false)
				return
			}
			s.failure(w, err, "权限")
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "sys_permissions", text(row, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
			s.failure(w, err, "权限")
			return
		}
		respond(w, 200, nil)
	})))
}

// ── ③ shareholders ───────────────────────────────────────────────────────
//
// 回放实测：
//
//	KK-21 POST {}              → 400「股东名称不能为空」
//	KK-22 POST {name}          → 200 success，默认 holder_type=natural、
//	                             share_ratio="0"、capital="0"、is_active=true
//	KK-23 POST 重名            → 200 success，**不查重**
//	KK-24 PUT 改股东           → 200 success，data:null
//	KK-25 DELETE 股东          → 200 success，data:null
//	KK-26 PUT 不存在的 id      → 400「股东不存在」（注意是 400 不是 404）
//	KK-27 DELETE 不存在的 id   → 400 同上
func (s *Server) registerShareholderWrites() {
	base := "/api/v1/shareholders"

	s.mux.Handle("POST "+base, s.protected("shareholder_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if text(body, "name") == "" {
			fail(w, 400, "股东名称不能为空")
			return
		}
		record := map[string]any{
			"id":         uuidNew(),
			"created_at": database.Now(),
			"updated_at": database.Now(),
			"tenant_id":  database.ZeroUUID,
			"created_by": current(r).UserID,
			"name":       text(body, "name"),
		}
		for key, value := range body {
			if key == "id" || key == "created_at" || key == "updated_at" || key == "deleted_at" || key == "tenant_id" || key == "created_by" || key == "name" {
				continue
			}
			if s.Store.Has("shareholders", key) {
				record[key] = value
			}
		}
		if err = s.Store.Insert(r.Context(), "shareholders", record); err != nil {
			s.failure(w, err, "股东")
			return
		}
		row, err := s.Store.Get(r.Context(), "shareholders", record["id"].(string))
		if err != nil {
			s.failure(w, err, "股东")
			return
		}
		respond(w, 200, s.Store.Public("shareholders", row))
	})))

	for _, spec := range []struct {
		method     string
		permission string
		soft       bool
	}{
		{"PUT", "shareholder_edit", false},
		{"DELETE", "shareholder_delete", true},
	} {
		s.mux.Handle(spec.method+" "+base+"/{id}", s.protected(spec.permission, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body := map[string]any{}
			if spec.method == "PUT" {
				decoded, err := decode(w, r)
				if err != nil {
					fail(w, 400, err.Error())
					return
				}
				body = decoded
			}
			row, err := s.Store.Get(r.Context(), "shareholders", r.PathValue("id"))
			if err != nil {
				if errors.Is(err, database.ErrNotFound) {
					// 回放 KK-26/27：原版是 400，不是 404
					fail(w, 400, "股东不存在")
					return
				}
				s.failure(w, err, "股东")
				return
			}
			updates := map[string]any{"updated_at": database.Now()}
			for key, value := range body {
				if key == "id" || key == "created_at" || key == "updated_at" || key == "deleted_at" || key == "tenant_id" {
					continue
				}
				if s.Store.Has("shareholders", key) {
					updates[key] = value
				}
			}
			if spec.soft {
				updates["deleted_at"] = database.Now()
			}
			if err = s.Store.Update(r.Context(), "shareholders", text(row, "id"), updates); err != nil {
				s.failure(w, err, "股东")
				return
			}
			respond(w, 200, nil)
		})))
	}
}

// ── ④ console/companies ──────────────────────────────────────────────────
//
// 回放实测（KK-29 / KK-code-* / KK-30 / KK-31）：
//
//	POST {}                    → 200 code:10000「公司编码需以小写字母开头，仅含小写字母/数字/下划线，2~20 位」
//	POST {code:"Abc"}          → 200 code:10000 同上（首字母大写不合法）
//	POST {code:"A"}            → 200 code:10000 同上（长度不足 2 位）
//	POST {code:"abc"}          → 200 code:10000「公司编码 abc 已存在」
//	POST {code:"ab"}           → 200 code:10000「公司编码 ab 已存在」
//	POST {code:"kk_company_x"} → 200 success
//	POST {code:"k1"}           → 200 success
//	POST {code:"kk-company"}   → 200 code:10000 格式错误（连字符不合法）
//	PUT  /{不存在的 id}        → 200 code:10000「公司不存在」
//
// 编码规则因此为 `^[a-z][a-z0-9_]{1,19}$`：首字符小写字母，整体 2~20 位，
// 其余只允许小写字母/数字/下划线。注意「已存在」检查发生在格式校验**之后**
// （"Abc" 报的是格式错而非已存在）。
//
// 重要副作用（回放 KK 自身踩到）：一旦在原版建出第 2 家公司，
// `POST /api/v1/auth/login` 就**必须带 company 字段**，否则返回
// 400「请选择公司后再登录」。故本实现里建公司时同步写入公司表，
// 但**不切换登录逻辑**（恢复端是单公司模式），避免引入原版没有的复杂度。
var companyCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{1,19}$`)

func (s *Server) registerCompanyWrites() {
	base := "/api/v1/console/companies"

	s.mux.Handle("POST "+base, s.protected("company_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		code := text(body, "code")
		if !companyCodePattern.MatchString(code) {
			businessFailure(w, errors.New("公司编码需以小写字母开头，仅含小写字母/数字/下划线，2~20 位"), false)
			return
		}
		// 「已存在」检查在格式校验之后（回放 KK-code-Abc 报的是格式错）
		existing, err := s.Store.Rows(r.Context(), "SELECT id FROM companies WHERE deleted_at IS NULL AND code=?", code)
		if err != nil {
			s.failure(w, err, "公司")
			return
		}
		if len(existing) > 0 {
			businessFailure(w, errors.New("公司编码 "+code+" 已存在"), false)
			return
		}
		record := map[string]any{
			"id":         uuidNew(),
			"created_at": database.Now(),
			"updated_at": database.Now(),
			"code":       code,
			"name":       text(body, "name"),
			"status":     "active",
		}
		if body["db_path"] != nil {
			record["db_path"] = body["db_path"]
		}
		if !s.Store.Has("companies", "db_path") {
			delete(record, "db_path")
		}
		if err = s.Store.Insert(r.Context(), "companies", record); err != nil {
			s.failure(w, err, "公司")
			return
		}
		row, err := s.Store.Get(r.Context(), "companies", record["id"].(string))
		if err != nil {
			s.failure(w, err, "公司")
			return
		}
		respond(w, 200, s.Store.Public("companies", row))
	})))

	s.mux.Handle("PUT "+base+"/{id}", s.protected("company_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		row, err := s.Store.Get(r.Context(), "companies", r.PathValue("id"))
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				businessFailure(w, errors.New("公司不存在"), false)
				return
			}
			s.failure(w, err, "公司")
			return
		}
		updates := map[string]any{"updated_at": database.Now()}
		for _, key := range []string{"name", "status", "db_path"} {
			if value, ok := body[key]; ok && s.Store.Has("companies", key) {
				updates[key] = value
			}
		}
		if err = s.Store.Update(r.Context(), "companies", text(row, "id"), updates); err != nil {
			s.failure(w, err, "公司")
			return
		}
		respond(w, 200, nil)
	})))
}

// ── ⑤ purchase-reconciliations/generate 与 piecework-records/import-processes ──
//
// 初版取证的参数名是错的，这里记录订正过程（避免后人重犯）：
// `period` **不是**原版的参数名。原版校验的是 `period_start` / `period_end`
// 两个日期，**都必填**、格式 YYYY-MM-DD：
//
//	{supplier_id}                                → 400 期间格式无效（应为 YYYY-MM-DD）
//	{supplier_id, period_start}                  → 400 同上（缺 period_end）
//	{supplier_id, period_start, period_end}      → 200 success
//	{supplier_id, period_start:"bad", …}         → 400 期间格式无效
//	{supplier_id, period_start:"2026-13-01", …}  → 400 期间格式无效（月份也要合法）
//	{period_start, period_end}（无 supplier_id） → 200 code:10000「请选择供应商」
//	{supplier_id: 零UUID, …}                     → 200 code:10000「请选择供应商」
//
// 成功时生成的记录形态（实测连续两张）：
//
//	code                = CGDZ{yyyymmdd}{3 位日流水}（CGDZ202610150001 / …002）
//	status              = draft
//	period_start/end    = 归一为当天 00:00:00+08:00 的 RFC3339
//	begin_balance / period_in / period_out / end_balance = 0
//	supplier_end_balance / diff_amount = null
//
// 注意校验顺序：供应商存在性在**期间格式校验之后**
// （零 UUID + 合法期间才报「请选择供应商」），顺序不能颠倒。
func (s *Server) registerGapKKActions() {
	s.mux.Handle("POST /api/v1/purchase-reconciliations/generate", s.protected("purchase_reconciliation_list", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		cst := time.FixedZone("CST", 8*60*60)
		start, startErr := timeParse("2006-01-02", text(body, "period_start"))
		end, endErr := timeParse("2006-01-02", text(body, "period_end"))
		if startErr != nil || endErr != nil {
			fail(w, 400, "期间格式无效（应为 YYYY-MM-DD）")
			return
		}
		supplierID := text(body, "supplier_id")
		if supplierID == "" || supplierID == database.ZeroUUID {
			businessFailure(w, errors.New("请选择供应商"), false)
			return
		}
		supplier, err := s.Store.Get(r.Context(), "suppliers", supplierID)
		if err != nil {
			businessFailure(w, errors.New("请选择供应商"), false)
			return
		}
		number, err := s.nextReconciliationNumber(r)
		if err != nil {
			s.failure(w, err, "对账单")
			return
		}
		now := database.Now()
		record := map[string]any{
			"id":            uuidNew(),
			"created_at":    now,
			"updated_at":    now,
			"code":          number,
			"supplier_id":   supplierID,
			"supplier_name": text(supplier, "name"),
			"period_start":  start.In(cst).Format(time.RFC3339),
			"period_end":    end.In(cst).Format(time.RFC3339),
			"status":        "draft",
			// 本期无对账数据时四项金额均为 0，与原版实测一致
			"begin_balance": 0,
			"period_in":     0,
			"period_out":    0,
			"end_balance":   0,
			"tenant_id":     database.ZeroUUID,
			"created_by":    current(r).UserID,
		}
		if remark := text(body, "remark"); remark != "" {
			record["remark"] = remark
		}
		if err = s.Store.Insert(r.Context(), "purchase_reconciliations", record); err != nil {
			s.failure(w, err, "对账单")
			return
		}
		row, err := s.Store.Get(r.Context(), "purchase_reconciliations", record["id"].(string))
		if err != nil {
			s.failure(w, err, "对账单")
			return
		}
		respond(w, 200, s.Store.Public("purchase_reconciliations", row))
	})))

	s.mux.Handle("POST /api/v1/piecework-records/import-processes", s.protected("piecework_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		ids, _ := body["process_ids"].([]any)
		if len(ids) == 0 {
			// 回放 KK-34/35：缺参数与空数组落到同一分支
			businessFailure(w, errors.New("请选择要导入的工序报工"), false)
			return
		}
		// 逐条导入的落库语义未取证（需真实工序报工数据），不自造。
		businessFailure(w, errors.New("请选择要导入的工序报工"), false)
	})))
}

// nextReconciliationNumber 生成 CGDZ{yyyymmdd}{3 位日流水}。
// 实测原版同日两张对账单是 …001 / …002，故流水按「当日已有条数 +1」递增。
func (s *Server) nextReconciliationNumber(r *http.Request) (string, error) {
	day := time.Now().In(time.FixedZone("CST", 8*60*60)).Format("20060102")
	rows, err := s.Store.Rows(r.Context(),
		"SELECT code FROM purchase_reconciliations WHERE deleted_at IS NULL AND code LIKE ?",
		"CGDZ"+day+"%")
	if err != nil {
		return "", err
	}
	return "CGDZ" + day + fmt.Sprintf("%03d", len(rows)+1), nil
}

// uuidNew 生成主键。批次 KK 的各写路径都需要新 id，统一走这里。
func uuidNew() string { return uuid.NewString() }

// timeParse 解析月份级期间字符串。
func timeParse(layout, value string) (time.Time, error) { return time.Parse(layout, value) }

// hasMethod 判断切片里是否含某个 HTTP 方法。
// 注意不能叫 contains —— 同包的 database 包已导出 contains，方法集不同会冲突。
func hasMethod(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// indexOf 返回值在切片中的下标；不在时返回 -1。
func indexOf(list []string, value string) int {
	for i, item := range list {
		if item == value {
			return i
		}
	}
	return -1
}

// registerReconciliationWrites 补齐对账单的删除路径。
//
// 回放实测（2026-10-15）：前端 `purchaseReconApi.remove(id)` 会调
// `DELETE /purchase-reconciliations/{id}`，恢复端此前没注册（落 501）。
// 记录不存在时原版返回 200 + code 10000「对账单不存在」。
func (s *Server) registerReconciliationWrites() {
	s.mux.Handle("DELETE /api/v1/purchase-reconciliations/{id}", s.protected("purchase_reconciliation_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "purchase_reconciliations", r.PathValue("id"))
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				businessFailure(w, errors.New("对账单不存在"), false)
				return
			}
			s.failure(w, err, "对账单")
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "purchase_reconciliations", text(row, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
			s.failure(w, err, "对账单")
			return
		}
		respond(w, 200, nil)
	})))
}

// ── ⑧ 写路径「记录不存在」的形态（2026-10-15 逐条回放，66 处差异）─────────
//
// 起因：前两轮只核对了「路由在不在」「列表形状」，没核对过**写路径的失败形态**。
// 扫描器 tools/scan-write-labels.mjs 对 Resources 里每张表的 PUT/DELETE 各打一次
// 「不存在的 id」，发现 66 处不一致：
//
//	51 处：原版 200 + code 10000 + 中文文案，恢复端 404 + code 404
//	15 处：原版**没有**该写路由（404「路由不存在」），恢复端却注册了
//
// 两类的差异都不能用「统一 404」或「统一 10000」概括，故按实测逐条配置。
// 证据：evidence/backend-runtime/audit-batch-kk-write-labels-20261015.json

// writeNotFoundBusiness：写路径「记录不存在」时原版返回业务错误形态
// （HTTP 200 + code 10000）而非 404 的表，逐字文案取自原版回放。
// 键是路由名；同一路由的 PUT/DELETE 文案一致（回放已逐一确认）。
var writeNotFoundBusiness = map[string]string{
	"approval-flows":         "审批流程不存在",
	"attendance-requests":    "考勤申请不存在",
	"categories":             "分类不存在",
	"crm-activities":         "跟进记录不存在",
	"crm-opportunities":      "商机不存在",
	"customers":              "客户不存在",
	"departments":            "部门不存在",
	"employees":              "员工不存在",
	"expense-claims":         "报销单不存在",
	"fixed-assets":           "资产不存在",
	"labor-contracts":        "合同不存在",
	"leads":                  "线索不存在",
	"loan-orders":            "借出借入单不存在",
	"locations":              "库位不存在",
	"payrolls":               "工资批次不存在",
	"perf-assessments":       "考核单不存在",
	"perf-templates":         "考核模板不存在",
	"piecework-rates":        "计件单价不存在",
	"piecework-records":      "计件登记不存在",
	"products":               "商品不存在",
	"racks":                  "货架不存在",
	"recruitment-candidates": "候选人不存在",
	"recruitment-positions":  "招聘职位不存在",
	"roles":                  "角色不存在",
	"suppliers":              "供应商不存在",
	"training-records":       "培训记录不存在",
	"units":                  "计量单位不存在",
	"users":                  "用户不存在",
	"warehouses":             "仓库不存在",
}

// writeRouteAbsent：原版**没有**这些写路由（回放返回 404「路由不存在」），
// 恢复端不得自动补出，须逐字返回「路由不存在」。
// 注意是按「路由 + 方法」而非按表 —— 同一张表 DELETE 可能存在而 PUT 不存在
// （如 crm-activities / expense-claims / fixed-assets / leads 只有 DELETE）。
var writeRouteAbsent = map[string][]string{
	"accounting-periods":      {"PUT", "DELETE"},
	"approval-records":        {"PUT", "DELETE"},
	"crm-activities":          {"PUT"},
	"employee-changes":        {"PUT", "DELETE"},
	"equipment-maintenances":  {"PUT"},
	"expense-claims":          {"PUT"},
	"fixed-assets":            {"PUT"},
	"leads":                   {"PUT"},
	"payrolls":                {"PUT"},
	"production-team-members": {"PUT", "DELETE"},
	"tax-accruals":            {"PUT"},
}

// ── ⑨ 动作端点「记录不存在」的形态（批次 LL，2026-10-15）──────────────────
//
// 起因：前几轮核对了「路由存在性」「列表/详情形状」「写路径 notFound」，
// 但**从未核对动作端点（/{id}/confirm、/approve、/cancel…）的 notFound 形态**。
// 这些是前端高频按钮，文案错了用户立刻看到。
// tools/scan-action-labels.mjs 对 25 资源 × 36 动作做实际探测，
// 两端都存在的 40 组里 **35 组不一致**：
//
//	25 组：原版 200+10000+中文文案，恢复端 404+404
//	 5 组：形态同为 200/10000，但恢复端文案与原版不同
//	 3 组：原版 400，恢复端 404
//	 2 组：原版 500 通用文案，恢复端 200/10000
//
// 关键：同一资源的**不同动作文案可以不同**
// （如 purchase-requisitions 的 convert 是「采购申请单不存在」而 submit 是「采购申请不存在」），
// 故按「资源|动作」做键，不能按资源。
// 证据：evidence/backend-runtime/audit-batch-ll-actions-20261015.json

// actionNotFoundShape 是动作端点（/{id}/<action>）「记录不存在」时原版的形态。
// 由 tools/scan-action-labels.mjs 逐个实测（批次 LL，2026-10-15）得出，40 组里 35 组不一致。
// 键是「资源|动作」，值是 HTTP 状态码与业务文案。
type actionNotFound struct {
	http int
	code int
	text string
}

var actionNotFoundShapes = map[string]actionNotFound{
	"accounting-periods|close":      {200, 10000, "会计期间不存在"},
	"accounting-periods|reopen":     {200, 10000, "会计期间不存在"},
	"payrolls|confirm":              {200, 10000, "工资批次不存在"},
	"payment-plans|cancel":          {400, 400, "收付款计划不存在"},
	"payment-plans|receive":         {400, 400, "Key: 'QfOKnXbU28' Error:Field validation for 'QfOKnXbU28' failed on the 'required' tag"},
	"assemblies|confirm":            {500, 500, "系统内部错误，请稍后重试或联系管理员"},
	"assemblies|cancel":             {500, 500, "系统内部错误，请稍后重试或联系管理员"},
	"expense-claims|approve":        {200, 10000, "报销单不存在"},
	"expense-claims|cancel":         {200, 10000, "报销单不存在"},
	"expense-claims|submit":         {200, 10000, "报销单不存在"},
	"expense-claims|reject":         {200, 10000, "报销单不存在"},
	"labor-contracts|terminate":     {200, 10000, "合同不存在"},
	"purchase-requisitions|approve": {200, 10000, "采购申请单不存在"},
	"purchase-requisitions|cancel":  {200, 10000, "采购申请单不存在"},
	"purchase-requisitions|convert": {200, 10000, "采购申请不存在"},
	"purchase-requisitions|submit":  {200, 10000, "采购申请单不存在"},
	"purchase-requisitions|reject":  {200, 10000, "采购申请单不存在"},
	"purchase-rfqs|confirm":         {200, 10000, "询价单不存在"},
	"purchase-rfqs|cancel":          {200, 10000, "询价单不存在"},
	"purchase-rfqs|convert":         {200, 10000, "询价单不存在"},
	"sales-quotations|send":         {200, 10000, "销售报价单不存在"},
	"sales-quotations|convert":      {200, 10000, "销售报价不存在"},
	"sales-quotations|reject":       {200, 10000, "销售报价单不存在"},
	"sales-orders|confirm":          {200, 10000, "销售订单不存在"},
	"sales-orders|approve":          {200, 10000, "销售订单不存在"},
	"sales-orders|cancel":           {200, 10000, "销售订单不存在"},
	"sales-orders|close":            {200, 10000, "销售订单不存在"},
	"sales-orders|change":           {400, 400, "请求参数错误: Key: 'changeSalesOrderRequest.Reason' Error:Field validation for 'Reason' failed on the 'required' tag"},
	"work-order-processes|complete": {200, 10000, "工序不存在"},
	"work-order-processes|start":    {200, 10000, "工序不存在"},
	"work-order-processes|revert":   {200, 10000, "工序不存在"},
	"work-orders|confirm":           {200, 10000, "工单不存在"},
	"work-orders|approve":           {200, 10000, "工单不存在"},
	"work-orders|cancel":            {200, 10000, "工单不存在"},
	"work-orders|complete":          {200, 10000, "工单不存在"},
}

// uniqueConflictAsServerError 是「表 → 唯一约束冲突形态」的按表覆盖。
//
// 键是表名，值是原版实测的 HTTP 状态码与文案。
// 目前只有会计期间需要：原版的期间重叠检查只看日期区间，
// 「同 period 但日期不重叠」的请求绕过业务校验后直接撞唯一索引，
// 原版把它当未处理异常抛出，返回 500 通用文案而非业务错误。
// 证据：docs/UNSUPPORTED-AUDIT-LOG.md 37.8。
var uniqueConflictAsServerError = map[string]struct {
	http int
	text string
}{
	"accounting_periods": {500, "系统内部错误，请稍后重试或联系管理员"},
}
