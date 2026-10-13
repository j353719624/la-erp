package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) CompleteEquipmentMaintenance(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "equipment_maintenances", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("设备维护记录不存在")
		}
		if err != nil {
			return err
		}
		if value(row, "status") == "done" {
			return errors.New("设备维护记录已完成")
		}
		stamp := now()
		changes := map[string]any{"status": "done", "done_date": stamp, "updated_at": stamp}
		for _, key := range []string{"result", "cost", "executor", "next_date", "remark"} {
			if input[key] != nil {
				changes[key] = input[key]
			}
		}
		if err := s.Store.UpdateWith(ctx, tx, "equipment_maintenances", id, changes); err != nil {
			return err
		}
		if equipmentID := value(row, "equipment_id"); equipmentID != "" {
			if err := s.Store.UpdateWith(ctx, tx, "production_equipments", equipmentID, map[string]any{"status": "idle", "updated_at": stamp}); err != nil && !errors.Is(err, database.ErrNotFound) {
				return err
			}
		}
		result, err = s.Store.GetWith(ctx, tx, "equipment_maintenances", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("equipment_maintenances", result), nil
}
