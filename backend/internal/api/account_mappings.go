package api

import "net/http"

func (s *Server) registerAccountMappings() {
	s.mux.Handle("GET /api/v1/account-mappings", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().AccountMappings(r.Context())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("PUT /api/v1/account-mappings", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		items := map[string]string{}
		if input["items"] != nil {
			raw, ok := input["items"].(map[string]any)
			if !ok {
				fail(w, 400, "请求参数错误")
				return
			}
			for key, v := range raw {
				id, ok := v.(string)
				if !ok {
					fail(w, 400, "请求参数错误")
					return
				}
				items[key] = id
			}
		}
		data, err := s.business().SaveAccountMappings(r.Context(), items)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}
