package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"
	"la-erp/backend/internal/auth"
	"la-erp/backend/internal/database"
)

// ── 列定义 ───────────────────────────────────────────────────────────────────

// ieRef 外键解析：把表格里的可读值（如「分类名称」）翻译成要写入的列（category_id）。
type ieRef struct {
	Table   string // 被参照表
	Match   string // 按哪一列匹配传入值
	Missing string // 参照不到时的文案（含一个 %s，填原始值）；留空用「参照不存在」
}

// ieField 导入导出的一列。
type ieField struct {
	Header  string // 表头（中文，逐字取自各列表页 templateHint）
	Column  string // 目标列名；空串表示该列仅供展示（导入时忽略）
	Kind    string // "" | "bool" | "int" | "num"
	Ref     *ieRef // 外键解析（写入 column 时为 id）
	Combine bool   // true：值以空格追加到同 Column（颜色/尺码合并成规格）
	Default string // 该列留空时的默认值

	// 类型错误文案口径（原版回放 2026-10-14，audit-batch-gg3-20261014.json）。
	// 原版对同一类列有两种写法，得看具体列：
	//   ErrMode ""    → 「<列名> 格式错误: <底层错误>」（payment_term / credit_limit / sale_price）
	//   ErrMode "int" → 「<名字>必须为非负整数: <值>」（保质期(天) / rows）
	//   ErrMode "num" → 「<名字>必须为非负数: <值>」（容量）
	ErrMode  string
	ErrLabel string // ErrMode 非空的文案名字；留空取表头
}

// ieRequired 必填校验（原版只校验一项，文案各不相同）。
type ieRequired struct {
	Header  string // 判空的列（表头）
	Also    string // 与 Header 同时判空的另一列（「款号与款名不能同时为空」）
	Message string // 判空时的文案
}

type ieSpec struct {
	Kind     string       // URL 中的种类名
	Table    string       // 目标表
	Label    string       // 中文名（错误文案用）
	Fields   []ieField    // 列定义
	Dedupe   []string     // 查重列（按序优先）
	Dynamic  bool         // true：动态实体（meta），列由 field_defs 决定
	Required []ieRequired // 必填校验（顺序即报错顺序）
}

// categoryCreateFailure 分类名称参照不到时的原版文案。
//
// 原版对找不到的分类名会尝试**自动建分类**，而建分类缺少 code 必然失败，
// 故稳定返回这句（回放 N2:2026-10-14，evidence/.../audit-batch-gg3-20261014.json）。
const categoryCreateFailure = "创建分类失败: ent: missing required field \"Category.code\""

// importExportSpecs 各导入导出对象的列定义。
//
// 表头文案逐字取自前端各列表页的 templateHint（CustomerList / ProductList /
// SupplierList / UnitList / WarehouseList / LocationList / RackList / SpuList /
// UserList / StockInList / DynamicDataList），保证「下载模板 → 填写 → 导入」闭环。
var importExportSpecs = map[string]ieSpec{
	"customers": {Kind: "customers", Table: "customers", Label: "客户", Dedupe: []string{"code", "name"},
		Required: []ieRequired{{Header: "名称", Message: "客户名称不能为空"}}, Fields: []ieField{
		{Header: "编码", Column: "code"},
		{Header: "名称", Column: "name"},
		{Header: "联系人", Column: "contact"},
		{Header: "电话", Column: "phone"},
		{Header: "邮箱", Column: "email"},
		{Header: "地址", Column: "address"},
		{Header: "分类名称", Column: "category_id", Ref: &ieRef{Table: "categories", Match: "name", Missing: categoryCreateFailure}},
		{Header: "信用额度", Column: "credit_limit", Kind: "num", Default: "0"},
		{Header: "信用余额", Column: "credit_balance", Kind: "num", Default: "0"},
		{Header: "账期(天)", Column: "payment_term", Kind: "int", Default: "0"},
		{Header: "税号", Column: "tax_no"},
		{Header: "银行账号", Column: "bank_account"},
		{Header: "备注", Column: "remark"},
	}},
	"suppliers": {Kind: "suppliers", Table: "suppliers", Label: "供应商", Dedupe: []string{"code", "name"},
		Required: []ieRequired{{Header: "名称", Message: "供应商名称不能为空"}}, Fields: []ieField{
		{Header: "编码", Column: "code"},
		{Header: "名称", Column: "name"},
		{Header: "联系人", Column: "contact"},
		{Header: "电话", Column: "phone"},
		{Header: "邮箱", Column: "email"},
		{Header: "地址", Column: "address"},
		{Header: "分类名称", Column: "category_id", Ref: &ieRef{Table: "categories", Match: "name", Missing: categoryCreateFailure}},
		{Header: "账期(天)", Column: "payment_term", Kind: "int", Default: "0"},
		{Header: "税号", Column: "tax_no"},
		{Header: "银行账号", Column: "bank_account"},
		{Header: "评级", Column: "rating"},
		{Header: "备注", Column: "remark"},
	}},
	"products": {Kind: "products", Table: "products", Label: "商品", Dedupe: []string{"code", "name"},
		Required: []ieRequired{{Header: "名称", Message: "商品名称不能为空"}}, Fields: []ieField{
		{Header: "编码", Column: "code"},
		{Header: "名称", Column: "name"},
		{Header: "规格型号", Column: "spec"},
		{Header: "条形码", Column: "barcode"},
		{Header: "商品类型", Column: "product_type", Default: "goods"},
		{Header: "分类名称", Column: "category_id", Ref: &ieRef{Table: "categories", Match: "name", Missing: categoryCreateFailure}},
		{Header: "单位名称", Column: "unit_id", Ref: &ieRef{Table: "units", Match: "name", Missing: "计量单位不存在: %s"}},
		{Header: "销售价", Column: "sale_price", Kind: "num", Default: "0"},
		{Header: "采购价", Column: "purchase_price", Kind: "num", Default: "0"},
		{Header: "安全库存", Column: "safety_stock", Kind: "num", Default: "0"},
		{Header: "备注", Column: "remark"},
		{Header: "是否批次", Column: "is_batch", Kind: "bool"},
		{Header: "保质期(天)", Column: "shelf_life_days", Kind: "int", ErrMode: "int", ErrLabel: "保质期(天)"},
	}},
	"units": {Kind: "units", Table: "units", Label: "计量单位", Dedupe: []string{"code", "name"},
		Required: []ieRequired{{Header: "名称", Message: "单位名称不能为空"}}, Fields: []ieField{
		{Header: "编码", Column: "code"},
		{Header: "名称", Column: "name"},
		{Header: "是否基础单位", Column: "is_base", Kind: "bool"},
		{Header: "备注", Column: "remark"},
	}},
	"warehouses": {Kind: "warehouses", Table: "warehouses", Label: "仓库", Dedupe: []string{"code", "name"},
		Required: []ieRequired{{Header: "名称", Message: "仓库名称不能为空"}}, Fields: []ieField{
		{Header: "编码", Column: "code"},
		{Header: "名称", Column: "name"},
		{Header: "地址", Column: "address"},
		{Header: "是否默认", Column: "is_default", Kind: "bool"},
		{Header: "备注", Column: "remark"},
	}},
	"locations": {Kind: "locations", Table: "locations", Label: "库位", Dedupe: []string{"code", "name"},
		Required: []ieRequired{{Header: "名称", Message: "库位名称不能为空"}}, Fields: []ieField{
		{Header: "编码", Column: "code"},
		{Header: "名称", Column: "name"},
		{Header: "仓库编码", Column: "warehouse_id", Ref: &ieRef{Table: "warehouses", Match: "code", Missing: "仓库不存在: %s"}},
		{Header: "面积", Column: "area", Kind: "num", Default: "0", ErrMode: "num"},
		{Header: "备注", Column: "remark"},
	}},
	"racks": {Kind: "racks", Table: "racks", Label: "货架", Dedupe: []string{"code", "name"},
		Required: []ieRequired{{Header: "名称", Message: "货架名称不能为空"}}, Fields: []ieField{
		{Header: "编码", Column: "code"},
		{Header: "名称", Column: "name"},
		{Header: "库位编码", Column: "location_id", Ref: &ieRef{Table: "locations", Match: "code", Missing: "库位不存在: %s"}},
		{Header: "行数", Column: "rows", Kind: "int", Default: "0", ErrMode: "int", ErrLabel: "rows"},
		{Header: "列数", Column: "cols", Kind: "int", Default: "0", ErrMode: "int", ErrLabel: "cols"},
		{Header: "容量", Column: "capacity", Kind: "num", Default: "0", ErrMode: "num"},
		{Header: "备注", Column: "remark"},
	}},
	"skus": {Kind: "skus", Table: "products", Label: "SKU", Dedupe: []string{"code"},
		Required: []ieRequired{
			{Header: "款号", Also: "款名", Message: "款号与款名不能同时为空"},
			{Header: "颜色", Message: "规格维度「颜色」不能为空"},
			{Header: "尺码", Message: "规格维度「尺码」不能为空"},
		}, Fields: []ieField{
		{Header: "款号", Column: "spu_id", Ref: &ieRef{Table: "product_spus", Match: "code", Missing: "多规格商品「%s」不存在，请填写款名以自动建款"}},
		{Header: "款名", Column: ""},
		{Header: "颜色", Column: "spec"},
		{Header: "尺码", Column: "spec", Combine: true},
		{Header: "SKU编码", Column: "code"},
		{Header: "条形码", Column: "barcode"},
		{Header: "销售价", Column: "sale_price", Kind: "num", Default: "0"},
		{Header: "采购价", Column: "purchase_price", Kind: "num", Default: "0"},
		{Header: "安全库存", Column: "safety_stock", Kind: "num", Default: "0"},
		{Header: "单位名称", Column: "unit_id", Ref: &ieRef{Table: "units", Match: "name", Missing: "计量单位不存在: %s"}},
		{Header: "分类名称", Column: "category_id", Ref: &ieRef{Table: "categories", Match: "name", Missing: categoryCreateFailure}},
		{Header: "是否批次", Column: "is_batch", Kind: "bool"},
		{Header: "保质期(天)", Column: "shelf_life_days", Kind: "int", ErrMode: "int", ErrLabel: "保质期(天)"},
		{Header: "备注", Column: "remark"},
	}},
	"users": {Kind: "users", Table: "sys_users", Label: "用户", Dedupe: []string{"username"},
		Required: []ieRequired{{Header: "用户名", Message: "用户名不能为空"}}, Fields: []ieField{
		{Header: "用户名", Column: "username"},
		{Header: "姓名", Column: "name"},
		{Header: "密码", Column: "password"},
		{Header: "手机号", Column: "phone"},
		{Header: "邮箱", Column: "email"},
		{Header: "角色", Column: "roles"},
		{Header: "部门", Column: "department_id", Ref: &ieRef{Table: "departments", Match: "name", Missing: "部门不存在: %s"}},
		{Header: "状态", Column: "status", Default: "active"},
	}},
	"opening-stock": {Kind: "opening-stock", Table: "inventory_balances", Label: "期初库存",
		Required: []ieRequired{
			{Header: "商品编码", Message: "商品编码不能为空"},
			{Header: "仓库编码", Message: "仓库编码不能为空"},
		}, Fields: []ieField{
		{Header: "商品编码", Column: "product_id", Ref: &ieRef{Table: "products", Match: "code", Missing: "商品不存在: %s"}},
		{Header: "仓库编码", Column: "warehouse_id", Ref: &ieRef{Table: "warehouses", Match: "code", Missing: "仓库不存在: %s"}},
		{Header: "库位编码", Column: "location_id", Ref: &ieRef{Table: "locations", Match: "code", Missing: "库位不存在: %s"}},
		{Header: "货架编码", Column: "rack_id", Ref: &ieRef{Table: "racks", Match: "code", Missing: "货架不存在: %s"}},
		{Header: "批号", Column: "batch_no"},
		{Header: "生产日期", Column: "production_date"},
		{Header: "有效期至", Column: "expiry_date"},
		{Header: "数量", Column: "qty_available", Kind: "num", Default: "0"},
		{Header: "单位成本", Column: "avg_cost", Kind: "num", Default: "0"},
		{Header: "备注", Column: "remark"},
	}},
	"meta": {Kind: "meta", Table: "", Label: "动态数据", Dynamic: true, Dedupe: []string{"code"}},
}

// ── 注册 ─────────────────────────────────────────────────────────────────────

func (s *Server) registerImportExport() {
	// 数据导出：两步式（先生成文件 → 再下载）；meta 例外，前端直接取 blob。
	for _, kind := range []string{"customers", "products", "suppliers"} {
		k := kind
		s.mux.Handle("GET /api/v1/export/"+k, s.protected("import_export", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s.exportData(w, r, k, false)
		})))
	}
	s.mux.Handle("GET /api/v1/export/meta", s.protected("import_export", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.exportData(w, r, "meta", true)
	})))
	// 模板导出：仅表头，直接下载
	for _, kind := range []string{"customers", "products", "suppliers", "units", "warehouses", "locations", "racks", "skus", "users", "opening-stock", "meta"} {
		k := kind
		s.mux.Handle("GET /api/v1/export/"+k+"-template", s.protected("import_export", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s.exportTemplate(w, r, k)
		})))
	}
	s.mux.Handle("GET /api/v1/export/download/{filename}", s.authenticated(http.HandlerFunc(s.downloadExport)))
	// 数据导入
	for _, kind := range []string{"customers", "products", "suppliers", "units", "warehouses", "locations", "racks", "skus", "users", "opening-stock", "meta"} {
		k := kind
		s.mux.Handle("POST /api/v1/import/"+k, s.protected("import_export", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s.importData(w, r, k)
		})))
	}
}

// ── 导出 ─────────────────────────────────────────────────────────────────────

// exportData 生成导出文件。direct=true 直接回传文件内容，否则返回 {filename, count}。
func (s *Server) exportData(w http.ResponseWriter, r *http.Request, kind string, direct bool) {
	spec := importExportSpecs[kind]
	fields := spec.Fields
	if spec.Dynamic {
		resolved, err := s.dynamicFields(r, r.URL.Query().Get("entity"))
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		fields = resolved
	}
	rows, err := s.exportRows(r, spec)
	if err != nil {
		verbatimFailure(w, err)
		return
	}
	lookups := s.refLookups(r, fields, rows)
	table := make([][]string, 0, len(rows)+1)
	headers := make([]string, 0, len(fields))
	for _, field := range fields {
		headers = append(headers, exportHeader(spec, field))
	}
	table = append(table, headers)
	for _, row := range rows {
		line := make([]string, 0, len(fields))
		for _, field := range fields {
			line = append(line, exportCell(row, field, lookups))
		}
		table = append(table, line)
	}
	s.writeExportFile(w, r, kind, table, len(rows), direct)
}

// exportTemplate 导出仅含表头的模板文件。
func (s *Server) exportTemplate(w http.ResponseWriter, r *http.Request, kind string) {
	spec := importExportSpecs[kind]
	fields := spec.Fields
	if spec.Dynamic {
		resolved, err := s.dynamicFields(r, r.URL.Query().Get("entity"))
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		fields = resolved
	}
	headers := make([]string, 0, len(fields))
	for _, field := range fields {
		headers = append(headers, exportHeader(spec, field))
	}
	s.writeExportFile(w, r, kind+"-template", [][]string{headers}, 0, true)
}

// exportRows 按 spec 取出待导出的行。
func (s *Server) exportRows(r *http.Request, spec ieSpec) ([]map[string]any, error) {
	if spec.Dynamic {
		code := r.URL.Query().Get("entity")
		table, ok := s.entityTable(r, code)
		if !ok {
			// 原版回放 GG16：HTTP 200 + code 10000「实体不存在: <编码>」
			return nil, verbatim{text: "实体不存在: " + code}
		}
		return s.Store.Rows(r.Context(), "SELECT * FROM "+database.Quote(table)+" WHERE deleted_at IS NULL ORDER BY created_at DESC")
	}
	if !s.Store.Has(spec.Table, "deleted_at") {
		return s.Store.Rows(r.Context(), "SELECT * FROM "+database.Quote(spec.Table)+" ORDER BY created_at DESC")
	}
	return s.Store.Rows(r.Context(), "SELECT * FROM "+database.Quote(spec.Table)+" WHERE deleted_at IS NULL ORDER BY created_at DESC")
}

// refLookups 为外键列预加载 id → 可读值的映射（避免逐行查库）。
func (s *Server) refLookups(r *http.Request, fields []ieField, rows []map[string]any) map[string]map[string]string {
	lookups := map[string]map[string]string{}
	for _, field := range fields {
		if field.Ref == nil {
			continue
		}
		key := field.Ref.Table + "." + field.Ref.Match
		if _, ok := lookups[key]; ok {
			continue
		}
		ids := map[string]bool{}
		for _, row := range rows {
			if v := text(row, field.Column); v != "" {
				ids[v] = true
			}
		}
		if len(ids) == 0 {
			lookups[key] = map[string]string{}
			continue
		}
		placeholders := make([]string, 0, len(ids))
		args := []any{}
		for id := range ids {
			placeholders = append(placeholders, "?")
			args = append(args, id)
		}
		found, err := s.Store.Rows(r.Context(),
			"SELECT id, "+database.Quote(field.Ref.Match)+" AS label FROM "+database.Quote(field.Ref.Table)+" WHERE id IN ("+strings.Join(placeholders, ",")+")",
			args...)
		if err != nil {
			lookups[key] = map[string]string{}
			continue
		}
		mapping := map[string]string{}
		for _, item := range found {
			mapping[text(item, "id")] = text(item, "label")
		}
		lookups[key] = mapping
	}
	return lookups
}

// exportCell 单元格文本：外键列回显可读值，布尔回显「是/否」。
func exportCell(row map[string]any, field ieField, lookups map[string]map[string]string) string {
	value := row[field.Column]
	if field.Ref != nil {
		id := fmt.Sprint(value)
		if id == "" || id == "<nil>" {
			return ""
		}
		if mapping, ok := lookups[field.Ref.Table+"."+field.Ref.Match]; ok {
			return mapping[id]
		}
		return ""
	}
	switch field.Kind {
	case "bool":
		return boolToYesNo(value)
	}
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func boolToYesNo(value any) string {
	switch v := value.(type) {
	case bool:
		if v {
			return "是"
		}
	case int64:
		if v != 0 {
			return "是"
		}
	case string:
		if v == "1" || v == "true" {
			return "是"
		}
	}
	return "否"
}

// writeExportFile 落盘 + 登记 export_files，再按 direct 决定回传形态。
func (s *Server) writeExportFile(w http.ResponseWriter, r *http.Request, kind string, table [][]string, count int, direct bool) {
	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "" {
		format = "csv"
	}
	if format != "csv" && format != "xlsx" {
		fail(w, 400, "导出格式仅支持 csv 与 xlsx")
		return
	}
	var payload []byte
	var err error
	if format == "xlsx" {
		payload, err = writeXLSX("Sheet1", table)
	} else {
		payload, err = writeCSV(table)
	}
	if err != nil {
		fail(w, 500, "导出文件生成失败")
		return
	}
	filename := fmt.Sprintf("%s-%s.%s", kind, time.Now().Format("20060102150405"), format)
	directory, err := s.exportsDirectory()
	if err != nil {
		fail(w, 500, "导出目录不可用")
		return
	}
	if err = os.WriteFile(filepath.Join(directory, filename), payload, 0o600); err != nil {
		fail(w, 500, "导出文件写入失败")
		return
	}
	now := database.Now()
	_ = s.Store.Insert(r.Context(), "export_files", map[string]any{
		"id":         uuid.NewString(),
		"created_at": now,
		"updated_at": now,
		"deleted_at": nil,
		"filename":   filename,
		"kind":       kind,
		"permission": "import_export",
		"expires_at": time.Now().Add(24 * time.Hour).Format(time.RFC3339Nano),
	})
	if direct {
		s.serveExportBytes(w, filename, format, payload)
		return
	}
	respond(w, 200, map[string]any{"filename": filename, "count": count})
}

// downloadExport 取回已生成的导出文件（校验登记记录与权限）。
func (s *Server) downloadExport(w http.ResponseWriter, r *http.Request) {
	filename := filepath.Base(r.PathValue("filename"))
	rows, err := s.Store.Rows(r.Context(), "SELECT * FROM export_files WHERE filename=? AND deleted_at IS NULL", filename)
	if err != nil || len(rows) == 0 {
		fail(w, 404, "导出文件不存在")
		return
	}
	if permission := text(rows[0], "permission"); permission != "" && !s.Auth.Allowed(r.Context(), current(r).UserID, permission) {
		fail(w, 403, "没有操作权限")
		return
	}
	directory, err := s.exportsDirectory()
	if err != nil {
		fail(w, 500, "导出目录不可用")
		return
	}
	payload, err := os.ReadFile(filepath.Join(directory, filename))
	if err != nil {
		fail(w, 404, "导出文件不存在")
		return
	}
	format := "csv"
	if strings.HasSuffix(strings.ToLower(filename), ".xlsx") {
		format = "xlsx"
	}
	s.serveExportBytes(w, filename, format, payload)
}

func (s *Server) serveExportBytes(w http.ResponseWriter, filename, format string, payload []byte) {
	if format == "xlsx" {
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	} else {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	_, _ = w.Write(payload)
}

// exportsDirectory 导出目录；未显式配置时回落到系统临时目录，保证测试环境可用。
func (s *Server) exportsDirectory() (string, error) {
	if s.exportDirectory != "" {
		return s.exportDirectory, nil
	}
	directory := filepath.Join(os.TempDir(), "la-erp-exports")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	return directory, nil
}

// ConfigureExports 显式指定导出目录（由 cmd 注入，与数据库同目录）。
func (s *Server) ConfigureExports(directory string) error {
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(absolute, 0o700); err != nil {
		return err
	}
	s.exportDirectory = absolute
	return nil
}

// ── 导入 ─────────────────────────────────────────────────────────────────────

func (s *Server) importData(w http.ResponseWriter, r *http.Request, kind string) {
	spec := importExportSpecs[kind]
	fields := spec.Fields
	if spec.Dynamic {
		code := r.URL.Query().Get("entity")
		resolved, err := s.dynamicFields(r, code)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		fields = resolved
		table, ok := s.entityTable(r, code)
		if !ok {
			verbatimFailure(w, verbatim{text: "实体不存在: " + code})
			return
		}
		spec.Table = table
	}
	if spec.Table == "" {
		fail(w, 501, "该导入对象尚未实现")
		return
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		fail(w, 400, "请选择要导入的文件")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "请选择要导入的文件")
		return
	}
	defer file.Close()
	table, err := readTable(file, header.Filename)
	if err != nil {
		verbatimFailure(w, err)
		return
	}
	// 原版对「无数据行」与「解析不出内容」都不报错，直接返回 total=0（回放 GG27/GG32）
	index := map[string]int{}
	for i, name := range table[0] {
		index[strings.TrimSpace(name)] = i
	}
	// 动态实体：表头必须全部是已定义字段，否则 HTTP 500（回放 GG33）
	if spec.Dynamic {
		known := map[string]bool{}
		for _, field := range fields {
			known[field.Column] = true
		}
		for _, header := range table[0] {
			key := importHeaderKey(spec, strings.TrimSpace(header))
			if key == "" {
				continue
			}
			if !known[key] {
				fail(w, 500, "模板包含未知字段列: "+strings.TrimSpace(header))
				return
			}
		}
	}
	onDuplicate := r.FormValue("on_duplicate")
	if onDuplicate == "" {
		onDuplicate = "create"
	}
	dryRun := r.FormValue("dry_run") == "true" || r.FormValue("dry_run") == "1"
	tenant := database.ZeroUUID
	now := database.Now()
	result := map[string]any{"total": len(table) - 1, "success": 0, "updated": 0, "skipped": 0, "failed": 0}
	if dryRun {
		result["dry_run"] = true
	}
	messages := []string{}
	ctx := r.Context()
	work := func(tx *importTx) error {
		success, updated, skipped, failed := 0, 0, 0, 0
		for i, line := range table[1:] {
			rowNo := i + 2
			record, err := s.buildImportRow(ctx, tx, spec, fields, index, line, tenant, now, current(r).UserID)
			if err != nil {
				failed++
				messages = append(messages, fmt.Sprintf("第%d行导入失败: %s", rowNo, err.Error()))
				continue
			}
			existing, err := s.findExisting(tx, spec, record)
			if err != nil {
				failed++
				messages = append(messages, fmt.Sprintf("第%d行导入失败: %s", rowNo, err.Error()))
				continue
			}
			if existing != nil {
				switch onDuplicate {
				case "skip":
					skipped++
					continue
				case "update":
					changes := map[string]any{"updated_at": now}
					for key, value := range record {
						if key == "id" || key == "created_at" || key == "tenant_id" || key == "created_by" || key == "password_hash" {
							continue
						}
						if value == "" || value == nil {
							continue // 「同名更新」：留空列保持原值
						}
						changes[key] = value
					}
					if err := tx.Update(spec.Table, text(existing, "id"), changes); err != nil {
						failed++
						messages = append(messages, fmt.Sprintf("第%d行导入失败: %s", rowNo, err.Error()))
						continue
					}
					updated++
					continue
				}
			}
			if err := tx.Insert(spec.Table, record); err != nil {
				failed++
				messages = append(messages, fmt.Sprintf("第%d行导入失败: %s", rowNo, err.Error()))
				continue
			}
			if roles := text(record, "roles"); roles != "" {
				_ = s.assignImportedUserRoles(tx, text(record, "id"), roles, now)
			}
			success++
		}
		result["success"] = success
		result["updated"] = updated
		result["skipped"] = skipped
		result["failed"] = failed
		return nil
	}
	if dryRun {
		raw, err := s.Store.DB.BeginTx(ctx, nil)
		if err != nil {
			s.failure(w, err, spec.Label)
			return
		}
		tx := &importTx{ctx: ctx, store: s.Store, tx: raw}
		if err := work(tx); err != nil {
			_ = raw.Rollback()
			s.failure(w, err, spec.Label)
			return
		}
		// 预览：真跑一遍再回滚，一个字节也不落库
		_ = raw.Rollback()
	} else {
		if err := work(&importTx{ctx: ctx, store: s.Store}); err != nil {
			s.failure(w, err, spec.Label)
			return
		}
	}
	if len(messages) > 0 {
		if len(messages) > 20 {
			messages = append(messages[:20], fmt.Sprintf("…其余 %d 条已省略", len(messages)-20))
		}
		result["messages"] = messages
	}
	respond(w, 200, result)
}

// buildImportRow 把一行文本翻译成一条待写入记录。
func (s *Server) buildImportRow(ctx context.Context, tx *importTx, spec ieSpec, fields []ieField, index map[string]int, line []string, tenant, now, userID string) (map[string]any, error) {
	record := map[string]any{}
	cell := func(header string) string {
		i, ok := index[header]
		if !ok || i >= len(line) {
			return ""
		}
		return strings.TrimSpace(line[i])
	}
	// 必填校验在字段解析之前：原版回放 N4 里「款号填了不存在的款 + 颜色留空」
	// 报的是「规格维度「颜色」不能为空」，而不是款号的参照错误。
	for _, item := range spec.Required {
		value := cell(item.Header)
		other := ""
		if item.Also != "" {
			other = cell(item.Also)
		}
		if value == "" && (item.Also == "" || other == "") {
			return nil, verbatim{text: item.Message}
		}
	}
	for _, field := range fields {
		if field.Column == "" {
			continue
		}
		raw := cell(field.Header)
		if raw == "" {
			raw = field.Default
		}
		if field.Ref != nil {
			if raw == "" {
				continue
			}
			id, err := tx.Resolve(field.Ref.Table, field.Ref.Match, raw)
			if err != nil {
				return nil, verbatim{text: ieMissingMessage(field.Ref, raw)}
			}
			record[field.Column] = id
			continue
		}
		switch field.Kind {
		case "bool":
			record[field.Column] = raw == "是" || raw == "true" || raw == "1" || raw == "Y" || raw == "y"
		case "int":
			if raw == "" {
				record[field.Column] = 0
				continue
			}
			v, err := strconv.Atoi(raw)
			if err != nil {
				return nil, verbatim{text: ieFormatError(field, raw, err.Error())}
			}
			if field.ErrMode == "int" && v < 0 {
				return nil, verbatim{text: ieFormatError(field, raw, "negative")}
			}
			record[field.Column] = v
		case "num":
			if raw == "" {
				record[field.Column] = "0"
				continue
			}
			value, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				return nil, verbatim{text: ieFormatError(field, raw, "can't convert "+raw+" to decimal")}
			}
			if field.ErrMode == "num" && value < 0 {
				return nil, verbatim{text: ieFormatError(field, raw, "negative")}
			}
			record[field.Column] = raw
		default:
			if field.Combine && raw != "" {
				if prev, _ := record[field.Column].(string); prev != "" {
					raw = prev + " " + raw
				}
			}
			record[field.Column] = raw
		}
	}
	switch spec.Kind {
	case "users":
		password := text(record, "password")
		if password == "" {
			password = randomPassword(12)
		}
		hash, err := auth.Hash(password)
		if err != nil {
			return nil, err
		}
		record["password_hash"] = hash
		delete(record, "password")
		if text(record, "status") == "" {
			record["status"] = "active"
		}
	case "opening-stock":
		record["qty_locked"] = "0"
		record["qty_in_transit"] = "0"
	case "skus":
		record["product_type"] = "goods"
		record["min_order_qty"] = "0"
		record["cost_method"] = "weighted_avg"
		record["is_combo"] = false
	}
	record["id"] = uuid.NewString()
	record["created_at"] = now
	record["updated_at"] = now
	if s.Store.Has(spec.Table, "tenant_id") {
		record["tenant_id"] = tenant
	}
	if s.Store.Has(spec.Table, "created_by") {
		record["created_by"] = userID
	}
	if s.Store.Has(spec.Table, "status") && text(record, "status") == "" {
		record["status"] = "active"
	}
	if s.Store.Has(spec.Table, "deleted_at") {
		record["deleted_at"] = nil
	}
	return record, nil
}

// findExisting 按 spec.Dedupe 顺序查找同编码/同名的既有记录。
func (s *Server) findExisting(tx *importTx, spec ieSpec, record map[string]any) (map[string]any, error) {
	for _, column := range spec.Dedupe {
		value := text(record, column)
		if value == "" || !s.Store.Has(spec.Table, column) {
			continue
		}
		rows, err := tx.Query("SELECT * FROM "+database.Quote(spec.Table)+" WHERE "+database.Quote(column)+"=?", value)
		if err != nil || len(rows) == 0 {
			continue
		}
		return rows[0], nil
	}
	if spec.Kind == "opening-stock" {
		rows, err := tx.Query("SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=? AND COALESCE(batch_no,'')=?",
			text(record, "product_id"), text(record, "warehouse_id"), text(record, "batch_no"))
		if err != nil || len(rows) == 0 {
			return nil, nil
		}
		return rows[0], nil
	}
	return nil, nil
}

// assignUserRoles 绑定「角色」列（多个用「、」分隔，按编码或名称匹配）。
func (s *Server) assignImportedUserRoles(tx *importTx, userID, roles, now string) error {
	if userID == "" || !s.Store.Has("sys_user_roles", "user_id") {
		return nil
	}
	for _, name := range strings.FieldsFunc(roles, func(c rune) bool { return c == '、' || c == ',' || c == '，' || c == '/' }) {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		found, err := tx.Query("SELECT id FROM sys_roles WHERE code=? AND deleted_at IS NULL", name)
		if err != nil || len(found) == 0 {
			found, err = tx.Query("SELECT id FROM sys_roles WHERE name=? AND deleted_at IS NULL", name)
		}
		if err != nil || len(found) == 0 {
			continue
		}
		_ = tx.Insert("sys_user_roles", map[string]any{
			"id":         uuid.NewString(),
			"created_at": now,
			"updated_at": now,
			"user_id":    userID,
			"role_id":    text(found[0], "id"),
		})
	}
	return nil
}

// dynamicFields 动态实体的列定义（field_defs：code → name）。
func (s *Server) dynamicFields(r *http.Request, entityCode string) ([]ieField, error) {
	if entityCode == "" {
		// 原版回放 GG15/GG17/GG18：HTTP 400「entity 参数不能为空」
		return nil, verbatim{text: "entity 参数不能为空", status: 400}
	}
	rows, err := s.Store.Rows(r.Context(),
		"SELECT f.code, f.name FROM field_defs f JOIN entity_defs e ON e.id=f.entity_id WHERE e.code=? AND f.deleted_at IS NULL AND e.deleted_at IS NULL ORDER BY f.sort_order, f.code",
		entityCode)
	if err != nil {
		return nil, err
	}
	// 原版对「有表无字段」的实体不报错：导出给空表头，导入走到
	// 「模板包含未知字段列: <表头>」（回放 GG29/GG33）。故这里返回空列而非错误。
	fields := make([]ieField, 0, len(rows))
	for _, row := range rows {
		fields = append(fields, ieField{Header: text(row, "name"), Column: text(row, "code")})
	}
	return fields, nil
}

// exportHeader 导出表头。动态实体（meta）原版写作「名称(code)」，导入时按 code 匹配。
func exportHeader(spec ieSpec, field ieField) string {
	if spec.Dynamic {
		return field.Header + "(" + field.Column + ")"
	}
	return field.Header
}

// importHeaderKey 解析导入表头：原版先按「名称(code)」取括号内 code，再按 code 匹配。
func importHeaderKey(spec ieSpec, header string) string {
	if !spec.Dynamic {
		return header
	}
	if start := strings.Index(header, "("); start >= 0 && strings.HasSuffix(header, ")") {
		return header[start+1 : len(header)-1]
	}
	return header
}

// randomPassword 生成临时密码（密码列留空时兜底，与前端说明一致）。
func randomPassword(n int) string {
	const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	out := make([]byte, n)
	for i := range out {
		remainder := new(big.Int).Mod(big.NewInt(time.Now().UnixNano()+int64(i)*7919), big.NewInt(int64(len(alphabet))))
		out[i] = alphabet[remainder.Int64()]
	}
	return string(out)
}

// ── 导入期的事务适配器 ────────────────────────────────────────────────────────
//
// 正式导入 tx==nil，直接走 Store（逐条自动提交，单行失败不影响其他行）；
// 预览（dry_run）tx!=nil，全部走同一事务，结束即回滚。

type importTx struct {
	ctx   context.Context
	store *database.Store
	tx    *sql.Tx
}

func (t *importTx) Insert(table string, record map[string]any) error {
	if t.tx == nil {
		return t.store.Insert(t.ctx, table, record)
	}
	return t.store.InsertWith(t.ctx, t.tx, table, record)
}
func (t *importTx) Update(table, id string, changes map[string]any) error {
	if t.tx == nil {
		return t.store.Update(t.ctx, table, id, changes)
	}
	return t.store.UpdateWith(t.ctx, t.tx, table, id, changes)
}
func (t *importTx) Query(query string, args ...any) ([]map[string]any, error) {
	if t.tx == nil {
		return t.store.Rows(t.ctx, query, args...)
	}
	return database.QueryRows(t.ctx, t.tx, query, args...)
}
func (t *importTx) Resolve(table, column, value string) (string, error) {
	where := database.Quote(column) + "=?"
	if t.store.Has(table, "deleted_at") {
		where += " AND deleted_at IS NULL"
	}
	rows, err := t.Query("SELECT id FROM "+database.Quote(table)+" WHERE "+where, value)
	if err != nil || len(rows) == 0 {
		return "", verbatim{text: "参照不存在"}
	}
	return text(rows[0], "id"), nil
}

// ── 文件读写 ─────────────────────────────────────────────────────────────────

// writeCSV 生成 UTF-8 BOM 的 CSV（Excel 直接双击不乱码）。
func writeCSV(table [][]string) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buf)
	if err := writer.WriteAll(table); err != nil {
		return nil, err
	}
	writer.Flush()
	return buf.Bytes(), writer.Error()
}

// writeXLSX 生成单表单的 xlsx。
func writeXLSX(sheet string, table [][]string) ([]byte, error) {
	file := excelize.NewFile()
	defer func() { _ = file.Close() }()
	first := file.GetSheetName(0)
	if sheet != first {
		if _, err := file.NewSheet(sheet); err != nil {
			return nil, err
		}
		if err := file.DeleteSheet(first); err != nil {
			return nil, err
		}
	}
	for i, row := range table {
		for j, cell := range row {
			axis, err := excelize.CoordinatesToCellName(j+1, i+1)
			if err != nil {
				return nil, err
			}
			if err := file.SetCellStr(sheet, axis, cell); err != nil {
				return nil, err
			}
		}
	}
	buffer, err := file.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// readTable 读取上传的 CSV / xlsx，统一成二维字符串表。
func readTable(file interface{ Read([]byte) (int, error) }, filename string) ([][]string, error) {
	payload, err := readAll(file)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(strings.ToLower(filename), ".xlsx") || strings.HasPrefix(string(payload[:min(2, len(payload))]), "PK") {
		return readXLSX(payload)
	}
	return readCSV(payload)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func readAll(file interface{ Read([]byte) (int, error) }) ([]byte, error) {
	var buf bytes.Buffer
	chunk := make([]byte, 32*1024)
	for {
		n, err := file.Read(chunk)
		if n > 0 {
			buf.Write(chunk[:n])
		}
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return nil, err
		}
		if n == 0 {
			break
		}
	}
	return buf.Bytes(), nil
}

func readCSV(payload []byte) ([][]string, error) {
	// Excel「另存为 CSV」会写 UTF-8 BOM，不剥掉会让首列表头匹配不上。
	payload = bytes.TrimPrefix(payload, []byte("\xEF\xBB\xBF"))
	reader := csv.NewReader(bytes.NewReader(payload))
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true
	rows, err := reader.ReadAll()
	if err != nil {
		// 原版对解析不出内容的 CSV 不报错：按 0 行处理，导入结果 total=0
		// （回放 GG27：二进制垃圾当作一行表头，无数据行，且无 messages）
		return nil, nil
	}
	out := make([][]string, 0, len(rows))
	for _, row := range rows {
		for i := range row {
			row[i] = strings.TrimPrefix(row[i], "\uFEFF")
		}
		out = append(out, row)
	}
	return out, nil
}

func readXLSX(payload []byte) ([][]string, error) {
	file, err := excelize.OpenReader(bytes.NewReader(payload))
	if err != nil {
		// 原版回放 GG28：HTTP 500「XLSX 打开失败: zip: not a valid zip file」
		return nil, verbatim{text: "XLSX 打开失败: " + err.Error(), status: 500}
	}
	defer func() { _ = file.Close() }()
	sheet := file.GetSheetName(0)
	if sheet == "" {
		return nil, verbatim{text: "XLSX 打开失败: sheet not found", status: 500}
	}
	rows, err := file.GetRows(sheet)
	if err != nil {
		return nil, verbatim{text: "XLSX 打开失败: " + err.Error(), status: 500}
	}
	return rows, nil
}

// ieFormatError 类型错误文案：原版按列有两种写法（回放 N3/GG25/GG26）。
//   ErrMode ""    → 「<列名> 格式错误: <底层错误>」
//   ErrMode "int" → 「<名字>必须为非负整数: <值>」
//   ErrMode "num" → 「<名字>必须为非负数: <值>」
func ieFormatError(field ieField, raw, detail string) string {
	switch field.ErrMode {
	case "int":
		return ieErrorLabel(field) + "必须为非负整数: " + raw
	case "num":
		return ieErrorLabel(field) + "必须为非负数: " + raw
	}
	return ieErrorLabel(ieField{Column: field.Column, ErrLabel: field.Column}) + "格式错误: " + detail
}

// ieMissingMessage 参照不存在的文案：categoryCreateFailure 是整句（无占位符），
// 其余按「<中文名>不存在: <值>」填值。
func ieMissingMessage(ref *ieRef, raw string) string {
	if !strings.Contains(ref.Missing, "%s") {
		return ref.Missing
	}
	return fmt.Sprintf(ref.Missing, raw)
}

// ieErrorLabel 类型错误文案里的字段名。
//
// 原版回放里 ASCII 列名后面带一个空格、中文名不带：
//   「payment_term 格式错误: …」「rows 必须为非负整数: abc」
//   「保质期(天)必须为非负整数: abc」「容量必须为非负数: abc」
// 故按是否纯 ASCII 决定是否补空格。
func ieErrorLabel(field ieField) string {
	name := field.ErrLabel
	if name == "" {
		name = field.Header
	}
	for _, r := range name {
		if r > 127 {
			return name
		}
	}
	return name + " "
}
