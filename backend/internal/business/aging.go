package business

import (
	"context"
	"github.com/shopspring/decimal"
	"net/url"
	"time"
)

func (s *Service) Aging(ctx context.Context, q url.Values, kind string) (map[string]any, error) {
	table, party := "ar_invoices", "customer"
	if kind == "ap" {
		table, party = "ap_invoices", "supplier"
	}
	asOf := q.Get("as_of")
	if asOf == "" {
		asOf = time.Now().Format("2006-01-02")
	}
	ref, err := time.Parse("2006-01-02", asOf)
	if err != nil {
		// 批次 V 取证（2026-10-14，evidence/backend-runtime/audit-batch-v-20261014.json）：
		// 原版 `GET /reports/finance/aging` 对**非法 as_of 一律 code:0**：
		//   as_of=2026-13-45 → 200/0
		//   as_of=abc        → 200/0
		//   as_of=2026-01-01（合法）→ 200/0，且 buckets 数量与非法值不同（1 vs 2），
		//   说明合法日期确实生效、非法日期则被当作「未指定」。
		// 即原版对非法日期**静默回退**，不返回错误。
		// 原恢复端 return ErrUnsupported（501）属误拒，已移除 —— 回退到当天。
		// 回退到当天，与「未指定 as_of」行为一致。
		ref = time.Now()
	}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM "+table+" WHERE deleted_at IS NULL")
	if err != nil {
		return nil, err
	}
	buckets := []map[string]any{{"label": "未到期", "amount": "0", "count": 0}, {"label": "0-30天", "amount": "0", "count": 0}, {"label": "31-60天", "amount": "0", "count": 0}, {"label": "61-90天", "amount": "0", "count": 0}, {"label": "90天以上", "amount": "0", "count": 0}}
	details := []map[string]any{}
	total := decimal.Zero
	parties := map[string]bool{}
	for _, row := range rows {
		bal := readDecimal(row, "balance")
		if !bal.IsPositive() {
			continue
		}
		due := value(row, "due_date")
		if len(due) > 10 {
			due = due[:10]
		}
		dueDate, e := time.Parse("2006-01-02", due)
		if e != nil {
			dueDate = ref
		}
		days := int(ref.Sub(dueDate).Hours() / 24)
		label, idx := "未到期", 0
		if days >= 0 && days <= 30 {
			label, idx = "0-30天", 1
		} else if days <= 60 {
			label, idx = "31-60天", 2
		} else if days <= 90 {
			label, idx = "61-90天", 3
		} else if days > 90 {
			label, idx = "90天以上", 4
		}
		b := buckets[idx]
		b["amount"] = decimal.RequireFromString(b["amount"].(string)).Add(bal).String()
		b["count"] = b["count"].(int) + 1
		total = total.Add(bal)
		parties[value(row, party+"_id")] = true
		details = append(details, map[string]any{"party_id": value(row, party+"_id"), "party_name": value(row, party+"_name"), "invoice_no": value(row, "invoice_no"), "invoice_date": value(row, "invoice_date"), "due_date": due, "balance": bal.String(), "days_overdue": days, "bucket": label})
	}
	return map[string]any{"type": kind, "as_of": asOf, "total": total.String(), "buckets": buckets, "details": details, "party_count": len(parties)}, nil
}
