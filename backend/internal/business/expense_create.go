package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
)

func (s *Service) CreateExpenseClaim(ctx context.Context, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		raw, ok := input["lines"].([]any)
		if !ok || len(raw) == 0 {
			return errors.New("报销明细不能为空")
		}
		total, err := Number(input["total_amount"])
		if err != nil || !total.IsPositive() {
			if err != nil {
				return err
			}
			return errors.New("报销金额必须大于零")
		}
		name := value(input, "employee_name")
		if name == "" {
			return errors.New("员工不能为空")
		}
		date := value(input, "claim_date")
		if date == "" {
			date = now()
		}
		h := s.base("expense_claims")
		no, err := s.nextNumber(ctx, tx, "EXP")
		if err != nil {
			return err
		}
		h["claim_no"], h["employee_name"], h["claim_date"], h["total_amount"], h["status"], h["payment_status"] = no, name, date, total.String(), "draft", "unpaid"
		for _, key := range []string{"employee_id", "department_id", "department", "remark"} {
			if input[key] != nil {
				h[key] = input[key]
			}
		}
		if err := s.Store.InsertWith(ctx, tx, "expense_claims", h); err != nil {
			return err
		}
		sum := decimal.Zero
		for i, v := range raw {
			line, ok := v.(map[string]any)
			if !ok {
				return errors.New("报销明细格式错误")
			}
			amount, e := Number(line["amount"])
			if e != nil || !amount.IsPositive() {
				if e != nil {
					return e
				}
				return errors.New("报销明细金额必须大于零")
			}
			sum = sum.Add(amount)
			row := s.base("expense_claim_lines")
			row["claim_id"], row["line_no"], row["expense_type"] = h["id"], i+1, value(line, "expense_type")
			if row["expense_type"] == "" {
				row["expense_type"] = "other"
			}
			row["amount"] = amount.String()
			for _, key := range []string{"description", "remark"} {
				if line[key] != nil {
					row[key] = line[key]
				}
			}
			if err := s.Store.InsertWith(ctx, tx, "expense_claim_lines", row); err != nil {
				return err
			}
		}
		if !sum.Equal(total) {
			return errors.New("报销明细合计必须等于报销金额")
		}
		result = s.Store.Public("expense_claims", h)
		return nil
	})
	return result, err
}
