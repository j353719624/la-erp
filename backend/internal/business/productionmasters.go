package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) DeleteProductionMaster(ctx context.Context, table, id string) error {
	// 批次 X（2026-10-14）：table 由**路由层硬编码**（internal/api/production.go:101-104
	// `table := "routings"; if route == "work-centers" { table = "work_centers" }`），
	// route 又只来自 []string{"work-centers","routings"} → 不存在其它取值，
	// 本守卫**永不可达**，属防御性断言。保留 ErrUnsupported 作兜底，不自造文案。
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
