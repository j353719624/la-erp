package business

import (
	"context"
	"github.com/shopspring/decimal"
	"net/url"
	"strings"
)

func (s *Service) GeneralLedger(ctx context.Context, q url.Values) (any, error) {
	where := []string{"j.account_code=?", "v.deleted_at IS NULL", "v.status IN ('posted','approved')"}
	args := []any{q.Get("account_code")}
	for _, bound := range []struct{ key, op string }{{"start_date", ">="}, {"end_date", "<="}} {
		if value := q.Get(bound.key); value != "" {
			where = append(where, "date(j.entry_date)"+bound.op+"date(?)")
			args = append(args, value)
		}
	}
	rows, err := s.Store.Rows(ctx, "SELECT j.* FROM journal_entries j JOIN voucher_journal_entries l ON l.journal_entry_id=j.id JOIN vouchers v ON v.id=l.voucher_id WHERE "+strings.Join(where, " AND ")+" ORDER BY j.entry_date,j.id", args...)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	balance := decimal.Zero
	for _, r := range rows {
		r = s.Store.Public("journal_entries", r)
		amount := readDecimal(r, "amount")
		if value(r, "direction") == "debit" {
			balance = balance.Add(amount)
		} else {
			balance = balance.Sub(amount)
		}
		out = append(out, map[string]any{"entry_date": r["entry_date"], "voucher_no": r["voucher_no"], "remark": value(r, "remark"), "direction": r["direction"], "amount": amount.String(), "balance": balance.String()})
	}
	return out, nil
}
