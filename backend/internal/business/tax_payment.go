package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) PayTaxes(ctx context.Context, input map[string]any) (map[string]any, error) {
	raw, ok := input["items"].([]any)
	if !ok || len(raw) == 0 {
		return nil, errors.New("税费明细不能为空")
	}
	bank := value(input, "bank_code")
	if bank == "" {
		return nil, errors.New("银行科目不能为空")
	}
	date := value(input, "pay_date")
	if date == "" {
		date = now()
	}
	entries := make([]Posting, 0, len(raw)+1)
	total := decimal.Zero
	for _, v := range raw {
		m, ok := v.(map[string]any)
		if !ok {
			return nil, errors.New("税费明细格式错误")
		}
		code := value(m, "account_code")
		if code == "" {
			return nil, errors.New("税费科目不能为空")
		}
		amount, err := Number(m["amount"])
		if err != nil || !amount.IsPositive() {
			if err != nil {
				return nil, err
			}
			return nil, errors.New("税费金额必须大于零")
		}
		entries = append(entries, Posting{code, "debit", amount})
		total = total.Add(amount)
	}
	entries = append(entries, Posting{bank, "credit", total})
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if value(input, "post_voucher") == "true" || input["post_voucher"] == true {
			return s.post(ctx, tx, "tax_payment", "", "", date, value(input, "remark"), entries)
		}
		number, err := s.nextNumber(ctx, tx, "VOU")
		if err != nil {
			return err
		}
		h := s.base("vouchers")
		h["voucher_no"], h["type"], h["voucher_date"], h["status"], h["remark"], h["total_debit"], h["total_credit"] = number, "general", date, "draft", input["remark"], total.String(), total.String()
		if err := s.Store.InsertWith(ctx, tx, "vouchers", h); err != nil {
			return err
		}
		for i, entry := range entries {
			accounts, err := database.QueryRows(ctx, tx, "SELECT * FROM accounts WHERE code=? AND deleted_at IS NULL", entry.Code)
			if err != nil || len(accounts) != 1 {
				return errors.New("记账科目不存在或重复：" + entry.Code)
			}
			line := s.base("voucher_entries")
			line["voucher_entries"], line["sequence"], line["account_entries"], line["account_code"], line["account_name"], line["direction"], line["amount"] = h["id"], i+1, accounts[0]["id"], entry.Code, accounts[0]["name"], entry.Direction, entry.Amount.String()
			if err := s.Store.InsertWith(ctx, tx, "voucher_entries", line); err != nil {
				return err
			}
		}
		result = s.Store.Public("vouchers", h)
		return nil
	})
	return result, err
}
