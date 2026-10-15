package api

import (
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/business"
	"net/http"
	"time"
)

func bankFailure(w http.ResponseWriter, err error) {
	if errors.Is(err, business.ErrUnsupported) || errors.Is(err, business.ErrKnownDefect) {
		fail(w, 501, err.Error())
		return
	}
	for _, message := range []string{"账号不能为空", "银行账户不存在", "对账单金额不能为0", "该账户存在对账单记录，不能删除"} {
		if err.Error() == message {
			businessFailure(w, err, false)
			return
		}
	}
	fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
}
func bankInput(w http.ResponseWriter, input map[string]any, account bool) bool {
	stringsFields := []string{"account_id", "transaction_no", "description", "remark"}
	numeric := []string{"amount", "balance_after"}
	if account {
		stringsFields = []string{"account_no", "bank_name", "account_name", "currency", "remark"}
		numeric = []string{"opening_balance"}
	}
	for _, key := range stringsFields {
		if v := input[key]; v != nil {
			if _, ok := v.(string); !ok {
				fail(w, 400, "请求参数错误")
				return false
			}
		}
	}
	if v := input["is_active"]; v != nil {
		if _, ok := v.(bool); !ok {
			fail(w, 400, "请求参数错误")
			return false
		}
	}
	for _, key := range numeric {
		if v := input[key]; v != nil {
			if _, err := decimal.NewFromString(fmt.Sprint(v)); err != nil {
				fail(w, 400, fmt.Sprintf("请求参数错误: error decoding string '%v': %v", v, err))
				return false
			}
		}
	}
	if v := input["statement_date"]; v != nil {
		if _, err := time.Parse(time.RFC3339, fmt.Sprint(v)); err != nil {
			fail(w, 400, "请求参数错误: "+err.Error())
			return false
		}
	}
	return true
}
func (s *Server) registerBank() {
	s.mux.Handle("GET /api/v1/bank/accounts", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().BankAccounts(r.Context())
		if err != nil {
			bankFailure(w, err)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/bank/statements", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().BankStatements(r.Context(), r.URL.Query())
		if err != nil {
			bankFailure(w, err)
			return
		}
		respond(w, 200, data)
	})))
	for _, account := range []bool{true, false} {
		route := "statements"
		if account {
			route = "accounts"
		}
		s.mux.Handle("POST /api/v1/bank/"+route, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			if !bankInput(w, input, account) {
				return
			}
			var data any
			if account {
				if text(input, "account_no") == "" {
					write(w, 200, map[string]any{"code": 10000, "message": "账号不能为空", "data": nil})
					return
				}
				data, err = s.business().CreateBankAccount(r.Context(), input)
			} else {
				data, err = s.business().CreateBankStatement(r.Context(), input)
			}
			if err != nil {
				bankFailure(w, err)
				return
			}
			respond(w, 200, data)
		})))
		table := "bank_statements"
		if account {
			table = "bank_accounts"
		}
		s.mux.Handle("DELETE /api/v1/bank/"+route+"/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := s.business().DeleteBankRecord(r.Context(), table, r.PathValue("id")); err != nil {
				bankFailure(w, err)
				return
			}
			respond(w, 200, nil)
		})))
	}
	for _, summary := range []bool{true, false} {
		route := "POST /api/v1/bank/reconcile"
		if summary {
			route = "GET /api/v1/bank/reconcile-summary"
		}
		s.mux.Handle(route, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.URL.Query().Get("account_id")
			if _, err := uuid.Parse(id); err != nil {
				fail(w, 400, "account_id 格式错误")
				return
			}
			var data any
			var err error
			if summary {
				data, err = s.business().BankSummary(r.Context(), id)
			} else {
				var count int
				count, err = s.business().ReconcileBank(r.Context(), id)
				data = map[string]any{"matched": count}
			}
			if err != nil {
				bankFailure(w, err)
				return
			}
			respond(w, 200, data)
		})))
	}
}
