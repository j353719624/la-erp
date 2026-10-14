package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

var ErrBOMMissing = errors.New("BOM不存在")

func (s *Service) GetBOM(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "bo_ms", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("bo_ms", h)
	edges := map[string]any{}
	p, err := s.Store.Get(ctx, "products", value(h, "product_id"))
	if err != nil {
		return nil, err
	}
	edges["product"] = s.Store.Public("products", p)
	rows, err := s.Store.Rows(ctx, "SELECT * FROM bom_items WHERE bom_id=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, l := range rows {
		item := s.Store.Public("bom_items", l)
		e := map[string]any{}
		for relation, table := range map[string]string{"product": "products", "unit": "units"} {
			if value(l, relation+"_id") != "" {
				r, err := s.Store.Get(ctx, table, value(l, relation+"_id"))
				if err != nil {
					return nil, err
				}
				e[relation] = s.Store.Public(table, r)
			}
		}
		item["edges"] = e
		items = append(items, item)
	}
	if len(items) > 0 {
		edges["items"] = items
	}
	pub["edges"] = edges
	return pub, nil
}
func (s *Service) WriteBOM(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if !creating {
			var used int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM work_orders WHERE bom_id=? AND deleted_at IS NULL AND status IN ('confirmed','in_progress','completed')", id).Scan(&used); err != nil {
				return err
			}
			if used > 0 {
				return fmt.Errorf("该 BOM 已被 %d 张已确认/进行中/已完成的工单使用，禁止编辑（请新建 BOM 版本）", used)
			}
		}
		product, err := s.plainProduct(ctx, tx, value(input, "product_id"))
		if err != nil {
			return err
		}
		raw, ok := input["items"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 1000 {
			return errors.New("BOM明细不能为空且不超过1000行")
		}
		qtyPer, err := Number(input["qty_per"])
		if err != nil {
			return err
		}
		if input["qty_per"] == nil {
			qtyPer = decimal.NewFromInt(1)
		}
		if !qtyPer.IsPositive() {
			return errors.New("基准数量必须大于零")
		}
		var h map[string]any
		if creating {
			h = s.base("bo_ms")
			no, err := s.nextNumber(ctx, tx, "BOM")
			if err != nil {
				return err
			}
			h["code"], h["status"], h["version"] = no, "active", "1.0"
			id = value(h, "id")
		} else {
			h, err = s.Store.GetWith(ctx, tx, "bo_ms", id)
			if err != nil {
				return err
			}
		}
		h["product_id"], h["product_name"], h["product_code"], h["qty_per"] = product["id"], value(input, "product_name"), value(input, "product_code"), qtyPer.String()
		for _, k := range []string{"remark", "version"} {
			if input[k] != nil {
				h[k] = input[k]
			}
		}
		lines := []map[string]any{}
		for i, v := range raw {
			l, ok := v.(map[string]any)
			if !ok {
				return errors.New("BOM明细格式错误")
			}
			p, err := s.plainProduct(ctx, tx, value(l, "product_id"))
			if err != nil {
				return err
			}
			qty, err := Number(l["qty"])
			if err != nil {
				return err
			}
			scrap, err := Number(l["scrap_rate"])
			if err != nil {
				return err
			}
			// 原版回放 CC8/CC8b（2026-10-14）：qty_per=0、qty_per=-1、scrap_rate=-0.1
			// 三者原版全部 code:0 且原样落库。属原版校验缺失——qty_per=0 会让该组件
			// 需求恒为 0、qty_per=-1 会产生负需求，scrap_rate<0 会**放大**需求量。
			// 按「不复制未证实的错误行为」原则，恢复端保留拒绝，不对齐该缺陷。
			if !qty.IsPositive() || scrap.IsNegative() {
				return ErrOriginalDefect
			}

			row := s.base("bom_items")
			row["bom_id"], row["line_no"], row["product_id"], row["product_name"], row["product_code"], row["qty"], row["scrap_rate"] = id, i+1, p["id"], value(l, "product_name"), value(l, "product_code"), qty.String(), scrap.String()
			if value(l, "unit_id") != "" {
				if _, err := s.Store.GetWith(ctx, tx, "units", value(l, "unit_id")); err != nil {
					return err
				}
				row["unit_id"] = l["unit_id"]
			}
			if l["remark"] != nil {
				row["remark"] = l["remark"]
			}
			lines = append(lines, row)
		}
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "bo_ms", h); err != nil {
				return err
			}
		} else {
			h["updated_at"] = now()
			if err := s.Store.UpdateWith(ctx, tx, "bo_ms", id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE bom_items SET deleted_at=?,updated_at=? WHERE bom_id=? AND deleted_at IS NULL", now(), now(), id); err != nil {
				return err
			}
		}
		for _, l := range lines {
			if err := s.Store.InsertWith(ctx, tx, "bom_items", l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetBOM(ctx, id)
}
func (s *Service) ActivateBOM(ctx context.Context, id string) (map[string]any, error) {
	return s.setBOMStatus(ctx, id, "active")
}
func (s *Service) DeactivateBOM(ctx context.Context, id string) (map[string]any, error) {
	return s.setBOMStatus(ctx, id, "inactive")
}
func (s *Service) setBOMStatus(ctx context.Context, id, status string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var existing int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM bo_ms WHERE id=?", id).Scan(&existing); err != nil {
			return err
		}
		if existing == 0 {
			return database.ErrNotFound
		}
		_, err := tx.ExecContext(ctx, "UPDATE bo_ms SET status=?,updated_at=? WHERE id=?", status, now(), id)
		return err
	})
	if err != nil {
		return nil, err
	}
	row, err := s.GetBOM(ctx, id)
	if errors.Is(err, database.ErrNotFound) {
		return nil, ErrBOMMissing
	}
	return row, err
}
func (s *Service) BOMTree(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "bo_ms", id)
	if err != nil {
		return nil, err
	}

	result := map[string]any{}
	for _, k := range []string{"code", "product_id", "product_code", "product_name", "qty_per", "version"} {
		result[k] = s.Store.Public("bo_ms", h)[k]
	}
	result["bom_id"] = id
	children, total, err := s.bomTreeChildren(ctx, id, decimal.NewFromInt(1), 1, map[string]bool{})
	if err != nil {
		return nil, err
	}
	result["children"], result["total_cost"] = children, total.String()
	return result, nil
}

func (s *Service) bomTreeChildren(ctx context.Context, id string, factor decimal.Decimal, depth int, path map[string]bool) ([]map[string]any, decimal.Decimal, error) {
	rows, err := s.Store.Rows(ctx, "SELECT * FROM bom_items WHERE bom_id=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, decimal.Zero, err
	}
	children := []map[string]any{}
	total := decimal.Zero
	for _, line := range rows {
		product, err := s.Store.Get(ctx, "products", value(line, "product_id"))
		if err != nil {
			return nil, total, err
		}
		nested, err := s.Store.Rows(ctx, "SELECT id FROM bo_ms WHERE product_id=? AND status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", product["id"])
		if err != nil {
			return nil, total, err
		}
		if len(nested) > 1 {
			return nil, total, ErrUnsupported
		}
		qty, cost := readDecimal(line, "qty"), readDecimal(product, "purchase_price")
		quantity := factor.Mul(qty)
		lineCost := quantity.Mul(cost)
		child := map[string]any{"product_id": product["id"], "product_code": product["code"], "product_name": product["name"], "spec": value(product, "spec"), "unit_id": line["unit_id"], "unit_name": "", "qty": qty.String(), "scrap_rate": readDecimal(line, "scrap_rate").String(), "total_qty": quantity.String(), "unit_cost": cost.String(), "has_bom": len(nested) > 0, "bom_id": nil, "circular": false, "depth": depth, "children": []any{}}
		if value(line, "unit_id") != "" {
			unit, err := s.Store.Get(ctx, "units", value(line, "unit_id"))
			if err != nil {
				return nil, total, err
			}
			child["unit_name"] = unit["name"]
		}
		if len(nested) > 0 {
			child["bom_id"] = nested[0]["id"]
			nestedID := value(nested[0], "id")
			if path[nestedID] {
				child["circular"] = true
			} else {
				path[nestedID] = true
				nestedChildren, nestedCost, err := s.bomTreeChildren(ctx, nestedID, quantity, depth+1, path)
				delete(path, nestedID)
				if err != nil {
					return nil, total, err
				}
				child["children"] = nestedChildren
				total = total.Add(nestedCost)
			}
		}
		child["line_cost"] = lineCost.String()
		total = total.Add(lineCost)
		children = append(children, child)
	}
	return children, total, nil
}

func (s *Service) DeleteBOM(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, "bo_ms", id); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				return ErrBOMMissing
			}
			return err
		}
		var used int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM work_orders WHERE bom_id=? AND deleted_at IS NULL", id).Scan(&used); err != nil {
			return err
		}
		if used > 0 {
			return fmt.Errorf("该 BOM 已被 %d 张工单引用，不能删除（请先删除关联的草稿工单）", used)
		}
		date := now()
		if err := s.Store.UpdateWith(ctx, tx, "bo_ms", id, map[string]any{"deleted_at": date, "updated_at": date}); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "UPDATE bom_items SET deleted_at=?,updated_at=? WHERE bom_id=? AND deleted_at IS NULL", date, date, id)
		return err
	})
}
