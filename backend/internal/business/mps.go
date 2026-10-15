package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
	"sort"
	"time"
)

func (s *Service) GetMPS(ctx context.Context, id string) (map[string]any, error) {
	row, err := s.Store.Get(ctx, "mps_plans", id)
	if errors.Is(err, database.ErrNotFound) {
		return nil, errors.New("主生产计划不存在")
	}
	if err != nil {
		return nil, err
	}
	result := s.Store.Public("mps_plans", row)
	lines, err := s.Store.Rows(ctx, "SELECT * FROM mps_plan_lines WHERE plan_id=? AND deleted_at IS NULL ORDER BY product_code", id)
	if err != nil {
		return nil, err
	}
	if len(lines) > 0 {
		items := []map[string]any{}
		for _, l := range lines {
			items = append(items, s.Store.Public("mps_plan_lines", l))
		}
		result["edges"] = map[string]any{"lines": items}
	}
	return result, nil
}
func (s *Service) CreateMPS(ctx context.Context, input map[string]any) (map[string]any, error) {
	startText, endText := value(input, "period_start"), value(input, "period_end")
	if startText == "" || endText == "" {
		return nil, errors.New("计划期间不能为空")
	}
	start, err := time.Parse(time.RFC3339, startText)
	if err != nil {
		return nil, err
	}
	end, err := time.Parse(time.RFC3339, endText)
	if err != nil {
		return nil, err
	}
	if start.IsZero() || end.IsZero() {
		return nil, errors.New("计划期间不能为空")
	}
	if end.Before(start) {
		return nil, errors.New("结束日期不能早于开始日期")
	}
	id := ""
	err = s.transaction(ctx, func(tx *sql.Tx) error {
		orders, err := database.QueryRows(ctx, tx, "SELECT l.* FROM sales_order_lines l JOIN sales_orders h ON h.id=l.order_id WHERE h.deleted_at IS NULL AND l.deleted_at IS NULL AND h.status IN ('confirmed','approved') AND julianday(h.order_date)>=julianday(?) AND julianday(h.order_date)<=julianday(?)", startText, endText)
		if err != nil {
			return err
		}
		filter := map[string]bool{}
		if raw, ok := input["product_ids"].([]any); ok {
			for _, p := range raw {
				filter[fmt.Sprint(p)] = true
			}
		}
		demand := map[string]decimal.Decimal{}
		for _, l := range orders {
			p := value(l, "product_id")
			if len(filter) > 0 && !filter[p] {
				continue
			}
			demand[p] = demand[p].Add(readDecimal(l, "qty"))
		}
		h := s.base("mps_plans")
		id = value(h, "id")
		code, err := s.nextNumber(ctx, tx, "MPS")
		if err != nil {
			return err
		}
		h["code"], h["status"], h["period_start"], h["period_end"] = code, "draft", startText, endText
		if err := s.Store.InsertWith(ctx, tx, "mps_plans", h); err != nil {
			return err
		}
		products := []string{}
		for p := range demand {
			products = append(products, p)
		}
		sort.Strings(products)
		for _, p := range products {
			product, err := s.Store.GetWith(ctx, tx, "products", p)
			if err != nil {
				return err
			}
			var availableText, wipText string
			if err := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(qty_available),0) AS TEXT) FROM inventory_balances WHERE product_id=?", p).Scan(&availableText); err != nil {
				return err
			}
			if err := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(qty),0) AS TEXT) FROM work_orders WHERE product_id=? AND deleted_at IS NULL AND status IN ('confirmed','in_progress')", p).Scan(&wipText); err != nil {
				return err
			}
			available, _ := decimal.NewFromString(availableText)
			wip, _ := decimal.NewFromString(wipText)
			net := decimal.Max(decimal.Zero, demand[p].Sub(available).Sub(wip))
			line := s.base("mps_plan_lines")
			for k, v := range map[string]any{"plan_id": id, "product_id": p, "product_code": product["code"], "product_name": product["name"], "qty_demand": demand[p].String(), "qty_onhand": available.String(), "qty_wip": wip.String(), "net_qty": net.String(), "status": "pending"} {
				line[k] = v
			}
			if err := s.Store.InsertWith(ctx, tx, "mps_plan_lines", line); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetMPS(ctx, id)
}
func (s *Service) DeleteMPS(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "mps_plans", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("主生产计划不存在")
		}
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的计划才能删除")
		}
		return s.Store.UpdateWith(ctx, tx, "mps_plans", id, map[string]any{"deleted_at": now(), "updated_at": now()})
	})
}
func (s *Service) GenerateMPS(ctx context.Context, id, user string) (map[string]any, error) {
	created := 0
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "mps_plans", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("主生产计划不存在")
		}
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的计划才能生成工单")
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM mps_plan_lines WHERE plan_id=? AND deleted_at IS NULL ORDER BY product_code", id)
		if err != nil {
			return err
		}
		for _, l := range lines {
			if !readDecimal(l, "net_qty").IsPositive() {
				continue
			}
			row := s.base("work_orders")
			no, err := s.nextNumber(ctx, tx, "WO")
			if err != nil {
				return err
			}
			for k, v := range map[string]any{"order_no": no, "status": "draft", "product_id": l["product_id"], "product_code": l["product_code"], "product_name": l["product_name"], "qty": l["net_qty"], "planned_start_date": h["period_start"], "planned_end_date": h["period_end"], "priority": "normal", "remark": "MPS计划生成", "created_by": user} {
				row[k] = v
			}
			if err := s.Store.InsertWith(ctx, tx, "work_orders", row); err != nil {
				return err
			}
			if err := s.Store.UpdateWith(ctx, tx, "mps_plan_lines", value(l, "id"), map[string]any{"status": "planned", "updated_at": now()}); err != nil {
				return err
			}
			created++
		}
		return s.Store.UpdateWith(ctx, tx, "mps_plans", id, map[string]any{"status": "planned", "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"created": created}, nil
}
