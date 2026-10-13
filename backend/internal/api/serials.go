package api

import (
	"net/http"
)

func (s *Server) registerSerials() {
	s.mux.Handle("GET /api/v1/serial-numbers", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		res := Resource{Table: "serial_numbers", Permission: "*", Label: "序列号"}
		s.list(w, r, res)
	})))
	s.mux.Handle("POST /api/v1/serial-numbers", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		data, err := s.business().RegisterSerials(r.Context(), input)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/serial-numbers/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "路由不存在") })))
	for _, action := range []string{"out", "scrap"} {
		s.mux.Handle("POST /api/v1/serial-numbers/{id}/"+action, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().SerialAction(r.Context(), r.PathValue("id"), action)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}
