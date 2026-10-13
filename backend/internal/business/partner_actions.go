package business

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
	"time"
)

func (s *Service) ConfirmLoan(ctx context.Context, id, user string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "loan_orders", id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的借用单才能确认")
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM loan_order_lines WHERE loan_order_id=? AND deleted_at IS NULL", id)
		if err != nil {
			return err
		}
		if len(lines) == 0 {
			return errors.New("单据明细不能为空")
		}
		for _, l := range lines {
			qty := readDecimal(l, "qty")
			b, e := s.trackingBalance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), value(l, "batch_no"), false)
			if e != nil {
				return e
			}
			available := readDecimal(b, "qty_available")
			if available.LessThan(qty) {
				return errors.New("库存不足")
			}
			cost := readDecimal(b, "avg_cost")
			if e = s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": available.Sub(qty).String(), "last_out_at": now(), "updated_at": now()}); e != nil {
				return e
			}
			m := s.base("stock_movements")
			m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"], m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = "out", "loan", id, value(h, "loan_no"), l["product_id"], h["warehouse_id"], qty.String(), -1, cost.String(), qty.Mul(cost).String(), available.Sub(qty).String(), user
			copyStockTracking(s, m, l)
			if e = s.Store.InsertWith(ctx, tx, "stock_movements", m); e != nil {
				return e
			}
		}
		return s.Store.UpdateWith(ctx, tx, "loan_orders", id, map[string]any{"status": "confirmed", "updated_at": time.Now(), "confirmed_at": time.Now()})
	})
	if err != nil {
		return nil, err
	}
	return s.GetPartnerDocument(ctx, "loan_orders", id)
}

func (s *Service) ConfirmConsignment(ctx context.Context, id, user string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "consignment_orders", id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的寄售单才能确认")
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM consignment_order_lines WHERE order_id=? AND deleted_at IS NULL", id)
		if err != nil {
			return err
		}
		if len(lines) == 0 {
			return errors.New("单据明细不能为空")
		}
		for _, l := range lines {
			qty := readDecimal(l, "qty")
			b, e := s.trackingBalance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), value(l, "batch_no"), false)
			if e != nil {
				return e
			}
			available := readDecimal(b, "qty_available")
			if available.LessThan(qty) {
				return errors.New("库存不足")
			}
			cost := readDecimal(b, "avg_cost")
			if e = s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": available.Sub(qty).String(), "last_out_at": now(), "updated_at": now()}); e != nil {
				return e
			}
			m := s.base("stock_movements")
			m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"], m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = "out", "consignment", id, value(h, "consignment_no"), l["product_id"], h["warehouse_id"], qty.String(), -1, cost.String(), qty.Mul(cost).String(), available.Sub(qty).String(), user
			copyStockTracking(s, m, l)
			if e = s.Store.InsertWith(ctx, tx, "stock_movements", m); e != nil {
				return e
			}
		}
		return s.Store.UpdateWith(ctx, tx, "consignment_orders", id, map[string]any{"status": "confirmed", "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.GetPartnerDocument(ctx, "consignment_orders", id)
}

func (s *Service) ReturnConsignment(ctx context.Context, id, user string, input map[string]any) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "consignment_orders", id)
		if err != nil {
			return err
		}
		if value(h, "status") != "confirmed" && value(h, "status") != "partial" {
			return errors.New("当前状态不允许退回")
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM consignment_order_lines WHERE order_id=? AND deleted_at IS NULL", id)
		if err != nil {
			return err
		}
		for _, raw := range inputLines(input) {
			m, ok := raw.(map[string]any)
			if !ok {
				return errors.New("退回明细格式错误")
			}
			lid := value(m, "id")
			qty, e := Number(value(m, "qty"))
			if e != nil || !qty.IsPositive() {
				return errors.New("退回数量必须大于0")
			}
			var line map[string]any
			for _, x := range lines {
				if value(x, "id") == lid {
					line = x
					break
				}
			}
			if line == nil {
				return errors.New("寄售明细不存在")
			}
			if err := s.restorePartnerSerials(ctx, tx, line, m); err != nil {
				return err
			}
			remain := readDecimal(line, "qty").Sub(readDecimal(line, "returned_qty")).Sub(readDecimal(line, "sold_qty"))
			if qty.GreaterThan(remain) {
				return errors.New("退回数量超过可退数量")
			}
			b, e := s.trackingBalance(ctx, tx, value(line, "product_id"), value(h, "warehouse_id"), value(line, "batch_no"), true)
			if e != nil {
				return e
			}
			avail := readDecimal(b, "qty_available")
			cost := readDecimal(line, "unit_cost")
			if e = s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": avail.Add(qty).String(), "last_in_at": now(), "updated_at": now()}); e != nil {
				return e
			}
			mvt := s.base("stock_movements")
			mvt["type"], mvt["source_type"], mvt["source_id"], mvt["source_no"], mvt["product_id"], mvt["warehouse_id"], mvt["qty"], mvt["direction"], mvt["unit_cost"], mvt["total_cost"], mvt["balance_after"], mvt["operator_id"] = "in", "consignment_return", id, value(h, "consignment_no"), line["product_id"], h["warehouse_id"], qty.String(), 1, cost.String(), qty.Mul(cost).String(), avail.Add(qty).String(), user
			copyStockTracking(s, mvt, line)
			if e = s.Store.InsertWith(ctx, tx, "stock_movements", mvt); e != nil {
				return e
			}
			if e = s.Store.UpdateWith(ctx, tx, "consignment_order_lines", lid, map[string]any{"returned_qty": readDecimal(line, "returned_qty").Add(qty).String(), "updated_at": now()}); e != nil {
				return e
			}
			line["returned_qty"] = readDecimal(line, "returned_qty").Add(qty).String()
		}
		all := true
		for _, line := range lines {
			if readDecimal(line, "returned_qty").Add(readDecimal(line, "sold_qty")).LessThan(readDecimal(line, "qty")) {
				all = false
				break
			}
		}
		status := "partial"
		if all {
			status = "returned"
		}
		return s.Store.UpdateWith(ctx, tx, "consignment_orders", id, map[string]any{"status": status, "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.GetPartnerDocument(ctx, "consignment_orders", id)
}

func (s *Service) SellConsignment(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "consignment_orders", id)
		if err != nil {
			return err
		}
		if value(h, "status") != "confirmed" && value(h, "status") != "partial" {
			return errors.New("当前状态不允许售出")
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM consignment_order_lines WHERE order_id=? AND deleted_at IS NULL", id)
		if err != nil {
			return err
		}
		for _, raw := range inputLines(input) {
			m, ok := raw.(map[string]any)
			if !ok {
				return errors.New("售出明细格式错误")
			}
			lid := value(m, "id")
			qty, e := Number(value(m, "qty"))
			if e != nil || !qty.IsPositive() {
				return errors.New("售出数量必须大于0")
			}
			var line map[string]any
			for _, x := range lines {
				if value(x, "id") == lid {
					line = x
					break
				}
			}
			if line == nil {
				return errors.New("寄售明细不存在")
			}
			remain := readDecimal(line, "qty").Sub(readDecimal(line, "sold_qty")).Sub(readDecimal(line, "returned_qty"))
			if qty.GreaterThan(remain) {
				return errors.New("售出数量超过可售数量")
			}
			if e = s.Store.UpdateWith(ctx, tx, "consignment_order_lines", lid, map[string]any{"sold_qty": readDecimal(line, "sold_qty").Add(qty).String(), "updated_at": now()}); e != nil {
				return e
			}
			line["sold_qty"] = readDecimal(line, "sold_qty").Add(qty).String()
		}
		all := true
		for _, line := range lines {
			if readDecimal(line, "sold_qty").Add(readDecimal(line, "returned_qty")).LessThan(readDecimal(line, "qty")) {
				all = false
				break
			}
		}
		status := "partial"
		if all {
			status = "sold"
		}
		return s.Store.UpdateWith(ctx, tx, "consignment_orders", id, map[string]any{"status": status, "sold_qty": s.sumPartnerLines(lines, "sold_qty"), "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.GetPartnerDocument(ctx, "consignment_orders", id)
}

func (s *Service) CancelPartner(ctx context.Context, table, id, user string) (map[string]any, error) {
	returnValue := ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, e := s.Store.GetWith(ctx, tx, table, id)
		if e != nil {
			return e
		}
		status := value(h, "status")
		if status != "draft" && status != "confirmed" {
			return errors.New("当前状态不允许取消")
		}
		if status == "confirmed" {
			lineTable, fk := "loan_order_lines", "loan_order_id"
			source := "loan_cancel"
			number := "loan_no"
			if table == "consignment_orders" {
				lineTable, fk, source, number = "consignment_order_lines", "order_id", "consignment_cancel", "consignment_no"
			}
			lines, e := database.QueryRows(ctx, tx, "SELECT * FROM "+lineTable+" WHERE "+fk+"=? AND deleted_at IS NULL", id)
			if e != nil {
				return e
			}
			for _, l := range lines {
				qty := readDecimal(l, "qty")
				if table == "loan_orders" {
					qty = qty.Sub(readDecimal(l, "returned_qty"))
				} else {
					qty = qty.Sub(readDecimal(l, "returned_qty")).Sub(readDecimal(l, "sold_qty"))
				}
				if !qty.IsPositive() {
					continue
				}
				b, e := s.trackingBalance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), value(l, "batch_no"), true)
				if e != nil {
					return e
				}
				avail := readDecimal(b, "qty_available")
				cost := readDecimal(l, "unit_cost")
				if e = s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": avail.Add(qty).String(), "last_in_at": now(), "updated_at": now()}); e != nil {
					return e
				}
				m := s.base("stock_movements")
				m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"], m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = "in", source, id, value(h, number), l["product_id"], h["warehouse_id"], qty.String(), 1, cost.String(), qty.Mul(cost).String(), avail.Add(qty).String(), user
				copyStockTracking(s, m, l)
				if e = s.Store.InsertWith(ctx, tx, "stock_movements", m); e != nil {
					return e
				}
			}
		}
		returnValue = id
		return s.Store.UpdateWith(ctx, tx, table, id, map[string]any{"status": "cancelled", "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.GetPartnerDocument(ctx, table, returnValue)
}

func (s *Service) sumPartnerLines(lines []map[string]any, key string) string {
	total := decimal.Zero
	for _, l := range lines {
		total = total.Add(readDecimal(l, key))
	}
	return total.String()
}

func (s *Service) ReturnLoan(ctx context.Context, id, user string, input map[string]any) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "loan_orders", id)
		if err != nil {
			return err
		}
		if value(h, "status") != "confirmed" && value(h, "status") != "partial" {
			return errors.New("当前状态不允许归还")
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM loan_order_lines WHERE loan_order_id=? AND deleted_at IS NULL", id)
		if err != nil {
			return err
		}
		for _, raw := range inputLines(input) {
			m, ok := raw.(map[string]any)
			if !ok {
				return errors.New("归还明细格式错误")
			}
			lid := value(m, "id")
			qty, e := Number(value(m, "qty"))
			if e != nil || !qty.IsPositive() {
				return errors.New("归还数量必须大于0")
			}
			var line map[string]any
			for _, x := range lines {
				if value(x, "id") == lid {
					line = x
					break
				}
			}
			if line == nil {
				return errors.New("借用明细不存在")
			}
			if err := s.restorePartnerSerials(ctx, tx, line, m); err != nil {
				return err
			}
			remain := readDecimal(line, "qty").Sub(readDecimal(line, "returned_qty"))
			if qty.GreaterThan(remain) {
				return errors.New("归还数量超过未归还数量")
			}
			b, e := s.trackingBalance(ctx, tx, value(line, "product_id"), value(h, "warehouse_id"), value(line, "batch_no"), true)
			if e != nil {
				return e
			}
			avail := readDecimal(b, "qty_available")
			cost := readDecimal(line, "unit_cost")
			if e = s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": avail.Add(qty).String(), "last_in_at": now(), "updated_at": now()}); e != nil {
				return e
			}
			mvt := s.base("stock_movements")
			mvt["type"], mvt["source_type"], mvt["source_id"], mvt["source_no"], mvt["product_id"], mvt["warehouse_id"], mvt["qty"], mvt["direction"], mvt["unit_cost"], mvt["total_cost"], mvt["balance_after"], mvt["operator_id"] = "in", "loan_return", id, value(h, "loan_no"), line["product_id"], h["warehouse_id"], qty.String(), 1, cost.String(), qty.Mul(cost).String(), avail.Add(qty).String(), user
			copyStockTracking(s, mvt, line)
			if e = s.Store.InsertWith(ctx, tx, "stock_movements", mvt); e != nil {
				return e
			}
			if e = s.Store.UpdateWith(ctx, tx, "loan_order_lines", lid, map[string]any{"returned_qty": readDecimal(line, "returned_qty").Add(qty).String(), "updated_at": now()}); e != nil {
				return e
			}
			line["returned_qty"] = readDecimal(line, "returned_qty").Add(qty).String()
		}
		allReturned := true
		for _, line := range lines {
			if readDecimal(line, "returned_qty").LessThan(readDecimal(line, "qty")) {
				allReturned = false
				break
			}
		}
		status := "partial"
		if allReturned {
			status = "returned"
		}
		return s.Store.UpdateWith(ctx, tx, "loan_orders", id, map[string]any{"status": status, "updated_at": now()})
	})
	if err != nil {
		return nil, fmt.Errorf("归还失败: %w", err)
	}
	return s.GetPartnerDocument(ctx, "loan_orders", id)
}

func (s *Service) restorePartnerSerials(ctx context.Context, tx *sql.Tx, line, request map[string]any) error {
	var raw []any
	if v, ok := request["serial_nos"].([]any); ok {
		raw = v
	}
	if len(raw) == 0 {
		if v, ok := line["serial_nos"].(string); ok && v != "" {
			_ = json.Unmarshal([]byte(v), &raw)
		}
	}
	if len(raw) == 0 {
		return nil
	}
	for _, item := range raw {
		serial, ok := item.(string)
		if !ok || serial == "" {
			return errors.New("序列号格式错误")
		}
		rows, err := database.QueryRows(ctx, tx, "SELECT * FROM serial_numbers WHERE serial_no=? AND deleted_at IS NULL", serial)
		if err != nil {
			return err
		}
		if len(rows) != 1 || value(rows[0], "status") != "out" || value(rows[0], "product_id") != value(line, "product_id") {
			return errors.New("序列号不存在或不在出库状态")
		}
		if err := s.Store.UpdateWith(ctx, tx, "serial_numbers", value(rows[0], "id"), map[string]any{"status": "in_stock", "out_at": nil, "updated_at": now()}); err != nil {
			return err
		}
	}
	return nil
}

func inputLines(input map[string]any) []any {
	if v, ok := input["lines"].([]any); ok {
		return v
	}
	return nil
}

func copyStockTracking(s *Service, movement, line map[string]any) {
	for _, key := range []string{"batch_no", "serial_nos", "production_date", "expiry_date"} {
		if s.Store.Has("stock_movements", key) && line[key] != nil {
			movement[key] = line[key]
		}
	}
}
