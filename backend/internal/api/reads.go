package api

import (
	_ "embed"
	"encoding/json"
	"la-erp-recovered/backend/internal/database"
	"net/http"
	"strings"
)

//go:embed read_resources.json
var recoveredReadResources []byte

type readResource struct {
	Route      string `json:"route"`
	Table      string `json:"table"`
	Permission string `json:"permission"`
}

func (s *Server) registerRecoveredReads() {
	for _, table := range []string{"ar_invoices", "ap_invoices"} {
		route := strings.ReplaceAll(table, "_", "-")
		s.mux.Handle("GET /api/v1/"+route, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			where := []string{"deleted_at IS NULL"}
			args := []any{}
			for _, field := range []string{"customer_id", "supplier_id", "status", "source_id", "source_type"} {
				if value := r.URL.Query().Get(field); value != "" && s.Store.Has(table, field) {
					where = append(where, database.Quote(field)+"=?")
					args = append(args, value)
				}
			}
			rows, err := s.Store.Rows(r.Context(), "SELECT * FROM "+database.Quote(table)+" WHERE "+strings.Join(where, " AND ")+" ORDER BY created_at DESC", args...)
			if err != nil {
				s.failure(w, err, table)
				return
			}
			items := []map[string]any{}
			for _, row := range rows {
				items = append(items, s.Store.Public(table, row))
			}
			respond(w, 200, items)
		})))
	}
	var resources []readResource
	if err := json.Unmarshal(recoveredReadResources, &resources); err != nil {
		panic(err)
	}
	for _, item := range resources {
		if item.Route == "notifications" {
			continue
		}
		if _, registered := Resources[item.Route]; registered {
			continue
		}
		res := Resource{Table: item.Table, Permission: item.Permission, Label: item.Table}
		if item.Route != "bank/statements" && item.Route != "serial-numbers" {
			s.mux.Handle("GET /api/v1/"+item.Route, s.protected(res.Permission, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.list(w, r, res) })))
		}
		if s.Store.Has(res.Table, "id") && item.Route != "mrp/requirements" && item.Route != "purchase-suggestions" && item.Route != "serial-numbers" && item.Route != "mps-plans" {
			s.mux.Handle("GET /api/v1/"+item.Route+"/{id}", s.protected(res.Permission, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.get(w, r, res) })))
		}
	}
}
