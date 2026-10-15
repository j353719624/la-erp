package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

func (s *Service) ConfirmPayroll(ctx context.Context, id string) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		batch, err := s.Store.GetWith(ctx, tx, "payroll_batches", id)
		if err != nil {
			return err
		}
		if value(batch, "status") != "draft" {
			// 批次 PP（2026-10-15）：既有实现逐字为「只有草稿状态的工资批次才能确认」
			// （tools/replay-batch-pp-statemachine.js 用例 D2）。
			return errors.New("只有草稿状态的工资批次才能确认")
		}
		rows, err := database.QueryRows(ctx, tx, "SELECT net_pay FROM payroll_items WHERE batch_id=? AND deleted_at IS NULL", id)
		if err != nil || len(rows) == 0 {
			if err != nil {
				return err
			}
			return errors.New("工资明细不能为空")
		}
		total := decimal.Zero
		for _, row := range rows {
			amount, e := Number(row["net_pay"])
			if e != nil {
				return e
			}
			total = total.Add(amount)
		}
		if err := s.post(ctx, tx, "payroll", id, value(batch, "batch_no"), value(batch, "period")+"-01T00:00:00Z", "工资计提", []Posting{{Code: "6602", Direction: "debit", Amount: total}, {Code: "2211", Direction: "credit", Amount: total}}); err != nil {
			return err
		}
		if err := s.Store.UpdateWith(ctx, tx, "payroll_batches", id, map[string]any{"status": "confirmed", "updated_at": now()}); err != nil {
			return err
		}
		batch["status"] = "confirmed"
		result = s.Store.Public("payroll_batches", batch)
		return nil
	})
	return result, err
}
