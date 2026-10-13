package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"la-erp-recovered/backend/internal/database"
	"time"
)

func stateError(d Document, action string) error {
	name := "采购订单"
	if d.Party == "customer" {
		name = "销售订单"
	}
	if d.Stock {
		name = "出库单"
		if d.Incoming {
			name = "入库单"
		}
		if action == "修改" {
			return fmt.Errorf("%s不存在或状态不允许修改", name)
		}
	}
	return fmt.Errorf("只有草稿状态的%s才能%s", name, action)
}
func (s *Service) Update(ctx context.Context, d Document, id string, input map[string]any, user string) (map[string]any, error) {
	if !d.Stock || input["lines"] != nil {
		return s.writeDocument(ctx, d, input, user, id)
	}
	if err := rejectAdvanced(input); err != nil {
		return nil, err
	}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return stateError(d, "修改")
		}
		changes := map[string]any{"updated_at": now()}
		for _, key := range []string{"remark", "type", "warehouse_id", d.Date} {
			if val, ok := input[key]; ok {
				if key == "warehouse_id" {
					if _, err := s.Store.GetWith(ctx, tx, "warehouses", fmt.Sprint(val)); err != nil {
						return errors.New("仓库不存在")
					}
				}
				if key == "type" && fmt.Sprint(val) != value(h, "type") {
					return ErrUnsupported
				}
				if key == d.Date && val != nil {
					if _, err := time.Parse(time.RFC3339Nano, fmt.Sprint(val)); err != nil {
						return errors.New("日期格式错误")
					}
				}
				changes[key] = val
			}
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, changes)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, d, id)
}
func (s *Service) Delete(ctx context.Context, d Document, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return stateError(d, "删除")
		}
		// A draft has no posted inventory effects. Keep it and its detail rows for
		// soft-delete history; confirmed documents can never enter this path.
		stamp := now()
		if _, err := tx.ExecContext(ctx, "UPDATE "+database.Quote(d.Lines)+" SET deleted_at=?,updated_at=? WHERE "+database.Quote(d.ForeignKey)+"=?", stamp, stamp, id); err != nil {
			return err
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"deleted_at": stamp, "updated_at": stamp})
	})
}
