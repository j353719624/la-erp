package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) createWorkOrderProcesses(ctx context.Context, tx *sql.Tx, order map[string]any) error {
	steps, err := database.QueryRows(ctx, tx, "SELECT * FROM routing_steps WHERE routing_id=? AND deleted_at IS NULL ORDER BY sequence", order["routing_id"])
	if err != nil {
		return err
	}
	for _, step := range steps {
		p := s.base("work_order_processes")
		for _, k := range []string{"sequence", "process_code", "process_name", "work_center", "work_center_id", "standard_time", "standard_time_unit"} {
			p[k] = step[k]
		}
		p["work_order_id"], p["work_center_name"], p["status"], p["qty_planned"], p["actual_time_unit"], p["actual_time"] = order["id"], step["work_center"], "pending", order["qty"], "minute", 0
		if err := s.Store.InsertWith(ctx, tx, "work_order_processes", p); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) GetWorkProcess(ctx context.Context, id string) (map[string]any, error) {
	p, err := s.Store.Get(ctx, "work_order_processes", id)
	if err != nil {
		return nil, err
	}
	order, err := s.Store.Get(ctx, "work_orders", value(p, "work_order_id"))
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("work_order_processes", p)
	pub["edges"] = map[string]any{"work_order": s.Store.Public("work_orders", order)}
	return pub, nil
}

func (s *Service) WorkProcessAction(ctx context.Context, id, action string, input map[string]any) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		p, err := s.Store.GetWith(ctx, tx, "work_order_processes", id)
		if err != nil {
			return err
		}
		order, err := s.Store.GetWith(ctx, tx, "work_orders", value(p, "work_order_id"))
		if err != nil {
			return err
		}
		// Other parent states need their own original-runtime contract.
		if action == "complete" && value(p, "status") != "in_progress" {
			return errors.New("只有进行中的工序才能完成")
		}
		if value(order, "status") != "in_progress" {
			if action == "start" {
				return fmt.Errorf("工单未开工（当前状态：%s），无法开始工序，请先开工生产", value(order, "status"))
			}
			if action == "revert" {
				return fmt.Errorf("工单已不在生产中（当前状态：%s），无法撤销报工；如需调整请先处理工单状态", value(order, "status"))
			}
			return fmt.Errorf("工单未处于生产中（当前状态：%s），无法执行工序操作", value(order, "status"))
		}
		changes := map[string]any{"updated_at": now()}
		switch action {
		case "start":
			if value(p, "status") != "pending" {
				return errors.New("只有待处理状态的工序才能开始")
			}
			changes["status"], changes["started_at"] = "in_progress", now()
			changes["operator_name"] = value(input, "operator_name")
			if value(input, "operator_id") != "" {
				changes["operator_id"] = input["operator_id"]
			}
		case "complete":
			if value(p, "status") != "in_progress" {
				return errors.New("只有进行中的工序才能完成")
			}
			amounts := map[string]decimal.Decimal{}
			for _, k := range []string{"qty_good", "qty_bad", "actual_time", "labor_rate"} {
				n, err := Number(input[k])
				if err != nil {
					return err
				}
				if n.IsNegative() && (k == "actual_time" || k == "labor_rate") {
					return ErrUnsupported
				}
				amounts[k] = n
			}
			if amounts["qty_good"].Add(amounts["qty_bad"]).GreaterThan(readDecimal(p, "qty_planned")) {
				return fmt.Errorf("报工数量（良品+不良=%s）不能超过计划数量 %s", amounts["qty_good"].Add(amounts["qty_bad"]).String(), readDecimal(p, "qty_planned").String())
			}
			changes["qty_good"], changes["qty_bad"], changes["qty_completed"] = amounts["qty_good"].String(), amounts["qty_bad"].String(), amounts["qty_good"].Add(amounts["qty_bad"]).String()
			changes["labor_rate"], changes["actual_time"] = amounts["labor_rate"].String(), amounts["actual_time"].InexactFloat64()
			changes["status"], changes["completed_at"], changes["operator_name"], changes["operator_id"] = "completed", now(), value(input, "operator_name"), nil
			if value(input, "operator_id") != "" {
				changes["operator_id"] = input["operator_id"]
			}
		case "revert":
			if value(p, "status") != "completed" {
				return fmt.Errorf("只有已报工的工序才能撤销（当前状态：%s）", value(p, "status"))
			}
			changes["status"], changes["qty_good"], changes["qty_bad"], changes["qty_completed"], changes["actual_time"], changes["completed_at"] = "in_progress", "0", "0", "0", 0, nil
		default:
			return ErrUnsupported
		}
		if err := s.Store.UpdateWith(ctx, tx, "work_order_processes", id, changes); err != nil {
			return err
		}
		if action == "start" {
			return nil
		}
		rows, err := database.QueryRows(ctx, tx, "SELECT labor_rate,actual_time FROM work_order_processes WHERE work_order_id=? AND status='completed' AND deleted_at IS NULL", order["id"])
		if err != nil {
			return err
		}
		labor := decimal.Zero
		// Original uses raw reported minutes times rate, with no hour conversion.
		for _, r := range rows {
			labor = labor.Add(readDecimal(r, "labor_rate").Mul(readDecimal(r, "actual_time")))
		}
		total := readDecimal(order, "material_cost").Add(labor).Add(readDecimal(order, "overhead_cost"))
		return s.Store.UpdateWith(ctx, tx, "work_orders", value(order, "id"), map[string]any{"labor_cost": labor.String(), "total_cost": total.String(), "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.GetWorkProcess(ctx, id)
}
