package api

import "net/http"

func (s *Server) registerAdjustments() {
	s.mux.Handle("POST /api/v1/inventory-adjusts", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		data, err := s.business().WriteAdjustment(r.Context(), "", input, current(r).UserID)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))

	s.mux.Handle("PUT /api/v1/inventory-adjusts/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		_, err = s.business().WriteAdjustment(r.Context(), r.PathValue("id"), input, current(r).UserID)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, nil)
	})))
	for _, action := range []string{"confirm", "cancel", "delete"} {
		method, path := "POST", "/api/v1/inventory-adjusts/{id}/"+action
		if action == "delete" {
			method, path = "DELETE", "/api/v1/inventory-adjusts/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().AdjustmentAction(r.Context(), r.PathValue("id"), action, current(r).UserID)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			if action == "cancel" {
				respond(w, 200, nil)
			} else {
				respond(w, 200, data)
			}
		})))
	}
}
