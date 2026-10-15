package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp/backend/internal/database"
)

func productionLabel(d ProductionDocument) string {
	switch d.Kind {
	case "picking":
		return "领料单"
	case "return":
		return "退料单"
	default:
		return "入库单"
	}
}
func (s *Service) DeleteProductionDocument(ctx context.Context, d ProductionDocument, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的" + productionLabel(d) + "才能删除")
		}
		date := now()
		if _, err := tx.ExecContext(ctx, "UPDATE "+database.Quote(d.Lines)+" SET deleted_at=?,updated_at=? WHERE "+database.Quote(d.FK)+"=? AND deleted_at IS NULL", date, date, id); err != nil {
			return err
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"deleted_at": date, "updated_at": date})
	})
}
func (s *Service) CancelProductionReturn(ctx context.Context, d ProductionDocument, id string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的退料单才能取消")
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"status": "cancelled", "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.GetProductionDocument(ctx, d, id)
}
func (s *Service) DeleteWorkOrder(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "work_orders", id)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				return errors.New("工单不存在")
			}
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的工单才能删除")
		}
		date := now()
		if _, err := tx.ExecContext(ctx, "UPDATE work_order_materials SET deleted_at=?,updated_at=? WHERE work_order_id=? AND deleted_at IS NULL", date, date, id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE work_order_processes SET deleted_at=?,updated_at=? WHERE work_order_id=? AND deleted_at IS NULL", date, date, id); err != nil {
			return err
		}
		return s.Store.UpdateWith(ctx, tx, "work_orders", id, map[string]any{"deleted_at": date, "updated_at": date})
	})
}
