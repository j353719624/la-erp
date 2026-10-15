package api

import (
	"errors"
	"net/http"

	"github.com/google/uuid"

	"la-erp/backend/internal/business"
)

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
		// 批次 PP（2026-10-15）：非法 UUID → 400「无效的ID格式」；
		// 合法 UUID 不存在 → 400「科目不存在」（此前泄漏 ORM 原文 record not found）。
		// 取证：tools/replay-batch-oo-catchall2.js B 组。
		if _, err := uuid.Parse(r.PathValue("id")); err != nil {
			fail(w, 400, "无效的ID格式")
			return
		}
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if !accountInput(w, input) {
			return
		}
		if err = s.business().UpdateAccount(r.Context(), r.PathValue("id"), input); err != nil {
			if errors.Is(err, business.ErrAccountNotFound) {
				fail(w, 400, "科目不存在")
				return
			}
			fail(w, 400, err.Error())
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("DELETE /api/v1/accounts/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 回放 OO（2026-10-15）：DELETE /accounts/tree（非 UUID）→ 400「无效的ID格式」。
		// 注：这个 handler 比通用 Resources 的 DELETE /{id} 更先注册，故守卫必须写在这里。
		//
		// ⚠ 不要在这里拦掉「合法 UUID」的删除 —— 原版**允许**删除科目：
		// evidence/backend-runtime/account-flow-contracts.json（2026-10-08 回放）
		// case 29/31/32 都是 200/code0。只有「科目从未存在」才回裸 400 + 通用文案，
		// 那条判断在 business.DeleteAccount 里（按 id 查无此行）。
		if _, err := uuid.Parse(r.PathValue("id")); err != nil {
			fail(w, 400, "无效的ID格式")
			return
		}
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
