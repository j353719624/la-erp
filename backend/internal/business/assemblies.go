package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) AssemblyAction(ctx context.Context, id, action string) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "assembly_orders", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("装配单不存在")
		}
		if err != nil {
			return err
		}
		status := value(row, "status")
		changes := map[string]any{"updated_at": now()}
		switch action {
		case "confirm":
			if status != "draft" {
				return errors.New("只有草稿装配单才能确认")
			}
			changes["status"], changes["confirmed_at"] = "confirmed", now()
		case "cancel":
			if status != "draft" && status != "confirmed" {
				return errors.New("当前状态不能取消")
			}
			changes["status"] = "cancelled"
		default:
			return ErrUnsupported
		}
		if err := s.Store.UpdateWith(ctx, tx, "assembly_orders", id, changes); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "assembly_orders", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("assembly_orders", result), nil
}

func (s *Service) AssemblyBOMComponents(ctx context.Context, productID string) ([]map[string]any, error) {
	if productID == "" {
		return nil, errors.New("产品不能为空")
	}
	rows, err := s.Store.Rows(ctx, "SELECT bi.* FROM bom_items bi JOIN bo_ms b ON b.id=bi.bom_id WHERE b.product_id=? AND b.status='active' AND b.deleted_at IS NULL AND bi.deleted_at IS NULL ORDER BY bi.line_no", productID)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, s.Store.Public("bom_items", row))
	}
	return items, nil
}
