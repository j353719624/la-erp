package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) DeleteProductionMaster(ctx context.Context, table, id string) error {
	if table != "routings" && table != "work_centers" {
		return ErrUnsupported
	}
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, table, id); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				if table == "routings" {
					return errors.New("工艺路线不存在")
				}
				return errors.New("工作中心不存在")
			}
			return err
		}
		stamp := now()
		if err := s.Store.UpdateWith(ctx, tx, table, id, map[string]any{"deleted_at": stamp, "updated_at": stamp}); err != nil {
			return err
		}
		if table == "routings" {
			_, err := tx.ExecContext(ctx, "UPDATE routing_steps SET deleted_at=?,updated_at=? WHERE routing_id=? AND deleted_at IS NULL", stamp, stamp, id)
			return err
		}
		return nil
	})
}
