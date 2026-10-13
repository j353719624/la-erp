package api

import (
	"fmt"
	"net/http"
	"time"
)

func (s *Server) registerMPS() {
	s.mux.Handle("POST /api/v1/mps-plans", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, "参数错误: "+err.Error())
			return
		}
		for _, key := range []string{"period_start", "period_end"} {
			if input[key] != nil {
				if _, err := time.Parse(time.RFC3339, fmt.Sprint(input[key])); err != nil {
					fail(w, 400, "参数错误: "+err.Error())
					return
				}
			}
		}
		data, err := s.business().CreateMPS(r.Context(), input)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/mps-plans/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().GetMPS(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("DELETE /api/v1/mps-plans/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.business().DeleteMPS(r.Context(), r.PathValue("id")); err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/mps-plans/{id}/generate-work-orders", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().GenerateMPS(r.Context(), r.PathValue("id"), current(r).UserID)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}
