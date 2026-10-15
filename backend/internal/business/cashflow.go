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
		// 回归回放 KK1-KK3（2026-10-14，运行快照）：
		// 现金流量表对以下三种情况**全部 code:0 正常出数**，无一报错：
		//   KK1  1001↔6401（对方科目在本实现白名单之外）→ 归**经营**，Δ经营 +7
		//   KK1b 1001↔6602（对方科目在白名单之外）      → 归**经营**，Δ经营 +9
		//   KK2  同一凭证含 1001 与 1002 两个现金科目     → 归经营，Δ经营 +7（取 1001 那条）
		//   KK3  现金凭证为四行（非两行）                → 归经营，Δ经营 +5
		// 即既有实现语义是「白名单外归经营、多个现金科目取其一、非两行也照算」，
		// 而本实现原先三处均 return ErrUnsupported，会让**整张现金流量表失败**。
		// 三个守卫均属误拒，已移除；无法确定「多个现金科目取哪一条」的既有实现规则，
		// 此处沿用本实现原有的「首个命中即采用」顺序（与 KK2 实测的 +7 一致）。
		var cash []map[string]any
		for _, e := range entries {
			if value(e, "account_code") == "1001" || value(e, "account_code") == "1002" {
				cash = append(cash, e)
			}
		}
		if len(cash) == 0 {
			continue
		}
		entry := cash[0]
		contra := map[string]any{}
		for _, e := range entries {
			if value(e, "id") != value(entry, "id") {
				contra = e
				break
			}
		}
		category := "operating"
		switch value(contra, "account_code") {
		case "1601":
			category = "investing"
		case "2001":
			category = "financing"
		}
		// 1122/2202/6001 与**任何其他科目**都归经营（KK1/KK1b 实测）。
		f := totals[category]
		if value(entry, "direction") == "debit" {
			f.in = f.in.Add(readDecimal(entry, "amount"))
		} else {
			f.out = f.out.Add(readDecimal(entry, "amount"))
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
