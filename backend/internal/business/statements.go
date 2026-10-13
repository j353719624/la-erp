package business

import (
	"context"
	"github.com/shopspring/decimal"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Statement totals use invoice face amounts and confirmed payment headers.
// The original exposes each invoice's present balance, not a running balance,
// and preserves null lines for a party with only opening activity.
func (s *Service) Statement(ctx context.Context, q url.Values, party string) (any, error) {
	invoice, payment, payDate, payNo, payType := "ar_invoices", "payment_receipts", "receipt_date", "receipt_no", "receipt"
	if party == "supplier" {
		invoice, payment, payDate, payNo, payType = "ap_invoices", "payment_payments", "payment_date", "payment_no", "payment"
	}
	for _, key := range []string{"start_date", "end_date"} {
		if v := q.Get(key); v != "" {
			if _, err := time.Parse("2006-01-02", v); err != nil {
				return nil, ErrUnsupported
			}
		}
	}
	where, args := []string{}, []any{}
	if id := q.Get(party + "_id"); id != "" {
		where = append(where, "party_id=?")
		args = append(args, id)
	}
	if end := q.Get("end_date"); end != "" {
		where = append(where, "date(event_date)<=date(?)")
		args = append(args, end)
	}
	sql := "SELECT * FROM (SELECT " + party + "_id AS party_id," + party + "_name AS party_name,invoice_date AS event_date,invoice_no AS no,COALESCE(source_no,'') AS source_no,'invoice' AS type,total_amount AS amount,balance,created_at AS event_created FROM " + invoice + " WHERE deleted_at IS NULL UNION ALL SELECT " + party + "_id," + party + "_name," + payDate + "," + payNo + ",'','" + payType + "',amount,0,created_at FROM " + payment + " WHERE deleted_at IS NULL AND status='confirmed')"
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	sql += " ORDER BY CASE type WHEN 'invoice' THEN 0 ELSE 1 END,event_created,no"
	rows, err := s.Store.Rows(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	type group struct {
		id, name       string
		begin, in, out decimal.Decimal
		lines          []map[string]any
	}
	groups := map[string]*group{}
	for _, row := range rows {
		id := value(row, "party_id")
		g := groups[id]
		if g == nil {
			g = &group{id: id, name: value(row, "party_name")}
			groups[id] = g
		}
		date := value(row, "event_date")
		if t, ok := row["event_date"].(time.Time); ok {
			date = t.Format("2006-01-02")
		}
		if len(date) > 10 {
			date = date[:10]
		}
		amount := readDecimal(row, "amount")
		incoming := value(row, "type") == "invoice"
		if start := q.Get("start_date"); start != "" && date < start {
			if incoming {
				g.begin = g.begin.Add(amount)
			} else {
				g.begin = g.begin.Sub(amount)
			}
			continue
		}
		if incoming {
			g.in = g.in.Add(amount)
		} else {
			g.out = g.out.Add(amount)
		}
		g.lines = append(g.lines, map[string]any{"date": date, "no": value(row, "no"), "source_no": value(row, "source_no"), "type": value(row, "type"), "amount": amount.String(), "balance": readDecimal(row, "balance").String()})
	}
	keys := []string{}
	for id := range groups {
		keys = append(keys, id)
	}
	sort.Slice(keys, func(i, j int) bool { return groups[keys[i]].name < groups[keys[j]].name })
	out := []map[string]any{}
	for _, id := range keys {
		g := groups[id]
		out = append(out, map[string]any{party + "_id": g.id, party + "_name": g.name, "begin_balance": g.begin.String(), "period_in": g.in.String(), "period_out": g.out.String(), "end_balance": g.begin.Add(g.in).Sub(g.out).String(), "lines": g.lines})
	}
	return out, nil
}
