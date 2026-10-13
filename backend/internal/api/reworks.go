package api

import "net/http"

func (s *Server) registerReworks() {
	for _, method := range []string{"POST", "PUT"} {
		path := "/api/v1/rework-orders"
		if method == "PUT" {
			path += "/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().WriteRework(r.Context(), r.PathValue("id"), input)
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
	for _, action := range []string{"confirm", "complete", "cancel", "delete"} {
		path := "POST /api/v1/rework-orders/{id}/" + action
		if action == "delete" {
			path = "DELETE /api/v1/rework-orders/{id}"
		}
		s.mux.Handle(path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().ReworkAction(r.Context(), r.PathValue("id"), action)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}
