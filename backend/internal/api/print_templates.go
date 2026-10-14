package api

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"la-erp-recovered/backend/internal/database"
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
	// 原版该路径存在（缺参时按参数缺失处理），此处与 {id} 字面量路由共存。
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
		if text(row, "doc_type") == "" {
			fail(w, 400, "缺少单据类型")
			return
		}
		if text(row, "name") == "" {
			fail(w, 400, "缺少模板名称")
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
		row, err := s.Store.Get(r.Context(), "print_templates", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		changes := printTemplateRow(body)
		if len(changes) == 0 {
			fail(w, 400, "没有可更新的字段")
			return
		}
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
		row, err := s.Store.Get(r.Context(), "print_templates", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		if row["is_system"] == true || row["is_system"] == int64(1) {
			fail(w, 400, "系统内置模板不允许删除")
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "print_templates", text(row, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
			s.failure(w, err, "打印模板")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/print-templates/{id}/duplicate", s.protected("print_template_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "print_templates", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "打印模板")
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
