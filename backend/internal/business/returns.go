package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

func isReturn(d Document) bool { return d.Table == "sales_returns" || d.Table == "purchase_returns" }

// The original approves returns independently of source-order delivered quantities.
// Keep this observed behavior explicit rather than silently inventing backwrites.
func (s *Service) approveReturn(ctx context.Context, d Document, id, user string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var flows int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM approval_flows WHERE is_active=1 AND deleted_at IS NULL").Scan(&flows); err != nil {
			return err
		}
		if flows > 0 {
			return ErrUnsupported
		}
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		label, source, remark := "采购退货单", "purchase_return", "采购退货自动回冲"
		if d.Incoming {
			label, source, remark = "销售退货单", "sales_return", "销售退货自动回冲"
		}
		if value(h, "status") != "confirmed" {
			return errors.New("只有已确认的" + label + "才能审批")
		}
		if value(h, "currency") != "CNY" || !readDecimal(h, "paid_amount").IsZero() {
			return ErrUnsupported
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE order_id=? AND deleted_at IS NULL ORDER BY line_no", id)
		if err != nil {
			return err
		}
		if len(lines) == 0 {
			return errors.New("单据明细不能为空")
		}
		totalCost := decimal.Zero
		for _, l := range lines {
			if err := rejectAdvanced(l); err != nil {
				return err
			}
			if _, err := s.plainProduct(ctx, tx, value(l, "product_id"), true); err != nil {
				return err
			}
			b, err := s.balance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), d.Incoming)
			if err != nil {
				return err
			}
			qty, available, cost := readDecimal(l, "qty"), readDecimal(b, "qty_available"), readDecimal(b, "avg_cost")
			if d.Incoming {
				costs, err := database.QueryRows(ctx, tx, "SELECT avg_cost FROM inventory_balances WHERE product_id=? AND warehouse_id=? ORDER BY qty_available DESC LIMIT 1", l["product_id"], h["warehouse_id"])
				if err != nil {
					return err
				}
				if len(costs) > 0 {
					cost = readDecimal(costs[0], "avg_cost")
				}
			}
			if !d.Incoming {
				cost = readDecimal(l, "price")
			}
			direction, kind, date := 1, "in", "last_in_at"
			if d.Incoming {
				available = available.Add(qty)
			} else {
				if available.LessThan(qty) {
					return errors.New("库存不足")
				}
				available = available.Sub(qty)
				direction, kind, date = -1, "out", "last_out_at"
			}
			changes := map[string]any{"qty_available": available.String(), date: now(), "updated_at": now()}
			if d.Incoming {
				if available.IsZero() {
					return ErrUnsupported
				}
				changes["avg_cost"] = readDecimal(b, "qty_available").Mul(readDecimal(b, "avg_cost")).Add(qty.Mul(cost)).DivRound(available, 6).String()
			}
			if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), changes); err != nil {
				return err
			}
			totalCost = totalCost.Add(qty.Mul(cost))
			m := s.base("stock_movements")
			for k, v := range map[string]any{"type": kind, "source_type": source, "source_id": id, "source_no": h[d.Number], "product_id": l["product_id"], "warehouse_id": h["warehouse_id"], "qty": qty.String(), "direction": direction, "unit_cost": cost.String(), "total_cost": qty.Mul(cost).String(), "balance_after": available.String(), "remark": remark} {
				m[k] = v
			}
			if value(l, "unit_id") != "" {
				m["unit_id"] = l["unit_id"]
			}
			if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
				return err
			}
		}
		amount := readDecimal(h, "total_amount")
		entries := []Posting{{"2202", "debit", amount}, {"1403", "credit", amount}}
		postingRemark := "采购退货红字冲销"
		if d.Incoming {
			postingRemark = "销售退货红字冲销"
			entries = []Posting{{"6001", "debit", amount}, {"1122", "credit", amount}, {"1405", "debit", totalCost}, {"6401", "credit", totalCost}}
		}
		if err := s.post(ctx, tx, source, id, value(h, d.Number), now(), postingRemark, entries); err != nil {
			return err
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"status": "approved", "approved_by": user, "approved_at": now(), "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, d, id)
}
