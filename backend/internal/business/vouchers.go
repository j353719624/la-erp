package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) GetVoucher(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "vouchers", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("vouchers", h)
	rows, err := s.Store.Rows(ctx, "SELECT * FROM voucher_entries WHERE voucher_entries=? AND deleted_at IS NULL ORDER BY sequence", id)
	if err != nil {
		return nil, err
	}
	lines := []map[string]any{}
	for _, r := range rows {
		p := s.Store.Public("voucher_entries", r)
		delete(p, "voucher_entries")
		delete(p, "account_entries")
		lines = append(lines, p)
	}
	edges := map[string]any{}
	if len(lines) > 0 {
		edges["entries"] = lines
	}
	pub["edges"] = edges
	return pub, nil
}
func (s *Service) WriteVoucher(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		raw, ok := input["entries"].([]any)
		if !ok || len(raw) < 2 || len(raw) > 1000 {
			return errors.New("凭证分录必须为2至1000行")
		}
		if value(input, "type") != "general" || value(input, "source_id") != "" || value(input, "source_type") != "" || value(input, "currency_code") != "" {
			return ErrUnsupported
		}
		lines := []map[string]any{}
		debit, credit := decimal.Zero, decimal.Zero
		for i, v := range raw {
			l, ok := v.(map[string]any)
			if !ok {
				return errors.New("分录格式错误")
			}
			account, err := s.Store.GetWith(ctx, tx, "accounts", value(l, "account_id"))
			if err != nil {
				return errors.New("系统内部错误，请稍后重试或联系管理员")
			}
			amount, err := Number(l["amount"])
			if err != nil {
				return err
			}
			if !amount.IsPositive() {
				return errors.New("分录金额必须大于零")
			}
			direction := value(l, "direction")
			switch direction {
			case "debit":
				debit = debit.Add(amount)
			case "credit":
				credit = credit.Add(amount)
			default:
				return errors.New("记账方向错误")
			}
			row := s.base("voucher_entries")
			row["sequence"], row["account_code"], row["account_name"], row["account_entries"], row["direction"], row["amount"] = i+1, account["code"], account["name"], account["id"], direction, amount.String()
			if l["remark"] != nil {
				row["remark"] = l["remark"]
			}
			lines = append(lines, row)
		}
		if !debit.Equal(credit) {
			return errors.New("凭证借贷不平衡")
		}
		var h map[string]any
		if id == "" {
			h = s.base("vouchers")
			number, err := s.nextNumber(ctx, tx, "VOU")
			if err != nil {
				return err
			}
			h["voucher_no"] = number
			h["status"] = "draft"
			h["source_type"] = ""
			id = value(h, "id")
		} else {
			var err error
			h, err = s.Store.GetWith(ctx, tx, "vouchers", id)
			if err != nil {
				return err
			}
			if value(h, "status") != "draft" {
				return errors.New("只有草稿状态的凭证才能编辑")
			}
		}
		h["type"], h["voucher_date"], h["total_debit"], h["total_credit"] = input["type"], input["voucher_date"], debit.String(), credit.String()
		if input["remark"] != nil {
			h["remark"] = input["remark"]
		}
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "vouchers", h); err != nil {
				return err
			}
		} else {
			h["updated_at"] = now()
			if err := s.Store.UpdateWith(ctx, tx, "vouchers", id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM voucher_entries WHERE voucher_entries=?", id); err != nil {
				return err
			}
		}
		for _, l := range lines {
			l["voucher_entries"] = id
			if err := s.Store.InsertWith(ctx, tx, "voucher_entries", l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetVoucher(ctx, id)
}
func (s *Service) VoucherAction(ctx context.Context, id, user, action string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "vouchers", id)
		if err != nil {
			return err
		}
		status := value(h, "status")
		changes := map[string]any{"updated_at": now()}
		switch action {
		case "approve":
			if status != "posted" {
				return errors.New("凭证不存在或状态不允许审批")
			}
			changes["status"], changes["approved_by"], changes["approved_at"] = "approved", user, now()
		case "post":
			if status != "draft" {
				return errors.New("凭证不存在或状态不允许过账")
			}
			rows, err := database.QueryRows(ctx, tx, "SELECT * FROM voucher_entries WHERE voucher_entries=? AND deleted_at IS NULL ORDER BY sequence", id)
			if err != nil {
				return err
			}
			entries := []Posting{}
			debit, credit := decimal.Zero, decimal.Zero
			for _, l := range rows {
				amount := readDecimal(l, "amount")
				direction := value(l, "direction")
				if direction == "debit" {
					debit = debit.Add(amount)
				} else {
					credit = credit.Add(amount)
				}
				entries = append(entries, Posting{value(l, "account_code"), direction, amount})
			}
			if len(entries) < 2 || !debit.Equal(credit) {
				return errors.New("凭证借贷不平衡")
			}
			if err := s.postVoucherEntries(ctx, tx, h, entries, false); err != nil {
				return err
			}
			changes["status"] = "posted"
		case "cancel":
			if status != "posted" {
				return errors.New("凭证不存在或状态不允许取消")
			}
			changes["status"] = "cancelled"
		case "delete":
			if status != "draft" {
				return errors.New("只有草稿状态的凭证才能删除")
			}
			changes["deleted_at"] = now()
		default:
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, "vouchers", id, changes)
	})
	if err != nil {
		return nil, err
	}
	if action == "delete" {
		return nil, nil
	}
	return s.GetVoucher(ctx, id)
}
