package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"la-erp/backend/internal/database"
	"net/url"
	"regexp"
	"strings"
)

var readonlySQL = regexp.MustCompile(`(?is)^\s*(select|with)\b`)

// validateReadOnlySQL 按既有实现边界校验自定义报表 SQL（2026-10-14 批次 D 回放：
// audit-batch-d-20261014.json）。实测：
//
//	SELECT / WITH / 前导空格 / 小写     → code:0 建单并可执行
//	任何分号（含结尾单个分号）          → 10000「不支持多条语句」
//	INSERT/UPDATE/DELETE/PRAGMA/ATTACH  → 10000「仅支持 SELECT 查询语句」
//
// 即本实现原有的「只允许 select/with 且不含分号」边界与既有实现**完全一致**，
// 只是既有实现返回业务错误文案而本实现返回 501。已对齐为原文案。
// 注意：分号检查先于语句类型检查——「SELECT 1; INSERT …」既有实现报「不支持多条语句」。
func validateReadOnlySQL(sqlText string) error {
	if strings.Contains(sqlText, ";") {
		return errors.New("不支持多条语句")
	}
	if !readonlySQL.MatchString(sqlText) {
		return errors.New("仅支持 SELECT 查询语句")
	}
	return nil
}

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
	if code == "" || name == "" || sqlText == "" {
		return nil, errors.New("报表编码、名称和查询 SQL 不能为空")
	}
	if err := validateReadOnlySQL(sqlText); err != nil {
		return nil, err
	}
	row := s.base("report_definitions")
	for _, k := range []string{"report_code", "report_name", "category", "query_sql", "columns", "status", "remark", "ext"} {
		if v, ok := input[k]; ok {
			row[k] = v
		}
	}
	row["report_code"], row["report_name"], row["query_sql"] = code, name, sqlText
	if value(row, "category") == "" {
		row["category"] = "custom"
	}
	if value(row, "status") == "" {
		row["status"] = "active"
	}
	if err := s.Store.Insert(ctx, "report_definitions", row); err != nil {
		return nil, err
	}
	return s.CustomReport(ctx, value(row, "id"))
}

func (s *Service) UpdateCustomReport(ctx context.Context, id string, input map[string]any) error {
	if _, err := s.CustomReport(ctx, id); err != nil {
		return err
	}
	changes := map[string]any{"updated_at": now()}
	for _, k := range []string{"report_name", "category", "remark", "status", "columns", "ext"} {
		if v, ok := input[k]; ok {
			changes[k] = v
		}
	}
	if sqlText, ok := input["query_sql"]; ok {
		q := strings.TrimSpace(fmt.Sprint(sqlText))
		if err := validateReadOnlySQL(q); err != nil {
			return err
		}
		changes["query_sql"] = q
	}
	return s.Store.Update(ctx, "report_definitions", id, changes)
}

func (s *Service) DeleteCustomReport(ctx context.Context, id string) error {
	if _, err := s.CustomReport(ctx, id); err != nil {
		return err
	}
	return s.Store.Update(ctx, "report_definitions", id, map[string]any{"deleted_at": now(), "updated_at": now()})
}

func (s *Service) RunCustomReport(ctx context.Context, id string) (map[string]any, error) {
	r, err := s.CustomReport(ctx, id)
	if err != nil {
		return nil, err
	}
	if value(r, "status") != "active" {
		return nil, errors.New("自定义报表已停用")
	}
	sqlText := strings.TrimSpace(value(r, "query_sql"))
	if err := validateReadOnlySQL(sqlText); err != nil {
		return nil, err
	}
	resultColumns, rows, err := database.QueryRowsWithColumns(ctx, s.Store.DB, sqlText)
	if err != nil {
		return nil, fmt.Errorf("自定义报表执行失败: %w", err)
	}
	var columns any
	if raw := value(r, "columns"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &columns)
	}
	if columns == nil {
		columns = columnMetadata(resultColumns)
	}
	return map[string]any{"report": r, "columns": columns, "rows": rows}, nil
}

func columnMetadata(names []string) []map[string]any {
	result := make([]map[string]any, 0, len(names))
	for _, name := range names {
		result = append(result, map[string]any{"key": name, "label": name})
	}
	return result
}

func (s *Service) RunCustomSQL(ctx context.Context, sqlText string, columns any) (map[string]any, error) {
	sqlText = strings.TrimSpace(sqlText)
	if err := validateReadOnlySQL(sqlText); err != nil {
		return nil, err
	}
	resultColumns, rows, err := database.QueryRowsWithColumns(ctx, s.Store.DB, sqlText)
	if err != nil {
		return nil, fmt.Errorf("自定义报表执行失败: %w", err)
	}
	if columns == nil {
		columns = columnMetadata(resultColumns)
	}
	return map[string]any{"columns": columns, "rows": rows}, nil
}
