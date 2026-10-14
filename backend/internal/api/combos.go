package api

// combos.go —— /api/v1/combo-products 端点族（组合件）
//
// 批次 EE 回放取证（2026-10-14，evidence/backend-runtime/audit-batch-ee-20261014.json）。
// 原版 7 个入口的行为与文案全部取自回放；本文件只做参数绑定与 ID 形态校验，
// 业务校验与文案一律下沉到 business/combos.go，避免自造中文。
//
// ID 形态：非法 UUID 一律 400「无效的商品ID」（列表以外的全部路径均实测一致）。
// available 的 warehouse_id 非法/缺失一律 400「无效的仓库ID」。

import (
	"net/http"

	"github.com/google/uuid"
)

func (s *Server) registerCombos() {
	s.mux.Handle("GET /api/v1/combo-products", s.protected("product_list", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().ListCombos(r.Context(), r.URL.Query())
		if err != nil {
			s.failure(w, err, "商品")
			return
		}
		respond(w, 200, data)
	})))

	s.mux.Handle("GET /api/v1/combo-products/{id}", s.protected("product_list", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if _, err := uuid.Parse(id); err != nil {
			fail(w, 400, "无效的商品ID")
			return
		}
		data, err := s.business().GetCombo(r.Context(), id)
		if err != nil {
			businessFailureLabeled(w, err, false, "商品")
			return
		}
		respond(w, 200, data)
	})))

	s.mux.Handle("PUT /api/v1/combo-products/{id}", s.protected("product_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if _, err := uuid.Parse(id); err != nil {
			fail(w, 400, "无效的商品ID")
			return
		}
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if err := s.business().SaveCombo(r.Context(), id, input); err != nil {
			businessFailureLabeled(w, err, false, "商品")
			return
		}
		respond(w, 200, nil)
	})))

	s.mux.Handle("DELETE /api/v1/combo-products/{id}", s.protected("product_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if _, err := uuid.Parse(id); err != nil {
			fail(w, 400, "无效的商品ID")
			return
		}
		if err := s.business().DeleteCombo(r.Context(), id); err != nil {
			businessFailureLabeled(w, err, false, "商品")
			return
		}
		respond(w, 200, nil)
	})))

	s.mux.Handle("GET /api/v1/combo-products/{id}/available", s.protected("product_list", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if _, err := uuid.Parse(id); err != nil {
			fail(w, 400, "无效的商品ID")
			return
		}
		warehouse := r.URL.Query().Get("warehouse_id")
		if _, err := uuid.Parse(warehouse); err != nil {
			fail(w, 400, "无效的仓库ID")
			return
		}
		data, err := s.business().ComboAvailable(r.Context(), id, warehouse)
		if err != nil {
			s.failure(w, err, "商品")
			return
		}
		respond(w, 200, data)
	})))

	for _, action := range []string{"assemble", "disassemble"} {
		action := action
		s.mux.Handle("POST /api/v1/combo-products/{id}/"+action, s.protected("product_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			if _, err := uuid.Parse(id); err != nil {
				fail(w, 400, "无效的商品ID")
				return
			}
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().ComboAction(r.Context(), id, action, input, current(r).UserID)
			if err != nil {
				businessFailureLabeled(w, err, false, "商品")
				return
			}
			respond(w, 200, data)
		})))
	}
}
