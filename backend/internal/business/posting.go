package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
	"time"
)

type Posting struct {
	Code, Direction string
	Amount          decimal.Decimal
}

func accountingPeriod(date string) (string, error) {
	t, err := time.Parse(time.RFC3339Nano, date)
	if err != nil {
		return "", err
	}
	t = t.In(time.FixedZone("CST", 8*3600))
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location()).Format(time.RFC3339), nil
}

// post writes the original's journal, posted voucher, links and monthly balances
// together with the business transaction. A failed leg rolls everything back.
func (s *Service) post(ctx context.Context, tx *sql.Tx, source, id, no, date, remark string, entries []Posting) error {
	debit, credit := decimal.Zero, decimal.Zero
	for _, e := range entries {
		if e.Amount.IsNegative() {
			return errors.New("记账金额不能为负")
		}
		if e.Direction == "debit" {
			debit = debit.Add(e.Amount)
		} else if e.Direction == "credit" {
			credit = credit.Add(e.Amount)
		} else {
			return errors.New("记账方向错误")
		}
	}
	if !debit.Equal(credit) {
		return errors.New("凭证借贷不平衡")
	}
	if _, err := accountingPeriod(date); err != nil {
		return err
	}
	number, err := s.nextNumber(ctx, tx, "VOU")
	if err != nil {
		return err
	}
	voucher := s.base("vouchers")
	for k, v := range map[string]any{"voucher_no": number, "type": "general", "voucher_date": date, "status": "posted", "remark": remark, "source_id": id, "source_type": source, "source_no": no, "total_debit": debit.String(), "total_credit": credit.String()} {
		voucher[k] = v
	}
	if err := s.Store.InsertWith(ctx, tx, "vouchers", voucher); err != nil {
		return err
	}
	return s.postVoucherEntries(ctx, tx, voucher, entries, true)
}

func (s *Service) postVoucherEntries(ctx context.Context, tx *sql.Tx, voucher map[string]any, entries []Posting, createLines bool) error {
	date := value(s.Store.Public("vouchers", voucher), "voucher_date")
	period, err := accountingPeriod(date)
	if err != nil {
		return err
	}
	source, id, number, remark := value(voucher, "source_type"), value(voucher, "source_id"), value(voucher, "voucher_no"), value(voucher, "remark")
	for i, e := range entries {
		accounts, err := database.QueryRows(ctx, tx, "SELECT * FROM accounts WHERE code=? AND deleted_at IS NULL", e.Code)
		if err != nil {
			return err
		}
		if len(accounts) != 1 {
			return errors.New("记账科目不存在或重复：" + e.Code)
		}
		account := accounts[0]
		journal := s.base("journal_entries")
		for k, v := range map[string]any{"entry_date": date, "account_code": e.Code, "account_name": account["name"], "direction": e.Direction, "amount": e.Amount.String(), "voucher_no": number, "source_id": id, "source_type": source, "remark": remark} {
			journal[k] = v
		}
		if id == "" {
			journal["source_id"] = nil
			journal["remark"] = ""
		}
		if err := s.Store.InsertWith(ctx, tx, "journal_entries", journal); err != nil {
			return err
		}
		if createLines {
			line := s.base("voucher_entries")
			for k, v := range map[string]any{"sequence": i + 1, "account_code": e.Code, "account_name": account["name"], "direction": e.Direction, "amount": e.Amount.String(), "remark": "", "account_entries": account["id"], "voucher_entries": voucher["id"]} {
				line[k] = v
			}
			if err := s.Store.InsertWith(ctx, tx, "voucher_entries", line); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO voucher_journal_entries(voucher_id,journal_entry_id) VALUES(?,?)", voucher["id"], journal["id"]); err != nil {
			return err
		}
		rows, err := database.QueryRows(ctx, tx, "SELECT * FROM account_balances WHERE account_id=? AND period=?", account["id"], period)
		if err != nil {
			return err
		}
		var b map[string]any
		if len(rows) == 0 {
			b = s.base("account_balances")
			b["account_id"] = account["id"]
			b["period"] = period
			// Original carries the immediately preceding month's closing balance
			// only when this month's row is first created. A gap yields zero;
			// later backdated postings do not rewrite an existing opening balance.
			month, err := time.Parse(time.RFC3339, period)
			if err != nil {
				return err
			}
			previous, err := database.QueryRows(ctx, tx, "SELECT * FROM account_balances WHERE account_id=? AND period=?", account["id"], month.AddDate(0, -1, 0).Format(time.RFC3339))
			if err != nil {
				return err
			}
			if len(previous) > 0 {
				opening := readDecimal(previous[0], "end_balance").String()
				b["begin_balance"], b["end_balance"] = opening, opening
			}
			if err := s.Store.InsertWith(ctx, tx, "account_balances", b); err != nil {
				return err
			}
		} else {
			b = rows[0]
		}
		d, c := readDecimal(b, "debit_amount"), readDecimal(b, "credit_amount")
		if e.Direction == "debit" {
			d = d.Add(e.Amount)
		} else {
			c = c.Add(e.Amount)
		}
		if err := s.Store.UpdateWith(ctx, tx, "account_balances", value(b, "id"), map[string]any{"debit_amount": d.String(), "credit_amount": c.String(), "end_balance": readDecimal(b, "begin_balance").Add(d).Sub(c).String()}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) AccountBalance(ctx context.Context, id, period string) (map[string]any, error) {
	if _, err := s.Store.Get(ctx, "accounts", id); err != nil {
		// 见 service.go 里 ErrAccountNotFound 的注释：本路由的 notFound 形态是
		// 200 + code 10000，与 GET /accounts/{id} 的 404 不同。
		return nil, ErrAccountNotFound
	}
	// 回放 OO（2026-10-15）：原版**完全忽略** period 参数。
	// 受控对照（tools/replay-batch-oo-balance.js）：同一科目依次写入
	// 2026-10/09/11/08 四期期初余额，每次写入后 GET balance 的返回依次是
	// 10 → 09 → 09（写 11 后不变）→ 08（写 08 后变）。
	// 唯一吻合的排序是 period 升序取首条：写 11 不影响最小值，写 08 才改变它。
	// 传 2026-10 去查也照样返回 09 那条，所以 period 不入 WHERE。
	//
	// 恢复端原来按 `account_id=? AND period=?` 查，而 period 默认取
	// accountingPeriod(now())（格式 2026-10-01T00:00:00+08:00），
	// 但 SetOpeningBalances 写入的是入参原样（2026-10），两者对不上 → 恒为 null。
	_ = period
	rows, err := s.Store.Rows(ctx, "SELECT * FROM account_balances WHERE account_id=? ORDER BY period ASC LIMIT 1", id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return s.Store.Public("account_balances", rows[0]), nil
}

// balancePeriodText 把入参 period 归一化成 account_balances 的存储格式。
//
// 回放 OO：原版库里存的是「当月 1 日 00:00:00 +08:00」的 RFC3339 串
// （写入 2026-10 → 存 2026-10-01T00:00:00+08:00），不是 YYYY-MM。
// 恢复端原来原样存 YYYY-MM，与过账侧 accountingPeriod 生成的格式不一致，
// 导致过账时 `WHERE account_id=? AND period=?` 命中不到期初行。
func BalancePeriodText(period string) string {
	zone := time.FixedZone("CST", 8*3600)
	if t, err := time.Parse("2006-01", period); err == nil {
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, zone).Format(time.RFC3339)
	}
	if t, err := time.Parse(time.RFC3339, period); err == nil {
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, zone).Format(time.RFC3339)
	}
	return period
}
