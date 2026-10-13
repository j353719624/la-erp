package business

import (
	"context"
	"database/sql"
	"encoding/json"
)

func (s *Service) personalMode(ctx context.Context, tx *sql.Tx) (bool, error) {
	var raw string
	err := tx.QueryRowContext(ctx, "SELECT value FROM system_settings WHERE key='personal_mode'").Scan(&raw)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var v struct {
		Enabled bool `json:"enabled"`
	}
	err = json.Unmarshal([]byte(raw), &v)
	return v.Enabled, err
}
