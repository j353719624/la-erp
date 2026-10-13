package api

import "net/http"

func (s *Server) registerStockPhotos() {
	s.mux.Handle("POST /api/v1/stock-ins/{id}/photos", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		data, err := s.business().AddStockPhotos(r.Context(), r.PathValue("id"), input, current(r).UserID)
		if err != nil {
			businessFailure(w, err, true)
			return
		}
		respond(w, 200, data)
	})))
	for _, method := range []string{"PUT", "DELETE"} {
		s.mux.Handle(method+" /api/v1/stock-ins/{id}/photos/{photo}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input := map[string]any{}
			if method == "PUT" {
				var err error
				input, err = decode(w, r)
				if err != nil {
					fail(w, 400, err.Error())
					return
				}
			}
			if err := s.business().EditStockPhoto(r.Context(), r.PathValue("id"), r.PathValue("photo"), input, method == "DELETE"); err != nil {
				businessFailure(w, err, true)
				return
			}
			respond(w, 200, nil)
		})))
	}
}
