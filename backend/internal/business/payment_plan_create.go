package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
)

func (s *Service) CreatePaymentPlan(ctx context.Context, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		raw, ok := input["items"].([]any)
		if !ok || len(raw) == 0 {
			return errors.New("分期明细不能为空")
		}
		if value(input, "plan_type") != "receivable" && value(input, "plan_type") != "payable" {
			return errors.New("计划类型错误")
		}
		total, err := Number(input["total_amount"])
		if err != nil || !total.IsPositive() {
			if err != nil {
				return err
			}
			return errors.New("计划金额必须大于零")
		}
		h := s.base("payment_plans")
		no, err := s.nextNumber(ctx, tx, "PP")
		if err != nil {
			return err
		}
		h["plan_no"], h["plan_type"], h["total_amount"], h["received_amount"], h["status"] = no, input["plan_type"], total.String(), "0", "active"
		for _, key := range []string{"party_id", "party_name", "source_type", "source_id", "source_no", "start_date", "remark"} {
			if input[key] != nil {
				h[key] = input[key]
			}
		}
		if err := s.Store.InsertWith(ctx, tx, "payment_plans", h); err != nil {
			return err
		}
		sum := decimal.Zero
		for i, v := range raw {
			m, ok := v.(map[string]any)
			if !ok {
				return errors.New("分期明细格式错误")
			}
			amount, e := Number(m["planned_amount"])
			if e != nil || !amount.IsPositive() {
				if e != nil {
					return e
				}
				return errors.New("分期金额必须大于零")
			}
			sum = sum.Add(amount)
			item := s.base("payment_plan_items")
			item["payment_plan_items"], item["seq"], item["due_date"], item["planned_amount"], item["received_amount"], item["status"] = h["id"], i+1, m["due_date"], amount.String(), "0", "pending"
			if m["remark"] != nil {
				item["remark"] = m["remark"]
			}
			if err := s.Store.InsertWith(ctx, tx, "payment_plan_items", item); err != nil {
				return err
			}
		}
		if !sum.Equal(total) {
			return errors.New("分期金额合计必须等于计划金额")
		}
		result = s.Store.Public("payment_plans", h)
		return nil
	})
	return result, err
}
