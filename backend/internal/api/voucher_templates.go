package api

import (
	"encoding/json"
	"net/http"
)

// voucherTemplateDefaults 各业务来源的官方默认分录（既有实现 2026-10-14 抓包
// 运行快照 —— GET /api/v1/voucher-templates 逐字录制）。
// 「恢复默认」即把该 source_type 的 entries 重置为此处内容。
var voucherTemplateDefaults = map[string][]map[string]any{
	"ar_invoice": {
		{"account_code": "1122", "account_name": "应收账款", "amount_expr": "{{line.amount}}", "direction": "debit"},
		{"account_code": "6001", "account_name": "主营业务收入", "amount_expr": "{{line.amount}}", "direction": "credit"},
	},
	"purchase_inbound": {
		{"account_code": "1403", "account_name": "原材料", "amount_expr": "{{line.amount - line.tax_amount}}", "direction": "debit"},
		{"account_code": "2221.01.01", "account_name": "应交税费-进项税", "amount_expr": "{{line.tax_amount}}", "direction": "debit"},
		{"account_code": "2202", "account_name": "应付账款", "amount_expr": "{{line.amount}}", "direction": "credit"},
	},
	"purchase_return": {
		{"account_code": "2202", "account_name": "应付账款", "amount_expr": "{{line.amount}}", "direction": "debit"},
		{"account_code": "1403", "account_name": "原材料", "amount_expr": "{{line.amount - line.tax_amount}}", "direction": "credit"},
		{"account_code": "2221.01.01", "account_name": "应交税费-进项税", "amount_expr": "{{line.tax_amount}}", "direction": "credit"},
	},
	"sales_outbound": {
		{"account_code": "6401", "account_name": "主营业务成本", "amount_expr": "{{line.cost}}", "direction": "debit"},
		{"account_code": "1405", "account_name": "库存商品", "amount_expr": "{{line.cost}}", "direction": "credit"},
	},
	"sales_return": {
		{"account_code": "6001", "account_name": "主营业务收入", "amount_expr": "{{line.amount - line.tax_amount}}", "direction": "debit"},
		{"account_code": "2221.01.02", "account_name": "应交税费-销项税", "amount_expr": "{{line.tax_amount}}", "direction": "debit"},
		{"account_code": "1122", "account_name": "应收账款", "amount_expr": "{{line.amount}}", "direction": "credit"},
		{"account_code": "1405", "account_name": "库存商品", "amount_expr": "{{line.cost}}", "direction": "debit"},
		{"account_code": "6401", "account_name": "主营业务成本", "amount_expr": "{{line.cost}}", "direction": "credit"},
	},
}

func (s *Server) registerVoucherTemplates() {
	s.mux.Handle("GET /api/v1/voucher-templates", s.protected("voucher_template", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM voucher_templates ORDER BY code")
		if err != nil {
			s.failure(w, err, "凭证模板")
			return
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			items = append(items, s.voucherTemplateView(row))
		}
		respond(w, 200, items)
	})))
	// 编辑：只放开 name / is_active / entries / remark（code 与 source_type 是模板标识，不可改）。
	s.mux.Handle("PUT /api/v1/voucher-templates/{id}", s.protected("voucher_template_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "voucher_templates", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "凭证模板")
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		changes := map[string]any{}
		for _, key := range []string{"name", "remark", "is_active"} {
			if value, ok := body[key]; ok && value != nil {
				changes[key] = value
			}
		}
		if value, ok := body["entries"]; ok {
			encoded, err := json.Marshal(value)
			if err != nil {
				fail(w, 400, "分录格式错误")
				return
			}
			changes["entries"] = string(encoded)
		}
		if len(changes) == 0 {
			fail(w, 400, "没有可更新的字段")
			return
		}
		if err = s.Store.Update(r.Context(), "voucher_templates", text(row, "id"), changes); err != nil {
			s.failure(w, err, "凭证模板")
			return
		}
		saved, err := s.Store.Get(r.Context(), "voucher_templates", text(row, "id"))
		if err != nil {
			s.failure(w, err, "凭证模板")
			return
		}
		respond(w, 200, s.voucherTemplateView(saved))
	})))
	s.mux.Handle("POST /api/v1/voucher-templates/{id}/reset", s.protected("voucher_template_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "voucher_templates", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "凭证模板")
			return
		}
		entries, ok := voucherTemplateDefaults[text(row, "source_type")]
		if !ok {
			fail(w, 400, "该凭证模板没有可恢复的默认分录")
			return
		}
		encoded, err := json.Marshal(entries)
		if err != nil {
			s.failure(w, err, "凭证模板")
			return
		}
		if err = s.Store.Update(r.Context(), "voucher_templates", text(row, "id"), map[string]any{"entries": string(encoded)}); err != nil {
			s.failure(w, err, "凭证模板")
			return
		}
		row["entries"] = string(encoded)
		respond(w, 200, s.voucherTemplateView(row))
	})))
}

// voucherTemplateView 凭证模板公开展望：按回归回放形状裁剪
// （不含 account_templates 外键列，也不额外挂 edges）。
func (s *Server) voucherTemplateView(row map[string]any) map[string]any {
	view := map[string]any{
		"id":          text(row, "id"),
		"code":        text(row, "code"),
		"name":        text(row, "name"),
		"source_type": text(row, "source_type"),
		"is_active":   row["is_active"] == true || row["is_active"] == int64(1) || row["is_active"] == "1",
		"tenant_id":   text(row, "tenant_id"),
	}
	if raw, ok := row["entries"]; ok && raw != nil {
		var entries any
		if json.Unmarshal([]byte(jsonString(raw)), &entries) == nil && entries != nil {
			view["entries"] = entries
		}
	}
	if v := text(row, "remark"); v != "" {
		view["remark"] = v
	}
	return view
}

// jsonString 把任意列值还原为 JSON 文本（json 列可能以 string/[]byte 形式返回）。
func jsonString(v any) string {
	switch value := v.(type) {
	case string:
		return value
	case []byte:
		return string(value)
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}
