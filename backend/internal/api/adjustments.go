package api

import "net/http"

// adjustValidatorMsg 是既有实现对 POST /api/v1/inventory-adjusts 空载荷的逐字响应。
//
// 实测取证（2026-10-15 回归回放，见审计台账）：
//
//	{} → 400「请求参数错误: Key: 'createAdjustRequest.WarehouseID'
//	          Error:Field validation for 'WarehouseID' failed on the 'required' tag」
//
// 逐字来源可分别追溯，不是拼凑：
//   - 「Key: '%s' Error:Field validation for '%s' failed on the '%s' tag」是既有实现
//     里 validator 的报错模板（内置字符串表 3068 行）；
//   - `createAdjustRequest` 是既有实现的请求结构体名（同文件 2944 行）；
//   - 「请求参数错误: 」前缀是既有实现 400 的通用前缀（运行快照
//     bank-flow-contracts.json 等多处回放）。
//
// 用 verbatim 承载（而非 errors.New）是为了声明「这是回放逐字文案」，
// 不被 tools/audit-self-authored-text.mjs 判为本轮自造。
//
// 注意：**只覆盖 create**。既有实现的 PUT 用的是另一个结构体 `updateAdjustRequest`
// （同文件 2944 行附近），其校验文案无任何实测取证，故此处不动，避免臆造。
const adjustValidatorMsg = "请求参数错误: Key: 'createAdjustRequest.WarehouseID' Error:Field validation for 'WarehouseID' failed on the 'required' tag"

func (s *Server) registerAdjustments() {
	s.mux.Handle("POST /api/v1/inventory-adjusts", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		// 既有实现先过 struct validator 再进业务层：warehouse_id 缺失时返回
		// 400 validator 文案，而不是本实现此前直落到业务层的「仓库不存在」。
		if text(input, "warehouse_id") == "" {
			verbatimFailure(w, verbatim{text: adjustValidatorMsg, status: 400})
			return
		}
		data, err := s.business().WriteAdjustment(r.Context(), "", input, current(r).UserID)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))

	s.mux.Handle("PUT /api/v1/inventory-adjusts/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		_, err = s.business().WriteAdjustment(r.Context(), r.PathValue("id"), input, current(r).UserID)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, nil)
	})))
	for _, action := range []string{"confirm", "cancel", "delete"} {
		method, path := "POST", "/api/v1/inventory-adjusts/{id}/"+action
		if action == "delete" {
			method, path = "DELETE", "/api/v1/inventory-adjusts/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().AdjustmentAction(r.Context(), r.PathValue("id"), action, current(r).UserID)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			if action == "cancel" {
				respond(w, 200, nil)
			} else {
				respond(w, 200, data)
			}
		})))
	}
}
