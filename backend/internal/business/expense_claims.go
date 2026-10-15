package business

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"la-erp/backend/internal/database"
	"time"
)

func (s *Service) expenseMappedCode(ctx context.Context, tx *sql.Tx, key, fallback string) (string, error) {
	rows, err := database.QueryRows(ctx, tx, "SELECT value FROM system_settings WHERE key=?", "account_mapping")
	if err != nil || len(rows) == 0 {
		return fallback, err
	}
	var ids map[string]string
	if err := json.Unmarshal([]byte(fmt.Sprint(rows[0]["value"])), &ids); err != nil {
		return "", err
	}
	if id := ids[key]; id != "" {
		accounts, err := database.QueryRows(ctx, tx, "SELECT code FROM accounts WHERE id=? AND deleted_at IS NULL", id)
		if err != nil {
			return "", err
		}
		if len(accounts) == 1 {
			return fmt.Sprint(accounts[0]["code"]), nil
		}
	}
	return fallback, nil
}

func expensePostingDate(raw string) string {
	if _, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return raw
	}
	if t, err := time.Parse("2006-01-02 15:04:05 -0700 MST", raw); err == nil {
		return t.Format(time.RFC3339)
	}
	return raw
}

func (s *Service) ExpenseAction(ctx context.Context, id, action string, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "expense_claims", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("费用报销不存在")
		}
		if err != nil {
			return err
		}
		status := value(row, "status")
		changes := map[string]any{"updated_at": now()}
		// 批次 PP（2026-10-15）：五个动作的**文案**原版逐字不同，已逐条取证
		// （tools/replay-batch-pp-expense.js，audit-batch-pp-expense-20261015.txt）。
		// 原版一律带「的……单」，恢复端此前的简写形态全部不符。
		switch action {
		case "submit":
			if status != "draft" {
				return errors.New("只有草稿状态的报销单才能提交")
			}
			changes["status"] = "submitted"
		case "approve":
			if status != "submitted" {
				return errors.New("只有已提交的报销单才能审批")
			}
			amount := readDecimal(row, "total_amount")
			expenseCode, err := s.expenseMappedCode(ctx, tx, "expense", "6602")
			if err != nil {
				return err
			}
			if err := s.post(ctx, tx, "expense_claim", id, value(row, "claim_no"), expensePostingDate(dateText(row, "claim_date")), "费用报销审批", []Posting{{expenseCode, "debit", amount}, {"2211", "credit", amount}}); err != nil {
				return err
			}
			changes["status"] = "approved"
		case "paid":
			if status != "approved" {
				return errors.New("只有已审批的报销单才能标记付款")
			}
			amount := readDecimal(row, "total_amount")
			cashKey, cashFallback := "bank", "1002"
			if value(input, "method") == "cash" {
				cashKey, cashFallback = "cash", "1001"
			}
			cash, err := s.expenseMappedCode(ctx, tx, cashKey, cashFallback)
			if err != nil {
				return err
			}
			if err := s.post(ctx, tx, "expense_payment", id, value(row, "claim_no"), expensePostingDate(dateText(row, "claim_date")), "费用报销付款", []Posting{{"2211", "debit", amount}, {cash, "credit", amount}}); err != nil {
				return err
			}
			changes["status"], changes["payment_status"] = "paid", "paid"
			if input["method"] != nil {
				changes["remark"] = value(input, "method")
			}
		case "reject":
			if status != "submitted" {
				return errors.New("只有已提交的报销单才能驳回")
			}
			changes["status"] = "rejected"
		case "cancel":
			// 批次 PP（2026-10-15）：这里不只是文案差异，是**逻辑差异**。
			// 原版实测 submitted → cancel 被拒（audit-batch-pp-expense2-20261015.txt E9），
			// 只允许 draft 取消；恢复端原先放行 draft + submitted。
			if status != "draft" {
				return errors.New("只有草稿状态的报销单才能取消")
			}
			changes["status"] = "cancelled"
		// 原版 NN1 实测动作集为 submit / approve / paid / reject / cancel，
		// 与恢复端白名单逐项一致，本 default **不可达**，保留作兜底。
		default:
			return ErrUnsupported
		}
		if err := s.Store.UpdateWith(ctx, tx, "expense_claims", id, changes); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "expense_claims", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("expense_claims", result), nil
}
