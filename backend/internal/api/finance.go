package api

import (
	"la-erp-recovered/backend/internal/business"
	"net/http"
)

func (s *Server) registerFinance() {
	for _, table := range []string{"ar_invoices", "ap_invoices"} {
		route := "ar-invoices"
		if table == "ap_invoices" {
			route = "ap-invoices"
		}
		for _, method := range []string{"PUT", "POST"} {
			path := "/api/v1/" + route + "/{id}"
			if method == "POST" {
				path += "/issue"
			}
			s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				input, err := decode(w, r)
				if err == nil {
					err = business.ValidFinanceDates(input, "invoice_date", "due_date")
				}
				if err != nil {
					fail(w, 400, err.Error())
					return
				}
				data, err := s.business().UpdateInvoice(r.Context(), table, r.PathValue("id"), input, method == "POST")
				if err != nil {
					businessFailure(w, err, false)
					return
				}
				respond(w, 200, data)
			})))
		}
		s.mux.Handle("DELETE /api/v1/"+route+"/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := s.business().DeleteFinance(r.Context(), table, r.PathValue("id")); err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, nil)
		})))
		s.mux.Handle("GET /api/v1/"+route+"/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().GetInvoice(r.Context(), table, r.PathValue("id"))
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
		s.mux.Handle("POST /api/v1/"+route, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err == nil {
				err = business.ValidFinanceDates(input, "invoice_date", "due_date")
			}
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().CreateInvoice(r.Context(), table, input)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
	for route, d := range business.Finances {
		s.mux.Handle("GET /api/v1/"+route, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().ListPayments(r.Context(), d)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
		s.mux.Handle("DELETE /api/v1/"+route+"/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := s.business().DeleteFinance(r.Context(), d.Table, r.PathValue("id")); err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, nil)
		})))
		s.mux.Handle("GET /api/v1/"+route+"/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().GetPayment(r.Context(), d, r.PathValue("id"))
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
		s.mux.Handle("POST /api/v1/"+route, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err == nil {
				err = business.ValidFinanceDates(input, d.Date)
			}
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().CreatePayment(r.Context(), d, input)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
		for _, action := range []string{"confirm", "cancel"} {
			s.mux.Handle("POST /api/v1/"+route+"/{id}/"+action, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data, err := s.business().PaymentTransition(r.Context(), d, r.PathValue("id"), action == "cancel")
				if err != nil {
					businessFailure(w, err, false)
					return
				}
				respond(w, 200, data)
			})))
		}
	}
	s.mux.Handle("GET /api/v1/accounts/{id}/balance", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().AccountBalance(r.Context(), r.PathValue("id"), r.URL.Query().Get("period"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}
