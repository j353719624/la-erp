package api

import (
	"encoding/csv"
	"fmt"
	"net/http"
)

func (s *Server) registerReports() {
	s.mux.Handle("POST /api/v1/custom-reports", s.protected("custom_report_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r); if err != nil { fail(w, 400, err.Error()); return }
		row, err := s.business().CreateCustomReport(r.Context(), input); if err != nil { businessFailure(w, err, false); return }; respond(w, 200, row)
	})))
	s.mux.Handle("PUT /api/v1/custom-reports/{id}", s.protected("custom_report_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r); if err != nil { fail(w, 400, err.Error()); return }
		if err = s.business().UpdateCustomReport(r.Context(), r.PathValue("id"), input); err != nil { businessFailure(w, err, false); return }; respond(w, 200, nil)
	})))
	s.mux.Handle("DELETE /api/v1/custom-reports/{id}", s.protected("custom_report_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.business().DeleteCustomReport(r.Context(), r.PathValue("id")); err != nil { businessFailure(w, err, false); return }; respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/custom-reports/{id}/run", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().RunCustomReport(r.Context(), r.PathValue("id"))
		if err != nil { businessFailure(w, err, false); return }
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/custom-reports/{id}/export", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().RunCustomReport(r.Context(), r.PathValue("id"))
		if err != nil { businessFailure(w, err, false); return }
		rows, _ := data["rows"].([]map[string]any)
		columns, _ := data["columns"].([]any)
		if columns == nil {
			if typed, ok := data["columns"].([]map[string]any); ok { columns = make([]any, len(typed)); for i := range typed { columns[i] = typed[i] } }
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		filename := r.PathValue("id")
		if report, ok := data["report"].(map[string]any); ok && fmt.Sprint(report["report_code"]) != "" { filename = fmt.Sprint(report["report_code"]) }
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename+".csv"))
		writer := csv.NewWriter(w)
		if len(rows) == 0 { writer.Flush(); return }
		headers := make([]string, 0, len(rows[0]))
		keys := make([]string, 0, len(rows[0]))
		for _, col := range columns {
			if c, ok := col.(map[string]any); ok {
				key, _ := c["key"].(string); label, _ := c["label"].(string)
				if key != "" { keys = append(keys, key); if label == "" { label = key }; headers = append(headers, label) }
			}
		}
		if len(keys) == 0 { for k := range rows[0] { keys = append(keys, k); headers = append(headers, k) } }
		if writer.Write(headers) != nil { return }
		for _, row := range rows {
			values := make([]string, len(keys))
			for i, key := range keys { values[i] = fmt.Sprint(row[key]) }
			if writer.Write(values) != nil { return }
		}
		writer.Flush()
	})))
	s.mux.Handle("POST /api/v1/custom-reports/run-sql", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil { fail(w, 400, err.Error()); return }
		query, _ := input["query_sql"].(string)
		if query == "" { fail(w, 400, "缺少 query_sql 参数"); return }
		data, err := s.business().RunCustomSQL(r.Context(), query, input["columns"])
		if err != nil { businessFailure(w, err, false); return }
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/reports/dashboard", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().Dashboard(r.Context())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/reports/export", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		typeName := r.URL.Query().Get("type")
		var data any
		var err error
		switch typeName {
		case "sales-forecast":
			data, err = s.business().SalesForecast(r.Context(), r.URL.Query())
		case "fulfillment":
			data, err = s.business().FulfillmentReport(r.Context(), r.URL.Query())
		case "fulfillment-summary":
			data, err = s.business().FulfillmentSummary(r.Context())
		default:
			fail(w, 501, "该报表导出类型尚未恢复")
			return
		}
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		rows, ok := data.([]map[string]any)
		if !ok {
			fail(w, 500, "报表数据格式错误")
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q.csv", typeName))
		writer := csv.NewWriter(w)
		if len(rows) == 0 {
			writer.Flush()
			return
		}
		headers := make([]string, 0, len(rows[0]))
		for k := range rows[0] {
			headers = append(headers, k)
		}
		if err := writer.Write(headers); err != nil {
			return
		}
		for _, row := range rows {
			values := make([]string, len(headers))
			for i, key := range headers {
				values[i] = fmt.Sprint(row[key])
			}
			if writer.Write(values) != nil {
				return
			}
		}
		writer.Flush()
	})))
	s.mux.Handle("GET /api/v1/reports/sales/forecast", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().SalesForecast(r.Context(), r.URL.Query())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/reports/trade/fulfillment", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().FulfillmentReport(r.Context(), r.URL.Query())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/reports/trade/fulfillment-summary", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().FulfillmentSummary(r.Context())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/reports/inventory/reorder-suggestions", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().ReorderSuggestions(r.Context())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	for _, party := range []string{"customer", "supplier"} {
		s.mux.Handle("GET /api/v1/reports/finance/statement/"+party, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().Statement(r.Context(), r.URL.Query(), party)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
	s.mux.Handle("GET /api/v1/reports/finance/aging", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		kind := r.URL.Query().Get("type")
		if kind != "ap" {
			kind = "ar"
		}
		data, err := s.business().Aging(r.Context(), r.URL.Query(), kind)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/reports/finance/cash-flow", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().CashFlow(r.Context(), r.URL.Query())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/reports/finance/general-ledger", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("account_code") == "" {
			fail(w, 400, "缺少 account_code 参数")
			return
		}
		data, err := s.business().GeneralLedger(r.Context(), r.URL.Query())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	for _, mode := range []string{"trial-balance", "profit-loss", "balance-sheet"} {
		s.mux.Handle("GET /api/v1/reports/finance/"+mode, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().FinanceReport(r.Context(), r.URL.Query(), mode)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
	for family, modes := range map[string][]string{"sales": {"by-product", "by-customer", "trend", "profit", "profit-summary"}, "purchase": {"by-product", "by-supplier", "trend", "price-trend"}} {
		for _, mode := range modes {
			s.mux.Handle("GET /api/v1/reports/"+family+"/"+mode, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data, err := s.business().TradeReport(r.Context(), r.URL.Query(), family, mode)
				if err != nil {
					businessFailure(w, err, false)
					return
				}
				respond(w, 200, data)
			})))
		}
	}
	for _, mode := range []string{"balance", "abc", "turnover", "dormant", "expiry-alert", "age"} {
		s.mux.Handle("GET /api/v1/reports/inventory/"+mode, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().InventoryReport(r.Context(), r.URL.Query(), mode)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}
