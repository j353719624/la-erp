package api

// platform.go —— 平台/设置类端点（批次 FF，2026-10-14）。
//
// 路由覆盖对账（tools/audit-route-coverage.mjs，1158 个候选路径）查出
// 既有实现有、本实现无的 94 条路径；本文件收敛其中「平台与设置」一族：
//
//	GET  /api/v1/audit-logs            操作日志分页（username/action/起止日期过滤）
//	GET  /api/v1/console/companies     部署控制台公司清单（单公司部署返回 1 条）
//	GET  /api/v1/public/company        登录页公司名/LOGO（免认证）
//	GET  /api/v1/license/machine-code  机器码（客服组件与授权激活用）
//	POST /api/v1/license/activate      授权激活（文件/粘贴内容）
//	GET  /api/v1/dict/types            字典类型（含条目数）
//	GET  /api/v1/dict/items            字典条目（type_code 过滤）
//	POST /api/v1/dict/items            新增条目
//	PUT  /api/v1/dict/items/{id}       编辑条目
//	DELETE /api/v1/dict/items/{id}     删除条目
//	POST /api/v1/dict/types            新增类型（含首条）
//	PUT  /api/v1/dict/types/{code}     类型改名
//
// 文案口径：有回放证据的逐字照抄（见 运行快照）；
// 无回放证据的校验提示沿用本实现既有框架文案风格（fail 层），不自造业务语义文案。

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"la-erp/backend/internal/database"
)

func (s *Server) registerPlatform() {
	// ---- 操作日志 ----
	s.mux.Handle("GET /api/v1/audit-logs", s.protected("audit_log", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		clauses := []string{}
		args := []any{}
		if v := q.Get("username"); v != "" {
			clauses = append(clauses, "username LIKE ?")
			args = append(args, "%"+v+"%")
		}
		if v := q.Get("action"); v != "" {
			clauses = append(clauses, "action=?")
			args = append(args, v)
		}
		if v := q.Get("start_date"); v != "" {
			clauses = append(clauses, "created_at>=?")
			args = append(args, v)
		}
		if v := q.Get("end_date"); v != "" {
			// 结束日期含当天整天（与前端注释的 parseEndDate 口径一致）
			clauses = append(clauses, "created_at<?")
			args = append(args, v+"T23:59:59.999999999+08:00")
		}
		where := ""
		if len(clauses) > 0 {
			where = " WHERE " + strings.Join(clauses, " AND ")
		}
		var total int
		if err := s.Store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM audit_logs"+where, args...).Scan(&total); err != nil {
			s.failure(w, err, "操作日志")
			return
		}
		page, _ := strconv.Atoi(q.Get("page"))
		if page < 1 {
			page = 1
		}
		size, _ := strconv.Atoi(q.Get("page_size"))
		if size < 1 {
			size = 10
		}
		if size > 1000 {
			size = 1000
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM audit_logs"+where+" ORDER BY created_at DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
		if err != nil {
			s.failure(w, err, "操作日志")
			return
		}
		items := []map[string]any{}
		for _, row := range rows {
			items = append(items, s.Store.Public("audit_logs", row))
		}
		respond(w, 200, map[string]any{"list": items, "total": total})
	})))

	// ---- 部署控制台：公司清单 ----
	// 回归回放（api-contracts.json / 批次 KK-28）：字段
	// {id, code, name, status, is_default, db_path, db_size, loaded, created_at}。
	// 批次 KK 恢复了 POST/PUT 写路径（见 gapKK_writes.go），故这里改为从
	// `companies` 表读，而不是硬编码单条 —— 否则新建的公司不会出现在清单里。
	s.mux.Handle("GET /api/v1/console/companies", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		size := int64(0)
		if stat, err := os.Stat(s.dbFilename); err == nil {
			size = stat.Size()
		}
		items := []map[string]any{}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM companies WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at")
		if err != nil {
			s.failure(w, err, "公司")
			return
		}
		for _, row := range rows {
			item := s.Store.Public("companies", row)
			// 默认公司指向当前库；新建公司没有独立 db_path。
			if text(row, "db_path") == "" && text(row, "code") == "default" {
				item["db_path"] = s.dbFilename
			}
			if text(row, "code") == "default" {
				item["db_size"] = size
				item["loaded"] = true
			}
			items = append(items, item)
		}
		respond(w, 200, items)
	})))

	// ---- 登录页公开公司信息（免认证）----
	// 前端 Login 页：res.data.company.{name,logo}；未配置时各字段缺省。
	s.mux.HandleFunc("GET /api/v1/public/company", func(w http.ResponseWriter, r *http.Request) {
		company := map[string]any{}
		if rows, err := s.Store.Rows(r.Context(), "SELECT value FROM system_settings WHERE key='company'"); err == nil && len(rows) > 0 {
			var v map[string]any
			if json.Unmarshal([]byte(text(rows[0], "value")), &v) == nil {
				company = v
			}
		}
		respond(w, 200, map[string]any{"company": company})
	})

	// ---- 机器码 ----
	// 既有实现 dist 路由串（打包清单）确认存在；
	// 算法取 internal/license.MachineID（首个可读机器标识的 sha256 hex）。
	s.mux.Handle("GET /api/v1/license/machine-code", s.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		code := s.machineCode()
		respond(w, 200, map[string]any{"machine_code": code})
	})))

	// ---- 授权激活 ----
	// 既有实现路由（前端接口契约表）：POST /v1/license/activate，
	// 支持 multipart 文件与 JSON {content} 两种形态；响应 {activated, file, message}。
	// 本实现由 cmd 注入激活器（写授权文件 + 热更新状态），未注入时返回 501。
	s.mux.Handle("POST /api/v1/license/activate", s.protected("license_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.licenseActivate == nil {
			fail(w, 501, "该业务接口尚未实现：POST /api/v1/license/activate")
			return
		}
		var content []byte
		name := "license.key"
		// multipart 需先解析；非 multipart（JSON {content}）直接走 decode 分支。
		if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
			if err := r.ParseMultipartForm(8 << 20); err == nil && r.MultipartForm != nil {
				defer r.MultipartForm.RemoveAll()
			}
		}
		if file, header, err := r.FormFile("file"); err == nil {
			defer file.Close()
			buf := make([]byte, 1<<20)
			n, _ := file.Read(buf)
			content = buf[:n]
			if header != nil && header.Filename != "" {
				name = header.Filename
			}
		} else {
			body, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			content = []byte(text(body, "content"))
			if v := text(body, "file"); v != "" {
				name = v
			}
		}
		if len(content) == 0 {
			fail(w, 400, "授权内容为空")
			return
		}
		data, err := s.licenseActivate(name, content)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		respond(w, 200, data)
	})))

	// ---- 数据字典 ----
	s.mux.Handle("GET /api/v1/dict/types", s.protected("dict", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT type_code,type_name,sort_order FROM data_dicts WHERE deleted_at IS NULL ORDER BY sort_order,id")
		if err != nil {
			s.failure(w, err, "字典")
			return
		}
		order := []string{}
		names := map[string]string{}
		counts := map[string]int{}
		for _, row := range rows {
			code := text(row, "type_code")
			if _, seen := counts[code]; !seen {
				order = append(order, code)
			}
			counts[code]++
			if name := text(row, "type_name"); name != "" {
				names[code] = name
			}
		}
		items := []map[string]any{}
		for _, code := range order {
			items = append(items, map[string]any{"type_code": code, "type_name": names[code], "count": counts[code]})
		}
		respond(w, 200, items)
	})))
	s.mux.Handle("GET /api/v1/dict/items", s.protected("dict", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("type_code")
		if code == "" {
			fail(w, 400, "缺少 type_code 参数")
			return
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM data_dicts WHERE deleted_at IS NULL AND type_code=? ORDER BY sort_order,id", code)
		if err != nil {
			s.failure(w, err, "字典")
			return
		}
		items := []map[string]any{}
		for _, row := range rows {
			items = append(items, s.Store.Public("data_dicts", row))
		}
		respond(w, 200, items)
	})))
	s.mux.Handle("POST /api/v1/dict/items", s.protected("dict_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		row := s.dictRow(body)
		if text(body, "type_code") == "" || text(body, "item_code") == "" || text(body, "item_name") == "" {
			fail(w, 400, "类型编码、条目编码与名称不能为空")
			return
		}
		if err = s.Store.Insert(r.Context(), "data_dicts", row); err != nil {
			s.failure(w, err, "字典")
			return
		}
		respond(w, 200, row)
	})))
	s.mux.Handle("PUT /api/v1/dict/items/{id}", s.protected("dict_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		changes := s.dictRow(body)
		delete(changes, "id")
		if err = s.Store.Update(r.Context(), "data_dicts", r.PathValue("id"), changes); err != nil {
			s.failure(w, err, "字典")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("DELETE /api/v1/dict/items/{id}", s.protected("dict_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.Store.Update(r.Context(), "data_dicts", r.PathValue("id"), map[string]any{"deleted_at": database.Now(), "updated_at": database.Now()}); err != nil {
			s.failure(w, err, "字典")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/dict/types", s.protected("dict_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		code, name := text(body, "type_code"), text(body, "type_name")
		firstCode, firstName := text(body, "first_item_code"), text(body, "first_item_name")
		if code == "" || name == "" || firstCode == "" || firstName == "" {
			fail(w, 400, "类型编码、类型名称与首条目的编码/名称不能为空")
			return
		}
		row := map[string]any{"id": uuid.NewString(), "type_code": code, "type_name": name, "item_code": firstCode, "item_name": firstName, "sort_order": 0, "status": "active", "created_at": database.Now(), "updated_at": database.Now()}
		if err = s.Store.Insert(r.Context(), "data_dicts", row); err != nil {
			s.failure(w, err, "字典")
			return
		}
		respond(w, 200, row)
	})))
	s.mux.Handle("PUT /api/v1/dict/types/{code}", s.protected("dict_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		name := text(body, "type_name")
		if name == "" {
			fail(w, 400, "类型名称不能为空")
			return
		}
		// 改名对所有条目生效（类型名是每行的冗余列）
		if _, err = s.Store.DB.ExecContext(r.Context(), "UPDATE data_dicts SET type_name=?,updated_at=? WHERE type_code=? AND deleted_at IS NULL", name, database.Now(), r.PathValue("code")); err != nil {
			s.failure(w, err, "字典")
			return
		}
		respond(w, 200, nil)
	})))
}

// dictRow 从请求体提取字典条目字段（仅白名单列）。
// 数值原样透传：decode 用 UseNumber，json.Number 经 database.SQLValue 转为列类型可接受的字符串。
func (s *Server) dictRow(body map[string]any) map[string]any {
	row := map[string]any{"id": uuid.NewString(), "created_at": database.Now(), "updated_at": database.Now()}
	for _, key := range []string{"type_code", "type_name", "item_code", "item_name", "sort_order", "status", "remark"} {
		if v, ok := body[key]; ok && v != nil {
			row[key] = v
		}
	}
	return row
}

// machineCode 机器码：优先 cmd 注入的既定算法（Linux 机器标识 sha256），
// 未注入或读取失败时退化为宿主名哈希，保证端点恒有稳定输出。
func (s *Server) machineCode() string {
	if s.machineCodeFn != nil {
		return s.machineCodeFn()
	}
	sum := sha256.Sum256([]byte("la-erp:" + mustHostname()))
	return hex.EncodeToString(sum[:])
}

// ConfigureLicense 注入机器码算法与授权激活器（由 cmd 提供，避免 api 层依赖
// 授权文件的落盘位置与公钥来源）。未注入时机器码退化为宿主名哈希，
// 激活端点返回 501（与「尚未实现」兜底一致）。
func (s *Server) ConfigureLicense(machineCode func() string, activate func(name string, content []byte) (map[string]any, error)) {
	s.machineCodeFn = machineCode
	s.licenseActivate = activate
}

func mustHostname() string {
	name, err := os.Hostname()
	if err != nil || name == "" {
		return "unknown-host"
	}
	return name
}
