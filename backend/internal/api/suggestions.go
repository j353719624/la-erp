package api

import "net/http"

func (s *Server) registerSuggestions() {
	s.mux.Handle("GET /api/v1/purchase-suggestions/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().GetSuggestion(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, 404, err.Error())
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("DELETE /api/v1/purchase-suggestions/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.business().DeleteSuggestion(r.Context(), r.PathValue("id")); err != nil {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/purchase-suggestions/{id}/convert", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().ConvertSuggestion(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}
