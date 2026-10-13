package api

import "net/http"

func (s *Server) registerAccounts() {
	s.mux.Handle("GET /api/v1/accounts/tree", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().AccountTree(r.Context())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("POST /api/v1/accounts", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if !accountInput(w, input) {
			return
		}
		if input["code"] == nil || input["code"] == "" || input["name"] == nil || input["name"] == "" {
			fail(w, 400, "系统内部错误，请稍后重试或联系管理员")
			return
		}
		data, err := s.business().CreateAccount(r.Context(), input)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("PUT /api/v1/accounts/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if !accountInput(w, input) {
			return
		}
		if err = s.business().UpdateAccount(r.Context(), r.PathValue("id"), input); err != nil {
			fail(w, 400, err.Error())
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("DELETE /api/v1/accounts/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.business().DeleteAccount(r.Context(), r.PathValue("id")); err != nil {
			fail(w, 400, err.Error())
			return
		}
		respond(w, 200, nil)
	})))
}
func accountInput(w http.ResponseWriter, input map[string]any) bool {
	for _, field := range []string{"code", "name", "category", "sub_category", "currency", "remark", "parent_id"} {
		if v := input[field]; v != nil {
			if _, ok := v.(string); !ok {
				fail(w, 400, "科目字段类型错误")
				return false
			}
		}
	}
	for _, field := range []string{"is_leaf", "is_enabled"} {
		if v := input[field]; v != nil {
			if _, ok := v.(bool); !ok {
				fail(w, 400, "科目字段类型错误")
				return false
			}
		}
	}
	return true
}
