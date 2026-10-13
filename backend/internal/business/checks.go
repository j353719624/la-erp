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

func (s *Service) GetCheck(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "inventory_checks", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("inventory_checks", h)
	lines := []map[string]any{}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM inventory_check_lines WHERE check_id=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	for _, l := range rows {
		p, err := s.Store.Get(ctx, "products", value(l, "product_id"))
		if err != nil {
			return nil, err
		}
		r := s.Store.Public("inventory_check_lines", l)
		r["edges"] = map[string]any{"product": s.product(ctx, p, true)}
		lines = append(lines, r)
	}
	pub["edges"] = map[string]any{"lines": lines}
	return pub, nil
}

func (s *Service) WriteCheck(ctx context.Context, id string, input map[string]any, user string) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if err := rejectAdvanced(input); err != nil {
			return err
		}
		wh := value(input, "warehouse_id")
		if _, err := s.Store.GetWith(ctx, tx, "warehouses", wh); err != nil {
			return errors.New("仓库不存在")
		}
		h := s.base("inventory_checks")
		old := map[string]map[string]any{}
		if !creating {
			var err error
			h, err = s.Store.GetWith(ctx, tx, "inventory_checks", id)
			if err != nil {
				return err
			}
			if value(h, "status") != "draft" && value(h, "status") != "checking" {
				return errors.New("只有草稿或盘点中的盘点单才能编辑")
			}
			if wh != value(h, "warehouse_id") {
				return ErrUnsupported
			}
			rows, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_check_lines WHERE check_id=? AND deleted_at IS NULL", id)
			if err != nil {
				return err
			}
			for _, r := range rows {
				old[value(r, "product_id")] = r
			}
		}
		raw, ok := input["lines"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 1000 {
			return errors.New("盘点明细不能为空且不超过1000行")
		}
		if creating {
			no, err := s.nextNumber(ctx, tx, "IC")
			if err != nil {
				return err
			}
			h["check_no"], h["status"], h["created_by"] = no, "draft", user
		}
		h["warehouse_id"], h["remark"], h["updated_by"], h["updated_at"], h["total_items"] = wh, value(input, "remark"), user, now(), len(raw)
		if date := value(input, "check_date"); date != "" {
			if _, err := time.Parse(time.RFC3339Nano, date); err != nil {
				return errors.New("日期格式错误")
			}
			h["check_date"] = date
		}
		id = value(h, "id")
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
			actual, err := Number(in["actual_qty"])
			if err != nil || actual.IsNegative() {
				return errors.New("实盘数量格式错误")
			}
			book := decimal.Zero
			if value(h, "status") == "checking" {
				previous := old[pid]
				if previous == nil {
					return ErrUnsupported
				}
				book = readDecimal(previous, "book_qty")
				b, err := s.balance(ctx, tx, pid, wh, false)
				if err != nil {
					return err
				}
				if !book.Equal(readDecimal(b, "qty_available")) {
					return ErrUnsupported
				}
			}
			diff := actual.Sub(book)
			kind := "none"
			if diff.IsPositive() {
				kind = "profit"
			} else if diff.IsNegative() {
				kind = "loss"
			}
			l := s.base("inventory_check_lines")
			l["check_id"], l["line_no"], l["product_id"], l["book_qty"], l["actual_qty"], l["diff_qty"], l["diff_type"] = id, i+1, pid, book.String(), actual.String(), diff.String(), kind
			for _, k := range []string{"product_name", "product_code", "remark"} {
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
			lines = append(lines, l)
		}
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "inventory_checks", h); err != nil {
				return err
			}
		} else {
			delete(h, "id")
			if err := s.Store.UpdateWith(ctx, tx, "inventory_checks", id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE inventory_check_lines SET deleted_at=? WHERE check_id=? AND deleted_at IS NULL", now(), id); err != nil {
				return err
			}
		}
		for _, l := range lines {
			if err := s.Store.InsertWith(ctx, tx, "inventory_check_lines", l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetCheck(ctx, id)
}

func (s *Service) CheckAction(ctx context.Context, id, action, user string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "inventory_checks", id)
		if err != nil {
			return err
		}
		state := value(h, "status")
		changes := map[string]any{"updated_at": now()}
		switch action {
		case "delete":
			if state != "draft" {
				return errors.New("只有草稿状态的盘点单才能删除")
			}
			changes["deleted_at"] = now()
		case "cancel":
			if state != "draft" && state != "checking" {
				return errors.New("只有草稿或盘点中的盘点单才能取消")
			}
			changes["status"] = "cancelled"
		case "start", "complete":
			if action == "start" && state != "draft" {
				return errors.New("只有草稿状态的盘点单才能开始盘点")
			}
			if action == "complete" && state != "checking" {
				return errors.New("只有盘点中的盘点单才能完成")
			}
			rows, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_check_lines WHERE check_id=? AND deleted_at IS NULL ORDER BY line_no", id)
			if err != nil {
				return err
			}
			profit, loss := decimal.Zero, decimal.Zero
			profits, losses := 0, 0
			for _, l := range rows {
				pid := value(l, "product_id")
				b, err := s.balance(ctx, tx, pid, value(h, "warehouse_id"), true)
				if err != nil {
					return err
				}
				available := readDecimal(b, "qty_available")
				if action == "start" {
					if err := s.Store.UpdateWith(ctx, tx, "inventory_check_lines", value(l, "id"), map[string]any{"book_qty": available.String(), "actual_qty": available.String(), "diff_qty": "0", "diff_type": "none", "diff_amount": "0", "updated_at": now()}); err != nil {
						return err
					}
					continue
				}
				// Apply the counted difference to the current balance; intervening
				// stock movements are retained, matching the original runtime.
				diff := readDecimal(l, "diff_qty")
				if diff.IsZero() {
					continue
				}
				qty := diff.Abs()
				cost := readDecimal(l, "unit_cost")
				kind := "out"
				direction := int64(-1)
				stamp := "last_out_at"
				if diff.IsPositive() {
					kind, direction, stamp = "in", 1, "last_in_at"
					cost = readDecimal(b, "avg_cost")
					profit = profit.Add(qty.Mul(cost))
					profits++
					if err := s.Store.UpdateWith(ctx, tx, "inventory_check_lines", value(l, "id"), map[string]any{"unit_cost": cost.String(), "diff_amount": qty.Mul(cost).String(), "updated_at": now()}); err != nil {
						return err
					}
				} else {
					loss = loss.Add(qty.Mul(cost))
					losses++
				}
				after := available.Add(diff)
				if after.IsNegative() {
					return errors.New("库存不足")
				}
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": after.String(), stamp: now(), "updated_at": now()}); err != nil {
					return err
				}
				m := s.base("stock_movements")
				m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"] = kind, "check", id, h["check_no"], pid, h["warehouse_id"]
				m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = qty.String(), direction, cost.String(), qty.Mul(cost).String(), after.String(), user
				m["remark"] = fmt.Sprintf("盘点调整 %s 行%d", value(h, "check_no"), l["line_no"])
				if value(l, "unit_id") != "" {
					m["unit_id"] = l["unit_id"]
				}
				if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
					return err
				}
			}
			if action == "start" {
				changes["status"] = "checking"
			} else {
				changes["status"], changes["completed_at"], changes["profit_items"], changes["loss_items"], changes["profit_amount"], changes["loss_amount"] = "completed", now(), profits, losses, profit.String(), loss.String()
			}
		default:
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, "inventory_checks", id, changes)
	})
	if err != nil {
		return nil, err
	}
	if action == "delete" {
		return nil, nil
	}
	return s.GetCheck(ctx, id)
}
