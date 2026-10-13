package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) GetWorkOrder(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "work_orders", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("work_orders", h)
	edges := map[string]any{}
	for relation, table := range map[string]string{"product": "products", "bom": "bo_ms", "warehouse": "warehouses", "routing": "routings"} {
		if value(h, relation+"_id") != "" {
			if relation == "routing" {
				rows, err := s.Store.Rows(ctx, "SELECT * FROM routings WHERE id=?", h["routing_id"])
				if err != nil {
					return nil, err
				}
				if len(rows) > 0 {
					edges[relation] = s.Store.Public(table, rows[0])
				}
				continue
			}
			r, err := s.Store.Get(ctx, table, value(h, relation+"_id"))
			if err != nil {
				return nil, err
			}
			edges[relation] = s.Store.Public(table, r)
		}
	}
	processes, err := s.Store.Rows(ctx, "SELECT * FROM work_order_processes WHERE work_order_id=? AND deleted_at IS NULL ORDER BY sequence", id)
	if err != nil {
		return nil, err
	}
	if len(processes) > 0 {
		rows := []map[string]any{}
		for _, p := range processes {
			rows = append(rows, s.Store.Public("work_order_processes", p))
		}
		edges["processes"] = rows
	}
	pub["edges"] = edges
	return pub, nil
}
func (s *Service) WriteWorkOrder(ctx context.Context, id, user string, input map[string]any) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var err error
		id, err = s.writeWorkOrderWith(ctx, tx, id, user, input)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.GetWorkOrder(ctx, id)
}

// Shared transaction helper also permits a generated batch to commit atomically.
func (s *Service) writeWorkOrderWith(ctx context.Context, tx *sql.Tx, id, user string, input map[string]any) (string, error) {
	creating := id == ""
	err := func() error {
		if !creating {
			var linked int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM work_order_processes WHERE work_order_id=? AND deleted_at IS NULL", id).Scan(&linked); err != nil {
				return err
			}
			if linked > 0 || value(input, "routing_id") != "" {
				return ErrUnsupported
			}
		}
		product, err := s.plainProduct(ctx, tx, value(input, "product_id"))
		if err != nil {
			return err
		}
		qty, err := Number(input["qty"])
		if err != nil {
			return err
		}
		if !qty.IsPositive() {
			return errors.New("生产数量必须大于零")
		}
		if _, err := s.Store.GetWith(ctx, tx, "warehouses", value(input, "warehouse_id")); err != nil {
			return errors.New("仓库不存在")
		}
		var h map[string]any
		if creating {
			h = s.base("work_orders")
			no, err := s.nextNumber(ctx, tx, "WO")
			if err != nil {
				return err
			}
			h["order_no"], h["status"], h["priority"], h["created_by"] = no, "draft", "normal", user
			id = value(h, "id")
		} else {
			h, err = s.Store.GetWith(ctx, tx, "work_orders", id)
			if err != nil {
				return err
			}
			if value(h, "bom_id") != value(input, "bom_id") || value(h, "product_id") != value(input, "product_id") {
				return ErrUnsupported
			}
			if value(h, "status") != "draft" {
				return errors.New("只有草稿状态的工单才能编辑")
			}
			h["updated_at"] = now()
		}
		h["product_id"], h["product_name"], h["product_code"], h["qty"], h["warehouse_id"] = product["id"], value(input, "product_name"), value(input, "product_code"), qty.String(), input["warehouse_id"]
		for _, k := range []string{"remark", "planned_start_date", "planned_end_date", "priority"} {
			if input[k] != nil {
				h[k] = input[k]
			}
		}
		bomID := value(input, "bom_id")
		var items []map[string]any
		qtyPer := decimal.NewFromInt(1)
		if bomID != "" {
			b, err := s.Store.GetWith(ctx, tx, "bo_ms", bomID)
			if err != nil {
				return err
			}
			if value(b, "product_id") != value(product, "id") {
				return errors.New("BOM产品与工单产品不一致")
			}
			if value(b, "status") != "active" {
				return errors.New("BOM未启用")
			}
			qtyPer = readDecimal(b, "qty_per")
			if !qtyPer.IsPositive() {
				return ErrUnsupported
			}
			items, err = database.QueryRows(ctx, tx, "SELECT * FROM bom_items WHERE bom_id=? AND deleted_at IS NULL ORDER BY line_no", bomID)
			if err != nil {
				return err
			}
			h["bom_id"] = bomID
		} else {
			h["bom_id"] = nil
		}
		if value(input, "routing_id") != "" {
			routing, err := s.Store.GetWith(ctx, tx, "routings", value(input, "routing_id"))
			if err != nil {
				return err
			}
			if value(routing, "product_id") != value(product, "id") || value(routing, "status") != "active" {
				return ErrUnsupported
			}
			h["routing_id"] = input["routing_id"]
		}
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "work_orders", h); err != nil {
				return err
			}
		} else {
			if err := s.Store.UpdateWith(ctx, tx, "work_orders", id, h); err != nil {
				return err
			}
		}
		if creating && value(h, "routing_id") != "" {
			if err := s.createWorkOrderProcesses(ctx, tx, h); err != nil {
				return err
			}
		}
		existingMaterials, err := database.QueryRows(ctx, tx, "SELECT product_id FROM work_order_materials WHERE work_order_id=? AND deleted_at IS NULL", id)
		if err != nil {
			return err
		}
		allowed := map[string]bool{}
		for _, l := range items {
			allowed[value(l, "product_id")] = true
		}
		for _, m := range existingMaterials {
			if !allowed[value(m, "product_id")] {
				return ErrUnsupported
			}
		}
		for _, l := range items {
			if readDecimal(l, "scrap_rate").IsNegative() {
				return ErrUnsupported
			}
			var rows []map[string]any
			if !creating {
				rows, err = database.QueryRows(ctx, tx, "SELECT * FROM work_order_materials WHERE work_order_id=? AND product_id=? AND deleted_at IS NULL ORDER BY created_at", id, l["product_id"])
				if err != nil {
					return err
				}
			}
			m := s.base("work_order_materials")
			required := qty.Div(qtyPer).Mul(readDecimal(l, "qty")).Mul(decimal.NewFromInt(1).Add(readDecimal(l, "scrap_rate").Div(decimal.NewFromInt(100))))
			for k, v := range map[string]any{"work_order_id": id, "product_id": l["product_id"], "product_code": l["product_code"], "product_name": l["product_name"], "unit_id": l["unit_id"], "qty_required": required.String()} {
				m[k] = v
			}
			if len(rows) == 0 {
				if err := s.Store.InsertWith(ctx, tx, "work_order_materials", m); err != nil {
					return err
				}
			} else {
				// Original sync indexes materials by product, so the last duplicate
				// receives each matching BOM update; earlier duplicate rows remain.
				if err := s.Store.UpdateWith(ctx, tx, "work_order_materials", value(rows[len(rows)-1], "id"), map[string]any{"qty_required": required.String(), "updated_at": now()}); err != nil {
					return err
				}
			}
		}
		return nil
	}()
	return id, err
}
func (s *Service) WorkOrderAction(ctx context.Context, id, user, action string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var flows int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM approval_flows WHERE is_active=1 AND deleted_at IS NULL").Scan(&flows); err != nil {
			return err
		}
		if flows > 0 {
			return ErrUnsupported
		}
		h, err := s.Store.GetWith(ctx, tx, "work_orders", id)
		if err != nil {
			return err
		}
		state := value(h, "status")
		changes := map[string]any{"updated_at": now()}
		switch action {
		case "confirm":
			if state != "draft" {
				return errors.New("只有草稿状态的工单才能确认")
			}
			changes["status"], changes["confirmed_at"] = "confirmed", now()
		case "approve":
			if state != "confirmed" {
				return errors.New("只有已确认的工单才能审批")
			}
			changes["status"], changes["approved_by"], changes["approved_at"], changes["actual_start_date"] = "in_progress", user, now(), now()
		case "cancel":
			var posted int
			for _, table := range []string{"production_pickings", "production_returns", "production_receipts"} {
				var n int
				if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM "+database.Quote(table)+" WHERE work_order_id=? AND status='confirmed' AND deleted_at IS NULL", id).Scan(&n); err != nil {
					return err
				}
				posted += n
			}
			if posted > 0 {
				return errors.New("工单已发生领料/退料/完工入库，不能取消（请先完成或做反向处理后工单）")
			}
			if state != "draft" && state != "confirmed" {
				return errors.New("只有草稿或已确认的工单才能取消")
			}
			changes["status"] = "cancelled"
		case "complete":
			if state != "in_progress" {
				return errors.New("只有生产中的工单才能完成")
			}
			var pendingProcesses int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM work_order_processes WHERE work_order_id=? AND deleted_at IS NULL AND status!='completed'", id).Scan(&pendingProcesses); err != nil {
				return err
			}
			if pendingProcesses > 0 {
				return errors.New("存在未完成的工序，无法完成工单")
			}
			rows, err := database.QueryRows(ctx, tx, "SELECT * FROM work_order_materials WHERE work_order_id=? AND deleted_at IS NULL", id)
			if err != nil {
				return err
			}
			for _, m := range rows {
				pending := readDecimal(m, "qty_required").Sub(readDecimal(m, "qty_issued")).Add(readDecimal(m, "qty_returned"))
				if pending.IsPositive() {
					return fmt.Errorf("物料 %s 尚有 %s 未领足，无法完成工单", value(m, "product_name"), pending.StringFixed(2))
				}
			}
			changes["status"], changes["completed_qty"], changes["actual_end_date"] = "completed", h["qty"], now()
		default:
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, "work_orders", id, changes)
	})
	if err != nil {
		return nil, err
	}
	return s.GetWorkOrder(ctx, id)
}
func (s *Service) WorkOrderMaterials(ctx context.Context, id, mode string) ([]map[string]any, error) {
	h, err := s.Store.Get(ctx, "work_orders", id)
	if err != nil {
		return nil, err
	}
	result := []map[string]any{}
	if mode == "bom-items" {
		if value(h, "bom_id") == "" {
			return result, nil
		}
		// Original endpoint includes old soft-deleted BOM items; other demand views
		// use the active snapshot. Preserve the captured discrepancy explicitly.
		rows, err := s.Store.Rows(ctx, "SELECT * FROM bom_items WHERE bom_id=? ORDER BY created_at", h["bom_id"])
		if err != nil {
			return nil, err
		}
		for _, l := range rows {
			p, err := s.Store.Get(ctx, "products", value(l, "product_id"))
			if err != nil {
				return nil, err
			}
			cost := readDecimal(p, "purchase_price")
			b, err := s.Store.Rows(ctx, "SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=?", l["product_id"], h["warehouse_id"])
			if err != nil {
				return nil, err
			}
			if len(b) > 0 {
				cost = readDecimal(b[0], "avg_cost")
			}
			unitName := ""
			if value(l, "unit_id") != "" {
				u, err := s.Store.Get(ctx, "units", value(l, "unit_id"))
				if err != nil {
					return nil, err
				}
				unitName = value(u, "name")
			}
			result = append(result, map[string]any{"product_id": p["id"], "product_code": p["code"], "product_name": p["name"], "unit_id": l["unit_id"], "unit_name": unitName, "qty": readDecimal(h, "qty").Mul(readDecimal(l, "qty")).String(), "unit_cost": cost.String()})
		}
		return result, nil
	}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM work_order_materials WHERE work_order_id=? AND deleted_at IS NULL ORDER BY created_at", id)
	if err != nil {
		return nil, err
	}
	for _, m := range rows {
		issued, returned, required := readDecimal(m, "qty_issued"), readDecimal(m, "qty_returned"), readDecimal(m, "qty_required")
		pending := decimal.Max(decimal.Zero, required.Sub(issued).Add(returned))
		if mode == "material-availability" {
			balance, err := s.Store.Rows(ctx, "SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=?", m["product_id"], h["warehouse_id"])
			if err != nil {
				return nil, err
			}
			available := decimal.Zero
			for _, b := range balance {
				available = available.Add(readDecimal(b, "qty_available"))
			}
			shortage := decimal.Max(decimal.Zero, pending.Sub(available))
			status := "ok"
			if shortage.IsPositive() {
				status = "shortage"
			}
			result = append(result, map[string]any{"product_id": m["product_id"], "product_code": m["product_code"], "product_name": m["product_name"], "required": required.String(), "picked": issued.Sub(returned).String(), "available": available.String(), "shortage": shortage.String(), "status": status})
		} else {
			unitName := ""
			if value(m, "unit_id") != "" {
				u, err := s.Store.Get(ctx, "units", value(m, "unit_id"))
				if err != nil {
					return nil, err
				}
				unitName = value(u, "name")
			}
			result = append(result, map[string]any{"id": m["id"], "work_order_id": id, "product_id": m["product_id"], "product_code": m["product_code"], "product_name": m["product_name"], "unit_id": m["unit_id"], "unit_name": unitName, "qty_required": required.String(), "qty_issued": issued.String(), "qty_returned": returned.String(), "qty_pending": pending.String(), "remark": value(m, "remark")})
		}
	}
	return result, nil
}
