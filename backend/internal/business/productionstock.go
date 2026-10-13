package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

type ProductionDocument struct{ Table, Lines, FK, Number, Prefix, Date, Kind string }

var ProductionDocuments = map[string]ProductionDocument{
	"production-pickings": {"production_pickings", "production_picking_lines", "picking_id", "picking_no", "PP", "picking_date", "picking"},
	"production-returns":  {"production_returns", "production_return_lines", "return_id", "return_no", "PRT", "return_date", "return"},
	"production-receipts": {"production_receipts", "production_receipt_lines", "receipt_id", "receipt_no", "REC", "receipt_date", "receipt"},
}

func (s *Service) GetProductionDocument(ctx context.Context, d ProductionDocument, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, d.Table, id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public(d.Table, h)
	edges := map[string]any{}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.FK)+"=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	lines := []map[string]any{}
	for _, l := range rows {
		p, err := s.Store.Get(ctx, "products", value(l, "product_id"))
		if err != nil {
			return nil, err
		}
		item := s.Store.Public(d.Lines, l)
		item["edges"] = map[string]any{"product": s.Store.Public("products", p)}
		lines = append(lines, item)
	}
	if len(lines) > 0 {
		edges["lines"] = lines
	}
	if d.Kind != "return" {
		for relation, table := range map[string]string{"work_order": "work_orders", "warehouse": "warehouses"} {
			if value(h, relation+"_id") != "" {
				r, err := s.Store.Get(ctx, table, value(h, relation+"_id"))
				if err != nil {
					return nil, err
				}
				edges[relation] = s.Store.Public(table, r)
			}
		}
	}
	pub["edges"] = edges
	return pub, nil
}
func (s *Service) CreateProductionDocument(ctx context.Context, d ProductionDocument, input map[string]any, user string) (map[string]any, error) {
	id := ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if err := rejectAdvanced(input); err != nil {
			return err
		}
		if value(input, "work_order_id") == "" {
			return ErrUnsupported
		}
		order, err := s.Store.GetWith(ctx, tx, "work_orders", value(input, "work_order_id"))
		if err != nil {
			return err
		}
		state := value(order, "status")
		if state == "completed" || state == "cancelled" {
			return fmt.Errorf("工单状态（%s）不允许新建领料/入库/退料单", state)
		}
		if state != "in_progress" && !(d.Kind == "receipt" && state == "confirmed") {
			return ErrUnsupported
		}
		if value(input, "work_order_no") != "" && value(input, "work_order_no") != value(order, "order_no") {
			return errors.New("工单编号不一致")
		}
		if value(input, "warehouse_id") != value(order, "warehouse_id") {
			return errors.New("仓库与工单不一致")
		}
		if d.Kind == "return" && value(input, "reason") != "excess" {
			return ErrUnsupported
		}
		raw, ok := input["lines"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 1000 {
			return errors.New("单据明细不能为空且不超过1000行")
		}
		h := s.base(d.Table)
		no, err := s.nextNumber(ctx, tx, d.Prefix)
		if err != nil {
			return err
		}
		id = value(h, "id")
		h[d.Number], h["status"], h["work_order_id"], h["work_order_no"], h["warehouse_id"], h["created_by"] = no, "draft", order["id"], order["order_no"], order["warehouse_id"], user
		if d.Kind == "return" {
			h[d.Date] = now()
		}
		for _, k := range []string{d.Date, "remark", "reason"} {
			if input[k] != nil && s.Store.Has(d.Table, k) {
				h[k] = input[k]
			}
		}
		lines := []map[string]any{}
		totalQty, totalCost := decimal.Zero, decimal.Zero
		seen := map[string]bool{}
		for i, v := range raw {
			l, ok := v.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			if err := rejectAdvanced(l); err != nil {
				return err
			}
			p, err := s.plainProduct(ctx, tx, value(l, "product_id"), d.Kind == "receipt")
			if err != nil {
				return err
			}
			if seen[value(p, "id")] {
				return ErrUnsupported
			}
			seen[value(p, "id")] = true
			qty, err := Number(l["qty"])
			if err != nil {
				return err
			}
			cost, err := Number(l["unit_cost"])
			if err != nil {
				return err
			}
			if !qty.IsPositive() || cost.IsNegative() {
				return errors.New("数量必须大于零，成本不能为负")
			}

			row := s.base(d.Lines)
			row[d.FK], row["line_no"], row["product_id"], row["product_name"], row["product_code"], row["qty"], row["unit_cost"] = id, i+1, p["id"], p["name"], p["code"], qty.String(), cost.String()
			if s.Store.Has(d.Lines, "total_cost") {
				row["total_cost"] = qty.Mul(cost).String()
			}
			if l["remark"] != nil {
				row["remark"] = l["remark"]
			}
			lines = append(lines, row)
			totalQty = totalQty.Add(qty)
			totalCost = totalCost.Add(qty.Mul(cost))
		}
		if s.Store.Has(d.Table, "total_qty") {
			h["total_qty"] = totalQty.String()
		}
		if s.Store.Has(d.Table, "total_cost") {
			h["total_cost"] = totalCost.String()
		}
		if err := s.Store.InsertWith(ctx, tx, d.Table, h); err != nil {
			return err
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
	return s.GetProductionDocument(ctx, d, id)
}
func (s *Service) ConfirmProductionDocument(ctx context.Context, d ProductionDocument, id string) (map[string]any, error) {
	if d.Kind == "receipt" {
		return s.confirmProductionReceipt(ctx, d, id)
	}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的单据才能确认")
		}
		order, err := s.Store.GetWith(ctx, tx, "work_orders", value(h, "work_order_id"))
		if err != nil {
			return err
		}
		if value(order, "status") != "in_progress" {
			return ErrUnsupported
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.FK)+"=? AND deleted_at IS NULL ORDER BY line_no", id)
		if err != nil {
			return err
		}
		delta := decimal.Zero
		for _, l := range lines {
			if err := rejectAdvanced(l); err != nil {
				return err
			}
			if _, err := s.plainProduct(ctx, tx, value(l, "product_id"), d.Kind == "receipt"); err != nil {
				return err
			}
			materials, err := database.QueryRows(ctx, tx, "SELECT * FROM work_order_materials WHERE work_order_id=? AND product_id=? AND deleted_at IS NULL", order["id"], l["product_id"])
			if err != nil {
				return err
			}
			if len(materials) != 1 {
				return ErrUnsupported
			}
			material := materials[0]
			qty := readDecimal(l, "qty")
			issued, returned, required := readDecimal(material, "qty_issued"), readDecimal(material, "qty_returned"), readDecimal(material, "qty_required")
			b, err := s.balance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), d.Kind == "return")
			if err != nil {
				return err
			}
			available, avg := readDecimal(b, "qty_available"), readDecimal(b, "avg_cost")
			cost := readDecimal(l, "unit_cost")
			if cost.IsNegative() {
				return errors.New("成本不能为负")
			}
			direction, kind, source, remark, date := -1, "out", "production_picking", "生产领料", "last_out_at"
			if d.Kind == "picking" {
				remaining := required.Sub(issued).Add(returned)
				if qty.GreaterThan(remaining) {
					return fmt.Errorf("物料 %s 领料超需求：已领 %s，剩余可领 %s，本次 %s", value(material, "product_name"), issued.StringFixed(2), remaining.StringFixed(2), qty.StringFixed(2))
				}
				if available.LessThan(qty) {
					return errors.New("库存不足")
				}
				available = available.Sub(qty)
				issued = issued.Add(qty)
				delta = delta.Add(qty.Mul(cost))
				if err := s.Store.UpdateWith(ctx, tx, d.Lines, value(l, "id"), map[string]any{"picked_qty": qty.String(), "unit_cost": cost.String(), "updated_at": now()}); err != nil {
					return err
				}
			} else {
				if qty.GreaterThan(issued.Sub(returned)) {
					return errors.New("退料数量超过已领未退数量")
				}
				newQty := available.Add(qty)
				avg = available.Mul(avg).Add(qty.Mul(cost)).DivRound(newQty, 6)
				available = newQty
				returned = returned.Add(qty)
				delta = delta.Sub(qty.Mul(cost))
				direction, kind, source, remark, date = 1, "in", "production_return", "生产退料", "last_in_at"
			}
			if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": available.String(), "avg_cost": avg.String(), date: now(), "updated_at": now()}); err != nil {
				return err
			}
			if err := s.Store.UpdateWith(ctx, tx, "work_order_materials", value(material, "id"), map[string]any{"qty_issued": issued.String(), "qty_returned": returned.String(), "updated_at": now()}); err != nil {
				return err
			}
			m := s.base("stock_movements")
			for k, v := range map[string]any{"type": kind, "source_type": source, "source_id": id, "source_no": h[d.Number], "product_id": l["product_id"], "warehouse_id": h["warehouse_id"], "qty": qty.String(), "direction": direction, "unit_cost": cost.String(), "total_cost": qty.Mul(cost).String(), "balance_after": available.String(), "remark": remark} {
				m[k] = v
			}
			if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
				return err
			}
		}
		materialCost := readDecimal(order, "material_cost").Add(delta)
		if materialCost.IsNegative() {
			return errors.New("退料成本超过工单材料成本")
		}
		if err := s.Store.UpdateWith(ctx, tx, "work_orders", value(order, "id"), map[string]any{"material_cost": materialCost.String(), "total_cost": materialCost.Add(readDecimal(order, "labor_cost")).Add(readDecimal(order, "overhead_cost")).String(), "updated_at": now()}); err != nil {
			return err
		}
		changes := map[string]any{"status": "confirmed", "updated_at": now()}
		if d.Kind == "return" {
			changes[d.Date] = now()
		} else {
			changes["confirmed_at"] = now()
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, changes)
	})
	if err != nil {
		return nil, err
	}
	return s.GetProductionDocument(ctx, d, id)
}
