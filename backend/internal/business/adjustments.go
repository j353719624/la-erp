package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
	"time"
)

func (s *Service) GetAdjustment(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "stock_adjusts", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("stock_adjusts", h)
	lines := []map[string]any{}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM stock_adjust_lines WHERE adjust_id=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	for _, l := range rows {
		p, err := s.Store.Get(ctx, "products", value(l, "product_id"))
		if err != nil {
			return nil, err
		}
		r := s.Store.Public("stock_adjust_lines", l)
		product := s.Store.Public("products", p)
		product["edges"] = map[string]any{}
		r["edges"] = map[string]any{"product": product}
		lines = append(lines, r)
	}
	pub["edges"] = map[string]any{"lines": lines}
	return pub, nil
}

func (s *Service) WriteAdjustment(ctx context.Context, id string, input map[string]any, user string) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if err := rejectAdvanced(input); err != nil {
			return err
		}
		kind := value(input, "adjust_type")
		switch kind {
		case "increase", "decrease", "gain", "loss", "profit", "cost":
		default:
			return ErrUnsupported
		}
		wh := value(input, "warehouse_id")
		if _, err := s.Store.GetWith(ctx, tx, "warehouses", wh); err != nil {
			return errors.New("仓库不存在")
		}
		raw, ok := input["lines"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 1000 {
			return errors.New("明细不能为空且不超过1000行")
		}
		h := s.base("stock_adjusts")
		if !creating {
			var err error
			h, err = s.Store.GetWith(ctx, tx, "stock_adjusts", id)
			if err != nil {
				return err
			}
			if value(h, "status") != "draft" {
				return errors.New("只有草稿状态的库存调整单才能编辑")
			}
		}
		id = value(h, "id")
		number := value(h, "adjust_no")
		if creating {
			var err error
			number, err = s.nextNumber(ctx, tx, "ADJ")
			if err != nil {
				return err
			}
		}
		h["adjust_no"], h["warehouse_id"], h["adjust_type"], h["status"], h["created_by"], h["remark"] = number, wh, kind, "draft", user, value(input, "remark")
		if date := value(input, "adjust_date"); date != "" {
			if _, err := time.Parse(time.RFC3339Nano, date); err != nil {
				return errors.New("日期格式错误")
			}
			h["adjust_date"] = date
		}
		total := decimal.Zero
		lines := []map[string]any{}
		seen := map[string]bool{}
		for i, v := range raw {
			in, ok := v.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			if err := rejectAdvanced(in); err != nil {
				return err
			}
			pid := value(in, "product_id")
			if seen[pid] {
				return ErrUnsupported
			}
			seen[pid] = true
			p, err := s.plainProduct(ctx, tx, pid)
			if err != nil {
				return err
			}
			qty, err := Number(in["qty"])
			if err != nil || (kind != "cost" && !qty.IsPositive()) {
				return errors.New("调整数量必须大于0")
			}
			if kind == "cost" && !qty.IsZero() {
				return ErrUnsupported
			}
			cost, err := Number(in["unit_cost"])
			if err != nil || cost.IsNegative() {
				return errors.New("成本格式错误")
			}
			l := s.base("stock_adjust_lines")
			l["adjust_id"], l["line_no"], l["product_id"], l["qty"], l["unit_cost"] = id, i+1, pid, qty.String(), cost.String()
			for _, k := range []string{"product_name", "product_code", "spec", "remark"} {
				if value(in, k) != "" {
					l[k] = in[k]
				}
			}
			if value(in, "unit_id") != "" {
				if value(in, "unit_id") != value(p, "unit_id") {
					return ErrUnsupported
				}
				l["unit_id"] = in["unit_id"]
			}
			total = total.Add(qty)
			lines = append(lines, l)
		}
		h["total_qty"] = total.String()
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "stock_adjusts", h); err != nil {
				return err
			}
		} else {
			delete(h, "id")
			h["updated_at"], h["updated_by"] = now(), user
			if err := s.Store.UpdateWith(ctx, tx, "stock_adjusts", id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE stock_adjust_lines SET deleted_at=? WHERE adjust_id=? AND deleted_at IS NULL", now(), id); err != nil {
				return err
			}
		}
		for _, l := range lines {
			if err := s.Store.InsertWith(ctx, tx, "stock_adjust_lines", l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetAdjustment(ctx, id)
}

func (s *Service) AdjustmentAction(ctx context.Context, id, action, user string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "stock_adjusts", id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的库存调整单才能" + map[string]string{"confirm": "确认", "cancel": "取消", "delete": "删除"}[action])
		}
		update := map[string]any{"updated_at": now()}
		switch action {
		case "delete":
			update["deleted_at"] = now()
		case "cancel":
			update["status"] = "cancelled"
		case "confirm":
			kind := value(h, "adjust_type")
			switch kind {
			case "increase", "decrease", "gain", "loss", "profit", "cost":
			default:
				return ErrUnsupported
			}
			lines, err := database.QueryRows(ctx, tx, "SELECT * FROM stock_adjust_lines WHERE adjust_id=? AND deleted_at IS NULL ORDER BY line_no", id)
			if err != nil {
				return err
			}
			for _, l := range lines {
				pid := value(l, "product_id")
				b, err := s.balance(ctx, tx, pid, value(h, "warehouse_id"), kind != "loss")
				if err != nil {
					return err
				}
				qty, cost := readDecimal(l, "qty"), readDecimal(l, "unit_cost")
				if kind == "cost" {
					if !qty.IsZero() {
						return ErrUnsupported
					}
					if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"avg_cost": cost.String(), "updated_at": now()}); err != nil {
						return err
					}
					m := s.base("stock_movements")
					m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"] = "adjust", "adjust_cost", id, h["adjust_no"], pid, h["warehouse_id"]
					m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = "0", int64(0), cost.String(), "0", readDecimal(b, "qty_available").String(), user
					m["remark"] = fmt.Sprintf("成本调整 %s 行%d：均价→%s", value(h, "adjust_no"), l["line_no"], cost.String())
					if value(l, "unit_id") != "" {
						m["unit_id"] = l["unit_id"]
					}
					if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
						return err
					}
					continue
				}
				before, avg := readDecimal(b, "qty_available"), readDecimal(b, "avg_cost")
				after := before.Add(qty)
				direction := int64(1)
				changes := map[string]any{"updated_at": now(), "last_in_at": now()}
				if kind == "loss" {
					if before.LessThan(qty) {
						return errors.New("库存不足")
					}
					after = before.Sub(qty)
					direction = -1
					delete(changes, "last_in_at")
					changes["last_out_at"] = now()
				} else if !after.IsZero() {
					avg = before.Mul(avg).Add(qty.Mul(cost)).DivRound(after, 6)
				}
				changes["qty_available"], changes["avg_cost"] = after.String(), avg.String()
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), changes); err != nil {
					return err
				}
				m := s.base("stock_movements")
				m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"] = "adjust", "adjust", id, h["adjust_no"], pid, h["warehouse_id"]
				m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = qty.String(), direction, cost.String(), qty.Mul(cost).String(), after.String(), user
				m["remark"] = fmt.Sprintf("库存调整 %s 行%d", value(h, "adjust_no"), l["line_no"])
				if value(l, "unit_id") != "" {
					m["unit_id"] = l["unit_id"]
				}
				if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
					return err
				}
			}
			update["status"], update["confirmed_at"], update["confirmed_by"] = "confirmed", now(), user
		default:
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, "stock_adjusts", id, update)
	})
	if err != nil {
		return nil, err
	}
	if action == "delete" {
		return nil, nil
	}
	return s.GetAdjustment(ctx, id)
}
