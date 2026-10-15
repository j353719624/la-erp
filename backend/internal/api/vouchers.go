package api

import (
	"errors"
	"la-erp/backend/internal/business"
	"la-erp/backend/internal/database"
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
				// 回归回放 KK7（2026-10-14，运行快照）：
				// 对不存在的凭证执行 approve/post/cancel 既有实现返回 **HTTP 400** +
				// 「凭证不存在或状态不允许审批/过账/取消」，而非本实现原先的 404「记录不存在」。
				// 业务层已用原文案表达，这里把 HTTP 语义对齐为 400。
				if errors.Is(err, database.ErrNotFound) {
					fail(w, 400, voucherActionMessage(action))
					return
				}
				businessFailure(w, err, true)
				return
			}
			respond(w, 200, data)
		})))
	}
}

// voucherActionMessage 给出既有实现凭证动作在「记录不存在」时的原文案
// （2026-10-14 批次 K 回放，运行快照）。
func voucherActionMessage(action string) string {
	switch action {
	case "approve":
		return "凭证不存在或状态不允许审批"
	case "post":
		return "凭证不存在或状态不允许过账"
	case "cancel":
		return "凭证不存在或状态不允许取消"
	case "delete":
		return "只有草稿状态的凭证才能删除"
	}
	return "凭证不存在或状态不允许" + action
}
