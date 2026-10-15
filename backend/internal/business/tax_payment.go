package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

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
	// 批次 PP（2026-10-15）：原版税金缴纳产生的凭证与其他过账点**形态不同**，
	// 三条都要按实测走（audit-batch-pp-voucher-shape-20261015.txt）：
	//   ① 凭证 type 是 "payment"，不是通用的 "general"
	//   ② 凭证头 remark 被加工成「缴纳税费（<传入 remark>）」，不是原样
	//   ③ 分录 remark 是「缴纳税费」（其余过账点的分录 remark 实测为空）
	// 传入 remark 为空时，原版的加工结果按同样规则处理（仍套「缴纳税费（…）」），
	// 未单独取证空串情形，此处保持与取值一致的处理。
	const taxRemarkPrefix = "缴纳税费"
	taxShape := VoucherShape{
		Type:        "payment",
		Remark:      fmt.Sprintf("%s（%s）", taxRemarkPrefix, value(input, "remark")),
		EntryRemark: taxRemarkPrefix,
	}
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if value(input, "post_voucher") == "true" || input["post_voucher"] == true {
			return s.postShaped(ctx, tx, "tax_payment", "", "", date, value(input, "remark"), entries, taxShape)
		}
		number, err := s.nextNumber(ctx, tx, "VOU")
		if err != nil {
			return err
		}
		h := s.base("vouchers")
		// 草稿分支同样走税金缴纳的形态（type=payment、remark 加工、带 source_type），
		// 只有 status 是 draft —— 原版实测草稿凭证也带 source_type=tax_payment
		// （audit-batch-pp-autopost4-20261015.txt：post_voucher=false 时原版
		// 产出 type=payment status=draft src=tax_payment 的凭证）。
		// 恢复端原先这里 type=general、remark 原样、**不打 source_type**，
		// 导致草稿凭证在列表里无法按来源归属。
		h["voucher_no"], h["type"], h["voucher_date"], h["status"], h["remark"], h["total_debit"], h["total_credit"] = number, taxShape.Type, date, "draft", taxShape.Remark, total.String(), total.String()
		h["source_id"], h["source_type"], h["source_no"] = "", "tax_payment", ""
		if err := s.Store.InsertWith(ctx, tx, "vouchers", h); err != nil {
			return err
		}
		for i, entry := range entries {
			accounts, err := database.QueryRows(ctx, tx, "SELECT * FROM accounts WHERE code=? AND deleted_at IS NULL", entry.Code)
			if err != nil || len(accounts) != 1 {
				return errors.New("记账科目不存在或重复：" + entry.Code)
			}
			line := s.base("voucher_entries")
		// 与过账分支同源：草稿凭证的分录 remark 也是「缴纳税费」（原版实测）。
		line["voucher_entries"], line["sequence"], line["account_entries"], line["account_code"], line["account_name"], line["direction"], line["amount"], line["remark"] = h["id"], i+1, accounts[0]["id"], entry.Code, accounts[0]["name"], entry.Direction, entry.Amount.String(), taxShape.EntryRemark
		if err := s.Store.InsertWith(ctx, tx, "voucher_entries", line); err != nil {
			return err
		}
		}
		result = s.Store.Public("vouchers", h)
		return nil
	})
	return result, err
}
