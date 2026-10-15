package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
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
	return s.postShaped(ctx, tx, source, id, no, date, remark, entries, VoucherShape{})
}

// VoucherShape 描述自动过账生成凭证时**各过账点之间的形态差异**。
//
// 批次 PP（2026-10-15）：绝大多数过账点产出 type=general 且分录无 remark 的凭证，
// 但税金缴纳实测是 type=payment、分录 remark="缴纳税费"、凭证头 remark 被加工成
// 「缴纳税费（<原 remark>）」（证据：audit-batch-pp-voucher-shape-20261015.txt）。
// 三者都要按既有实现走，故不能在 post 里写死。
type VoucherShape struct {
	Type        string // 凭证 type；空则回落 "general"
	Remark      string // 凭证头 remark（调用方已加工好的最终文本）
	EntryRemark string // 分录 remark
}

// postShaped 是 post 的可定制形态版本，额外的 shape 参数用于税金缴纳等特例。
func (s *Service) postShaped(ctx context.Context, tx *sql.Tx, source, id, no, date, remark string,
	entries []Posting, shape VoucherShape) error {
	// 既有实现**跳过金额为 0 的分录**，且全部分录都为 0 时**整个凭证不产生**
	// （批次 PP 取证：audit-batch-pp-autopost4-20261015.txt）。
	//
	// 决定性证据是同一张销售退货单在「金额非 0」与「金额为 0」两种情形下的对照：
	//   明细带 price=200 → 两端都是 4 条分录、D=210 C=210（含 6001/1122 收入冲销）
	//   明细不带 price   → 金额被重算为 0，既有实现只落 2 条（1405/6401 成本冲销），
	//                      本实现仍落 4 条（多两条 0 金额行）
	// 即既有实现**确实构造**了收入冲销那两条，只是 0 金额不入账 —— 不是「不构造」。
	// 采购退货更彻底：两条分录都为 0 时既有实现凭证增量为 0（业务动作仍 code:0 成功）。
	kept := make([]Posting, 0, len(entries))
	for _, e := range entries {
		if e.Amount.IsZero() {
			continue
		}
		kept = append(kept, e)
	}
	if len(kept) == 0 {
		return nil
	}
	entries = kept
	if shape.Remark != "" {
		remark = shape.Remark
	}
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
	voucherType := shape.Type
	if voucherType == "" {
		voucherType = "general"
	}
	voucher := s.base("vouchers")
	for k, v := range map[string]any{"voucher_no": number, "type": voucherType, "voucher_date": date, "status": "posted", "remark": remark, "source_id": id, "source_type": source, "source_no": no, "total_debit": debit.String(), "total_credit": credit.String()} {
		voucher[k] = v
	}
	if err := s.Store.InsertWith(ctx, tx, "vouchers", voucher); err != nil {
		return err
	}
	return s.postVoucherEntries(ctx, tx, voucher, entries, true, shape.EntryRemark)
}

func (s *Service) postVoucherEntries(ctx context.Context, tx *sql.Tx, voucher map[string]any, entries []Posting, createLines bool, entryRemark ...string) error {
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
		// 分录 remark 默认留空 —— 现场产生的凭证里，既有实现除税金缴纳外的分录
	// remark 实测均为空（历史库里 payroll/expense_paid 那几条带 remark 的是
	// 早期数据，不能拿来定规则，见 audit-batch-pp-voucher-shape-20261015.txt）。
	lineRemark := ""
	if len(entryRemark) > 0 {
		lineRemark = entryRemark[0]
	}
	if createLines {
		line := s.base("voucher_entries")
		for k, v := range map[string]any{"sequence": i + 1, "account_code": e.Code, "account_name": account["name"], "direction": e.Direction, "amount": e.Amount.String(), "remark": lineRemark, "account_entries": account["id"], "voucher_entries": voucher["id"]} {
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
	// 回放 OO（2026-10-15）：既有实现**完全忽略** period 参数。
	// 受控对照（tools/replay-batch-oo-balance.js）：同一科目依次写入
	// 2026-10/09/11/08 四期期初余额，每次写入后 GET balance 的返回依次是
	// 10 → 09 → 09（写 11 后不变）→ 08（写 08 后变）。
	// 唯一吻合的排序是 period 升序取首条：写 11 不影响最小值，写 08 才改变它。
	// 传 2026-10 去查也照样返回 09 那条，所以 period 不入 WHERE。
	//
	// 本实现原来按 `account_id=? AND period=?` 查，而 period 默认取
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
// 回放 OO：既有实现库里存的是「当月 1 日 00:00:00 +08:00」的 RFC3339 串
// （写入 2026-10 → 存 2026-10-01T00:00:00+08:00），不是 YYYY-MM。
// 本实现原来原样存 YYYY-MM，与过账侧 accountingPeriod 生成的格式不一致，
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
