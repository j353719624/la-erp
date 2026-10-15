package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"la-erp/backend/internal/database"
)

// SetOpeningBalances 返回写入后的科目余额行。
//
// 回放 OO：既有实现成功响应是 `data:{total:N, list:[...account_balances 行...]}`，
// 本实现原来返回 `{period, updated}` —— 前端拿不到写入结果。
func (s *Service) SetOpeningBalances(ctx context.Context, period string, entries []map[string]any) ([]map[string]any, error) {
	written := make([]map[string]any, 0, len(entries))
	// 入参 period 是 YYYY-MM（与 accounting_periods.period 同格式），先按它查期间状态。
	// 归一化只在**写 account_balances 时**生效，两种表的 period 格式本来就不同。
	stored := BalancePeriodText(period)
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		// 回放 OO：既有实现**不校验期间是否存在** —— {period:"2099-12", entries:[...]}
		// 在既有实现一路走到了科目检查并返回「会计科目不存在」。
		// 所以期间查不到时不能报错，更不能把 sql.ErrNoRows 的原文回给客户端；
		// 只在期间**确实存在且已结账**时才拒绝（该文案是本实现既有，非本批新增）。
		status := "open"
		if err := tx.QueryRowContext(ctx, "SELECT status FROM accounting_periods WHERE period=? AND deleted_at IS NULL", period).Scan(&status); err != nil {
			status = "open"
		}
		if status != "open" {
			return errors.New("已结账期间不能设置期初余额")
		}
		for _, e := range entries {
			aid := value(e, "account_id")
			amount, err := Number(e["begin_balance"])
			if err != nil || aid == "" {
				return errors.New("科目或期初余额无效")
			}
			// 回放 OO：科目不存在时既有实现返回 200/code10000 + 「会计科目不存在」，
			// 本实现原来把 sql.ErrNoRows 的原文回给了客户端。
			if _, err = s.Store.GetWith(ctx, tx, "accounts", aid); err != nil {
				return errors.New("会计科目不存在")
			}
			var id string
			if err = tx.QueryRowContext(ctx, "SELECT id FROM account_balances WHERE account_id=? AND period=?", aid, stored).Scan(&id); err == nil {
				_, err = tx.ExecContext(ctx, "UPDATE account_balances SET begin_balance=?,end_balance=? WHERE id=?", amount.String(), amount.String(), id)
			} else {
				id = uuid.NewString()
				_, err = tx.ExecContext(ctx, "INSERT INTO account_balances(id,period,begin_balance,debit_amount,credit_amount,end_balance,tenant_id,account_id) VALUES(?,?,?,0,0,?,?,?)", id, stored, amount.String(), amount.String(), database.ZeroUUID, aid)
			}
			if err != nil {
				return err
			}
			rows, err := database.QueryRows(ctx, tx, "SELECT * FROM account_balances WHERE id=?", id)
			if err != nil {
				return err
			}
			if len(rows) > 0 {
				written = append(written, s.Store.Public("account_balances", rows[0]))
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return written, nil
}
