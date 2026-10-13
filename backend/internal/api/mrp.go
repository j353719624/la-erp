package api

import "net/http"

func (s *Server) registerMRP() {
	s.mux.Handle("POST /api/v1/mrp/run", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().RunMRP(r.Context())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/mrp/requirements/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().GetMRP(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, 404, err.Error())
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("DELETE /api/v1/mrp/requirements/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.business().DeleteMRP(r.Context(), r.PathValue("id")); err != nil {
			fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/mrp/requirements/{id}/generate-work-orders", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().GenerateMRPWorkOrders(r.Context(), r.PathValue("id"), current(r).UserID)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}
