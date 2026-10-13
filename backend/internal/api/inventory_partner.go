package api

import (
 "net/http"
 "time"
)

func (s *Server) registerInventoryPartnerActions() {
 s.mux.Handle("POST /api/v1/loan-orders/{id}/confirm", s.protected("warehouse", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  row, err := s.business().ConfirmLoan(r.Context(), r.PathValue("id"), current(r).UserID)
  if err != nil { businessFailure(w, err, true); return }
  respond(w, 200, row)
 })))
	s.mux.Handle("POST /api/v1/loan-orders/{id}/return", s.protected("warehouse", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r); if err != nil { fail(w, 400, err.Error()); return }
		row, err := s.business().ReturnLoan(r.Context(), r.PathValue("id"), current(r).UserID, input)
		if err != nil { businessFailure(w, err, true); return }; respond(w, 200, row)
	})))
	s.mux.Handle("POST /api/v1/consignments/{id}/confirm", s.protected("warehouse", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.business().ConfirmConsignment(r.Context(), r.PathValue("id"), current(r).UserID)
		if err != nil { businessFailure(w, err, true); return }; respond(w, 200, row)
	})))
	s.mux.Handle("POST /api/v1/consignments/{id}/return", s.protected("warehouse", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r); if err != nil { fail(w, 400, err.Error()); return }; row, err := s.business().ReturnConsignment(r.Context(), r.PathValue("id"), current(r).UserID, input); if err != nil { businessFailure(w, err, true); return }; respond(w, 200, row)
	})))
	s.mux.Handle("POST /api/v1/consignments/{id}/sold", s.protected("warehouse", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r); if err != nil { fail(w, 400, err.Error()); return }; row, err := s.business().SellConsignment(r.Context(), r.PathValue("id"), input); if err != nil { businessFailure(w, err, true); return }; respond(w, 200, row)
	})))
 	for _, route := range []struct{ path, table string }{{"/api/v1/loan-orders/{id}/cancel", "loan_orders"}, {"/api/v1/consignments/{id}/cancel", "consignment_orders"}} {
		route := route
		s.mux.Handle("POST "+route.path, s.protected("warehouse", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			row, err := s.business().CancelPartner(r.Context(), route.table, r.PathValue("id"), current(r).UserID)
			if err != nil { businessFailure(w, err, true); return }; respond(w, 200, row)
		})))
	}
	for _, spec := range []struct{ route, table, to string; from []string }{
 } {
  spec := spec
  s.mux.Handle("POST "+spec.route, s.protected("warehouse", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
   id := r.PathValue("id"); row, err := s.Store.Get(r.Context(), spec.table, id)
   if err != nil { businessFailure(w, err, false); return }
   status, _ := row["status"].(string); allowed := false
   for _, v := range spec.from { if status == v { allowed = true; break } }
   if !allowed { fail(w, 409, "当前状态不允许执行该操作"); return }
   if err := s.Store.Update(r.Context(), spec.table, id, map[string]any{"status": spec.to, "updated_at": time.Now()}); err != nil { businessFailure(w, err, false); return }
   row, err = s.Store.Get(r.Context(), spec.table, id); if err != nil { businessFailure(w, err, false); return }; respond(w, 200, s.public(r, Resource{Table: spec.table}, row))
  })) )
 }
}





