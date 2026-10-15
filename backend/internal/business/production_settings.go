package business

import (
	"context"
	"database/sql"
	"encoding/json"
	"la-erp/backend/internal/database"
)

var defaultProductionSettings = map[string]any{"allow_over_issue": false, "allow_no_workorder_pick": false, "allow_return_after_complete": false}

func (s *Service) ProductionSettings(ctx context.Context) (map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT value FROM system_settings WHERE key=?", "production_settings")
	if err != nil || len(rows) == 0 {
		return cloneSettings(), err
	}
	result := cloneSettings()
	var saved map[string]any
	if err := json.Unmarshal([]byte(value(rows[0], "value")), &saved); err != nil {
		return nil, err
	}
	for key, v := range saved {
		if _, ok := result[key]; ok {
			result[key] = v
		}
	}
	return result, nil
}

func cloneSettings() map[string]any {
	result := map[string]any{}
	for key, value := range defaultProductionSettings {
		result[key] = value
	}
	return result
}

func (s *Service) SaveProductionSettings(ctx context.Context, input map[string]any) (map[string]any, error) {
	settings := cloneSettings()
	for key := range settings {
		if input[key] != nil {
			if b, ok := input[key].(bool); ok {
				settings[key] = b
			}
		}
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return nil, err
	}
	err = s.transaction(ctx, func(tx *sql.Tx) error {
		rows, err := database.QueryRows(ctx, tx, "SELECT * FROM system_settings WHERE key=?", "production_settings")
		if err != nil {
			return err
		}
		if len(rows) > 0 {
			return s.Store.UpdateWith(ctx, tx, "system_settings", value(rows[0], "id"), map[string]any{"value": string(raw), "updated_at": now()})
		}
		row := s.base("system_settings")
		row["key"], row["value"] = "production_settings", string(raw)
		return s.Store.InsertWith(ctx, tx, "system_settings", row)
	})
	if err != nil {
		return nil, err
	}
	return s.ProductionSettings(ctx)
}
