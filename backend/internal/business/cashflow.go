package business

import (
	"context"
	"github.com/shopspring/decimal"
	"net/url"
	"strings"
)

func (s *Service) CashFlow(ctx context.Context, q url.Values) (any, error) {
	where := []string{"v.deleted_at IS NULL", "v.status IN ('posted','approved')"}
	args := []any{}
	for _, b := range []struct{ key, op string }{{"start_date", ">="}, {"end_date", "<="}} {
		if v := q.Get(b.key); v != "" {
			where = append(where, "date(j.entry_date)"+b.op+"date(?)")
			args = append(args, v)
		}
	}
	rows, err := s.Store.Rows(ctx, "SELECT j.*,v.id AS report_voucher_id FROM journal_entries j JOIN voucher_journal_entries l ON l.journal_entry_id=j.id JOIN vouchers v ON v.id=l.voucher_id WHERE "+strings.Join(where, " AND "), args...)
	if err != nil {
		return nil, err
	}
	vouchers := map[string][]map[string]any{}
	for _, r := range rows {
		id := value(r, "report_voucher_id")
		vouchers[id] = append(vouchers[id], r)
	}
	type flow struct{ in, out decimal.Decimal }
	totals := map[string]flow{}
	for _, entries := range vouchers {
		var cash map[string]any
		for _, e := range entries {
			if value(e, "account_code") == "1001" || value(e, "account_code") == "1002" {
				if cash != nil {
					return nil, ErrUnsupported
				}
				cash = e
			}
		}
		if cash == nil {
			continue
		}
		if len(entries) != 2 {
			return nil, ErrUnsupported
		}
		var contra map[string]any
		for _, e := range entries {
			if value(e, "id") != value(cash, "id") {
				contra = e
			}
		}
		category := "operating"
		switch value(contra, "account_code") {
		case "1601":
			category = "investing"
		case "2001":
			category = "financing"
		case "1122", "2202", "6001":
		default:
			return nil, ErrUnsupported
		}
		f := totals[category]
		if value(cash, "direction") == "debit" {
			f.in = f.in.Add(readDecimal(cash, "amount"))
		} else {
			f.out = f.out.Add(readDecimal(cash, "amount"))
		}
		totals[category] = f
	}
	items := []map[string]any{}
	net := decimal.Zero
	for i, c := range []string{"operating", "investing", "financing"} {
		f := totals[c]
		n := f.in.Sub(f.out)
		net = net.Add(n)
		items = append(items, map[string]any{"category": c, "label": []string{"经营活动", "投资活动", "筹资活动"}[i], "inflow": f.in.String(), "outflow": f.out.String(), "net": n.String()})
	}
	return map[string]any{"items": items, "net_increase": net.String()}, nil
}
