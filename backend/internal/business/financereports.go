package business

import (
	"context"
	"github.com/shopspring/decimal"
	"net/url"
	"strings"
)

func (s *Service) FinanceReport(ctx context.Context, q url.Values, mode string) (any, error) {
	// The original ignores period; only the date bounds filter journal rows.
	accounts, err := s.Store.Rows(ctx, "SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY code")
	if err != nil {
		return nil, err
	}
	where := []string{"v.deleted_at IS NULL", "v.status IN ('posted','approved')"}
	args := []any{}
	for _, bound := range []struct{ key, op string }{{"end_date", "<="}} {
		if v := q.Get(bound.key); v != "" {
			where = append(where, "date(j.entry_date)"+bound.op+"date(?)")
			args = append(args, v)
		}
	}
	entries, err := s.Store.Rows(ctx, "SELECT j.* FROM journal_entries j JOIN voucher_journal_entries l ON l.journal_entry_id=j.id JOIN vouchers v ON v.id=l.voucher_id WHERE "+strings.Join(where, " AND "), args...)
	if err != nil {
		return nil, err
	}
	type movement struct{ debit, credit decimal.Decimal }
	moves := map[string]movement{}
	opening := map[string]decimal.Decimal{}
	for _, e := range entries {
		code := value(e, "account_code")
		date := value(s.Store.Public("journal_entries", e), "entry_date")
		if len(date) > 10 {
			date = date[:10]
		}
		if start := q.Get("start_date"); start != "" && date < start && mode != "balance-sheet" {
			if value(e, "direction") == "debit" {
				opening[code] = opening[code].Add(readDecimal(e, "amount"))
			} else {
				opening[code] = opening[code].Sub(readDecimal(e, "amount"))
			}
			continue
		}
		m := moves[code]
		if value(e, "direction") == "debit" {
			m.debit = m.debit.Add(readDecimal(e, "amount"))
		} else {
			m.credit = m.credit.Add(readDecimal(e, "amount"))
		}
		moves[code] = m
	}
	rows := []map[string]any{}
	totalD, totalC := decimal.Zero, decimal.Zero
	assets, liabilities, equity, revenue, cost, expense := decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero
	for _, a := range accounts {
		code, category := value(a, "code"), value(a, "category")
		m := moves[code]
		net := m.debit.Sub(m.credit)
		if mode == "trial-balance" {
			net = net.Add(opening[code])
		}
		direction := "debit"
		if category == "liability" || category == "equity" || category == "income" {
			direction = "credit"
		}
		if net.IsPositive() {
			direction = "debit"
		} else if net.IsNegative() {
			direction = "credit"
		}
		rows = append(rows, map[string]any{"account_code": code, "account_name": a["name"], "category": category, "begin_balance": opening[code].Abs().String(), "debit_amount": m.debit.String(), "credit_amount": m.credit.String(), "end_balance": net.Abs().String(), "end_direction": direction})
		totalD = totalD.Add(m.debit)
		totalC = totalC.Add(m.credit)
		switch category {
		case "asset":
			assets = assets.Add(net)
		case "liability":
			liabilities = liabilities.Sub(net)
		case "equity":
			equity = equity.Sub(net)
		case "income":
			revenue = revenue.Sub(net)
		}
		if strings.HasPrefix(code, "640") {
			cost = cost.Add(net)
		}
		if strings.HasPrefix(code, "660") || strings.HasPrefix(code, "671") {
			expense = expense.Add(net)
		}
	}
	profit := revenue.Sub(cost).Sub(expense)
	switch mode {
	case "trial-balance":
		return map[string]any{"rows": rows, "total_debit": totalD.String(), "total_credit": totalC.String()}, nil
	case "profit-loss":
		rate := decimal.Zero
		if revenue.IsPositive() {
			rate = profit.Mul(decimal.NewFromInt(100)).DivRound(revenue, 2)
		}
		period := q.Get("start_date")
		if len(period) > 7 {
			period = period[:7]
		}
		return map[string]any{"period": period, "revenue": revenue.String(), "cost": cost.String(), "gross_profit": revenue.Sub(cost).String(), "expense": expense.String(), "net_profit": profit.String(), "profit_rate": rate.String()}, nil
	case "balance-sheet":
		return map[string]any{"assets": assets.String(), "liabilities": liabilities.String(), "equity": equity.Add(profit).String(), "unclosed_profit": profit.String()}, nil
	}
	// 批次 V 取证（2026-10-14，evidence/backend-runtime/audit-batch-v-20261014.json）：
	// 原版 `reports/finance/` 只挂 5 个模式（profit-loss / balance-sheet / trial-balance /
	// cash-flow / general-ledger）；income / bogus / profit / revenue 等其它名称
	// 全部由路由层直接 404「路由不存在」，**不进入本分支**。
	// 即本 default 分支**不可达**，属防御性断言，保留 ErrUnsupported 作兜底。

	return nil, ErrUnsupported
}
