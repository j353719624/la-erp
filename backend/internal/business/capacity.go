package business

import (
	"context"
	"strconv"

	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) CapacityLoad(ctx context.Context, requestedDays string) (map[string]any, error) {
	days, err := strconv.Atoi(requestedDays)
	if err != nil || days <= 0 {
		days = 7
	}
	centers, err := database.QueryRows(ctx, s.Store.DB, "SELECT * FROM work_centers WHERE deleted_at IS NULL AND status='active' ORDER BY created_at,id")
	if err != nil {
		return nil, err
	}
	items := []any{}
	for _, center := range centers {
		rows, err := database.QueryRows(ctx, s.Store.DB, `SELECT p.*,w.order_no,w.planned_start_date,w.planned_end_date FROM work_order_processes p JOIN work_orders w ON w.id=p.work_order_id WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL AND p.work_center_id=? AND p.status IN ('pending','in_progress') ORDER BY p.sequence,p.created_at,p.id`, center["id"])
		if err != nil {
			return nil, err
		}
		load := decimal.Zero
		processes := []any{}
		orders := map[string]bool{}
		for _, p := range rows {
			hours := readDecimal(p, "qty_planned").Mul(readDecimal(p, "standard_time"))
			if value(p, "standard_time_unit") != "hour" {
				hours = hours.Div(decimal.NewFromInt(60))
			}
			load = load.Add(hours)
			orders[value(p, "work_order_id")] = true
			processes = append(processes, map[string]any{
				"work_order_id": p["work_order_id"], "order_no": p["order_no"], "process_id": p["id"],
				"process_code": value(p, "process_code"), "process_name": value(p, "process_name"),
				"qty_planned": readDecimal(p, "qty_planned").String(), "standard_time": readDecimal(p, "standard_time").InexactFloat64(),
				"standard_time_unit": value(p, "standard_time_unit"), "load_hours": hours.String(), "status": p["status"],
				"planned_start_date": p["planned_start_date"], "planned_end_date": p["planned_end_date"],
			})
		}
		capacity, efficiency := readDecimal(center, "capacity"), readDecimal(center, "efficiency")
		available := capacity.Mul(decimal.NewFromInt(int64(days))).Mul(efficiency)
		rate, level := 0.0, "idle"
		if load.IsPositive() {
			if available.IsPositive() {
				rate = load.Div(available).InexactFloat64()
			}
			level = "normal"
			if rate >= 1 {
				level = "overloaded"
			} else if rate >= .8 {
				level = "busy"
			}
		}
		items = append(items, map[string]any{"id": center["id"], "code": center["code"], "name": center["name"],
			"capacity": capacity.String(), "efficiency": efficiency.InexactFloat64(), "load_hours": load.String(),
			"available_hours": available.String(), "load_rate": rate, "level": level,
			"wip_orders": len(orders), "wip_processes": len(rows), "processes": processes})
	}
	return map[string]any{"days": days, "items": items}, nil
}
