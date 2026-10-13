package api

import "net/http"

func (s *Server) registerUnitConversions() {
	s.mux.Handle("GET /api/v1/products/{id}/unit-conversions", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().UnitConversions(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	for _, method := range []string{"POST", "PUT"} {
		path := "/api/v1/products/{id}/unit-conversions"
		if method == "PUT" {
			path += "/{conversion}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().WriteUnitConversion(r.Context(), r.PathValue("id"), r.PathValue("conversion"), input)
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
	s.mux.Handle("DELETE /api/v1/products/{id}/unit-conversions/{conversion}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.business().DeleteUnitConversion(r.Context(), r.PathValue("id"), r.PathValue("conversion")); err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, nil)
	})))
}
