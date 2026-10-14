package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func (s *Service) CreatePartnerDocument(ctx context.Context, table string, input map[string]any) (map[string]any, error) {
	lines, ok := input["lines"].([]any)
	if !ok || len(lines) == 0 {
		return nil, errors.New("明细不能为空")
	}
	lineTable, fk := "", ""
	if table == "loan_orders" {
		lineTable, fk = "loan_order_lines", "loan_order_id"
	}
	if table == "consignment_orders" {
		lineTable, fk = "consignment_order_lines", "order_id"
	}
	if lineTable == "" {
		return nil, errors.New("不支持的单据")
	}
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h := s.base(table)
		for k, v := range input {
			if k != "lines" && s.Store.Has(table, k) {
				h[k] = v
			}
		}
		if table == "loan_orders" && value(h, "loan_no") == "" {
			n, e := s.nextNumber(ctx, tx, "LOAN")
			if e != nil {
				return e
			}
			h["loan_no"] = n
		}
		if table == "consignment_orders" && value(h, "consignment_no") == "" {
			n, e := s.nextNumber(ctx, tx, "CONS")
			if e != nil {
				return e
			}
			h["consignment_no"] = n
		}
		if h["status"] == nil {
			h["status"] = "draft"
		}
		h["total_qty"], h["total_amount"] = "0", "0"
		if err := s.Store.InsertWith(ctx, tx, table, h); err != nil {
			return err
		}
		seen := map[string]bool{}
		total := 0.0
		for i, raw := range lines {
			m, ok := raw.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			pid := value(m, "product_id")
			if pid == "" || seen[pid] {
				return errors.New("商品不能为空或重复")
			}
			seen[pid] = true
			if _, e := s.Store.GetWith(ctx, tx, "products", pid); e != nil {
				return errors.New("商品不存在")
			}
			qty, e := Number(value(m, "qty"))
			if e != nil || qty.LessThanOrEqual(decimal.Zero) {
				return errors.New("数量必须大于0")
			}
			l := s.base(lineTable)
			l["id"] = uuid.NewString()
			l[fk] = h["id"]
			l["product_id"] = pid
			l["line_no"] = i + 1
			l["qty"] = qty.String()
			l["returned_qty"] = "0"
			if table == "consignment_orders" {
				l["sold_qty"] = "0"
			}
			l["unit_cost"] = value(m, "unit_cost")
			if l["unit_cost"] == "" {
				l["unit_cost"] = "0"
			}
			l["amount"] = value(m, "amount")
			if l["amount"] == "" {
				l["amount"] = "0"
			}
			for _, k := range []string{"product_name", "product_code", "spec", "batch_no", "serial_nos", "production_date", "expiry_date", "remark"} {
				if s.Store.Has(lineTable, k) {
					l[k] = value(m, k)
				}
			}
			if insertErr := s.Store.InsertWith(ctx, tx, lineTable, l); insertErr != nil {
				return insertErr
			}
			total += qty.InexactFloat64()
		}
		if err := s.Store.UpdateWith(ctx, tx, table, value(h, "id"), map[string]any{"total_qty": fmt.Sprintf("%g", total), "updated_at": now()}); err != nil {
			return err
		}
		loaded, loadErr := s.GetPartnerDocument(ctx, table, value(h, "id"))
		result = loaded
		return loadErr
	})
	return result, err
}
