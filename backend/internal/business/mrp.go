package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
	"sort"
)

// RunMRP reconstructs the packaged program's confirmed sales and active work
// order calculation. Advanced BOM variants remain explicit unsupported branches.
func (s *Service) RunMRP(ctx context.Context) (map[string]any, error) {
	var id string
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		sales, err := database.QueryRows(ctx, tx, "SELECT * FROM sales_orders WHERE deleted_at IS NULL AND status IN ('confirmed','approved')")
		if err != nil {
			return err
		}
		work, err := database.QueryRows(ctx, tx, "SELECT * FROM work_orders WHERE deleted_at IS NULL AND status IN ('confirmed','in_progress')")
		if err != nil {
			return err
		}
		demand := map[string]decimal.Decimal{}
		add := func(product string, qty decimal.Decimal) { demand[product] = demand[product].Add(qty) }
		for _, order := range sales {
			lines, err := database.QueryRows(ctx, tx, "SELECT * FROM sales_order_lines WHERE order_id=? AND deleted_at IS NULL", order["id"])
			if err != nil {
				return err
			}
			for _, line := range lines {
				qty := readDecimal(line, "qty")
				if !qty.IsPositive() {
					continue
				}
				if err := s.explodeMRP(ctx, tx, value(line, "product_id"), qty, 0, map[string]bool{}, add); err != nil {
					return err
				}
			}
		}

		for _, order := range work {
			bomID := value(order, "bom_id")
			if bomID == "" {
				continue
			}
			items, err := database.QueryRows(ctx, tx, "SELECT * FROM bom_items WHERE bom_id=? AND deleted_at IS NULL ORDER BY line_no", bomID)
			if err != nil {
				return err
			}
			for _, item := range items {
				scrap := readDecimal(item, "scrap_rate")
				if scrap.IsNegative() {
					return ErrUnsupported
				}
				quantity := readDecimal(order, "qty").Mul(readDecimal(item, "qty")).Mul(decimal.NewFromInt(1).Add(scrap))
				if err = s.explodeMRP(ctx, tx, value(item, "product_id"), quantity, 1, map[string]bool{value(order, "product_id"): true}, add); err != nil {
					return err
				}
			}
		}

		header := s.base("material_requirements")
		id = value(header, "id")
		number, err := s.nextNumber(ctx, tx, "MRP")
		if err != nil {
			return err
		}
		header["mrp_no"], header["plan_date"], header["status"] = number, now(), "computed"
		header["demand_source_count"] = len(sales) + len(work)
		header["remark"] = fmt.Sprintf("需求源：销售订单 %d 张 / 在制工单 %d 张", len(sales), len(work))
		if err = s.Store.InsertWith(ctx, tx, "material_requirements", header); err != nil {
			return err
		}
		suggestion := s.base("purchase_suggestions")
		ps, err := s.nextNumber(ctx, tx, "PS")
		if err != nil {
			return err
		}
		suggestion["suggestion_no"], suggestion["mrp_id"], suggestion["mrp_no"] = ps, id, number
		suggestion["plan_date"], suggestion["status"], suggestion["remark"] = now(), "draft", "由物料需求计划生成"
		if err = s.Store.InsertWith(ctx, tx, "purchase_suggestions", suggestion); err != nil {
			return err
		}
		keys := []string{}
		for key := range demand {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, productID := range keys {
			product, err := s.plainProduct(ctx, tx, productID)
			if err != nil {
				return err
			}
			balances, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_balances WHERE product_id=?", productID)
			if err != nil {
				return err
			}
			available := decimal.Zero
			for _, balance := range balances {
				available = available.Add(readDecimal(balance, "qty_available"))
			}
			purchase, err := database.QueryRows(ctx, tx, "SELECT l.* FROM purchase_order_lines l JOIN purchase_orders h ON h.id=l.order_id WHERE l.product_id=? AND l.deleted_at IS NULL AND h.deleted_at IS NULL AND h.status IN ('confirmed','approved')", productID)
			if err != nil {
				return err
			}
			onOrder := decimal.Zero
			for _, line := range purchase {
				onOrder = onOrder.Add(readDecimal(line, "qty"))
			}
			wip := decimal.Zero
			for _, order := range work {
				if value(order, "product_id") == productID {
					wip = wip.Add(readDecimal(order, "qty"))
				}
			}
			net := demand[productID].Sub(available).Sub(onOrder).Sub(wip)
			if net.IsNegative() {
				net = decimal.Zero
			}
			if readDecimal(product, "safety_stock").Sub(available).GreaterThan(net) {
				net = readDecimal(product, "safety_stock").Sub(available)
			}
			suggested := net
			if lot := readDecimal(product, "min_order_qty"); lot.IsPositive() && net.IsPositive() {
				suggested = net.DivRound(lot, 16).Ceil().Mul(lot)
			}
			boms, err := database.QueryRows(ctx, tx, "SELECT id FROM bo_ms WHERE product_id=? AND status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", productID)
			if err != nil {
				return err
			}
			kind := "purchase"
			if len(boms) > 0 {
				kind = "production"
			}
			line := s.base("material_requirement_lines")
			for k, v := range map[string]any{"mrp_id": id, "product_id": productID, "product_code": product["code"], "product_name": product["name"], "requirement_type": kind, "gross_demand": demand[productID].String(), "available_qty": available.String(), "on_order_qty": onOrder.String(), "wip_qty": wip.String(), "safety_stock": readDecimal(product, "safety_stock").String(), "net_requirement": net.String(), "suggested_qty": suggested.String(), "status": "suggested"} {
				line[k] = v
			}
			if err = s.Store.InsertWith(ctx, tx, "material_requirement_lines", line); err != nil {
				return err
			}
			if kind == "purchase" && net.IsPositive() {
				row := s.base("purchase_suggestion_lines")
				for k, v := range map[string]any{"suggestion_id": suggestion["id"], "product_id": productID, "product_code": product["code"], "product_name": product["name"], "suggested_qty": suggested.String(), "status": "pending"} {
					row[k] = v
				}
				if err = s.Store.InsertWith(ctx, tx, "purchase_suggestion_lines", row); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetMRP(ctx, id)
}

func (s *Service) GetMRP(ctx context.Context, id string) (map[string]any, error) {
	header, err := s.Store.Get(ctx, "material_requirements", id)
	if err != nil {
		if errors.Is(err, database.ErrNotFound) {
			return nil, errors.New("需求计划不存在")
		}
		return nil, err
	}
	result := s.Store.Public("material_requirements", header)
	lines, err := s.Store.Rows(ctx, "SELECT * FROM material_requirement_lines WHERE mrp_id=? AND deleted_at IS NULL ORDER BY product_code", id)
	if err != nil {
		return nil, err
	}
	if len(lines) > 0 {
		out := []map[string]any{}
		for _, line := range lines {
			p, err := s.Store.Get(ctx, "products", value(line, "product_id"))
			if err != nil {
				return nil, err
			}
			row := s.Store.Public("material_requirement_lines", line)
			row["edges"] = map[string]any{"product": s.Store.Public("products", p)}
			out = append(out, row)
		}
		result["edges"] = map[string]any{"lines": out}
	}
	return result, nil
}

func (s *Service) DeleteMRP(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		rows, err := database.QueryRows(ctx, tx, "SELECT id FROM material_requirements WHERE id=?", id)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return database.ErrNotFound
		}
		_, err = tx.ExecContext(ctx, "UPDATE material_requirements SET deleted_at=?,updated_at=? WHERE id=?", now(), now(), id)
		return err
	})
}

func (s *Service) GenerateMRPWorkOrders(ctx context.Context, id, user string) ([]map[string]any, error) {
	out := []map[string]any{}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		plan, err := s.Store.GetWith(ctx, tx, "material_requirements", id)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				return errors.New("需求计划不存在")
			}
			return err
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM material_requirement_lines WHERE mrp_id=? AND deleted_at IS NULL AND requirement_type='production' ORDER BY product_code", id)
		if err != nil {
			return err
		}
		for _, line := range lines {
			quantity := readDecimal(line, "suggested_qty")
			if !quantity.IsPositive() {
				continue
			}
			warehouses, err := database.QueryRows(ctx, tx, "SELECT id FROM warehouses WHERE deleted_at IS NULL AND is_default=1")
			if err != nil {
				return err
			}
			if len(warehouses) != 1 {
				return ErrUnsupported
			}
			boms, err := database.QueryRows(ctx, tx, "SELECT * FROM bo_ms WHERE product_id=? AND deleted_at IS NULL AND status='active' ORDER BY created_at DESC LIMIT 1", line["product_id"])
			if err != nil {
				return err
			}
			if len(boms) != 1 {
				return ErrUnsupported
			}
			product, err := s.plainProduct(ctx, tx, value(line, "product_id"))
			if err != nil {
				return err
			}
			if lot := readDecimal(product, "min_order_qty"); lot.IsPositive() {
				quantity = quantity.DivRound(lot, 16).Ceil().Mul(lot)
			}
			input := map[string]any{"product_id": line["product_id"], "product_code": line["product_code"], "product_name": line["product_name"], "qty": quantity.String(), "warehouse_id": warehouses[0]["id"], "bom_id": boms[0]["id"], "remark": "由 MRP " + value(plan, "mrp_no") + " 生成"}
			newID, err := s.writeWorkOrderWith(ctx, tx, "", user, input)
			if err != nil {
				return err
			}
			row, err := s.Store.GetWith(ctx, tx, "work_orders", newID)
			if err != nil {
				return err
			}
			out = append(out, s.Store.Public("work_orders", row))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// The original multiplies quantities and (1 + scrap_rate) at each level;
// qty_per is metadata and is not a divisor in this calculation.
func (s *Service) explodeMRP(ctx context.Context, tx *sql.Tx, productID string, qty decimal.Decimal, depth int, path map[string]bool, add func(string, decimal.Decimal)) error {
	if depth > 8 {
		return nil
	}
	add(productID, qty)
	boms, err := database.QueryRows(ctx, tx, "SELECT * FROM bo_ms WHERE product_id=? AND status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", productID)
	if err != nil {
		return err
	}
	if len(boms) > 1 {
		return ErrUnsupported
	}
	if len(boms) == 0 {
		return nil
	}
	items, err := database.QueryRows(ctx, tx, "SELECT * FROM bom_items WHERE bom_id=? AND deleted_at IS NULL ORDER BY line_no", boms[0]["id"])
	if err != nil {
		return err
	}
	for _, item := range items {
		scrap := readDecimal(item, "scrap_rate")
		if scrap.IsNegative() {
			return ErrUnsupported
		}
		amount := qty.Mul(readDecimal(item, "qty")).Mul(decimal.NewFromInt(1).Add(scrap))
		if err = s.explodeMRP(ctx, tx, value(item, "product_id"), amount, depth+1, path, add); err != nil {
			return err
		}
	}
	return nil
}
