package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp/backend/internal/database"
)

func (s *Service) RetireFixedAsset(ctx context.Context, id string) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "fixed_assets", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("固定资产不存在")
		}
		if err != nil {
			return err
		}
		if value(row, "status") == "retired" {
			return errors.New("固定资产已报废")
		}
		if err := s.Store.UpdateWith(ctx, tx, "fixed_assets", id, map[string]any{"status": "retired", "updated_at": now()}); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "fixed_assets", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("fixed_assets", result), nil
}

func (s *Service) RunDepreciation(ctx context.Context, period string) ([]map[string]any, error) {
	if period == "" {
		return nil, errors.New("折旧期间不能为空")
	}
	result := []map[string]any{}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		assets, err := database.QueryRows(ctx, tx, "SELECT * FROM fixed_assets WHERE deleted_at IS NULL AND status='in_use'")
		if err != nil {
			return err
		}
		for _, asset := range assets {
			var count int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM depreciation_entries WHERE asset_id=? AND period=? AND deleted_at IS NULL", asset["id"], period).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				continue
			}
			amount := readDecimal(asset, "monthly_depreciation")
			if amount.IsNegative() || amount.IsZero() {
				continue
			}
			acc := readDecimal(asset, "accumulated_depreciation").Add(amount)
			original := readDecimal(asset, "original_value")
			if acc.GreaterThan(original) {
				amount = original.Sub(readDecimal(asset, "accumulated_depreciation"))
				acc = original
			}
			net := original.Sub(acc)
			entry := s.base("depreciation_entries")
			entry["period"], entry["amount"], entry["status"], entry["asset_id"] = period, amount.String(), "posted", asset["id"]
			if err := s.Store.InsertWith(ctx, tx, "depreciation_entries", entry); err != nil {
				return err
			}
			if err := s.Store.UpdateWith(ctx, tx, "fixed_assets", value(asset, "id"), map[string]any{"accumulated_depreciation": acc.String(), "net_value": net.String(), "updated_at": now()}); err != nil {
				return err
			}
			result = append(result, s.Store.Public("depreciation_entries", entry))
		}
		return nil
	})
	return result, err
}

func (s *Service) DepreciationEntries(ctx context.Context, period string) ([]map[string]any, error) {
	query := "SELECT * FROM depreciation_entries WHERE deleted_at IS NULL"
	args := []any{}
	if period != "" {
		query += " AND period=?"
		args = append(args, period)
	}
	query += " ORDER BY period,created_at"
	rows, err := s.Store.Rows(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		result = append(result, s.Store.Public("depreciation_entries", row))
	}
	return result, nil
}
