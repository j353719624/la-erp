package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

func (s *Service) currencyPublic(row map[string]any) map[string]any {
	out := s.Store.Public("currencies", row)
	delete(out, "edges")
	return out
}
func (s *Service) Currencies(ctx context.Context) ([]map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT * FROM currencies WHERE deleted_at IS NULL ORDER BY created_at ASC")
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, row := range rows {
		out = append(out, s.currencyPublic(row))
	}
	return out, nil
}
func (s *Service) SaveCurrency(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	create := id == ""
	rate := decimal.Zero
	if input["exchange_rate"] != nil {
		var err error
		rate, err = decimal.NewFromString(value(input, "exchange_rate"))
		if err != nil {
			return nil, err
		}
	}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var row map[string]any
		if create {
			if value(input, "code") == "" {
				return errors.New("币种编码不能为空")
			}
			var count int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM currencies WHERE code=?", value(input, "code")).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				return errors.New("币种编码已存在")
			}
			row = s.base("currencies")
			id = value(row, "id")
			row["code"] = value(input, "code")
			row["is_base"] = false
			row["exchange_rate"] = "1"
			if !rate.IsZero() {
				row["exchange_rate"] = rate.String()
			}
			for _, field := range []string{"name", "symbol", "remark"} {
				row[field] = value(input, field)
			}
		} else {
			var err error
			row, err = s.Store.GetWith(ctx, tx, "currencies", id)
			if err != nil {
				if errors.Is(err, database.ErrNotFound) {
					return errors.New("币种不存在")
				}
				return err
			}
		}
		changes := map[string]any{"updated_at": now()}
		for _, field := range []string{"name", "symbol", "remark", "is_base"} {
			if v := input[field]; v != nil {
				changes[field] = v
			}
		}
		if rate.IsPositive() {
			changes["exchange_rate"] = rate.String()
		}
		if base, ok := input["is_base"].(bool); ok && base {
			if _, err := tx.ExecContext(ctx, "UPDATE currencies SET is_base=0,updated_at=? WHERE deleted_at IS NULL", now()); err != nil {
				return err
			}
		}
		if create {
			for k, v := range changes {
				row[k] = v
			}
			return s.Store.InsertWith(ctx, tx, "currencies", row)
		}
		return s.Store.UpdateWith(ctx, tx, "currencies", id, changes)
	})
	if err != nil {
		return nil, err
	}
	row, err := s.Store.Get(ctx, "currencies", id)
	if err != nil {
		return nil, err
	}
	return s.currencyPublic(row), nil
}

func (s *Service) DeleteCurrency(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "currencies", id)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				return errors.New("币种不存在")
			}
			return err
		}
		if value(row, "is_base") == "1" || value(row, "is_base") == "true" {
			return errors.New("本位币不能删除")
		}
		suffix := id
		if len(suffix) > 8 {
			suffix = suffix[:8]
		}
		return s.Store.UpdateWith(ctx, tx, "currencies", id, map[string]any{"deleted_at": now(), "updated_at": now(), "code": value(row, "code") + "~del~" + suffix})
	})
}
