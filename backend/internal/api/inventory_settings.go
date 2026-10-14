package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"la-erp-recovered/backend/internal/database"
	"net/http"
)

func validateSettings(settings map[string]any) error {
	for key, raw := range settings {
		v, ok := raw.(map[string]any)
		if !ok {
			return errors.New("设置格式错误")
		}
		allowed := map[string]bool{}
		switch key {
		case "company":
			for _, k := range []string{"name", "tax_no", "address", "phone", "currency", "logo"} {
				allowed[k] = true
			}
			for _, x := range v {
				if _, ok := x.(string); !ok {
					return errors.New("公司字段必须为字符串")
				}
			}
		case "inventory":
			allowed["batch_strategy"] = true
			if text(v, "batch_strategy") != "fifo" && text(v, "batch_strategy") != "fefo" {
				// 批次 CC 取证（2026-10-14，evidence/backend-runtime/audit-batch-cc-20261014.json）：
				// 原版 PUT /settings {"settings":{"inventory":{"batch_strategy":"lifo"}}}
				// → 10000，原文逐字为
				//   「批次分配策略仅支持 fifo（先进先出）或 fefo（先到期先出）」
				// 原恢复端返回自造文案「库存策略无效」，已按原文案逐字对齐。
				return errors.New("批次分配策略仅支持 fifo（先进先出）或 fefo（先到期先出）")
			}
		case "personal_mode":
			allowed["enabled"] = true
			if _, ok := v["enabled"].(bool); !ok {
				return errors.New("个人模式必须为布尔值")
			}
		case "data_isolation":
			allowed["mode"] = true
			if text(v, "mode") != "off" && text(v, "mode") != "sales" && text(v, "mode") != "full" {
				return errors.New("隔离模式无效")
			}
		default:
			return errors.New("未知设置分支")
		}
		for k := range v {
			if !allowed[k] {
				return errors.New("未知设置字段")
			}
		}
	}
	return nil
}
func (s *Server) saveSettings(r *http.Request, settings map[string]any) error {
	tx, err := s.Store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for key, v := range settings {
		merged := map[string]any{}
		var id, old string
		err = tx.QueryRowContext(r.Context(), "SELECT id,value FROM system_settings WHERE key=?", key).Scan(&id, &old)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if err == nil {
			if err = json.Unmarshal([]byte(old), &merged); err != nil {
				return err
			}
		}
		for k, x := range v.(map[string]any) {
			merged[k] = x
		}
		raw, err := json.Marshal(merged)
		if err != nil {
			return err
		}
		if id == "" {
			err = s.Store.InsertWith(r.Context(), tx, "system_settings", map[string]any{"id": uuid.NewString(), "key": key, "value": string(raw), "created_at": database.Now(), "updated_at": database.Now()})
		} else {
			err = s.Store.UpdateWith(r.Context(), tx, "system_settings", id, map[string]any{"value": string(raw), "updated_at": database.Now()})
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Server) registerInventorySettings() {
	s.mux.Handle("GET /api/v1/settings/company", s.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT key,value FROM system_settings WHERE key IN ('company','personal_mode')")
		if err != nil {
			s.failure(w, err, "设置")
			return
		}
		result := map[string]any{"company": map[string]any{}, "personal_mode": false}
		for _, row := range rows {
			var v map[string]any
			if err = json.Unmarshal([]byte(text(row, "value")), &v); err != nil {
				s.failure(w, err, "设置")
				return
			}
			if text(row, "key") == "company" {
				result["company"] = v
			} else {
				result["personal_mode"] = v["enabled"]
			}
		}
		respond(w, 200, result)
	})))
	s.mux.Handle("GET /api/v1/settings", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT key,value FROM system_settings")
		if err != nil {
			s.failure(w, err, "设置")
			return
		}
		result := map[string]any{"company": map[string]any{}, "personal_mode": map[string]any{"enabled": false}, "data_isolation": map[string]any{"mode": "off"}, "inventory": map[string]any{"batch_strategy": "fifo"}}
		for _, row := range rows {
			var v any
			if json.Unmarshal([]byte(text(row, "value")), &v) == nil {
				result[text(row, "key")] = v
			}
		}
		respond(w, 200, result)
	})))
	s.mux.Handle("PUT /api/v1/settings", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		settings, ok := body["settings"].(map[string]any)
		if !ok {
			fail(w, 400, "设置不能为空")
			return
		}
		if err = validateSettings(settings); err != nil {
			fail(w, 400, err.Error())
			return
		}
		if err = s.saveSettings(r, settings); err != nil {
			s.failure(w, err, "设置")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("GET /api/v1/data-isolation", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT value FROM system_settings WHERE key='data_isolation'")
		if err != nil {
			s.failure(w, err, "设置")
			return
		}
		v := map[string]any{"mode": "off"}
		if len(rows) > 0 {
			if err = json.Unmarshal([]byte(text(rows[0], "value")), &v); err != nil {
				s.failure(w, err, "设置")
				return
			}
		}
		respond(w, 200, v)
	})))
	s.mux.Handle("PUT /api/v1/data-isolation", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		settings := map[string]any{"data_isolation": body}
		if err = validateSettings(settings); err != nil {
			fail(w, 400, err.Error())
			return
		}
		if err = s.saveSettings(r, settings); err != nil {
			s.failure(w, err, "设置")
			return
		}
		respond(w, 200, body)
	})))
}
