package database

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"sort"
	"strings"
)

//go:embed seed-data.json
var originalSeed []byte

// Seed initializes only an empty user database. All IDs, configuration and
// permission records originate from an isolated original fresh installation.
// Original password hashes were removed; a new bcrypt hash is generated here.
func (s *Store) Seed(ctx context.Context, adminPassword string) error {
	var count int
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM sys_users").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if len(adminPassword) < 6 {
		return errors.New("初始管理员密码至少 6 个字符")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(originalSeed))
	decoder.UseNumber()
	var seed map[string][]map[string]any
	if err = decoder.Decode(&seed); err != nil {
		return err
	}
	// Original tables have circular relationships, so defer FK checks until after
	// the complete captured seed has been restored in one transaction.
	if _, err = s.DB.ExecContext(ctx, "PRAGMA foreign_keys=OFF"); err != nil {
		return err
	}
	defer s.DB.Exec("PRAGMA foreign_keys=ON")
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tables := []string{}
	for table := range seed {
		tables = append(tables, table)
	}
	sort.Strings(tables)
	for _, table := range tables {
		if _, ok := s.Tables[table]; !ok {
			return errors.New("seed references unknown table")
		}
		for _, record := range seed[table] {
			if table == "sys_users" {
				record["password_hash"] = string(hash)
			}
			keys := []string{}
			for key := range record {
				if !s.Has(table, key) {
					return errors.New("seed references unknown column")
				}
				keys = append(keys, key)
			}
			sort.Strings(keys)
			columns := []string{}
			marks := []string{}
			values := []any{}
			for _, key := range keys {
				columns = append(columns, Quote(key))
				marks = append(marks, "?")
				value := record[key]
				if blob, ok := value.(map[string]any); ok {
					if raw, ok := blob["$sqlite_blob"].(string); ok {
						value, err = hex.DecodeString(raw)
						if err != nil {
							return err
						}
					}
				}
				values = append(values, SQLValue(value))
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO "+Quote(table)+" ("+strings.Join(columns, ",")+") VALUES ("+strings.Join(marks, ",")+")", values...); err != nil {
				return err
			}
		}
	}
	rows, err := tx.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	invalid := rows.Next()
	rows.Close()
	if invalid {
		return errors.New("captured seed has a broken foreign-key relationship")
	}
	return tx.Commit()
}
