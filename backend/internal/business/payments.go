package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
	"time"
)

type FinanceSpec struct {
	Table, Lines, Party, Invoice, Paid, Number, Prefix, Date, Type string
	Receipt                                                        bool
}

var Finances = map[string]FinanceSpec{
	"payment-receipts": {"payment_receipts", "payment_receipt_lines", "customer", "ar_invoices", "received_amount", "receipt_no", "RC", "receipt_date", "receipt_type", true},
	"payments":         {"payment_payments", "payment_payment_lines", "supplier", "ap_invoices", "paid_amount", "payment_no", "PY", "payment_date", "payment_type", false},
}

func InvoiceParty(table string) string {
	if table == "ar_invoices" {
		return "customer"
	}
	return "supplier"
}
func ValidFinanceDates(input map[string]any, fields ...string) error {
	for _, field := range fields {
		if input[field] != nil {
			if _, err := time.Parse(time.RFC3339Nano, value(input, field)); err != nil {
				return err
			}
		}
	}
	return nil
}
func (s *Service) GetInvoice(ctx context.Context, table, id string) (map[string]any, error) {
	r, err := s.Store.Get(ctx, table, id)
	if err != nil {
		return nil, err
	}
	return s.Store.Public(table, r), nil
}
func (s *Service) CreateInvoice(ctx context.Context, table string, input map[string]any) (map[string]any, error) {
	id := ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		// 回归回放 BB1/BB1b（2026-10-14）：发票允许任意 currency_code/exchange_rate
		// 且 code:0。表结构无这两列，故既有实现静默忽略落库值；汇率的实际作用点在核销
		// （USD@7.2 发票用 10 元收款核销后 received_amount=72），由收款单侧
		// PaymentTransition 负责折算。本实现原先直接拒绝非 CNY 发票，属误拒，已移除。
		// 仅在汇率无法解析为正数时拒绝（避免把错误值静默当成 1）。
		if raw := value(input, "exchange_rate"); raw != "" {
			parsed, err := decimal.NewFromString(raw)
			if err != nil || !parsed.IsPositive() {
				return errors.New("汇率必须大于零")
			}
		}
		party := InvoiceParty(table)
		if _, err := s.Store.GetWith(ctx, tx, party+"s", value(input, party+"_id")); err != nil {
			return errors.New("往来单位不存在")
		}
		amount, err := Number(input["total_amount"])
		if err != nil {
			return err
		}
		if !amount.IsPositive() {
			return errors.New("金额必须大于零")
		}
		// 回归回放 BB2/BB2b（2026-10-14）：发票允许带 source_type/source_id/source_no，
		// 三者**全部真实落库**且可按 source_type 过滤（实测过滤命中 26 条）。
		// 原本实现一律拒绝，属误拒，已移除。
		prefix, paid := "AP", "paid_amount"
		if table == "ar_invoices" {
			prefix, paid = "AR", "received_amount"
		}
		no, err := s.nextNumber(ctx, tx, prefix)
		if err != nil {
			return err
		}
		h := s.base(table)
		for _, k := range []string{party + "_id", party + "_name", "invoice_date", "due_date", "remark"} {
			if input[k] != nil {
				h[k] = input[k]
			}
		}
		h["invoice_no"], h["total_amount"], h[paid], h["balance"], h["status"], h["invoice_status"] = no, amount.String(), "0", amount.String(), "unpaid", "uninvoiced"
		// 既有实现 BB2b：source_type/source_id/source_no 三列真实落库；不传时 source_id 归零 UUID。
		h["source_id"] = database.ZeroUUID
		for _, k := range []string{"source_type", "source_id", "source_no"} {
			if value(input, k) != "" {
				h[k] = input[k]
			}
		}
		if err := s.Store.InsertWith(ctx, tx, table, h); err != nil {
			return err
		}
		id = value(h, "id")
		// The original posts AR revenue on creation; manually created AP has no posting.
		if table == "ar_invoices" {
			return s.post(ctx, tx, "ar_invoice", id, no, value(h, "invoice_date"), "应收开票确认收入", []Posting{{"1122", "debit", amount}, {"6001", "credit", amount}})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetInvoice(ctx, table, id)
}
func (s *Service) GetPayment(ctx context.Context, d FinanceSpec, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, d.Table, id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public(d.Table, h)
	edges := map[string]any{}
	p, err := s.Store.Get(ctx, d.Party+"s", value(h, d.Party+"_id"))
	if err != nil {
		return nil, err
	}
	edges[d.Party] = s.Store.Public(d.Party+"s", p)
	rows, err := s.Store.Rows(ctx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.Lines)+"=? ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	lines := []map[string]any{}
	for _, l := range rows {
		v := s.Store.Public(d.Lines, l)
		delete(v, d.Lines)
		lines = append(lines, v)
	}
	if len(lines) > 0 {
		edges["lines"] = lines
	}
	pub["edges"] = edges
	return pub, nil
}

// paymentTypeNames 归一化常见的英文/拼音方式名为既有实现中文值（2026-10-13 回放映射表：
// bank→银行转账、alipay→支付宝、wechat→微信支付、cash→现金、check→支票、other→其他；
// 其余取值原样落库，既有实现不作白名单校验）。
var paymentTypeNames = map[string]string{
	"bank": "银行转账", "alipay": "支付宝", "wechat": "微信支付",
	"cash": "现金", "check": "支票", "other": "其他",
}

func (s *Service) CreatePayment(ctx context.Context, d FinanceSpec, input map[string]any) (map[string]any, error) {
	id := ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		// 既有实现接受任意收付款方式并原样落库（2026-10-13 M1-M4 回放：cash/check/garbage
		// 均 code:0），仅对上述常见英文名归一化；不传时留空（既有实现同样不落默认值）。
		currency := value(input, "currency_code")
		if currency == "" {
			currency = "CNY"
		}
		rate := decimal.NewFromInt(1)
		if input["exchange_rate"] != nil && value(input, "exchange_rate") != "" {
			parsed, err := decimal.NewFromString(value(input, "exchange_rate"))
			if err != nil || !parsed.IsPositive() {
				return errors.New("汇率必须大于零")
			}
			rate = parsed
		}
		// 既有实现接受 CNY 搭配非 1 汇率并落库（2026-10-13 M5 回放：CNY@7.5 → rate=7.5
		// 持久化）；确认时对 CNY 忽略汇率（实测凭证借=贷=原币金额，见 PaymentTransition）。
		if _, err := s.Store.GetWith(ctx, tx, d.Party+"s", value(input, d.Party+"_id")); err != nil {
			return errors.New("往来单位不存在")
		}
		account, err := s.Store.GetWith(ctx, tx, "accounts", value(input, "cash_account_id"))
		if err != nil {
			return errors.New("现金科目不存在")
		}
		amount, err := Number(input["amount"])
		if err != nil {
			return err
		}
		if !amount.IsPositive() {
			return errors.New("金额必须大于零")
		}
		raw, ok := input["lines"].([]any)
		// 回归回放 BB3/BB3b（2026-10-14）：lines 为空数组时既有实现 code:0，
		// 回读 status=draft、edges.lines 为 null，确认动作同样通过。
		// 原本实现返回 ErrUnsupported，属误拒，已移除。仅 lines 不是数组时拒绝。
		if input["lines"] != nil && !ok {
			return errors.New("明细格式错误")
		}
		if !ok {
			raw = nil
		}
		if len(raw) > 1000 {
			return errors.New("明细过多")
		}
		h := s.base(d.Table)
		no, err := s.nextNumber(ctx, tx, d.Prefix)
		if err != nil {
			return err
		}
		for _, k := range []string{d.Party + "_id", d.Party + "_name", d.Date, "remark"} {
			if input[k] != nil {
				h[k] = input[k]
			}
		}
		kind := value(input, d.Type)
		if normalized, ok := paymentTypeNames[kind]; ok {
			kind = normalized
		}
		h[d.Number], h["amount"], h[d.Type], h["currency_code"], h["exchange_rate"], h["status"] = no, amount.String(), kind, currency, rate.String(), "draft"
		h["cash_account_id"], h["cash_account_code"], h["cash_account_name"] = account["id"], value(input, "cash_account_code"), value(input, "cash_account_name")
		if err := s.Store.InsertWith(ctx, tx, d.Table, h); err != nil {
			return err
		}
		id = value(h, "id")
		sum := decimal.Zero
		field := "ap_invoice_id"
		noField := "ap_invoice_no"
		if d.Receipt {
			field, noField = "ar_invoice_id", "ar_invoice_no"
		}
		for i, v := range raw {
			input, ok := v.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			invoice, err := s.Store.GetWith(ctx, tx, d.Invoice, value(input, field))
			if err != nil {
				return err
			}
			if value(invoice, d.Party+"_id") != value(h, d.Party+"_id") {
				return errors.New("核销单据往来单位不一致")
			}
			a, err := Number(input["amount"])
			if err != nil {
				return err
			}
			if !a.IsPositive() {
				return errors.New("核销金额必须大于零")
			}
			sum = sum.Add(a)
			l := s.base(d.Lines)
			l[d.Lines], l["line_no"], l[field], l[noField], l["amount"] = id, i+1, invoice["id"], invoice["invoice_no"], a.String()
			if input["remark"] != nil {
				l["remark"] = input["remark"]
			}
			if err := s.Store.InsertWith(ctx, tx, d.Lines, l); err != nil {
				return err
			}
		}
		// 回归回放 BB4/BB4b（2026-10-14）：明细合计与表头 amount 不一致时既有实现 code:0，
		// 且**按明细金额核销**（表头 10 / 明细 5 → 发票 received_amount=5、balance=95），
		// 表头 amount 仍按传入值落库。原本实现要求合计相等，属误拒，已移除。
		_ = sum
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetPayment(ctx, d, id)
}
func (s *Service) PaymentTransition(ctx context.Context, d FinanceSpec, id string, cancel bool) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		status := value(h, "status")
		if cancel && status == "draft" {
			return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"status": "cancelled", "updated_at": now()})
		}
		if (!cancel && status != "draft") || (cancel && status != "confirmed") {
			return errors.New("单据状态不允许此操作")
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.Lines)+"=? ORDER BY line_no", id)
		if err != nil {
			return err
		}
		// 回归回放 BB3/BB3b（2026-10-14）：空明细收付款单确认时既有实现 code:0，
		// 发票不发生核销、单据转 confirmed。原本实现在确认期拒绝「核销明细不能为空」，
		// 与建单期已移除的守卫自相矛盾，已同步移除。
		field, label := "ap_invoice_id", "应付单"
		if d.Receipt {
			field, label = "ar_invoice_id", "应收单"
		}
		allocated := map[string]decimal.Decimal{}
		// 既有实现对 CNY 单据忽略汇率快照（2026-10-13 回放：CNY@7.2 收款 10 元确认后，
		// 发票已收=10、余额按 10 扣减，凭证借=贷=10，汇率不参与折算）；
		// 外币单据按 amount×exchange_rate 折算（EUR 10×7.872 → 78.72）。
		rate := decimal.NewFromInt(1)
		if value(h, "currency_code") != "" && value(h, "currency_code") != "CNY" {
			rate = readDecimal(h, "exchange_rate")
			if rate.IsZero() {
				rate = decimal.NewFromInt(1)
			}
		}
		for _, l := range lines {
			invoice, err := s.Store.GetWith(ctx, tx, d.Invoice, value(l, field))
			if err != nil {
				return err
			}
			amount := readDecimal(l, "amount").Mul(rate)
			balance := readDecimal(invoice, "balance")
			paid := readDecimal(invoice, d.Paid)
			if cancel {
				if paid.LessThan(amount) {
					return errors.New("已核销金额不足，无法冲销")
				}
				paid = paid.Sub(amount)
				balance = balance.Add(amount)
			} else {
				allocatedAmount := allocated[value(invoice, "id")].Add(amount)
				if allocatedAmount.GreaterThan(balance) {
					return fmt.Errorf("%s %s 核销金额 %s 超过剩余余额 %s", label, value(invoice, "invoice_no"), amount.StringFixed(2), balance.StringFixed(2))
				}
				allocated[value(invoice, "id")] = allocatedAmount
				paid = paid.Add(amount)
				balance = balance.Sub(amount)
			}
			state := "partial"
			if paid.IsZero() {
				state = "unpaid"
			} else if balance.IsZero() {
				state = "paid"
			}
			if err := s.Store.UpdateWith(ctx, tx, d.Invoice, value(invoice, "id"), map[string]any{d.Paid: paid.String(), "balance": balance.String(), "status": state, "updated_at": now()}); err != nil {
				return err
			}
		}
		amount := readDecimal(h, "amount").Mul(rate)
		code := value(h, "cash_account_code")
		source, remark := "payment_payment", "付款单确认"
		entries := []Posting{{"2202", "debit", amount}, {code, "credit", amount}}
		if d.Receipt {
			source, remark = "payment_receipt", "收款单确认"
			entries = []Posting{{code, "debit", amount}, {"1122", "credit", amount}}
		}
		state := "confirmed"
		if cancel {
			state = "cancelled"
			source += "_cancel"
			remark = "取消付款单冲销"
			if d.Receipt {
				remark = "取消收款单冲销"
			}
			entries[0], entries[1] = entries[1], entries[0]
			for i := range entries {
				if entries[i].Direction == "debit" {
					entries[i].Direction = "credit"
				} else {
					entries[i].Direction = "debit"
				}
			}
		}
		if code != "" {
			if err := s.post(ctx, tx, source, id, value(h, d.Number), value(s.Store.Public(d.Table, h), d.Date), remark, entries); err != nil {
				return err
			}
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"status": state, "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.GetPayment(ctx, d, id)
}
