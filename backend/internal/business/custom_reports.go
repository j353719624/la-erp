package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"net/url"
	"la-erp-recovered/backend/internal/database"
)

var readonlySQL = regexp.MustCompile(`(?is)^\s*(select|with)\b`)

// CustomReports mirrors the installed report_definitions contract. Arbitrary
// writes and non-read-only SQL are rejected until the original authorization
// and parameter binding rules are evidenced.
func (s *Service) CustomReports(ctx context.Context, q url.Values) ([]map[string]any, int, error) {
	return s.Store.List(ctx, "report_definitions", q)
}

func (s *Service) CustomReport(ctx context.Context, id string) (map[string]any, error) {
	return s.Store.Get(ctx, "report_definitions", id)
}

func (s *Service) CreateCustomReport(ctx context.Context, input map[string]any) (map[string]any, error) {
	code, name, sqlText := value(input, "report_code"), value(input, "report_name"), strings.TrimSpace(value(input, "query_sql"))
	if code == "" || name == "" || sqlText == "" { return nil, errors.New("报表编码、名称和查询 SQL 不能为空") }
	if !readonlySQL.MatchString(sqlText) || strings.Contains(sqlText, ";") { return nil, ErrUnsupported }
	row := s.base("report_definitions")
	for _, k := range []string{"report_code", "report_name", "category", "query_sql", "columns", "status", "remark", "ext"} { if v, ok := input[k]; ok { row[k] = v } }
	row["report_code"], row["report_name"], row["query_sql"] = code, name, sqlText
	if value(row, "category") == "" { row["category"] = "custom" }; if value(row, "status") == "" { row["status"] = "active" }
	if err := s.Store.Insert(ctx, "report_definitions", row); err != nil { return nil, err }
	return s.CustomReport(ctx, value(row, "id"))
}

func (s *Service) UpdateCustomReport(ctx context.Context, id string, input map[string]any) error {
	if _, err := s.CustomReport(ctx, id); err != nil { return err }
	changes := map[string]any{"updated_at": now()}
	for _, k := range []string{"report_name", "category", "remark", "status", "columns", "ext"} { if v, ok := input[k]; ok { changes[k] = v } }
	if sqlText, ok := input["query_sql"]; ok { q := strings.TrimSpace(fmt.Sprint(sqlText)); if !readonlySQL.MatchString(q) || strings.Contains(q, ";") { return ErrUnsupported }; changes["query_sql"] = q }
	return s.Store.Update(ctx, "report_definitions", id, changes)
}

func (s *Service) DeleteCustomReport(ctx context.Context, id string) error {
	if _, err := s.CustomReport(ctx, id); err != nil { return err }
	return s.Store.Update(ctx, "report_definitions", id, map[string]any{"deleted_at": now(), "updated_at": now()})
}

func (s *Service) RunCustomReport(ctx context.Context, id string) (map[string]any, error) {
	r, err := s.CustomReport(ctx, id)
	if err != nil { return nil, err }
	if value(r, "status") != "active" { return nil, errors.New("自定义报表已停用") }
	sqlText := strings.TrimSpace(value(r, "query_sql"))
	if !readonlySQL.MatchString(sqlText) || strings.Contains(sqlText, ";") { return nil, ErrUnsupported }
	resultColumns, rows, err := database.QueryRowsWithColumns(ctx, s.Store.DB, sqlText)
	if err != nil { return nil, fmt.Errorf("自定义报表执行失败: %w", err) }
	var columns any
	if raw := value(r, "columns"); raw != "" { _ = json.Unmarshal([]byte(raw), &columns) }
	if columns == nil { columns = columnMetadata(resultColumns) }
	return map[string]any{"report": r, "columns": columns, "rows": rows}, nil
}

func columnMetadata(names []string) []map[string]any {
	result := make([]map[string]any, 0, len(names))
	for _, name := range names { result = append(result, map[string]any{"key": name, "label": name}) }
	return result
}

func (s *Service) RunCustomSQL(ctx context.Context, sqlText string, columns any) (map[string]any, error) {
	sqlText = strings.TrimSpace(sqlText)
	if !readonlySQL.MatchString(sqlText) || strings.Contains(sqlText, ";") {
		return nil, ErrUnsupported
	}
	resultColumns, rows, err := database.QueryRowsWithColumns(ctx, s.Store.DB, sqlText)
	if err != nil { return nil, fmt.Errorf("自定义报表执行失败: %w", err) }
	if columns == nil { columns = columnMetadata(resultColumns) }
	return map[string]any{"columns": columns, "rows": rows}, nil
}
