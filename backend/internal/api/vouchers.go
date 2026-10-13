package api

import (
	"la-erp-recovered/backend/internal/business"
	"net/http"
)

func (s *Server) registerVouchers() {
	for _, method := range []string{"POST", "PUT"} {
		path := "/api/v1/vouchers"
		if method == "PUT" {
			path += "/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err == nil {
				err = business.ValidFinanceDates(input, "voucher_date")
			}
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().WriteVoucher(r.Context(), r.PathValue("id"), input)
			if err != nil {
				businessFailure(w, err, true)
				return
			}
			if method == "PUT" {
				respond(w, 200, nil)
			} else {
				respond(w, 200, data)
			}
		})))
	}
	for _, action := range []string{"approve", "post", "cancel", "delete"} {
		method, path := "POST", "/api/v1/vouchers/{id}/"+action
		if action == "delete" {
			method, path = "DELETE", "/api/v1/vouchers/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().VoucherAction(r.Context(), r.PathValue("id"), current(r).UserID, action)
			if err != nil {
				businessFailure(w, err, true)
				return
			}
			respond(w, 200, data)
		})))
	}
}
