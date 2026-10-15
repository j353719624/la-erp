package api

import (
	"fmt"
	"net/http"
	"strings"
)

// transferRequired 复刻原版 gin + go-playground/validator 的必填错误形态。
//
// 原版回放 NN（2026-10-15，evidence/backend-runtime/audit-batch-nn-transfers-20261015.json）：
//
//	POST /api/v1/stock-transfers {}
//	  → 400 {"code":400,"message":"请求参数错误: Key: 'createTransferRequest.FromWarehouseID'
//	    Error:Field validation for 'FromWarehouseID' failed on the 'required' tag\nKey:
//	    'createTransferRequest.ToWarehouseID' Error:Field validation for 'ToWarehouseID'
//	    failed on the 'required' tag","data":null}
//	PUT  /api/v1/stock-transfers/{id} {}  → 同形态，结构体名换为 updateTransferRequest
//	PUT  /api/v1/stock-transfers/{id} {"from_warehouse_id":"…"}（缺 to）→ 只报 ToWarehouseID
//
// 多字段按**结构体字段声明顺序**排列（From 先 To 后），用 "\n" 连接；单字段不带换行。
// 空串与缺失都触发 required（原版 validator 的 `binding:"required"` 语义）。
//
// 该校验位于**读库之前**（原版 validator 在 handler 入口），所以 PUT 一个不存在的 id
// 也会先报 400 而不是「调拨单不存在或状态不允许修改」。
func transferRequired(structName string, input map[string]any) string {
	fields := []struct{ json, field string }{
		{"from_warehouse_id", "FromWarehouseID"},
		{"to_warehouse_id", "ToWarehouseID"},
	}
	parts := make([]string, 0, len(fields))
	for _, f := range fields {
		v, _ := input[f.json].(string)
		if strings.TrimSpace(coalesce(v, input[f.json])) == "" {
			parts = append(parts, fmt.Sprintf(
				"Key: '%s.%s' Error:Field validation for '%s' failed on the 'required' tag",
				structName, f.field, f.field))
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return "请求参数错误: " + strings.Join(parts, "\n")
}

// coalesce 取首个非空字符串，否则把任意值转成字符串（nil 得空串）。
func coalesce(s string, fallback any) string {
	if s != "" {
		return s
	}
	if fallback == nil {
		return ""
	}
	return fmt.Sprint(fallback)
}

func (s *Server) registerTransfers() {
	for _, method := range []string{"POST", "PUT"} {
		path := "/api/v1/stock-transfers"
		structName := "createTransferRequest"
		if method == "PUT" {
			path += "/{id}"
			structName = "updateTransferRequest"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			if msg := transferRequired(structName, input); msg != "" {
				fail(w, 400, msg)
				return
			}
			data, err := s.business().WriteTransfer(r.Context(), r.PathValue("id"), input, current(r).UserID)
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
	for _, action := range []string{"dispatch", "complete", "cancel", "delete"} {
		method, path := "POST", "/api/v1/stock-transfers/{id}/"+action
		if action == "delete" {
			method, path = "DELETE", "/api/v1/stock-transfers/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().TransferAction(r.Context(), r.PathValue("id"), action, current(r).UserID)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}
