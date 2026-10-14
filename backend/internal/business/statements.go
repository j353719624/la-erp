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
	// 批次 V 取证（2026-10-14，evidence/backend-runtime/audit-batch-v-20261014.json）：
	// 原版 `GET /reports/finance/statement/{customer|supplier}` 对**非法日期一律 code:0**
	// （start_date=bad / end_date=bad / start_date=2026-13-45 均 200/0），
	// 即静默忽略、视为未指定 —— 与 aging 端点行为一致（同批取证）。
	// 原恢复端 return ErrUnsupported（501）属误拒，已移除。
	// 实际过滤在下方构造 where 时进行（必须在那里做，否则非法值会进 SQL 反而清空结果集）。
	where, args := []string{}, []any{}
	if id := q.Get(party + "_id"); id != "" {
		where = append(where, "party_id=?")
		args = append(args, id)
	}
	if end := q.Get("end_date"); end != "" {
		// 批次 V：原版对非法日期静默忽略（视为未指定）。
		// 这里必须显式判断 —— 若把非法值传给 `date(?)`，MySQL 返回 NULL，
		// 条件 `date(event_date) <= NULL` 恒为假，会把整个结果集清空（与原版不符）。
		if _, err := time.Parse("2006-01-02", end); err == nil {
			where = append(where, "date(event_date)<=date(?)")
			args = append(args, end)
		}
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
