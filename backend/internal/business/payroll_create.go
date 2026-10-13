package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
)

func (s *Service) CreatePayroll(ctx context.Context, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		raw, ok := input["items"].([]any)
		if !ok || len(raw) == 0 {
			return errors.New("工资明细不能为空")
		}
		period := value(input, "period")
		if len(period) != 7 {
			return errors.New("工资期间必须为 YYYY-MM")
		}
		h := s.base("payroll_batches")
		no, err := s.nextNumber(ctx, tx, "PAY")
		if err != nil {
			return err
		}
		h["batch_no"], h["period"], h["status"], h["total_amount"] = no, period, "draft", "0"
		if input["remark"] != nil {
			h["remark"] = input["remark"]
		}
		if err := s.Store.InsertWith(ctx, tx, "payroll_batches", h); err != nil {
			return err
		}
		total := decimal.Zero
		for i, v := range raw {
			m, ok := v.(map[string]any)
			if !ok || value(m, "employee_name") == "" {
				return errors.New("工资明细格式错误")
			}
			base, err := Number(m["base_salary"])
			if err != nil {
				return err
			}
			bonus, err := Number(m["bonus"])
			if err != nil {
				return err
			}
			allowance, err := Number(m["allowance"])
			if err != nil {
				return err
			}
			deduction, err := Number(m["deduction"])
			if err != nil {
				return err
			}
			net := base.Add(bonus).Add(allowance).Sub(deduction)
			if net.IsNegative() {
				return errors.New("实发工资不能为负")
			}
			item := s.base("payroll_items")
			item["batch_id"], item["line_no"], item["employee_name"] = h["id"], i+1, value(m, "employee_name")
			for key, val := range map[string]any{"employee_id": m["employee_id"], "department": m["department"], "base_salary": base.String(), "bonus": bonus.String(), "allowance": allowance.String(), "deduction": deduction.String(), "net_pay": net.String()} {
				if val != nil {
					item[key] = val
				}
			}
			if err := s.Store.InsertWith(ctx, tx, "payroll_items", item); err != nil {
				return err
			}
			total = total.Add(net)
		}
		if err := s.Store.UpdateWith(ctx, tx, "payroll_batches", h["id"].(string), map[string]any{"total_amount": total.String(), "updated_at": now()}); err != nil {
			return err
		}
		h["total_amount"] = total.String()
		result = s.Store.Public("payroll_batches", h)
		return nil
	})
	return result, err
}
