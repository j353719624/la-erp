package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

func sourceDocument(d Document) Document {
	if d.Incoming {
		return Documents["purchase-orders"]
	}
	return Documents["sales-orders"]
}
func (s *Service) source(ctx context.Context, tx *sql.Tx, d Document, h map[string]any) (map[string]any, error) {
	id := value(h, "source_id")
	if id == "" {
		return nil, nil
	}
	if !d.Stock {
		return nil, ErrUnsupported
	}
	order, err := s.Store.GetWith(ctx, tx, sourceDocument(d).Table, id)
	if err != nil {
		return nil, errors.New("来源订单不存在")
	}
	if value(order, "warehouse_id") != "" && value(order, "warehouse_id") != value(h, "warehouse_id") {
		return nil, errors.New("来源订单仓库与出入库仓库不一致")
	}
	if no := value(h, "source_no"); no != "" && no != value(order, "order_no") {
		return nil, errors.New("来源订单编号不一致")
	}
	return order, nil
}
func (s *Service) deliverLine(ctx context.Context, tx *sql.Tx, d Document, order, line map[string]any) error {
	if order == nil {
		return nil
	}
	status := value(order, "status")
	if status != "confirmed" && status != "approved" {
		return errors.New("来源订单状态不允许收发货")
	}
	src := sourceDocument(d)
	matches, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(src.Lines)+" WHERE order_id=? AND product_id=? AND deleted_at IS NULL", order["id"], line["product_id"])
	if err != nil {
		return err
	}
	if len(matches) == 0 {
		return errors.New("商品不在来源订单中")
	}
	if len(matches) != 1 {
		return ErrUnsupported
	}
	l := matches[0]
	remaining := readDecimal(l, "qty").Sub(readDecimal(l, "delivered_qty"))
	qty := readDecimal(line, "qty")
	if qty.GreaterThan(remaining) {
		kind, label, verb := "发", "销售", "发"
		if d.Incoming {
			kind, label, verb = "收", "采购", "收"
		}
		return fmt.Errorf("商品 %s 超%s：%s订单 %s 剩余可%s %s，本次 %s", value(line, "product_name"), kind, label, value(order, "order_no"), verb, remaining.StringFixed(2), qty.StringFixed(2))
	}
	if unit := value(l, "unit_id"); unit != "" && value(line, "unit_id") != "" && unit != value(line, "unit_id") {
		return ErrUnsupported
	}
	return s.Store.UpdateWith(ctx, tx, src.Lines, value(l, "id"), map[string]any{"delivered_qty": readDecimal(l, "delivered_qty").Add(qty).String(), "updated_at": now()})
}
func (s *Service) closeDelivered(ctx context.Context, tx *sql.Tx, d Document, order map[string]any) error {
	if order == nil {
		return nil
	}
	src := sourceDocument(d)
	lines, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(src.Lines)+" WHERE order_id=? AND deleted_at IS NULL", order["id"])
	if err != nil {
		return err
	}
	complete := len(lines) > 0
	for _, l := range lines {
		if readDecimal(l, "delivered_qty").LessThan(readDecimal(l, "qty")) {
			complete = false
		}
	}
	changes := map[string]any{"updated_at": now()}
	if complete {
		changes["status"] = "closed"
	}
	if !d.Incoming {
		changes["customer_progress"] = "shipped"
		if complete {
			changes["customer_progress"] = "completed"
		}
		changes["shipped_at"] = now()
	}
	return s.Store.UpdateWith(ctx, tx, src.Table, value(order, "id"), changes)
}
func (s *Service) Approve(ctx context.Context, d Document, id, user string) (map[string]any, error) {
	if isReturn(d) {
		return s.approveReturn(ctx, d, id, user)
	}
	if d.Stock {
		return nil, ErrUnsupported
	}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var configured int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM approval_flows WHERE is_active=1 AND deleted_at IS NULL").Scan(&configured); err != nil {
			return err
		}
		personal, err := s.personalMode(ctx, tx)
		if err != nil {
			return err
		}
		if configured > 0 && !personal {
			return ErrUnsupported
		}
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		if value(h, "status") != "confirmed" {
			return errors.New("只有已确认的订单才能审核")
		}
		if value(h, "currency") != "CNY" || !readDecimal(h, "paid_amount").IsZero() {
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"status": "approved", "approved_by": user, "approved_at": now(), "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, d, id)
}
func consumeLocked(available, locked, qty decimal.Decimal) (decimal.Decimal, decimal.Decimal, error) {
	fromLocked := decimal.Min(locked, qty)
	unlocked := qty.Sub(fromLocked)
	if available.LessThan(unlocked) {
		return available, locked, errors.New("库存不足")
	}
	return available.Sub(unlocked), locked.Sub(fromLocked), nil
}
