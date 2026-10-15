package api

import (
	"encoding/json"
	"la-erp/backend/internal/database"
	"net/http"
	"net/url"
)

func scopedMaster(table string) bool {
	// The original role seed marks sales_staff as self-scoped and the UI
	// exposes sales-order list/create/edit permissions. Apply the same
	// created_by/department filter to sales orders, in addition to the
	// master-data lists already covered here.
	return table == "products" || table == "customers" || table == "suppliers" || table == "sales_orders" || table == "purchase_orders" || table == "stock_ins" || table == "stock_outs"
}
func (s *Server) scopedQuery(r *http.Request, res Resource) (url.Values, error) {
	q := r.URL.Query()
	if !scopedMaster(res.Table) {
		return q, nil
	}
	claims := current(r)
	scope, department, err := s.documentScope(r, res.Table)
	if err != nil {
		return nil, err
	}
	if scope == "self" {
		q.Set("created_by", claims.UserID)
	}
	if scope == "dept" {
		if department == "" {
			department = database.ZeroUUID
		}
		q.Set("department_id", department)
	}
	return q, nil
}
func (s *Server) checkScope(r *http.Request, res Resource, row map[string]any) error {
	if !scopedMaster(res.Table) {
		return nil
	}
	claims := current(r)
	scope, department, err := s.documentScope(r, res.Table)
	if err != nil {
		return err
	}
	if scope == "self" && row["created_by"] != claims.UserID {
		return database.ErrNotFound
	}
	if scope == "dept" && (department == "" || row["department_id"] != department) {
		return database.ErrNotFound
	}
	return nil
}

func (s *Server) documentScope(r *http.Request, table string) (string, string, error) {
	scope, dept, err := s.Auth.Scope(r.Context(), current(r).UserID)
	if err != nil || scope != "dept" {
		return scope, dept, err
	}
	rows, err := s.Store.Rows(r.Context(), "SELECT value FROM system_settings WHERE key='data_isolation'")
	if err != nil {
		return "", "", err
	}
	mode := "off"
	if len(rows) > 0 {
		var v map[string]any
		if err = json.Unmarshal([]byte(text(rows[0], "value")), &v); err != nil {
			return "", "", err
		}
		mode = text(v, "mode")
	}
	if mode == "off" || (mode == "sales" && table != "customers" && table != "suppliers" && table != "sales_orders") {
		return "all", "", nil
	}
	return scope, dept, nil
}
