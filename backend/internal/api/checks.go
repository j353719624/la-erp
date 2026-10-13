package api

import "net/http"

func (s *Server) registerChecks() {
	for _, method := range []string{"POST", "PUT"} {
		path := "/api/v1/inventory-checks"
		if method == "PUT" {
			path += "/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			if text(input, "warehouse_id") == "" {
				fail(w, 400, "仓库不能为空")
				return
			}
			data, err := s.business().WriteCheck(r.Context(), r.PathValue("id"), input, current(r).UserID)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			if method == "PUT" {
				respond(w, 200, nil)
			} else {
				respond(w, 200, data)
			}
		})))
	}
	for _, action := range []string{"start", "complete", "cancel", "delete"} {
		method, path := "POST", "/api/v1/inventory-checks/{id}/"+action
		if action == "delete" {
			method, path = "DELETE", "/api/v1/inventory-checks/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().CheckAction(r.Context(), r.PathValue("id"), action, current(r).UserID)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}
