// Package business reconstructs transactions observed in the original runtime.
// Only plain weighted-average stock and plain sales/purchase orders are covered.
package business

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
	"regexp"
	"strings"
	"time"
)

var ErrUnsupported = errors.New("该业务分支尚未恢复")
var decimalSyntax = regexp.MustCompile(`^-?[0-9]{1,20}(\.[0-9]{1,12})?$`)

type Service struct{ Store *database.Store }
type Document struct {
	Table, Lines, ForeignKey, Number, Prefix, Date, Party string
	Stock, Incoming                                       bool
}

var Documents = map[string]Document{
	"stock-ins":        {"stock_ins", "stock_in_lines", "stock_in_id", "stock_in_no", "STIN", "stock_in_date", "", true, true},
	"stock-outs":       {"stock_outs", "stock_out_lines", "stock_out_id", "stock_out_no", "STOUT", "stock_out_date", "", true, false},
	"sales-orders":     {"sales_orders", "sales_order_lines", "order_id", "order_no", "SO", "order_date", "customer", false, false},
	"sales-returns":    {"sales_returns", "sales_return_lines", "order_id", "order_no", "SR", "order_date", "customer", false, true},
	"purchase-returns": {"purchase_returns", "purchase_return_lines", "order_id", "order_no", "PRN", "order_date", "supplier", false, false},
	"purchase-orders":  {"purchase_orders", "purchase_order_lines", "order_id", "order_no", "PO", "order_date", "supplier", false, false},
}

func Number(value any) (decimal.Decimal, error) {
	if value == nil {
		return decimal.Zero, nil
	}
	text := fmt.Sprint(value)
	if !decimalSyntax.MatchString(text) {
		return decimal.Zero, errors.New("数值格式错误，最多20位整数和12位小数")
	}
	return decimal.NewFromString(text)
}
func value(m map[string]any, k string) string {
	if m[k] == nil {
		return ""
	}
	return fmt.Sprint(m[k])
}
func readDecimal(m map[string]any, k string) decimal.Decimal {
	d, _ := decimal.NewFromString(value(m, k))
	return d
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func (s *Service) base(table string) map[string]any {
	r := map[string]any{"id": uuid.NewString()}
	for _, k := range []string{"created_at", "updated_at"} {
		if s.Store.Has(table, k) {
			r[k] = now()
		}
	}
	for _, c := range s.Store.Tables[table].Columns {
		if strings.EqualFold(c.Type, "numeric") && c.NotNull == 1 {
			r[c.Name] = "0"
		}
	}
	if s.Store.Has(table, "tenant_id") {
		r["tenant_id"] = database.ZeroUUID
	}
	return r
}
func (s *Service) transaction(ctx context.Context, action func(*sql.Tx) error) error {
	tx, err := s.Store.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = action(tx); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Service) nextNumber(ctx context.Context, tx *sql.Tx, prefix string) (string, error) {
	// The captured default uses the server's Asia/Shanghai calendar and four digits.
	p := prefix + time.Now().In(time.FixedZone("CST", 8*3600)).Format("20060102")
	rows, err := database.QueryRows(ctx, tx, "SELECT * FROM number_counters WHERE prefix=?", p)
	if err != nil {
		return "", err
	}
	seq := int64(1)
	if len(rows) == 0 {
		r := s.base("number_counters")
		r["prefix"] = p
		r["seq"] = seq
		err = s.Store.InsertWith(ctx, tx, "number_counters", r)
	} else {
		seq = rows[0]["seq"].(int64) + 1
		err = s.Store.UpdateWith(ctx, tx, "number_counters", value(rows[0], "id"), map[string]any{"seq": seq, "updated_at": now()})
	}
	return fmt.Sprintf("%s%04d", p, seq), err
}
func (s *Service) plainProduct(ctx context.Context, tx *sql.Tx, id string, stock ...bool) (map[string]any, error) {
	p, err := s.Store.GetWith(ctx, tx, "products", id)
	if err != nil {
		return nil, errors.New("商品不存在")
	}
	if method := value(p, "cost_method"); method != "" && method != "weighted_avg" && !(method == "fifo" && len(stock) > 0 && stock[0]) {
		return nil, ErrUnsupported
	}
	for _, k := range []string{"is_combo", "is_batch", "is_serial", "batch_enabled", "serial_enabled", "enable_batch", "enable_serial", "track_batch", "track_serial"} {
		if k == "is_batch" && len(stock) > 0 && stock[0] {
			continue
		}
		if p[k] == int64(1) || p[k] == true {
			return nil, ErrUnsupported
		}
	}
	return p, nil
}
func rejectAdvancedDocumentLine(input map[string]any, dates ...bool) error {
	for _, k := range []string{"location_id", "rack_id", "production_date", "expiry_date", "sales_contract_id", "contract_id"} {
		if (k == "production_date" || k == "expiry_date") && len(dates) > 0 && dates[0] {
			if _, ok := input[k].(time.Time); ok {
				continue
			}
			if v := value(input, k); v != "" {
				if _, err := time.Parse(time.RFC3339Nano, v); err != nil {
					return errors.New("批次日期格式无效")
				}
			}
			continue
		}
		if input[k] != nil && fmt.Sprint(input[k]) != "" {
			return ErrUnsupported
		}
	}
	return nil
}
func rejectAdvanced(input map[string]any) error {
	for _, k := range []string{"location_id", "rack_id", "batch_no", "serial_nos", "production_date", "expiry_date", "sales_contract_id", "contract_id"} {
		if list, ok := input[k].([]any); ok && len(list) == 0 {
			continue
		}
		if input[k] != nil && fmt.Sprint(input[k]) != "" {
			return ErrUnsupported
		}
	}
	return nil
}
func (s *Service) Create(ctx context.Context, d Document, input map[string]any, user string) (map[string]any, error) {
	return s.writeDocument(ctx, d, input, user, "")
}
func (s *Service) writeDocument(ctx context.Context, d Document, input map[string]any, user, existingID string) (map[string]any, error) {
	raw, ok := input["lines"].([]any)
	if existingID == "" && (!ok || len(raw) == 0) {
		if d.Stock && d.Incoming {
			return nil, errors.New("入库明细不能为空")
		}
		return nil, errors.New("单据明细不能为空")
	}
	if len(raw) > 1000 {
		return nil, errors.New("明细过多")
	}
	if err := rejectAdvanced(input); err != nil {
		return nil, err
	}
	if !d.Stock && (value(input, "source_id") != "" || value(input, "source_no") != "") {
		return nil, ErrUnsupported
	}
	for _, k := range []string{"discount_amount", "discount", "discount_rate"} {
		d, err := Number(input[k])
		if err != nil {
			return nil, err
		}
		if !d.IsZero() {
			return nil, ErrUnsupported
		}
	}
	id := ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		wh := value(input, "warehouse_id")
		if existingID != "" && wh == "" {
			old, err := s.Store.GetWith(ctx, tx, d.Table, existingID)
			if err != nil {
				return err
			}
			wh = value(old, "warehouse_id")
		}
		if d.Stock && wh == "" {
			return errors.New("仓库不能为空")
		}
		if wh != "" {
			if _, err := s.Store.GetWith(ctx, tx, "warehouses", wh); err != nil {
				return errors.New("仓库不存在")
			}
		}
		h := s.base(d.Table)
		if existingID != "" {
			old, err := s.Store.GetWith(ctx, tx, d.Table, existingID)
			if err != nil {
				return err
			}
			if value(old, "status") != "draft" {
				return stateError(d, "修改")
			}
			h = old
			if !d.Stock && value(h, "currency") != "CNY" {
				return ErrUnsupported
			}
			if !readDecimal(h, "paid_amount").IsZero() {
				return ErrUnsupported
			}
			h["updated_at"] = now()
			if err := rejectAdvanced(h); err != nil {
				return err
			}
		} else {
			h["created_by"] = user
			if s.Store.Has(d.Table, "department_id") {
				creator, err := s.Store.GetWith(ctx, tx, "sys_users", user)
				if err != nil {
					return err
				}
				if dep := value(creator, "department_id"); dep != "" {
					h["department_id"] = dep
				}
			}
		}
		id = value(h, "id")
		h["status"] = "draft"
		if wh != "" {
			h["warehouse_id"] = wh
		}
		for _, k := range []string{d.Date, "remark"} {
			if v := value(input, k); v != "" {
				if k == d.Date {
					if _, err := time.Parse(time.RFC3339Nano, v); err != nil {
						return errors.New("日期格式错误")
					}
				}
				h[k] = v
			}
		}
		if existingID == "" {
			number, err := s.nextNumber(ctx, tx, d.Prefix)
			if err != nil {
				return err
			}
			h[d.Number] = number
		}
		if d.Stock {
			for _, k := range []string{"source_id", "source_no"} {
				if v := value(input, k); v != "" {
					h[k] = v
				}
			}
			if _, err := s.source(ctx, tx, d, h); err != nil {
				return err
			}
			h["type"] = ""
			if t := value(input, "type"); t != "" {
				if !(d.Incoming && t == "purchase") && !(!d.Incoming && t == "sales") && !(t == "other" && value(h, "source_id") == "" && value(h, "source_no") == "") {
					return ErrUnsupported
				}
				h["type"] = t
			}
		}
		if !d.Stock {
			party := value(input, d.Party+"_id")
			if party == "" && existingID != "" {
				party = value(h, d.Party+"_id")
			}
			if party == "" {
				return errors.New("客户或供应商不能为空")
			}
			p, err := s.Store.GetWith(ctx, tx, d.Party+"s", party)
			if err != nil {
				return errors.New("客户或供应商不存在")
			}
			h[d.Party+"_id"] = party
			h[d.Party+"_name"] = p["name"]
			if existingID != "" {
				h[d.Party+"_name"] = nil
				if name := value(input, d.Party+"_name"); name != "" {
					h[d.Party+"_name"] = name
				}
			}
			h["currency"] = "CNY"
			if value(input, "currency") != "" && value(input, "currency") != "CNY" {
				return ErrUnsupported
			}
			h["payment_status"] = "unpaid"
			if isReturn(d) {
				for _, k := range []string{"sales_order_id", "sales_order_no", "purchase_order_id", "purchase_order_no"} {
					if s.Store.Has(d.Table, k) && input[k] != nil {
						h[k] = input[k]
					}
				}
			}
		}
		lines := []map[string]any{}
		totalQty, totalAmount, totalTax := decimal.Zero, decimal.Zero, decimal.Zero
		for i, item := range raw {
			line, ok := item.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			if d.Stock {
				if err := rejectAdvancedDocumentLine(line, true); err != nil {
					return err
				}
			} else if err := rejectOrderLine(line, isReturn(d)); err != nil {
				return err
			}
			if line["is_gift"] == true {
				return ErrUnsupported
			}
			if rate := line["unit_rate"]; rate != nil {
				n, err := Number(rate)
				if err != nil {
					return err
				}
				if !n.Equal(decimal.NewFromInt(1)) {
					return ErrUnsupported
				}
			}
			product, err := s.plainProduct(ctx, tx, value(line, "product_id"), d.Stock || d.Table == "sales_orders" || isReturn(d))
			if err != nil {
				return err
			}
			qty, err := Number(line["qty"])
			if err != nil {
				return err
			}
			if !qty.IsPositive() {
				return errors.New("库存数量必须大于0")
			}
			costField := "price"
			if d.Stock {
				costField = "unit_cost"
			}
			cost, err := Number(line[costField])
			if err != nil {
				return err
			}
			if cost.IsNegative() {
				return errors.New("价格不能为负数")
			}
			l := s.base(d.Lines)
			l[d.ForeignKey] = id
			l["line_no"] = i + 1
			l["product_id"] = product["id"]
			l["product_name"] = product["name"]
			l["product_code"] = product["code"]
			if unit := value(line, "unit_id"); unit != "" {
				if _, err := s.Store.GetWith(ctx, tx, "units", unit); err != nil {
					return errors.New("单位不存在")
				}
				l["unit_id"] = unit
			}
			l["qty"] = qty.String()
			l[costField] = cost.String()
			amount := qty.Mul(cost)
			l["amount"] = amount.String()
			for _, key := range []string{"batch_no", "serial_nos", "production_date", "expiry_date"} {
				if s.Store.Has(d.Lines, key) && line[key] != nil {
					l[key] = line[key]
				}
			}
			if !d.Stock {
				discount, err := Number(line["discount"])
				if err != nil {
					return err
				}
				if discount.IsNegative() || discount.GreaterThan(amount) {
					return errors.New("折扣金额超出明细金额")
				}
				amount = amount.Sub(discount)
				l["discount"] = discount.String()
				l["amount"] = amount.String()
				tax, err := Number(line["tax_rate"])
				if err != nil {
					return err
				}
				if tax.IsNegative() || tax.GreaterThan(decimal.NewFromInt(100)) {
					return errors.New("税率超出范围")
				}
				taxAmount := amount.Mul(tax).Div(decimal.NewFromInt(100))
				l["tax_rate"] = tax.String()
				l["tax_amount"] = taxAmount.String()
				totalTax = totalTax.Add(taxAmount)
			}
			if v := value(line, "remark"); v != "" {
				l["remark"] = v
			}
			lines = append(lines, l)
			totalQty = totalQty.Add(qty)
			totalAmount = totalAmount.Add(amount)
		}
		h["total_qty"] = totalQty.String()
		h["total_amount"] = totalAmount.String()
		if !d.Stock {
			h["tax_amount"] = totalTax.String()
		}
		if existingID == "" {
			if err := s.Store.InsertWith(ctx, tx, d.Table, h); err != nil {
				return err
			}
		} else {
			if err := s.Store.UpdateWith(ctx, tx, d.Table, id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=?", id); err != nil {
				return err
			}
		}
		for _, l := range lines {
			if err := s.Store.InsertWith(ctx, tx, d.Lines, l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, d, id)
}
func (s *Service) Get(ctx context.Context, d Document, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, d.Table, id)
	if err != nil {
		return nil, err
	}
	result := s.Store.Public(d.Table, h)
	edges := map[string]any{}
	lines, err := s.Store.Rows(ctx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	publicLines := []map[string]any{}
	for _, l := range lines {
		p := s.Store.Public(d.Lines, l)
		e := map[string]any{}
		if product, err := s.Store.Get(ctx, "products", value(l, "product_id")); err == nil {
			e["product"] = s.product(ctx, product, true)
		}
		if !d.Stock {
			if unit, err := s.Store.Get(ctx, "units", value(l, "unit_id")); err == nil {
				e["unit"] = s.Store.Public("units", unit)
			}
		}
		p["edges"] = e
		publicLines = append(publicLines, p)
	}
	if len(publicLines) > 0 {
		edges["lines"] = publicLines
	}
	relation, table, field := "warehouse", "warehouses", "warehouse_id"
	if !d.Stock {
		relation = d.Party
		table = d.Party + "s"
		field = d.Party + "_id"
	}
	if p, err := s.Store.Get(ctx, table, value(h, field)); err == nil {
		edges[relation] = s.Store.Public(table, p)
	}
	result["edges"] = edges
	if d.Table == "stock_ins" {
		photos, err := s.StockPhotos(ctx, id)
		if err != nil {
			return nil, err
		}
		if len(photos) > 0 {
			edges["photos"] = photos
		}
	}
	return result, nil
}
func (s *Service) product(ctx context.Context, p map[string]any, nested bool) map[string]any {
	pub := s.Store.Public("products", p)
	if nested {
		edges := map[string]any{}
		if u, err := s.Store.Get(ctx, "units", value(p, "unit_id")); err == nil {
			edges["unit"] = s.Store.Public("units", u)
		}
		pub["edges"] = edges
	}
	return pub
}
func (s *Service) trackingBalance(ctx context.Context, tx *sql.Tx, product, warehouse, batch string, create bool) (map[string]any, error) {
	if batch == "" {
		return s.balance(ctx, tx, product, warehouse, create)
	}
	rows, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=? AND batch_no=?", product, warehouse, batch)
	if err != nil {
		return nil, err
	}
	if len(rows) > 1 {
		return nil, ErrUnsupported
	}
	if len(rows) == 1 {
		return rows[0], nil
	}
	if !create {
		return nil, errors.New("库存不足")
	}
	b := s.base("inventory_balances")
	b["product_id"], b["warehouse_id"], b["batch_no"] = product, warehouse, batch
	if err := s.Store.InsertWith(ctx, tx, "inventory_balances", b); err != nil {
		return nil, err
	}
	return b, nil
}
func (s *Service) balance(ctx context.Context, tx *sql.Tx, product, warehouse string, create bool) (map[string]any, error) {
	rows, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=? AND (batch_no IS NULL OR batch_no='')", product, warehouse)
	if err != nil {
		return nil, err
	}
	if len(rows) > 1 {
		return nil, ErrUnsupported
	}
	if len(rows) == 1 {
		if err := rejectAdvanced(rows[0]); err != nil {
			return nil, err
		}
		return rows[0], nil
	}
	if !create {
		return nil, errors.New("库存不足")
	}
	b := s.base("inventory_balances")
	b["product_id"] = product
	b["warehouse_id"] = warehouse
	err = s.Store.InsertWith(ctx, tx, "inventory_balances", b)
	return b, err
}
func (s *Service) shift(ctx context.Context, tx *sql.Tx, b map[string]any, qty decimal.Decimal, unlock bool) error {
	available, locked := readDecimal(b, "qty_available"), readDecimal(b, "qty_locked")
	if !qty.IsPositive() {
		return errors.New("库存数量必须大于0")
	}
	if unlock {
		if locked.LessThan(qty) {
			return errors.New("锁定库存不足")
		}
		available = available.Add(qty)
		locked = locked.Sub(qty)
	} else {
		personal, err := s.personalMode(ctx, tx)
		if err != nil {
			return err
		}
		if available.LessThan(qty) && !personal {
			return errors.New("库存不足")
		}
		available = available.Sub(qty)
		locked = locked.Add(qty)
	}
	return s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": available.String(), "qty_locked": locked.String(), "updated_at": now()})
}
func (s *Service) Lock(ctx context.Context, id string, input map[string]any, unlock bool) error {
	qty, err := Number(input["qty"])
	if err != nil {
		return err
	}
	return s.transaction(ctx, func(tx *sql.Tx) error {
		b, err := s.Store.GetWith(ctx, tx, "inventory_balances", id)
		if err != nil {
			return err
		}
		return s.shift(ctx, tx, b, qty, unlock)
	})
}
func (s *Service) Transition(ctx context.Context, d Document, id, user string, cancel bool) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var approvalCount int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM approval_flows WHERE is_active=1 AND deleted_at IS NULL").Scan(&approvalCount); err != nil {
			return err
		}
		personal, err := s.personalMode(ctx, tx)
		if err != nil {
			return err
		}
		if approvalCount > 0 && !personal {
			return ErrUnsupported
		}
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		status := value(h, "status")
		if !cancel && status != "draft" {
			if d.Stock {
				label := "出库单"
				if d.Incoming {
					label = "入库单"
				}
				return errors.New(label + "不存在或状态不允许确认")
			}
			label := "销售"
			if d.Party == "supplier" {
				label = "采购"
			}
			return fmt.Errorf("只有草稿状态的%s订单才能确认", label)
		}
		if cancel && d.Stock {
			return ErrUnsupported
		}
		if cancel && status != "draft" && status != "confirmed" {
			label := "销售"
			if d.Party == "supplier" {
				label = "采购"
			}
			return fmt.Errorf("只有草稿或已确认的%s订单才能取消", label)
		}
		if err := rejectAdvanced(h); err != nil {
			return err
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=? AND deleted_at IS NULL ORDER BY line_no", id)
		if err != nil {
			return err
		}
		if len(lines) == 0 && d.Stock {
			return errors.New("单据明细不能为空")
		}
		if cancel {
			for _, line := range lines {
				if readDecimal(line, "delivered_qty").IsPositive() {
					return ErrUnsupported
				}
			}
		}
		changes := map[string]any{"updated_at": now(), "status": "confirmed"}
		if cancel {
			changes["status"] = "cancelled"
		} else {
			changes["confirmed_at"] = now()
		}
		if d.Stock {
			order, err := s.source(ctx, tx, d, h)
			if err != nil {
				return err
			}
			changes["confirmed_by"] = user
			total := decimal.Zero
			for _, l := range lines {
				if err := rejectAdvancedDocumentLine(l, true); err != nil {
					return err
				}
				product, err := s.plainProduct(ctx, tx, value(l, "product_id"), true)
				if err != nil {
					return err
				}
				if !d.Incoming && order == nil && value(l, "batch_no") == "" && (product["is_batch"] == int64(1) || product["is_batch"] == true) {
					if order != nil {
						return ErrUnsupported
					}
					strategy := "fifo"
					settings, e := database.QueryRows(ctx, tx, "SELECT value FROM system_settings WHERE key='inventory'")
					if e != nil {
						return e
					}
					if len(settings) > 0 {
						var config map[string]any
						if e = json.Unmarshal([]byte(value(settings[0], "value")), &config); e != nil {
							return e
						}
						if v := value(config, "batch_strategy"); v != "" {
							strategy = v
						}
					}
					if e := s.allocateTrackedBatch(ctx, tx, h, l, d, user, strategy); e != nil {
						return e
					}
					total = total.Add(readDecimal(l, "qty").Mul(readDecimal(l, "unit_cost")))
					continue
				}
				b, err := s.trackingBalance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), value(l, "batch_no"), d.Incoming || personal)
				if err != nil {
					return err
				}
				if err := validateSerialLine(l); err != nil {
					return err
				}
				if err := s.applySerialTransition(ctx, tx, l, h, d.Incoming); err != nil {
					return err
				}
				if err := s.deliverLine(ctx, tx, d, order, l); err != nil {
					return err
				}
				qty, cost := readDecimal(l, "qty"), readDecimal(l, "unit_cost")
				available, locked, avg := readDecimal(b, "qty_available"), readDecimal(b, "qty_locked"), readDecimal(b, "avg_cost")
				update := map[string]any{"updated_at": now()}
				direction, kind := 1, "in"
				if d.Incoming {
					for _, key := range []string{"production_date", "expiry_date"} {
						if value(l, key) != "" {
							update[key] = l[key]
						}
					}
					// Captured original cost logic uses available stock, excluding locked stock.
					onHand := available
					newQty := onHand.Add(qty)
					avg = onHand.Mul(avg).Add(qty.Mul(cost)).DivRound(newQty, 6)
					available = available.Add(qty)
					update["last_in_at"] = now()
				} else {
					if order != nil && value(order, "status") == "approved" && (order["stock_locked"] == int64(1) || order["stock_locked"] == true) {
						var err error
						available, locked, err = consumeLocked(available, locked, qty)
						if err != nil {
							return err
						}
					} else {
						personal, err := s.personalMode(ctx, tx)
						if err != nil {
							return err
						}
						if available.LessThan(qty) && !personal {
							return errors.New("库存不足")
						}
						available = available.Sub(qty)
					}
					cost = avg
					direction, kind = -1, "out"
					update["last_out_at"] = now()
					if err := s.Store.UpdateWith(ctx, tx, d.Lines, value(l, "id"), map[string]any{"unit_cost": cost.String(), "amount": qty.Mul(cost).String(), "updated_at": now()}); err != nil {
						return err
					}
				}
				update["qty_available"] = available.String()
				update["qty_locked"] = locked.String()
				update["avg_cost"] = avg.String()
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), update); err != nil {
					return err
				}
				movement := s.base("stock_movements")
				movement["type"] = kind
				movement["source_type"] = h["type"]
				if value(h, "type") == "other" || value(h, "type") == "" {
					movement["source_type"] = "manual"
				}
				movement["source_id"] = id
				movement["source_no"] = h[d.Number]
				movement["product_id"] = l["product_id"]
				movement["warehouse_id"] = h["warehouse_id"]
				movement["qty"] = qty.String()
				movement["direction"] = direction
				movement["unit_cost"] = cost.String()
				movement["total_cost"] = qty.Mul(cost).String()
				movement["balance_after"] = available.String()
				movement["operator_id"] = user
				for _, key := range []string{"batch_no", "production_date", "expiry_date"} {
					if value(l, key) != "" {
						movement[key] = l[key]
					}
				}
				if err := s.Store.InsertWith(ctx, tx, "stock_movements", movement); err != nil {
					return err
				}
				total = total.Add(qty.Mul(cost))
			}
			if err := s.closeDelivered(ctx, tx, d, order); err != nil {
				return err
			}
			changes["total_amount"] = total.String()
			source, remark := "sales_outbound", "销售出库确认"
			entries := []Posting{{"6401", "debit", total}, {"1405", "credit", total}}
			if d.Incoming {
				source, remark = "purchase_inbound", "采购入库确认"
				entries = []Posting{{"1403", "debit", total}, {"2202", "credit", total}}
			}
			if value(h, "type") != "other" && value(h, "type") != "" {
				if err := s.post(ctx, tx, source, id, value(h, d.Number), now(), remark, entries); err != nil {
					return err
				}
			}
		} else if d.Table == "sales_orders" && value(h, "warehouse_id") != "" {
			locked := h["stock_locked"] == int64(1) || h["stock_locked"] == true
			if !cancel || locked {
				for _, l := range lines {
					b, err := s.balance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), personal)
					if err != nil {
						return err
					}
					if err := s.shift(ctx, tx, b, readDecimal(l, "qty"), cancel); err != nil {
						return err
					}
				}
				changes["stock_locked"] = !cancel
				if cancel {
					changes["lock_remark"] = "取消已归还锁定库存"
				} else {
					changes["lock_remark"] = "确认时锁定库存"
				}
			}
		}
		if !cancel && d.Table == "sales_orders" {
			changes["customer_progress"] = "confirmed"
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, changes)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, d, id)
}

func (s *Service) applySerialTransition(ctx context.Context, tx *sql.Tx, line, header map[string]any, incoming bool) error {
	raw, ok := line["serial_nos"].([]any)
	if !ok {
		if encoded, yes := line["serial_nos"].(string); yes && encoded != "" {
			_ = json.Unmarshal([]byte(encoded), &raw)
		}
	}
	if len(raw) == 0 {
		return nil
	}
	for _, item := range raw {
		serial := item.(string)
		if incoming {
			existing, err := database.QueryRows(ctx, tx, "SELECT id FROM serial_numbers WHERE serial_no=? AND deleted_at IS NULL", serial)
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				return fmt.Errorf("序列号 %s 已存在", serial)
			}
			row := s.base("serial_numbers")
			row["product_id"], row["warehouse_id"], row["serial_no"] = line["product_id"], header["warehouse_id"], serial
			row["status"], row["registered_at"] = "in_stock", now()
			if err := s.Store.InsertWith(ctx, tx, "serial_numbers", row); err != nil {
				return err
			}
			continue
		}
		rows, err := database.QueryRows(ctx, tx, "SELECT * FROM serial_numbers WHERE serial_no=? AND deleted_at IS NULL", serial)
		if err != nil {
			return err
		}
		if len(rows) != 1 || value(rows[0], "status") != "in_stock" || value(rows[0], "product_id") != value(line, "product_id") {
			return errors.New("序列号不存在或不在库")
		}
		if err := s.Store.UpdateWith(ctx, tx, "serial_numbers", value(rows[0], "id"), map[string]any{"status": "out", "warehouse_id": header["warehouse_id"], "out_at": now(), "updated_at": now()}); err != nil {
			return err
		}
	}
	return nil
}

func validateSerialLine(line map[string]any) error {
	var raw []any
	switch v := line["serial_nos"].(type) {
	case []any:
		raw = v
	case string:
		if v != "" {
			_ = json.Unmarshal([]byte(v), &raw)
		}
	}
	if len(raw) == 0 {
		return nil
	}
	seen := map[string]bool{}
	for _, v := range raw {
		no, ok := v.(string)
		if !ok || no == "" {
			return errors.New("序列号格式错误")
		}
		if seen[no] {
			return fmt.Errorf("序列号 %s 重复", no)
		}
		seen[no] = true
	}
	if !readDecimal(line, "qty").Equal(decimal.NewFromInt(int64(len(raw)))) {
		return errors.New("序列号数量必须与明细数量一致")
	}
	return nil
}

func rejectOrderLine(line map[string]any, returnDocument bool) error {
	if !returnDocument {
		return rejectAdvanced(line)
	}
	// Original return lines do not persist batch_no and return to the generic balance.
	validated := map[string]any{}
	for k, v := range line {
		if k != "batch_no" {
			validated[k] = v
		}
	}
	return rejectAdvanced(validated)
}
