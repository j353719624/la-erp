package api

import (
	"fmt"
	"github.com/shopspring/decimal"
	"net/http"
)

func (s *Server) registerCurrencies() {
	s.mux.Handle("GET /api/v1/currencies", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().Currencies(r.Context())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	for _, method := range []string{"POST", "PUT"} {
		route := "/api/v1/currencies"
		if method == "PUT" {
			route += "/{id}"
		}
		s.mux.Handle(method+" "+route, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			for _, key := range []string{"code", "name", "symbol", "remark"} {
				if v := input[key]; v != nil {
					if _, ok := v.(string); !ok {
						fail(w, 400, "请求参数错误")
						return
					}
				}
			}
			if v := input["is_base"]; v != nil {
				if _, ok := v.(bool); !ok {
					fail(w, 400, "请求参数错误")
					return
				}
			}
			if v := input["exchange_rate"]; v != nil {
				if _, err := decimal.NewFromString(fmt.Sprint(v)); err != nil {
					fail(w, 400, fmt.Sprintf("请求参数错误: error decoding string '%v': %v", v, err))
					return
				}
			}
			data, err := s.business().SaveCurrency(r.Context(), r.PathValue("id"), input)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
	s.mux.Handle("DELETE /api/v1/currencies/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.business().DeleteCurrency(r.Context(), r.PathValue("id")); err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, nil)
	})))
}
