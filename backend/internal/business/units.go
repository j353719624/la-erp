package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp/backend/internal/database"
)

func (s *Service) UnitConversions(ctx context.Context, product string) ([]map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT * FROM unit_conversions WHERE product_id=? AND deleted_at IS NULL ORDER BY created_at", product)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, r := range rows {
		out = append(out, s.Store.Public("unit_conversions", r))
	}
	return out, nil
}

func (s *Service) WriteUnitConversion(ctx context.Context, product, id string, input map[string]any) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		p, err := s.Store.GetWith(ctx, tx, "products", product)
		if err != nil {
			return err
		}
		h := s.base("unit_conversions")
		if creating {
			unit := value(input, "unit_id")
			if unit == value(p, "unit_id") {
				return errors.New("辅助单位不能等于商品主单位")
			}
			if _, err := s.Store.GetWith(ctx, tx, "units", unit); err != nil {
				return errors.New("单位不存在")
			}
			h["product_id"], h["unit_id"] = product, unit
			existing, err := database.QueryRows(ctx, tx, "SELECT id FROM unit_conversions WHERE product_id=? AND unit_id=? AND deleted_at IS NULL", product, unit)
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				return errors.New("该商品已配置此单位的换算率")
			}
		} else {
			h, err = s.Store.GetWith(ctx, tx, "unit_conversions", id)
			if err != nil {
				return err
			}
			if value(h, "product_id") != product {
				return database.ErrNotFound
			}
		}
		if raw, ok := input["rate"]; ok || creating {
			rate, err := Number(raw)
			if err != nil || !rate.IsPositive() {
				return errors.New("换算率必须大于 0")
			}
			h["rate"] = rate.String()
		}
		if creating && value(input, "unit_name") != "" {
			h["unit_name"] = input["unit_name"]
		}
		if remark, ok := input["remark"]; ok {
			h["remark"] = remark
		}
		id = value(h, "id")
		if creating {
			return s.Store.InsertWith(ctx, tx, "unit_conversions", h)
		}
		delete(h, "id")
		h["updated_at"] = now()
		return s.Store.UpdateWith(ctx, tx, "unit_conversions", id, h)
	})
	if err != nil {
		return nil, err
	}
	h, err := s.Store.Get(ctx, "unit_conversions", id)
	if err != nil {
		return nil, err
	}
	return s.Store.Public("unit_conversions", h), nil
}

func (s *Service) DeleteUnitConversion(ctx context.Context, product, id string) error {
	_, err := s.Store.DB.ExecContext(ctx, "UPDATE unit_conversions SET deleted_at=?,updated_at=? WHERE id=? AND product_id=? AND deleted_at IS NULL", now(), now(), id, product)
	return err
}
