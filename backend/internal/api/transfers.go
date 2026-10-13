package api

import "net/http"

func (s *Server) registerTransfers() {
	for _, method := range []string{"POST", "PUT"} {
		path := "/api/v1/stock-transfers"
		if method == "PUT" {
			path += "/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().WriteTransfer(r.Context(), r.PathValue("id"), input, current(r).UserID)
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
	for _, action := range []string{"dispatch", "complete", "cancel", "delete"} {
		method, path := "POST", "/api/v1/stock-transfers/{id}/"+action
		if action == "delete" {
			method, path = "DELETE", "/api/v1/stock-transfers/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().TransferAction(r.Context(), r.PathValue("id"), action, current(r).UserID)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}
