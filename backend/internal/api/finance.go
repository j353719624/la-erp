package api

import (
	"errors"
	"net/http"

	"github.com/google/uuid"

	"la-erp/backend/internal/business"
	"la-erp/backend/internal/database"
)

func (s *Server) registerFinance() {
	for _, table := range []string{"ar_invoices", "ap_invoices"} {
		route := "ar-invoices"
		label := "应收单"
		if table == "ap_invoices" {
			route = "ap-invoices"
			label = "应付单"
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
					// 开票（POST /{id}/issue）的「记录不存在」在既有实现是**业务错误形态**
					// 200 + code 10000 + 「应付单不存在」/「应收单不存在」（回放 OO
					// 2026-10-15），而本实现统一走 404「记录不存在」。
					// PUT 分支的既有实现形态是 500，按铁律④不作语义证据，故保持原样。
					if method == "POST" {
						if errors.Is(err, database.ErrNotFound) {
							write(w, 200, map[string]any{"code": 10000, "message": label + "不存在", "data": nil})
							return
						}
					}
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
			// 批次 KK：既有实现支持 status / customer_id / supplier_id / currency_code 精确过滤，
			// 且**忽略分页参数**（page_size=2 仍返回全部）。过滤字段是否生效由
			// ListPayments 按「表上确有该列」判断（与批次 JJ 的结论一致）。
			filters := map[string]string{}
			for _, key := range []string{"status", "customer_id", "supplier_id", "currency_code"} {
				if v := r.URL.Query().Get(key); v != "" {
					filters[key] = v
				}
			}
			data, err := s.business().ListPayments(r.Context(), d, filters)
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
		// 批次 PP（2026-10-15）：非法 UUID → 400「无效的ID格式」
		// （tools/replay-batch-oo-catchall2.js B 组），此前漏进 AccountBalance
		// 输出 200+10000「科目不存在」。
		if _, err := uuid.Parse(r.PathValue("id")); err != nil {
			fail(w, 400, "无效的ID格式")
			return
		}
		data, err := s.business().AccountBalance(r.Context(), r.PathValue("id"), r.URL.Query().Get("period"))
		if err != nil {
			// 回放 OO：既有实现科目不存在时返回 200 + code 10000 + 「科目不存在」，
			// 与 GET /accounts/{id} 的 404「科目不存在」是**两套形态**，不能共用
			// businessFailure 的默认分支（那个会输出 404「记录不存在」）。
			if errors.Is(err, business.ErrAccountNotFound) {
				write(w, 200, map[string]any{"code": 10000, "message": "科目不存在", "data": nil})
				return
			}
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
}
