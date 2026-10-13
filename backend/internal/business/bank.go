package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
	"net/url"
	"strconv"
)

func (s *Service) BankAccounts(ctx context.Context) ([]map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT * FROM bank_accounts WHERE deleted_at IS NULL ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, row := range rows {
		out = append(out, s.Store.Public("bank_accounts", row))
	}
	return out, nil
}
func (s *Service) CreateBankAccount(ctx context.Context, input map[string]any) (map[string]any, error) {
	row := s.base("bank_accounts")
	row["currency"] = "CNY"
	row["is_active"] = true
	for _, field := range []string{"bank_name", "account_name", "remark"} {
		row[field] = ""
	}
	for _, field := range []string{"account_no", "bank_name", "account_name", "currency", "is_active", "remark"} {
		if v := input[field]; v != nil {
			row[field] = v
		}
	}
	rate, err := Number(input["opening_balance"])
	if err != nil {
		return nil, err
	}
	row["opening_balance"] = rate.String()
	if err = s.Store.Insert(ctx, "bank_accounts", row); err != nil {
		return nil, err
	}
	row, err = s.Store.Get(ctx, "bank_accounts", value(row, "id"))
	if err != nil {
		return nil, err
	}
	return s.Store.Public("bank_accounts", row), nil
}
func (s *Service) CreateBankStatement(ctx context.Context, input map[string]any) (map[string]any, error) {
	id := ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, "bank_accounts", value(input, "account_id")); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				return errors.New("银行账户不存在")
			}
			return err
		}
		amount, err := Number(input["amount"])
		if err != nil {
			return err
		}
		if amount.IsZero() {
			return errors.New("对账单金额不能为0")
		}
		balance, err := Number(input["balance_after"])
		if err != nil {
			return err
		}
		row := s.base("bank_statements")
		row["account_id"] = value(input, "account_id")
		row["statement_date"] = "0001-01-01T00:00:00Z"
		row["amount"] = amount.String()
		row["balance_after"] = balance.String()
		row["reconciled"] = false
		for _, field := range []string{"transaction_no", "description", "remark"} {
			row[field] = ""
		}
		for _, field := range []string{"statement_date", "transaction_no", "description", "remark"} {
			if v := input[field]; v != nil {
				row[field] = v
			}
		}
		id = value(row, "id")
		return s.Store.InsertWith(ctx, tx, "bank_statements", row)
	})
	if err != nil {
		return nil, err
	}
	row, err := s.Store.Get(ctx, "bank_statements", id)
	if err != nil {
		return nil, err
	}
	return s.Store.Public("bank_statements", row), nil
}
func (s *Service) DeleteBankRecord(ctx context.Context, table, id string) error {
	if table != "bank_accounts" && table != "bank_statements" {
		return ErrUnsupported
	}
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if table == "bank_accounts" {
			var count int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM bank_statements WHERE account_id=? AND deleted_at IS NULL", id).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				return errors.New("该账户存在对账单记录，不能删除")
			}
		}
		result, err := tx.ExecContext(ctx, "UPDATE "+database.Quote(table)+" SET deleted_at=?,updated_at=? WHERE id=?", now(), now(), id)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err == nil && count == 0 {
			return database.ErrNotFound
		}
		return err
	})
}
func (s *Service) BankStatements(ctx context.Context, q url.Values) (map[string]any, error) {
	where := "deleted_at IS NULL"
	args := []any{}
	if id := q.Get("account_id"); id != "" {
		where += " AND account_id=?"
		args = append(args, id)
	}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM bank_statements WHERE "+where+" ORDER BY julianday(statement_date) DESC,created_at ASC", args...)
	if err != nil {
		return nil, err
	}

	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(q.Get("page_size"))
	if size < 1 {
		size = 10
	}
	if size > 1000 {
		size = 1000
	}
	start := (page - 1) * size
	if start > len(rows) || start < 0 {
		start = len(rows)
	}
	end := start + size
	if end > len(rows) {
		end = len(rows)
	}
	out := []map[string]any{}
	for _, row := range rows[start:end] {
		out = append(out, s.Store.Public("bank_statements", row))
	}
	return map[string]any{"total": len(rows), "list": out}, nil
}
func (s *Service) BankSummary(ctx context.Context, id string) (map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT * FROM bank_statements WHERE account_id=? AND deleted_at IS NULL", id)
	if err != nil {
		return nil, err
	}
	total, reconciled := decimal.Zero, decimal.Zero
	count := 0
	for _, row := range rows {
		amount := readDecimal(row, "amount")
		total = total.Add(amount)
		if value(row, "reconciled") == "1" || value(row, "reconciled") == "true" {
			count++
			reconciled = reconciled.Add(amount)
		}
	}
	return map[string]any{"statement_count": len(rows), "reconciled_count": count, "total_amount": total.String(), "reconciled_amount": reconciled.String(), "unreconciled_amount": total.Sub(reconciled).String()}, nil
}

func (s *Service) ReconcileBank(ctx context.Context, id string) (int, error) {
	matched := 0
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		statements, err := database.QueryRows(ctx, tx, "SELECT * FROM bank_statements WHERE account_id=? AND deleted_at IS NULL AND reconciled=0 ORDER BY julianday(statement_date) ASC,created_at ASC", id)
		if err != nil {
			return err
		}
		for _, spec := range []struct {
			table, number string
			positive      bool
		}{{"payment_receipts", "receipt_no", true}, {"payment_payments", "payment_no", false}} {
			payments, err := database.QueryRows(ctx, tx, "SELECT * FROM "+spec.table+" WHERE status='confirmed' AND deleted_at IS NULL ORDER BY created_at ASC")
			if err != nil {
				return err
			}
			// Ambiguous candidates sharing an amount need a separate captured contract.
			candidates := map[string]int{}
			for _, payment := range payments {
				candidates[readDecimal(payment, "amount").String()]++
			}
			for _, payment := range payments {
				target := readDecimal(payment, "amount")
				if !spec.positive {
					target = target.Neg()
				}
				for _, statement := range statements {
					if value(statement, "reconciled") == "true" || value(statement, "reconciled") == "1" {
						continue
					}
					if !readDecimal(statement, "amount").Equal(target) {
						continue
					}
					if candidates[readDecimal(payment, "amount").String()] > 1 || value(payment, "currency_code") != "CNY" {
						return ErrUnsupported
					}
					if err := s.Store.UpdateWith(ctx, tx, "bank_statements", value(statement, "id"), map[string]any{"reconciled": true, "matched_ref": value(payment, spec.number), "updated_at": now()}); err != nil {
						return err
					}
					statement["reconciled"] = true
					matched++
					break
				}
			}
		}
		return nil
	})
	return matched, err
}
