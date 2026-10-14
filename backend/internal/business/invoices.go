package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) UpdateInvoice(ctx context.Context, table, id string, input map[string]any, issue bool) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		_, err := s.Store.GetWith(ctx, tx, table, id)
		if err != nil {
			return err
		}
		changes := map[string]any{"updated_at": now()}
		if issue {
			field := "purchase_invoice_no"
			if table == "ar_invoices" {
				field = "sales_invoice_no"
			}
			if value(input, field) == "" {
				return errors.New("发票号码不能为空")
			}
			rate, err := Number(input["tax_rate"])
			if err != nil {
				return err
			}
			amount, err := Number(input["tax_amount"])
			if err != nil {
				return err
			}
			if rate.IsNegative() || amount.IsNegative() {
				return errors.New("税率和税额不能为负")
			}
			changes[field], changes["invoice_status"], changes["tax_rate"], changes["tax_amount"], changes["invoiced_at"] = input[field], "invoiced", rate.String(), amount.String(), now()
		} else {
			// Original PUT does not rewrite total_amount or the generated posting.
			for _, field := range []string{"remark", "due_date"} {
				if input[field] != nil {
					changes[field] = input[field]
				}
			}
		}
		return s.Store.UpdateWith(ctx, tx, table, id, changes)
	})
	if err != nil {
		return nil, err
	}
	return s.GetInvoice(ctx, table, id)
}
func (s *Service) DeleteFinance(ctx context.Context, table, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, table, id)
		if err != nil {
			return err
		}
		switch table {
		case "payment_receipts", "payment_payments":
			if value(h, "status") != "draft" && value(h, "status") != "cancelled" {
				return errors.New("已确认的收付款单不能删除")
			}
		case "ar_invoices", "ap_invoices":
			// 原版回放（2026-10-13，证据 evidence/backend-runtime/audit-finance-advanced-20261013.json
			// 的 G4 与内联 P1 全额收款场景）：
			//   G4  应收 130 → 部分收款 65（status=partial）→ DELETE code:0，单据真实消失
			//   P1  应收  80 → 全额收款 80（status=paid）    → DELETE code:0，单据真实消失
			//   两次删除后凭证总数均不变（63→63），已过账凭证与核销明细无悬挂。
			// 原实现对 received_amount/paid_amount>0 返回 ErrUnsupported，
			// 属未经证据的错误拒绝，已移除。
		default:
			// 批次 CC（2026-10-14，evidence/backend-runtime/audit-batch-cc-20261014.json）：
			// table 由 API 层 registerFinance 的
			// `for _, table := range []string{"ar_invoices", "ap_invoices"}` 提供，
			// 而上面两个 case 已覆盖全部四个取值（payment_receipts / payment_payments /
			// ar_invoices / ap_invoices）→ 本 default **永不可达**。
			// 保留 ErrUnsupported 作兜底，不自造文案。
			return ErrUnsupported
		}
		// Observed original soft-deletes headers and preserves details/postings.
		return s.Store.UpdateWith(ctx, tx, table, id, map[string]any{"deleted_at": now(), "updated_at": now()})
	})
}
func (s *Service) ListPayments(ctx context.Context, d FinanceSpec) ([]map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT id FROM "+database.Quote(d.Table)+" WHERE deleted_at IS NULL ORDER BY created_at ASC")
	if err != nil {
		return nil, err
	}
	result := []map[string]any{}
	for _, h := range rows {
		v, err := s.GetPayment(ctx, d, value(h, "id"))
		if err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, nil
}
