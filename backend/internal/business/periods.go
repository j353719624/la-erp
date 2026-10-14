package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) SetOpeningBalances(ctx context.Context, period string, entries []map[string]any) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		var status string
		if err := tx.QueryRowContext(ctx, "SELECT status FROM accounting_periods WHERE period=? AND deleted_at IS NULL", period).Scan(&status); err != nil {
			return err
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
			if _, err = s.Store.GetWith(ctx, tx, "accounts", aid); err != nil {
				return err
			}
			var id string
			if err = tx.QueryRowContext(ctx, "SELECT id FROM account_balances WHERE account_id=? AND period=?", aid, period).Scan(&id); err == nil {
				_, err = tx.ExecContext(ctx, "UPDATE account_balances SET begin_balance=?,end_balance=? WHERE id=?", amount.String(), amount.String(), id)
			} else {
				id = uuid.NewString()
				_, err = tx.ExecContext(ctx, "INSERT INTO account_balances(id,period,begin_balance,debit_amount,credit_amount,end_balance,tenant_id,account_id) VALUES(?,?,?,0,0,?,?,?)", id, period, amount.String(), amount.String(), database.ZeroUUID, aid)
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
}
