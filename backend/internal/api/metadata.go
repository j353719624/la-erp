package api

// metadata.go —— 元数据模块剩余端点（批次 FF，2026-10-14）。
//
// 路由覆盖对账查出 metadata 一族原版有、恢复端无的路径；generic reader 只注册了
// `GET /metadata/entities`（read_resources.json），其余全部缺失。本文件补齐：
//
//	GET    /api/v1/metadata/entities/code/{code}    按编码取实体
//	GET    /api/v1/metadata/fields?entity_id=       字段列表（sort_order）
//	GET    /api/v1/metadata/fields/{id}             字段详情
//	POST   /api/v1/metadata/fields                  新增字段
//	PUT    /api/v1/metadata/fields/{id}             编辑字段
//	DELETE /api/v1/metadata/fields/{id}             删除字段
//	POST   /api/v1/metadata/fields/batch            批量新增（模板应用走这里）
//	GET    /api/v1/metadata/fields/labels           轻量标签（code→name）
//	GET    /api/v1/metadata/layouts?entity_id=      布局列表
//	GET    /api/v1/metadata/layouts/default         默认布局
//	GET    /api/v1/metadata/layouts/{id}            布局详情
//	POST   /api/v1/metadata/layouts                 新增布局
//	PUT    /api/v1/metadata/layouts/{id}            编辑布局
//	DELETE /api/v1/metadata/layouts/{id}            删除布局
//	GET    /api/v1/metadata/templates               行业模板列表（edges.fields）
//	GET    /api/v1/metadata/templates/current       当前应用模板（无则 null）
//	GET    /api/v1/metadata/templates/{id}          模板详情
//	POST   /api/v1/metadata/templates               新增模板
//	PUT    /api/v1/metadata/templates/{id}          编辑模板
//	DELETE /api/v1/metadata/templates/{id}          删除模板
//	POST   /api/v1/metadata/templates/{id}/apply    应用模板（设当前）
//	GET    /api/v1/metadata/field-permissions       角色字段权限列表
//	POST   /api/v1/metadata/field-permissions/batch 批量保存
//	GET    /api/v1/metadata/field-permissions/my    我的字段权限
//	DELETE /api/v1/metadata/field-permissions/{id}  删除单条
//	GET    /api/v1/dynamic/{entityCode}             动态数据分页
//	GET    /api/v1/dynamic/{entityCode}/{id}        动态数据详情
//	POST   /api/v1/dynamic/{entityCode}             新增
//	PUT    /api/v1/dynamic/{entityCode}/{id}        编辑
//	DELETE /api/v1/dynamic/{entityCode}/{id}        删除
//
// 模板列表/详情的响应形状取自原版回放（evidence/backend-runtime/api-contracts.json
// 的 GET /api/v1/metadata/templates 记录）：项含
// {id, created_at, updated_at, category, name, description, icon, entity_code,
//  is_system, is_active, edges:{fields:[…]}}；字段项含
// {id, created_at, updated_at, code, name, field_type, is_required?, is_indexed?,
//  is_unique?, default_value?, group_name, sort_order, options?, edges:{}}——
// 布尔/空值字段省略（与 Store.Public 的 omitempty 口径一致）。

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"la-erp-recovered/backend/internal/database"
)

func (s *Server) registerMetadata() {
	// ---- 实体 ----
	s.mux.Handle("GET /api/v1/metadata/entities/code/{code}", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM entity_defs WHERE code=? AND deleted_at IS NULL", r.PathValue("code"))
		if err != nil || len(rows) == 0 {
			// 原版回放 GG12（2026-10-14）：不存在的实体返回 HTTP 500 + 通用文案，不是 404
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		respond(w, 200, s.entityView(r, rows[0]))
	})))

	// 实体写路径：路由覆盖对账未采集到（前端与文档都无引用），由批次 GG 回放发现。
	// 契约（evidence/backend-runtime/audit-batch-gg-20261014.json + 现场回放）：
	//   POST   /metadata/entities      缺 table_name → 10000「表名不能为空」
	//                                  重复 code / 建表失败 → 500 系统内部错误
	//   GET    /metadata/entities/{id} 不存在 → 500 系统内部错误
	//   PUT    /metadata/entities/{id} 更新后回传实体
	//   DELETE /metadata/entities/{id} 不存在 → 500 系统内部错误
	s.mux.Handle("GET /api/v1/metadata/entities/{id}", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM entity_defs WHERE id=? AND deleted_at IS NULL", r.PathValue("id"))
		if err != nil || len(rows) == 0 {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		respond(w, 200, s.entityView(r, rows[0]))
	})))
	s.mux.Handle("POST /api/v1/metadata/entities", s.protected("metadata_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if text(body, "table_name") == "" {
			verbatimFailure(w, verbatim{text: "表名不能为空"})
			return
		}
		now := database.Now()
		row := map[string]any{
			"id": uuid.NewString(), "created_at": now, "updated_at": now, "deleted_at": nil,
			"code": text(body, "code"), "name": text(body, "name"),
			"table_name": text(body, "table_name"), "category": text(body, "category"),
		}
		if err = s.Store.Insert(r.Context(), "entity_defs", row); err != nil {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		if err = s.ensureDynamicTable(text(row, "table_name")); err != nil {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		respond(w, 200, s.entityView(r, row))
	})))
	s.mux.Handle("PUT /api/v1/metadata/entities/{id}", s.protected("metadata_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "entity_defs", r.PathValue("id"))
		if err != nil {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		changes := map[string]any{"updated_at": database.Now()}
		for _, key := range []string{"code", "name", "table_name", "category", "description", "icon", "is_active", "sort_order"} {
			if value, ok := body[key]; ok && value != nil && s.Store.Has("entity_defs", key) {
				changes[key] = value
			}
		}
		if err = s.Store.Update(r.Context(), "entity_defs", text(row, "id"), changes); err != nil {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		saved, err := s.Store.Get(r.Context(), "entity_defs", text(row, "id"))
		if err != nil {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		respond(w, 200, s.entityView(r, saved))
	})))
	s.mux.Handle("DELETE /api/v1/metadata/entities/{id}", s.protected("metadata_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "entity_defs", r.PathValue("id"))
		if err != nil {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		if err = s.Store.Update(r.Context(), "entity_defs", text(row, "id"), map[string]any{
			"deleted_at": database.Now(), "updated_at": database.Now(),
		}); err != nil {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		respond(w, 200, nil)
	})))

	// ---- 字段 ----
	s.mux.Handle("GET /api/v1/metadata/fields", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entityID := r.URL.Query().Get("entity_id")
		if entityID == "" {
			fail(w, 400, "缺少 entity_id 参数")
			return
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM field_defs WHERE entity_id=? AND deleted_at IS NULL ORDER BY sort_order,id", entityID)
		if err != nil {
			s.failure(w, err, "字段")
			return
		}
		items := []map[string]any{}
		for _, row := range rows {
			items = append(items, s.fieldView(r, row))
		}
		respond(w, 200, items)
	})))
	s.mux.Handle("GET /api/v1/metadata/fields/{id}", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "field_defs", r.PathValue("id"))
		if err != nil {
			fail(w, 404, "字段不存在")
			return
		}
		respond(w, 200, s.fieldView(r, row))
	})))
	s.mux.Handle("POST /api/v1/metadata/fields", s.protected("metadata_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if text(body, "entity_id") == "" || text(body, "code") == "" || text(body, "name") == "" {
			fail(w, 400, "实体、字段编码与名称不能为空")
			return
		}
		row := s.fieldRow(body)
		if err = s.Store.Insert(r.Context(), "field_defs", row); err != nil {
			s.failure(w, err, "字段")
			return
		}
		respond(w, 200, s.fieldView(r, row))
	})))
	s.mux.Handle("PUT /api/v1/metadata/fields/{id}", s.protected("metadata_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		changes := s.fieldRow(body)
		delete(changes, "id")
		delete(changes, "created_at")
		changes["updated_at"] = database.Now()
		if err = s.Store.Update(r.Context(), "field_defs", r.PathValue("id"), changes); err != nil {
			s.failure(w, err, "字段")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("DELETE /api/v1/metadata/fields/{id}", s.protected("metadata_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.Store.Update(r.Context(), "field_defs", r.PathValue("id"), map[string]any{"deleted_at": database.Now(), "updated_at": database.Now()}); err != nil {
			s.failure(w, err, "字段")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/metadata/fields/batch", s.protected("metadata_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		entityID := text(body, "entity_id")
		raw, _ := body["fields"].([]any)
		if entityID == "" || len(raw) == 0 {
			fail(w, 400, "实体与字段列表不能为空")
			return
		}
		created := []map[string]any{}
		for _, item := range raw {
			field, ok := item.(map[string]any)
			if !ok {
				continue
			}
			field["entity_id"] = entityID
			row := s.fieldRow(field)
			if err = s.Store.Insert(r.Context(), "field_defs", row); err != nil {
				s.failure(w, err, "字段")
				return
			}
			created = append(created, s.fieldView(r, row))
		}
		respond(w, 200, created)
	})))
	s.mux.Handle("GET /api/v1/metadata/fields/labels", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("entity_code")
		if code == "" {
			fail(w, 400, "缺少 entity_code 参数")
			return
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT f.code,f.name,f.sort_order FROM field_defs f JOIN entity_defs e ON e.id=f.entity_id WHERE e.code=? AND f.deleted_at IS NULL AND e.deleted_at IS NULL ORDER BY f.sort_order,f.id", code)
		if err != nil {
			s.failure(w, err, "字段")
			return
		}
		items := []map[string]any{}
		for _, row := range rows {
			item := map[string]any{"code": text(row, "code"), "name": text(row, "name")}
			if n, err := strconv.Atoi(text(row, "sort_order")); err == nil && n != 0 {
				item["sort_order"] = n
			}
			items = append(items, item)
		}
		respond(w, 200, items)
	})))

	// ---- 布局 ----
	s.mux.Handle("GET /api/v1/metadata/layouts", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entityID := r.URL.Query().Get("entity_id")
		if entityID == "" {
			fail(w, 400, "缺少 entity_id 参数")
			return
		}
		clauses := []string{"entity_id=?", "deleted_at IS NULL"}
		args := []any{entityID}
		if v := r.URL.Query().Get("layout_type"); v != "" {
			clauses = append(clauses, "layout_type=?")
			args = append(args, v)
		}
		if v := r.URL.Query().Get("scope"); v != "" {
			clauses = append(clauses, "scope=?")
			args = append(args, v)
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM layout_defs WHERE "+clauses[0]+" AND "+strings.Join(clauses[1:], " AND ")+" ORDER BY is_default DESC,id", args...)
		if err != nil {
			s.failure(w, err, "布局")
			return
		}
		items := []map[string]any{}
		for _, row := range rows {
			items = append(items, s.Store.Public("layout_defs", row))
		}
		respond(w, 200, items)
	})))
	s.mux.Handle("GET /api/v1/metadata/layouts/default", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entityID := r.URL.Query().Get("entity_id")
		layoutType := r.URL.Query().Get("layout_type")
		if entityID == "" || layoutType == "" {
			fail(w, 400, "缺少 entity_id 或 layout_type 参数")
			return
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM layout_defs WHERE entity_id=? AND layout_type=? AND deleted_at IS NULL ORDER BY is_default DESC,id LIMIT 1", entityID, layoutType)
		if err != nil || len(rows) == 0 {
			respond(w, 200, nil)
			return
		}
		respond(w, 200, s.Store.Public("layout_defs", rows[0]))
	})))
	s.mux.Handle("GET /api/v1/metadata/layouts/{id}", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "layout_defs", r.PathValue("id"))
		if err != nil {
			fail(w, 404, "布局不存在")
			return
		}
		respond(w, 200, s.Store.Public("layout_defs", row))
	})))
	s.mux.Handle("POST /api/v1/metadata/layouts", s.protected("metadata_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if text(body, "entity_id") == "" || text(body, "name") == "" || text(body, "layout_type") == "" {
			fail(w, 400, "实体、布局名称与类型不能为空")
			return
		}
		row := map[string]any{"id": uuid.NewString(), "created_at": database.Now(), "updated_at": database.Now()}
		for _, key := range []string{"entity_id", "name", "layout_type", "scope", "scope_id", "config"} {
			if v, ok := body[key]; ok && v != nil {
				row[key] = v
			}
		}
		if _, ok := row["scope"]; !ok {
			row["scope"] = "system"
		}
		if v, ok := body["is_default"]; ok {
			row["is_default"] = v == true || v == "true" || v == "1"
		}
		if err = s.Store.Insert(r.Context(), "layout_defs", row); err != nil {
			s.failure(w, err, "布局")
			return
		}
		respond(w, 200, s.Store.Public("layout_defs", row))
	})))
	s.mux.Handle("PUT /api/v1/metadata/layouts/{id}", s.protected("metadata_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		changes := map[string]any{"updated_at": database.Now()}
		for _, key := range []string{"name", "layout_type", "scope", "scope_id", "config", "is_default"} {
			if v, ok := body[key]; ok && v != nil {
				changes[key] = v
			}
		}
		if err = s.Store.Update(r.Context(), "layout_defs", r.PathValue("id"), changes); err != nil {
			s.failure(w, err, "布局")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("DELETE /api/v1/metadata/layouts/{id}", s.protected("metadata_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.Store.Update(r.Context(), "layout_defs", r.PathValue("id"), map[string]any{"deleted_at": database.Now(), "updated_at": database.Now()}); err != nil {
			s.failure(w, err, "布局")
			return
		}
		respond(w, 200, nil)
	})))

	// ---- 行业模板 ----
	s.mux.Handle("GET /api/v1/metadata/templates/current", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM industry_templates WHERE is_applied=1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1")
		if err != nil || len(rows) == 0 {
			// 原版回放：未应用任何模板时 data 为 null（api-contracts.json）。
			respond(w, 200, nil)
			return
		}
		respond(w, 200, s.templateView(r, rows[0]))
	})))
	s.mux.Handle("GET /api/v1/metadata/templates", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clauses := []string{"deleted_at IS NULL"}
		args := []any{}
		if v := r.URL.Query().Get("category"); v != "" {
			clauses = append(clauses, "category=?")
			args = append(args, v)
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM industry_templates WHERE "+strings.Join(clauses, " AND ")+" ORDER BY id", args...)
		if err != nil {
			s.failure(w, err, "模板")
			return
		}
		items := []map[string]any{}
		for _, row := range rows {
			items = append(items, s.templateView(r, row))
		}
		respond(w, 200, items)
	})))
	s.mux.Handle("GET /api/v1/metadata/templates/{id}", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "industry_templates", r.PathValue("id"))
		if err != nil {
			fail(w, 404, "模板不存在")
			return
		}
		respond(w, 200, s.templateView(r, row))
	})))
	s.mux.Handle("POST /api/v1/metadata/templates", s.protected("metadata_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if text(body, "name") == "" || text(body, "entity_code") == "" {
			fail(w, 400, "模板名称与实体编码不能为空")
			return
		}
		row := map[string]any{"id": uuid.NewString(), "created_at": database.Now(), "updated_at": database.Now()}
		for _, key := range []string{"category", "name", "description", "icon", "entity_code", "categories", "units"} {
			if v, ok := body[key]; ok && v != nil {
				row[key] = v
			}
		}
		if err = s.Store.Insert(r.Context(), "industry_templates", row); err != nil {
			s.failure(w, err, "模板")
			return
		}
		respond(w, 200, s.templateView(r, row))
	})))
	s.mux.Handle("PUT /api/v1/metadata/templates/{id}", s.protected("metadata_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		changes := map[string]any{"updated_at": database.Now()}
		for _, key := range []string{"category", "name", "description", "icon", "entity_code", "is_active", "categories", "units"} {
			if v, ok := body[key]; ok && v != nil {
				changes[key] = v
			}
		}
		if err = s.Store.Update(r.Context(), "industry_templates", r.PathValue("id"), changes); err != nil {
			s.failure(w, err, "模板")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("DELETE /api/v1/metadata/templates/{id}", s.protected("metadata_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.Store.Update(r.Context(), "industry_templates", r.PathValue("id"), map[string]any{"deleted_at": database.Now(), "updated_at": database.Now()}); err != nil {
			s.failure(w, err, "模板")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/metadata/templates/{id}/apply", s.protected("metadata_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "industry_templates", r.PathValue("id"))
		if err != nil {
			fail(w, 404, "模板不存在")
			return
		}
		// 设当前：先清掉其他模板的 is_applied，再标记本模板（原版为单选语义）。
		if _, err = s.Store.DB.ExecContext(r.Context(), "UPDATE industry_templates SET is_applied=0,updated_at=? WHERE is_applied=1 AND id<>? AND deleted_at IS NULL", database.Now(), r.PathValue("id")); err != nil {
			s.failure(w, err, "模板")
			return
		}
		if err = s.Store.Update(r.Context(), "industry_templates", r.PathValue("id"), map[string]any{"is_applied": true, "updated_at": database.Now()}); err != nil {
			s.failure(w, err, "模板")
			return
		}
		row["is_applied"] = true
		respond(w, 200, s.templateView(r, row))
	})))

	// ---- 角色字段权限 ----
	s.mux.Handle("GET /api/v1/metadata/field-permissions", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roleID := r.URL.Query().Get("role_id")
		entityID := r.URL.Query().Get("entity_id")
		if roleID == "" || entityID == "" {
			fail(w, 400, "缺少 role_id 或 entity_id 参数")
			return
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM sys_field_permissions WHERE role_id=? AND entity_id=? ORDER BY field_code", roleID, entityID)
		if err != nil {
			s.failure(w, err, "字段权限")
			return
		}
		items := []map[string]any{}
		for _, row := range rows {
			items = append(items, s.Store.Public("sys_field_permissions", row))
		}
		respond(w, 200, items)
	})))
	s.mux.Handle("GET /api/v1/metadata/field-permissions/my", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entityID := r.URL.Query().Get("entity_id")
		if entityID == "" {
			fail(w, 400, "缺少 entity_id 参数")
			return
		}
		roles, _, err := s.Auth.Roles(r.Context(), current(r).UserID, false)
		if err != nil {
			s.failure(w, err, "字段权限")
			return
		}
		result := map[string]string{}
		for _, role := range roles {
			roleID := text(role, "id")
			rows, err := s.Store.Rows(r.Context(), "SELECT field_code,access_level FROM sys_field_permissions WHERE role_id=? AND entity_id=?", roleID, entityID)
			if err != nil {
				continue
			}
			for _, row := range rows {
				result[text(row, "field_code")] = text(row, "access_level")
			}
		}
		respond(w, 200, result)
	})))
	s.mux.Handle("POST /api/v1/metadata/field-permissions/batch", s.protected("metadata_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		roleID, entityID := text(body, "role_id"), text(body, "entity_id")
		raw, _ := body["items"].([]any)
		if roleID == "" || entityID == "" {
			fail(w, 400, "缺少 role_id 或 entity_id")
			return
		}
		// 全量替换语义：先删后插（与前端「整表保存」一致）
		if _, err = s.Store.DB.ExecContext(r.Context(), "DELETE FROM sys_field_permissions WHERE role_id=? AND entity_id=?", roleID, entityID); err != nil {
			s.failure(w, err, "字段权限")
			return
		}
		saved := 0
		for _, item := range raw {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			level := text(entry, "access_level")
			if level == "" {
				continue
			}
			row := map[string]any{"id": uuid.NewString(), "created_at": database.Now(), "updated_at": database.Now(), "role_id": roleID, "entity_id": entityID, "field_code": text(entry, "field_code"), "access_level": level}
			if err = s.Store.Insert(r.Context(), "sys_field_permissions", row); err != nil {
				s.failure(w, err, "字段权限")
				return
			}
			saved++
		}
		respond(w, 200, map[string]any{"saved": saved})
	})))
	s.mux.Handle("DELETE /api/v1/metadata/field-permissions/{id}", s.protected("metadata_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := s.Store.DB.ExecContext(r.Context(), "DELETE FROM sys_field_permissions WHERE id=?", r.PathValue("id")); err != nil {
			s.failure(w, err, "字段权限")
			return
		}
		respond(w, 200, nil)
	})))

	// ---- 动态数据（按实体编码路由到实体表）----
	s.mux.Handle("GET /api/v1/dynamic/{entityCode}", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		table, ok := s.entityTable(r, r.PathValue("entityCode"))
		if !ok {
			// 原版回放 GG13/GG14：实体不存在时 HTTP 200 + code 10000 + 通用文案
			verbatimFailure(w, verbatim{text: "系统内部错误，请稍后重试或联系管理员"})
			return
		}
		rows, total, err := s.Store.List(r.Context(), table, r.URL.Query())
		if err != nil {
			s.failure(w, err, "数据")
			return
		}
		items := []map[string]any{}
		for _, row := range rows {
			items = append(items, s.Store.Public(table, row))
		}
		respond(w, 200, map[string]any{"list": items, "total": total})
	})))
	s.mux.Handle("GET /api/v1/dynamic/{entityCode}/{id}", s.protected("metadata", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		table, ok := s.entityTable(r, r.PathValue("entityCode"))
		if !ok {
			// 原版回放 GG13/GG14：实体不存在时 HTTP 200 + code 10000 + 通用文案
			verbatimFailure(w, verbatim{text: "系统内部错误，请稍后重试或联系管理员"})
			return
		}
		row, err := s.Store.Get(r.Context(), table, r.PathValue("id"))
		if err != nil {
			fail(w, 404, "记录不存在")
			return
		}
		respond(w, 200, s.Store.Public(table, row))
	})))
	s.mux.Handle("POST /api/v1/dynamic/{entityCode}", s.protected("metadata_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		table, ok := s.entityTable(r, r.PathValue("entityCode"))
		if !ok {
			fail(w, 404, "实体不存在")
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		row := map[string]any{"id": uuid.NewString(), "created_at": database.Now(), "updated_at": database.Now()}
		for key, v := range body {
			if s.Store.Has(table, key) {
				row[key] = v
			}
		}
		if err = s.Store.Insert(r.Context(), table, row); err != nil {
			s.failure(w, err, "数据")
			return
		}
		respond(w, 200, s.Store.Public(table, row))
	})))
	s.mux.Handle("PUT /api/v1/dynamic/{entityCode}/{id}", s.protected("metadata_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		table, ok := s.entityTable(r, r.PathValue("entityCode"))
		if !ok {
			fail(w, 404, "实体不存在")
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		changes := map[string]any{"updated_at": database.Now()}
		for key, v := range body {
			if key == "id" || key == "created_at" {
				continue
			}
			if s.Store.Has(table, key) {
				changes[key] = v
			}
		}
		if err = s.Store.Update(r.Context(), table, r.PathValue("id"), changes); err != nil {
			s.failure(w, err, "数据")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("DELETE /api/v1/dynamic/{entityCode}/{id}", s.protected("metadata_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		table, ok := s.entityTable(r, r.PathValue("entityCode"))
		if !ok {
			fail(w, 404, "实体不存在")
			return
		}
		if err := s.Store.Update(r.Context(), table, r.PathValue("id"), map[string]any{"deleted_at": database.Now(), "updated_at": database.Now()}); err != nil {
			s.failure(w, err, "数据")
			return
		}
		respond(w, 200, nil)
	})))
}

// entityTable 实体编码 → 表名（仅未删除实体）。
// dynamicEntityColumns 动态实体表的固定列（原版回放 GG17：POST /dynamic/{code} 的返回行
// 形如 {id, code, name, status, remark, created_at, updated_at, deleted_at, created_by,
// updated_by} + field_defs 里定义的自定义列）。
var dynamicEntityColumns = []string{
	"id", "code", "name", "status", "remark",
	"created_at", "updated_at", "deleted_at", "created_by", "updated_by", "tenant_id",
}

// ensureDynamicTable 建（并登记）动态实体的物理表；已存在则只补齐内存表元数据。
func (s *Server) ensureDynamicTable(table string) error {
	if table == "" {
		return nil
	}
	columns := make([]string, 0, len(dynamicEntityColumns))
	for _, name := range dynamicEntityColumns {
		columns = append(columns, database.Quote(name)+" TEXT")
	}
	statement := "CREATE TABLE IF NOT EXISTS " + database.Quote(table) + " (" + strings.Join(columns, ", ") + ", PRIMARY KEY (id))"
	if _, err := s.Store.DB.ExecContext(context.Background(), statement); err != nil {
		return err
	}
	if _, ok := s.Store.Tables[table]; !ok {
		meta := database.Table{Name: table, SQL: statement}
		for _, name := range dynamicEntityColumns {
			meta.Columns = append(meta.Columns, database.Column{Name: name, Type: "TEXT"})
		}
		s.Store.Tables[table] = meta
	}
	return nil
}

func (s *Server) entityTable(r *http.Request, code string) (string, bool) {
	rows, err := s.Store.Rows(r.Context(), "SELECT table_name FROM entity_defs WHERE code=? AND deleted_at IS NULL", code)
	if err != nil || len(rows) == 0 {
		return "", false
	}
	table := text(rows[0], "table_name")
	if _, ok := s.Store.Tables[table]; !ok {
		return "", false
	}
	return table, true
}

// entityView 实体详情（含 edges.fields，与原版 GORM preload 形状一致）。
func (s *Server) entityView(r *http.Request, row map[string]any) map[string]any {
	view := s.Store.Public("entity_defs", row)
	fields := []map[string]any{}
	if rows, err := s.Store.Rows(r.Context(), "SELECT * FROM field_defs WHERE entity_id=? AND deleted_at IS NULL ORDER BY sort_order,id", text(row, "id")); err == nil {
		for _, field := range rows {
			fields = append(fields, s.fieldView(r, field))
		}
	}
	view["edges"] = map[string]any{"fields": fields}
	return view
}

// fieldView 字段公开展望（validation 为 json 列，Public 会解码）。
func (s *Server) fieldView(r *http.Request, row map[string]any) map[string]any {
	view := s.Store.Public("field_defs", row)
	view["edges"] = map[string]any{}
	return view
}

// fieldRow 从请求体提取字段白名单列。
func (s *Server) fieldRow(body map[string]any) map[string]any {
	row := map[string]any{"id": uuid.NewString(), "created_at": database.Now(), "updated_at": database.Now()}
	for _, key := range []string{"entity_id", "code", "name", "field_type", "default_value", "ref_entity", "ref_display", "group_name"} {
		if v, ok := body[key]; ok && v != nil {
			row[key] = v
		}
	}
	for _, key := range []string{"is_core", "is_required", "is_indexed", "is_unique"} {
		if v, ok := body[key]; ok && v != nil {
			row[key] = v == true || v == "true" || v == "1"
		}
	}
	for _, key := range []string{"sort_order", "validation"} {
		if v, ok := body[key]; ok && v != nil {
			row[key] = v
		}
	}
	return row
}

// templateView 行业模板公开展望：严格按原版回放形状裁剪
// （不含 categories/units/is_applied 等内部列，字段走 edges.fields）。
func (s *Server) templateView(r *http.Request, row map[string]any) map[string]any {
	view := map[string]any{
		"id":          text(row, "id"),
		"category":    text(row, "category"),
		"name":        text(row, "name"),
		"entity_code": text(row, "entity_code"),
		"edges":       map[string]any{"fields": []map[string]any{}},
	}
	if v := text(row, "description"); v != "" {
		view["description"] = v
	}
	if v := text(row, "icon"); v != "" {
		view["icon"] = v
	}
	if v, ok := row["created_at"]; ok && v != nil {
		view["created_at"] = v
	}
	if v, ok := row["updated_at"]; ok && v != nil {
		view["updated_at"] = v
	}
	if row["is_system"] == true || row["is_system"] == int64(1) {
		view["is_system"] = true
	}
	if row["is_active"] == true || row["is_active"] == int64(1) {
		view["is_active"] = true
	}
	fields := []map[string]any{}
	if rows, err := s.Store.Rows(r.Context(), "SELECT * FROM industry_template_fields WHERE industry_template_fields=? AND deleted_at IS NULL ORDER BY id", text(row, "id")); err == nil {
		for _, field := range rows {
			fields = append(fields, s.templateFieldView(field))
		}
	}
	view["edges"] = map[string]any{"fields": fields}
	return view
}

// templateFieldView 模板字段公开展望：布尔/空值省略，恒带 edges:{}。
func (s *Server) templateFieldView(row map[string]any) map[string]any {
	view := map[string]any{
		"id":         text(row, "id"),
		"code":       text(row, "code"),
		"name":       text(row, "name"),
		"field_type": text(row, "field_type"),
		"group_name": text(row, "group_name"),
		"sort_order": row["sort_order"],
		"edges":      map[string]any{},
	}
	if v, ok := row["created_at"]; ok && v != nil {
		view["created_at"] = v
	}
	if v, ok := row["updated_at"]; ok && v != nil {
		view["updated_at"] = v
	}
	if row["is_required"] == true || row["is_required"] == int64(1) {
		view["is_required"] = true
	}
	if row["is_indexed"] == true || row["is_indexed"] == int64(1) {
		view["is_indexed"] = true
	}
	if row["is_unique"] == true || row["is_unique"] == int64(1) {
		view["is_unique"] = true
	}
	if v := text(row, "default_value"); v != "" {
		view["default_value"] = v
	}
	if raw := text(row, "options"); raw != "" {
		var options any
		if json.Unmarshal([]byte(raw), &options) == nil && options != nil {
			view["options"] = options
		}
	}
	return view
}
