package api

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"la-erp/backend/internal/database"
)

var printTemplateResource = Resource{Table: "print_templates", Permission: "print_template", Label: "打印模板"}

// printTemplateColumns 打印模板可写列白名单（与 print_templates 表结构一致，
// 去掉 id/时间戳/软删除三个内部列）。
var printTemplateColumns = []string{
	"doc_type", "name", "paper_size", "paper_width", "paper_height", "font_size",
	"title_size", "header_size", "row_height", "margin", "print_mode", "label_per_row",
	"label_field", "label_sub_field", "footer_text", "header_fields", "columns",
	"is_default", "is_system", "show_border", "show_barcode", "show_logo",
	"show_company", "show_status", "show_totals", "show_remark", "show_signatures",
}

func (s *Server) registerPrintTemplates() {
	s.mux.Handle("GET /api/v1/print-templates", s.protected("print_template", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		where := []string{"deleted_at IS NULL"}
		args := []any{}
		if docType := r.URL.Query().Get("doc_type"); docType != "" {
			where = append(where, database.Quote("doc_type")+"=?")
			args = append(args, docType)
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM print_templates WHERE "+strings.Join(where, " AND ")+" ORDER BY created_at DESC", args...)
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			items = append(items, s.public(r, printTemplateResource, row))
		}
		respond(w, 200, items)
	})))
	// 打印页统一入口：按单据类型取默认模板（无模板时返回 null，前端回落内置版式）。
	s.mux.Handle("GET /api/v1/print-templates/by-type/{docType}", s.protected("print_template", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(),
			"SELECT * FROM print_templates WHERE doc_type=? AND deleted_at IS NULL ORDER BY is_default DESC, created_at DESC LIMIT 1",
			r.PathValue("docType"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		if len(rows) == 0 {
			respond(w, 200, nil)
			return
		}
		respond(w, 200, s.public(r, printTemplateResource, rows[0]))
	})))
	// 既有实现该路径存在（缺参时按参数缺失处理），此处与 {id} 字面量路由共存。
	s.mux.Handle("GET /api/v1/print-templates/by-type", s.protected("print_template", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail(w, 400, "缺少 doc_type 参数")
	})))
	s.mux.Handle("GET /api/v1/print-templates/{id}", s.protected("print_template", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "print_templates", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		respond(w, 200, s.public(r, printTemplateResource, row))
	})))
	s.mux.Handle("POST /api/v1/print-templates", s.protected("print_template_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		row := printTemplateRow(body)
		row["id"] = uuid.NewString()
		now := database.Now()
		row["created_at"] = now
		row["updated_at"] = now
		row["deleted_at"] = nil
		// 回放 NN（2026-10-15）：既有实现对缺 doc_type / 缺 name / 两者都缺**一律**
		// 回同一句 400「doc_type 与 name 必填」，不区分缺哪个。
		// 原本实现的「缺少单据类型」「缺少模板名称」是自造文案，已替换。
		if text(row, "doc_type") == "" || text(row, "name") == "" {
			fail(w, 400, "doc_type 与 name 必填")
			return
		}
		if row["is_default"] == true {
			s.clearPrintTemplateDefault(r, text(row, "doc_type"))
		}
		if err = s.Store.Insert(r.Context(), "print_templates", row); err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		saved, err := s.Store.Get(r.Context(), "print_templates", text(row, "id"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		respond(w, 200, s.public(r, printTemplateResource, saved))
	})))
	s.mux.Handle("PUT /api/v1/print-templates/{id}", s.protected("print_template_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.printTemplateAny(r, r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		if row == nil {
			printTemplateNotFound(w)
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		// 回放 NN（2026-10-15）：既有实现 `PUT` 空载荷返回 **200 code 0** 并回传原记录，
		// 不是 400。原本实现的「没有可更新的字段」是自造文案，已移除 ——
		// 空载荷只写 updated_at，仍走正常返回路径。
		changes := printTemplateRow(body)
		changes["updated_at"] = database.Now()
		if changes["is_default"] == true {
			s.clearPrintTemplateDefault(r, text(row, "doc_type"))
		}
		if err = s.Store.Update(r.Context(), "print_templates", text(row, "id"), changes); err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		saved, err := s.Store.Get(r.Context(), "print_templates", text(row, "id"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		respond(w, 200, s.public(r, printTemplateResource, saved))
	})))
	s.mux.Handle("DELETE /api/v1/print-templates/{id}", s.protected("print_template_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.printTemplateAny(r, r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		if row == nil {
			printTemplateNotFound(w)
			return
		}
		if row["is_system"] == true || row["is_system"] == int64(1) {
			fail(w, 400, "系统内置模板不允许删除")
			return
		}
		// 回放 NN（2026-10-15）：DELETE 是**幂等**的 —— 对已软删的 id 再删一次
		// 仍返回 200 code 0，而对从未存在的 id 返回 500。
		// Store.Update 的 WHERE 带 `deleted_at IS NULL`，会把已软删判成不存在，
		// 故此处直接走 SQL（与 printTemplateAny 的「不过滤软删」同口径）。
		now := database.Now()
		if _, err = s.Store.DB.ExecContext(r.Context(),
			"UPDATE print_templates SET deleted_at=?, updated_at=? WHERE id=?", now, now, text(row, "id")); err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/print-templates/{id}/duplicate", s.protected("print_template_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.printTemplateAny(r, r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		if row == nil {
			printTemplateNotFound(w)
			return
		}
		dup := map[string]any{}
		for key, value := range row {
			dup[key] = value
		}
		now := database.Now()
		dup["id"] = uuid.NewString()
		dup["created_at"] = now
		dup["updated_at"] = now
		dup["deleted_at"] = nil
		dup["name"] = text(row, "name") + "（副本）"
		dup["is_default"] = false
		dup["is_system"] = false
		if err = s.Store.Insert(r.Context(), "print_templates", dup); err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		saved, err := s.Store.Get(r.Context(), "print_templates", text(dup, "id"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		respond(w, 200, s.public(r, printTemplateResource, saved))
	})))
}

// printTemplateNotFound 是打印模板**写路径**在记录不存在时既定的降级形态。
//
// 回放 NN（2026-10-15，运行快照）：
// PUT / DELETE / duplicate 在不存在的 id 上**全部**返回
// 500「系统内部错误，请稍后重试或联系管理员」，而 GET 详情返回
// 404「打印模板不存在」——同一资源两套形态，勿统一。
//
// 成因推断：既有实现这些写路径直接 UPDATE / SELECT，命中不到行时落到通用 500，
// 与调拨单的仓库引用（外键兜底落成 500）是同一类降级。
func printTemplateNotFound(w http.ResponseWriter) {
	fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
}

// printTemplateAny 按 id 取打印模板，**不过滤软删**。
//
// 回放：DELETE 一个已软删的 id → 200 code 0（既有实现是裸 UPDATE，命中行即成功），
// 而 DELETE 一个从未存在的 id → 500。这两者只有「不过滤软删」才能区分 ——
// Store.Get 会过滤 deleted_at，用它会把已软删也判成不存在。
func (s *Server) printTemplateAny(r *http.Request, id string) (map[string]any, error) {
	rows, err := s.Store.Rows(r.Context(), "SELECT * FROM print_templates WHERE id=?", id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// clearPrintTemplateDefault 同一单据类型只保留一个默认模板。
func (s *Server) clearPrintTemplateDefault(r *http.Request, docType string) {
	if docType == "" {
		return
	}
	rows, err := s.Store.Rows(r.Context(), "SELECT id FROM print_templates WHERE doc_type=? AND is_default=1 AND deleted_at IS NULL", docType)
	if err != nil {
		return
	}
	now := database.Now()
	for _, row := range rows {
		_ = s.Store.Update(r.Context(), "print_templates", text(row, "id"), map[string]any{"is_default": false, "updated_at": now})
	}
}

// printTemplateRow 从请求体提取打印模板可写列（未提供的列不写入）。
func printTemplateRow(body map[string]any) map[string]any {
	row := map[string]any{}
	for _, key := range printTemplateColumns {
		if value, ok := body[key]; ok && value != nil {
			row[key] = value
		}
	}
	return row
}
