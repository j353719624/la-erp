package api

import (
	"errors"
	"la-erp-recovered/backend/internal/business"
	"la-erp-recovered/backend/internal/database"
	"net/http"
)

func (s *Server) business() *business.Service { return &business.Service{Store: s.Store} }
func businessFailure(w http.ResponseWriter, err error, stock bool) {
	if errors.Is(err, business.ErrUnsupported) {
		fail(w, 501, err.Error())
		return
	}
	if errors.Is(err, database.ErrNotFound) {
		fail(w, 404, "记录不存在")
		return
	}
	if stock {
		fail(w, 400, err.Error())
	} else {
		write(w, 200, map[string]any{"code": 10000, "message": err.Error(), "data": nil})
	}
}
func (s *Server) registerBusiness() {
	for route, d := range business.Documents {
		if !d.Stock {
			s.mux.Handle("POST /api/v1/"+route+"/{id}/approve", s.protected(documentPermission(route, "edit"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !s.checkDocumentScope(w, r, d) {
					return
				}
				data, err := s.business().Approve(r.Context(), d, r.PathValue("id"), current(r).UserID)
				if err != nil {
					businessFailure(w, err, false)
					return
				}
				respond(w, 200, data)
			})))
		}
		s.mux.Handle("PUT /api/v1/"+route+"/{id}", s.protected(documentPermission(route, "edit"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !s.checkDocumentScope(w, r, d) {
				return
			}
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			if err = s.checkDocumentReferences(r, d, input); err != nil {
				businessFailure(w, err, d.Stock)
				return
			}
			_, err = s.business().Update(r.Context(), d, r.PathValue("id"), input, current(r).UserID)
			if err != nil {
				businessFailure(w, err, d.Stock)
				return
			}
			respond(w, 200, nil)
		})))
		s.mux.Handle("DELETE /api/v1/"+route+"/{id}", s.protected(documentPermission(route, "delete"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !s.checkDocumentScope(w, r, d) {
				return
			}
			if err := s.business().Delete(r.Context(), d, r.PathValue("id")); err != nil {
				businessFailure(w, err, d.Stock)
				return
			}
			respond(w, 200, nil)
		})))
		// Original staff replay confirms create/edit and state actions use operation permissions.
		// Apply the current role scope before accessing an existing document.
		s.mux.Handle("POST /api/v1/"+route, s.protected(documentPermission(route, "create"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !s.checkDocumentScope(w, r, d) {
				return
			}
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			if err = s.checkDocumentReferences(r, d, input); err != nil {
				businessFailure(w, err, d.Stock)
				return
			}
			data, err := s.business().Create(r.Context(), d, input, current(r).UserID)
			if err != nil {
				businessFailure(w, err, d.Stock)
				return
			}
			respond(w, 200, data)
		})))
		for _, action := range []string{"confirm", "cancel"} {
			if d.Stock && action == "cancel" {
				continue
			}
			s.mux.Handle("POST /api/v1/"+route+"/{id}/"+action, s.protected(documentPermission(route, "edit"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !s.checkDocumentScope(w, r, d) {
					return
				}
				data, err := s.business().Transition(r.Context(), d, r.PathValue("id"), current(r).UserID, action == "cancel")
				if err != nil {
					businessFailure(w, err, d.Stock)
					return
				}
				respond(w, 200, data)
			})))
		}
	}
	for _, action := range []string{"lock", "unlock"} {
		s.mux.Handle("POST /api/v1/inventory-balances/{id}/"+action, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			if err = s.business().Lock(r.Context(), r.PathValue("id"), input, action == "unlock"); err != nil {
				businessFailure(w, err, true)
				return
			}
			row, err := s.Store.Get(r.Context(), "inventory_balances", r.PathValue("id"))
			if err != nil {
				businessFailure(w, err, true)
				return
			}
			respond(w, 200, s.public(r, Resource{Table: "inventory_balances"}, row))
		})))
	}
}

func documentPermission(route, action string) string {
	switch route {
	case "sales-orders":
		return "sales_order_" + action
	case "purchase-orders":
		return "purchase_order_" + action
	case "stock-ins":
		return "stock_in_" + action
	case "stock-outs":
		return "stock_out_" + action
	}
	return "*"
}
func (s *Server) checkDocumentScope(w http.ResponseWriter, r *http.Request, d business.Document) bool {
	id := r.PathValue("id")
	if id == "" {
		return true
	}
	row, err := s.Store.Get(r.Context(), d.Table, id)
	if err == nil && d.Stock && r.Method == http.MethodPut && text(row, "status") != "draft" {
		businessFailure(w, stateErrorForStock(d), true)
		return false
	}
	if err == nil {
		err = s.checkScope(r, Resource{Table: d.Table}, row)
		if errors.Is(err, database.ErrNotFound) {
			err = errors.New("无权访问该数据")
		}
	}
	if err != nil {
		businessFailure(w, err, d.Stock)
		return false
	}
	return true
}

func (s *Server) checkDocumentReferences(r *http.Request, d business.Document, input map[string]any) error {
	if d.Stock {
		scope, dept, err := s.documentScope(r, "products")
		if err != nil {
			return err
		}
		if scope != "dept" {
			return nil
		}
		lines, _ := input["lines"].([]any)
		for _, raw := range lines {
			line, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			p, err := s.Store.Get(r.Context(), "products", text(line, "product_id"))
			if err != nil {
				return err
			}
			if dept == "" || p["department_id"] != dept {
				return errors.New("无权访问该数据")
			}
		}
		return nil
	}
	table := d.Party + "s"
	scope, dept, err := s.documentScope(r, table)
	if err != nil {
		return err
	}
	if scope != "dept" {
		return nil
	}
	id := text(input, d.Party+"_id")
	if id == "" {
		return nil
	}
	row, err := s.Store.Get(r.Context(), table, id)
	if err != nil {
		return err
	}
	if dept == "" || row["department_id"] != dept {
		return errors.New("无权访问该数据")
	}
	return nil
}

func stateErrorForStock(d business.Document) error {
	label := "出库单"
	if d.Incoming {
		label = "入库单"
	}
	return errors.New(label + "不存在或状态不允许修改")
}
