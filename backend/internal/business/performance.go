package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) FinalizePerformance(ctx context.Context, id string) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "perf_assessments", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("绩效考核不存在")
		}
		if err != nil {
			return err
		}
		if value(row, "status") != "draft" {
			return errors.New("只有草稿考核才能定案")
		}
		if err := s.Store.UpdateWith(ctx, tx, "perf_assessments", id, map[string]any{"status": "finalized", "updated_at": now()}); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "perf_assessments", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("perf_assessments", result), nil
}
