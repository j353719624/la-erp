package business

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"la-erp/backend/internal/database"
	"sort"
)

//go:embed account_mapping_defs.json
var accountMappingDefinitions []byte

type AccountMappingDefinition struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Usage       string `json:"usage"`
	DefaultCode string `json:"default_code"`
	DefaultName string `json:"default_name"`
}

func mappingDefinitions() ([]AccountMappingDefinition, error) {
	var defs []AccountMappingDefinition
	err := json.Unmarshal(accountMappingDefinitions, &defs)
	return defs, err
}
func (s *Service) AccountMappings(ctx context.Context) (map[string]any, error) {
	defs, err := mappingDefinitions()
	if err != nil {
		return nil, err
	}
	rows, err := s.Store.Rows(ctx, "SELECT value FROM system_settings WHERE key=?", "account_mapping")
	if err != nil {
		return nil, err
	}
	overrides := map[string]string{}
	if len(rows) > 0 {
		raw := rows[0]["value"]
		var data []byte
		switch v := raw.(type) {
		case []byte:
			data = v
		case string:
			data = []byte(v)
		default:
			return nil, errors.New("科目映射配置格式错误")
		}
		if err = json.Unmarshal(data, &overrides); err != nil {
			return nil, err
		}
	}
	accounts, err := s.Store.Rows(ctx, "SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY code")
	if err != nil {
		return nil, err
	}
	byID, byCode := map[string]map[string]any{}, map[string]map[string]any{}
	for _, account := range accounts {
		byID[value(account, "id")] = account
		byCode[value(account, "code")] = account
	}
	items := map[string]any{}
	for _, def := range defs {
		item := map[string]any{"account_code": def.DefaultCode, "account_name": def.DefaultName, "is_default": true, "missing": false}
		if account := byCode[def.DefaultCode]; account != nil {
			item["account_name"] = value(account, "name")
		}
		if id := overrides[def.Key]; id != "" {
			if account := byID[id]; account != nil {
				item["account_id"] = id
				item["account_code"] = value(account, "code")
				item["account_name"] = value(account, "name")
				item["is_default"] = false
			} else {
				item["missing"] = true
			}
		}
		items[def.Key] = item
	}
	return map[string]any{"defs": defs, "items": items}, nil
}
func (s *Service) SaveAccountMappings(ctx context.Context, items map[string]string) (map[string]any, error) {
	defs, err := mappingDefinitions()
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, def := range defs {
		known[def.Key] = true
	}
	err = s.transaction(ctx, func(tx *sql.Tx) error {
		saved := map[string]string{}
		keys := []string{}
		for key := range items {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if !known[key] {
				return fmt.Errorf("未知的科目映射项：%s", key)
			}
			id := items[key]
			if id == "" {
				continue
			}
			if _, err := s.Store.GetWith(ctx, tx, "accounts", id); err != nil {
				if errors.Is(err, database.ErrNotFound) {
					return errors.New("选择的科目不存在或已删除，请重新选择")
				}
				return err
			}
			saved[key] = id
		}
		data, err := json.Marshal(saved)
		if err != nil {
			return err
		}
		rows, err := database.QueryRows(ctx, tx, "SELECT * FROM system_settings WHERE key=?", "account_mapping")
		if err != nil {
			return err
		}
		if len(rows) > 0 {
			return s.Store.UpdateWith(ctx, tx, "system_settings", value(rows[0], "id"), map[string]any{"value": string(data), "updated_at": now()})
		}
		row := s.base("system_settings")
		row["key"] = "account_mapping"
		row["value"] = string(data)
		return s.Store.InsertWith(ctx, tx, "system_settings", row)
	})
	if err != nil {
		return nil, err
	}
	return s.AccountMappings(ctx)
}
