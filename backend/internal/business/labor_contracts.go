package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp/backend/internal/database"
)

func (s *Service) TerminateLaborContract(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "labor_contracts", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("劳动合同不存在")
		}
		if err != nil {
			return err
		}
		if value(row, "status") == "terminated" {
			return errors.New("劳动合同已终止")
		}
		changes := map[string]any{"status": "terminated", "terminated_date": now(), "updated_at": now()}
		if input["date"] != nil {
			changes["terminated_date"] = input["date"]
		}
		if input["reason"] != nil {
			changes["terminate_reason"] = input["reason"]
		}
		if err := s.Store.UpdateWith(ctx, tx, "labor_contracts", id, changes); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "labor_contracts", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("labor_contracts", result), nil
}
