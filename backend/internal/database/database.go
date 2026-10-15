// Package database uses the schema src from the original 1.4.51 runtime.
package database

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	_ "modernc.org/sqlite"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed schema.sql schema.json
var schemaFiles embed.FS
var ErrNotFound = errors.New("record not found")

type Column struct {
	Name    string  `json:"name"`
	Type    string  `json:"type"`
	NotNull int     `json:"notnull"`
	Default *string `json:"dflt_value"`
	PK      int     `json:"pk"`
}
type Table struct {
	Name    string   `json:"name"`
	Columns []Column `json:"columns"`
	SQL     string   `json:"sql"`
}
type Store struct {
	DB       *sql.DB
	Tables   map[string]Table
	Filename string
}

const ZeroUUID = "00000000-0000-0000-0000-000000000000"

func Open(filename string) (*Store, error) {
	if filename != " :memory:" && filename != ":memory:" && !strings.HasPrefix(filename, "file:") {
		if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", filename)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	failure := func(err error) (*Store, error) { db.Close(); return nil, err }
	if _, err = db.Exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;"); err != nil {
		return failure(err)
	}
	s := &Store{DB: db, Tables: map[string]Table{}, Filename: filename}
	var tables []Table
	raw, _ := schemaFiles.ReadFile("schema.json")
	if err = json.Unmarshal(raw, &tables); err != nil {
		return failure(err)
	}
	for _, t := range tables {
		s.Tables[t.Name] = t
	}
	var existing int
	if err = db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&existing); err != nil {
		return failure(err)
	}
	if existing == 0 {
		raw, _ = schemaFiles.ReadFile("schema.sql")
		tx, e := db.Begin()
		if e != nil {
			return failure(e)
		}
		if _, e = tx.Exec(string(raw)); e != nil {
			tx.Rollback()
			return failure(e)
		}
		if e = tx.Commit(); e != nil {
			return failure(e)
		}
	} else {
		// Existing databases are opened as-is. No automatic schema rewrite is made.
		var found int
		if err = db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='sys_users'").Scan(&found); err != nil || found != 1 {
			return failure(errors.New("existing database does not match src ERP schema"))
		}
	}
	return s, nil
}
func (s *Store) Close() error  { return s.DB.Close() }
func Quote(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }
func (s *Store) Has(table, column string) bool {
	for _, c := range s.Tables[table].Columns {
		if c.Name == column {
			return true
		}
	}
	return false
}

type Executor interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func (s *Store) Rows(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	return QueryRows(ctx, s.DB, query, args...)
}
func QueryRows(ctx context.Context, db Executor, query string, args ...any) ([]map[string]any, error) {
	_, result, err := QueryRowsWithColumns(ctx, db, query, args...)
	return result, err
}
func QueryRowsWithColumns(ctx context.Context, db Executor, query string, args ...any) ([]string, []map[string]any, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	result := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		ptr := make([]any, len(values))
		for i := range values {
			ptr[i] = &values[i]
		}
		if err = rows.Scan(ptr...); err != nil {
			return nil, nil, err
		}
		record := map[string]any{}
		for i, k := range columns {
			v := values[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			record[k] = v
		}
		result = append(result, record)
	}
	return columns, result, rows.Err()
}
func (s *Store) Get(ctx context.Context, table, id string) (map[string]any, error) {
	return s.GetWith(ctx, s.DB, table, id)
}
func (s *Store) GetWith(ctx context.Context, db Executor, table, id string) (map[string]any, error) {
	if _, ok := s.Tables[table]; !ok {
		return nil, errors.New("unknown table")
	}
	where := "id=?"
	if s.Has(table, "deleted_at") {
		where += " AND deleted_at IS NULL"
	}
	rows, err := QueryRows(ctx, db, "SELECT * FROM "+Quote(table)+" WHERE "+where, id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

// listExtraFilters 是「列存在也不一定支持」的外键/单号过滤，按表白名单。
//
// 回归回放 JJ2 对 30 个有数据的资源逐一探测（用不可能命中的值，看 total 是否掉 0），
// 实测出的支持情况**与列是否存在并不一致**：
//   - work_order_id：生产领料/入库/退料支持；返工单、工序汇报、外协单**不支持**
//   - source_type：凭证、收付款计划、库存流水支持；序列号**不支持**
//   - customer_id / supplier_id / order_no：销售/采购单据类支持
//
// 未采样的表（既有实现上数据 < 4 条，探不出结果）按「有该列就支持」放行，
// 因为前端若会发这个参数，通常意味着既有实现确实支持。
var listExtraFilters = map[string][]string{
	"crm_opportunities":        {"customer_id"},
	"vouchers":                 {"source_type"},
	"bank_statements":          {"account_id"},
	"payment_plans":            {"source_type"},
	"stock_movements":          {"source_type"},
	"sales_orders":             {"customer_id", "order_no"},
	"purchase_orders":          {"supplier_id", "order_no"},
	"sales_returns":            {"customer_id", "order_no"},
	"purchase_returns":         {"supplier_id", "order_no"},
	"purchase_rf_qs":           {"supplier_id"},
	"sales_quotations":         {"customer_id"},
	"purchase_contracts":       {"supplier_id"},
	"sales_contracts":          {"customer_id"},
	"purchase_reconciliations": {"supplier_id"},
	"work_orders":              {"order_no"},
	"subcontract_orders":       {"supplier_id"},
	"production_pickings":      {"work_order_id"},
	"production_receipts":      {"work_order_id"},
	"production_returns":       {"work_order_id"},
	"leads":                    {"customer_id"},
	// 有反证、明确不支持的（列存在但既有实现不过滤）：
	//   serial_numbers.source_type、work_order_processes.work_order_id、
	//   rework_orders.work_order_id、subcontract_orders.work_order_id
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// listDateColumn 记录「start_date / end_date 日期区间」在各表上作用于哪一列。
//
// 回归回放 JJ2 探测出哪些表接受日期参数，JJ3-B / JJ5 / JJ6 进一步确定作用列：
//
//	sales_orders / purchase_orders / sales_returns → order_date
//	stock_movements                                → created_at
//
// vouchers / work_orders / stock_ins / stock_outs / work_order_processes 也接受
// start_date，但实测出来的命中数与 created_at、order_date 都对不上（作用列另有其人），
// 未确定前不列入本表，免得按猜错的列过滤出错误结果。
var listDateColumn = map[string]string{
	"sales_orders":    "order_date",
	"purchase_orders": "order_date",
	"sales_returns":   "order_date",
	"stock_movements": "created_at",
}

func (s *Store) List(ctx context.Context, table string, q url.Values) ([]map[string]any, int, error) {
	if _, ok := s.Tables[table]; !ok {
		return nil, 0, errors.New("unknown table")
	}
	clauses := []string{}
	args := []any{}
	if s.Has(table, "deleted_at") {
		clauses = append(clauses, "deleted_at IS NULL")
	}
	// period：佣金结算单/税金计提等按「期间」归档的单据需要按 period 精确过滤
	// （GET /sales-commissions/settlements?period=2026-10 走通用列表资源）。
	for _, field := range []string{"status", "entity_code", "type_code", "parent_id", "category_id", "category", "shift", "warehouse_id", "department_id", "product_type", "type", "module", "created_by", "location_id", "product_id", "applicable_product_id", "period"} {
		if value := q.Get(field); value != "" && s.Has(table, field) {
			clauses = append(clauses, Quote(field)+"=?")
			args = append(args, value)
		}
	}
	for _, field := range []string{"name", "code", "username", "mrp_no", "suggestion_no"} {
		if value := q.Get(field); value != "" && s.Has(table, field) {
			clauses = append(clauses, Quote(field)+" LIKE ?")
			args = append(args, "%"+value+"%")
		}
	}
	// ── 以下外键过滤是回归回放 JJ2（2026-10-14）实测补的 ──
	// 本实现此前只认一组「通用」字段，销售订单列表页发的 customer_id 被静默忽略，
	// 等于筛选失效。用「不可能命中的值」逐个探测，total 掉 0 即证明该参数被当作过滤条件。
	//
	// 但**不是所有表都支持**：同样是带 work_order_id 列的表，生产领料/入库/退料支持，
	// 而返工单、工序汇报、外协单实测不支持（total 不变）。故用 listExtraFilters
	// 按表白名单控制，不能一律按「列存在就过滤」处理。
	for _, field := range listExtraFilters[table] {
		// order_no 走下面的「包含」匹配，不参与精确等值
		if field == "order_no" {
			continue
		}
		if value := q.Get(field); value != "" && s.Has(table, field) {
			clauses = append(clauses, Quote(field)+"=?")
			args = append(args, value)
		}
	}
	// order_no 是「包含」匹配且**区分大小写**：
	//   回放 JJ3-A3 order_no=SO20261014003 → 10 条（命中 030~039）
	//   回放 JJ3-A4 order_no=202610140035  → 1 条（中缀也命中）
	//   回放 JJ3-A5 order_no=so202610140035（小写）→ 0 条
	// SQLite 的 LIKE 对 ASCII 默认不区分大小写，故此处用 instr 而非 LIKE。
	if value := q.Get("order_no"); value != "" && s.Has(table, "order_no") && contains(listExtraFilters[table], "order_no") {
		clauses = append(clauses, "instr("+Quote("order_no")+", ?) > 0")
		args = append(args, value)
	}
	// 日期区间：作用列**按表而异**，且上下界写法不对称（回放 JJ3-B / JJ5 / JJ6）：
	//   下界  col >= start_date                  —— 直接比对（含时间部分）
	//   上界  date(col) <= date(end_date)        —— 经 SQLite date() 归一到 UTC 再比
	//   例：销售订单 end_date=2026-10-12 仍能查到 order_date=2026-10-13T00:00:00+08:00
	//       的记录（date() 归一后为 2026-10-12），而 end_date=2026-10-11 查不到。
	// 只配置已用回放确认过作用列的表；其余表（vouchers / work_orders / stock_ins …）
	// 虽然也接受 start_date，但作用列未能确定，故不配置，避免猜错列。
	if column, ok := listDateColumn[table]; ok {
		if value := q.Get("start_date"); value != "" {
			clauses = append(clauses, Quote(column)+" >= ?")
			args = append(args, value)
		}
		if value := q.Get("end_date"); value != "" {
			clauses = append(clauses, "date("+Quote(column)+") <= date(?)")
			args = append(args, value)
		}
	}
	if table == "rework_orders" && q.Get("work_order_no") != "" {
		clauses = append(clauses, "work_order_no LIKE ?")
		args = append(args, "%"+q.Get("work_order_no")+"%")
	}
	if table == "product_documents" && q.Get("only_current") == "true" {
		clauses = append(clauses, "status='effective'")
	}
	if table == "equipment_maintenances" && q.Get("nearing_days") != "" {
		if days, err := strconv.Atoi(q.Get("nearing_days")); err == nil && days >= 0 {
			clauses = append(clauses, "plan_date IS NOT NULL AND plan_date <= datetime('now', '+' || ? || ' days')")
			args = append(args, days)
		}
	}
	if table == "toolings" && q.Get("nearing_days") != "" {
		if days, err := strconv.Atoi(q.Get("nearing_days")); err == nil && days >= 0 {
			clauses = append(clauses, "next_maintain_date IS NOT NULL AND next_maintain_date <= datetime('now', '+' || ? || ' days')")
			args = append(args, days)
		}
	}
	if table == "labor_contracts" && q.Get("expiring_days") != "" {
		if days, err := strconv.Atoi(q.Get("expiring_days")); err == nil && days >= 0 {
			clauses = append(clauses, "end_date IS NOT NULL AND end_date <= datetime('now', '+' || ? || ' days')")
			args = append(args, days)
		}
	}
	if keyword := q.Get("keyword"); keyword != "" {
		parts := []string{}
		fields := []string{"name", "code", "username", "phone"}
		if table == "toolings" {
			fields = []string{"tooling_no", "name", "model", "spec", "responsible"}
		}
		if table == "production_equipments" {
			fields = []string{"equipment_no", "name", "model", "spec", "manufacturer", "serial_no", "responsible"}
		}
		if table == "equipment_maintenances" {
			fields = []string{"equipment_no", "equipment_name", "content", "executor", "remark"}
		}
		if table == "product_documents" {
			fields = []string{"doc_no", "title", "author", "product_name"}
		}
		if table == "rework_orders" {
			fields = []string{"code", "process_name", "reason"}
		}
		if table == "subcontract_orders" {
			fields = []string{"code", "supplier_name", "process_name", "product_name"}
		}
		if table == "serial_numbers" {
			fields = []string{"serial_no", "product_code", "product_name"}
		}
		for _, k := range fields {
			if s.Has(table, k) {
				parts = append(parts, Quote(k)+" LIKE ?")
				args = append(args, "%"+keyword+"%")
			}
		}
		if len(parts) > 0 {
			clauses = append(clauses, "("+strings.Join(parts, " OR ")+")")
		}
	}
	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}
	var total int
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM "+Quote(table)+where, args...).Scan(&total); err != nil {
		return nil, 0, err
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
	order := "id DESC"
	if s.Has(table, "created_at") {
		order = "created_at DESC"
	}
	if q.Get("sort_order") != "" && s.Has(table, "sort_order") {
		order = "sort_order ASC"
	}
	query := "SELECT * FROM " + Quote(table) + where + " ORDER BY " + order + " LIMIT ? OFFSET ?"
	args = append(args, size, (page-1)*size)
	rows, err := s.Rows(ctx, query, args...)
	return rows, total, err
}
func Now() string { return time.Now().In(time.FixedZone("CST", 8*60*60)).Format(time.RFC3339Nano) }
func SQLValue(v any) any {
	switch value := v.(type) {
	case time.Time:
		return value.Format(time.RFC3339Nano)
	case json.Number:
		return value.String()
	case map[string]any, []any:
		raw, _ := json.Marshal(v)
		return string(raw)
	default:
		return value
	}
}
func (s *Store) Insert(ctx context.Context, table string, record map[string]any) error {
	return s.InsertWith(ctx, s.DB, table, record)
}
func (s *Store) InsertWith(ctx context.Context, db Executor, table string, record map[string]any) error {
	if _, ok := s.Tables[table]; !ok {
		return errors.New("unknown table")
	}
	keys := []string{}
	for key := range record {
		if !s.Has(table, key) {
			return fmt.Errorf("unknown column %s", key)
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	values := []any{}
	columns := []string{}
	marks := []string{}
	for _, key := range keys {
		columns = append(columns, Quote(key))
		marks = append(marks, "?")
		values = append(values, SQLValue(record[key]))
	}
	_, err := db.ExecContext(ctx, "INSERT INTO "+Quote(table)+" ("+strings.Join(columns, ",")+") VALUES ("+strings.Join(marks, ",")+")", values...)
	return err
}
func (s *Store) Update(ctx context.Context, table, id string, changes map[string]any) error {
	return s.UpdateWith(ctx, s.DB, table, id, changes)
}
func (s *Store) UpdateWith(ctx context.Context, db Executor, table, id string, changes map[string]any) error {
	if _, ok := s.Tables[table]; !ok {
		return errors.New("unknown table")
	}
	keys := []string{}
	for k := range changes {
		if !s.Has(table, k) {
			return fmt.Errorf("unknown column %s", k)
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return nil
	}
	sets := []string{}
	values := []any{}
	for _, k := range keys {
		sets = append(sets, Quote(k)+"=?")
		values = append(values, SQLValue(changes[k]))
	}
	values = append(values, id)
	where := "id=?"
	if s.Has(table, "deleted_at") {
		where += " AND deleted_at IS NULL"
	}
	result, err := db.ExecContext(ctx, "UPDATE "+Quote(table)+" SET "+strings.Join(sets, ",")+" WHERE "+where, values...)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

// Public omits zero values just as the original generated JSON model does.
func (s *Store) Public(table string, record map[string]any) map[string]any {
	result := map[string]any{}
	for _, column := range s.Tables[table].Columns {
		key := column.Name
		v := record[key]
		if v == nil || key == "password_hash" {
			continue
		}
		switch strings.ToLower(column.Type) {
		case "json":
			var value any
			if json.Unmarshal([]byte(fmt.Sprint(v)), &value) == nil {
				if value == nil {
					continue
				}
				if items, ok := value.([]any); ok && len(items) == 0 {
					continue
				}
				if items, ok := value.(map[string]any); ok && len(items) == 0 {
					continue
				}
				result[key] = value
			}
			continue
		case "bool":
			switch b := v.(type) {
			case bool:
				if b {
					result[key] = true
				}
			case int64:
				if b != 0 {
					result[key] = true
				}
			case string:
				if b == "true" || b == "1" {
					result[key] = true
				}
			}
			continue
		case "numeric":
			result[key] = fmt.Sprint(v)
			continue
		case "datetime":
			if t, ok := v.(time.Time); ok {
				result[key] = t.Format(time.RFC3339Nano)
			} else {
				result[key] = v
			}
			continue
		}
		if v == "" || v == int64(0) || v == float64(0) {
			continue
		}
		result[key] = v
	}
	if table != "departments" && !strings.HasPrefix(table, "sys_user_roles") && table != "sys_role_permissions" {
		result["edges"] = map[string]any{}
	}
	return result
}
