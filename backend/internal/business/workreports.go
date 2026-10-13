package business

import (
	"context"
	"github.com/shopspring/decimal"
	"net/url"
	"strconv"
	"strings"
)

func (s *Service) WorkReports(ctx context.Context, q url.Values, mode string) (map[string]any, error) {
	where := []string{"p.deleted_at IS NULL", "w.deleted_at IS NULL"}
	args := []any{}
	if mode == "pending" {
		where = append(where, "w.status='in_progress'", "p.status IN ('pending','in_progress')")
	}
	if status := q.Get("status"); status != "" {
		where = append(where, "p.status=?")
		args = append(args, status)
	}
	if no := q.Get("work_order_no"); no != "" && mode == "pending" {
		where = append(where, "w.order_no LIKE ?")
		args = append(args, "%"+no+"%")
	}
	if kw := q.Get("keyword"); kw != "" {
		where = append(where, "(p.process_name LIKE ? OR w.order_no LIKE ? OR w.product_name LIKE ?)")
		for i := 0; i < 3; i++ {
			args = append(args, "%"+kw+"%")
		}
	}
	if op := q.Get("operator"); op != "" {
		where = append(where, "p.operator_name LIKE ?")
		args = append(args, "%"+op+"%")
	}
	// work_order_id is ignored by the captured original reporting endpoint.
	from := " FROM work_order_processes p JOIN work_orders w ON w.id=p.work_order_id WHERE " + strings.Join(where, " AND ")
	rows, err := s.Store.Rows(ctx, "SELECT p.*"+from+" ORDER BY p.completed_at DESC,p.created_at DESC,p.sequence DESC", args...)
	if err != nil {
		return nil, err
	}
	if mode == "stats" {
		result := map[string]any{"total": len(rows), "completed": 0, "in_progress": 0, "pending": 0}
		good, bad, duration := decimal.Zero, decimal.Zero, decimal.Zero
		for _, p := range rows {
			status := value(p, "status")
			if n, ok := result[status].(int); ok {
				result[status] = n + 1
			}
			good = good.Add(readDecimal(p, "qty_good"))
			bad = bad.Add(readDecimal(p, "qty_bad"))
			duration = duration.Add(readDecimal(p, "actual_time"))
		}
		result["qty_good"], result["qty_bad"], result["actual_time"] = good.String(), bad.String(), duration.String()
		return result, nil
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(q.Get("page_size"))
	if size < 1 {
		size = 10
	}
	if size > 1000 {
		size = 1000
	}
	start := (page - 1) * size
	if start > len(rows) {
		start = len(rows)
	}
	end := start + size
	if end > len(rows) {
		end = len(rows)
	}
	items := []map[string]any{}
	for _, p := range rows[start:end] {
		data, err := s.GetWorkProcess(ctx, value(p, "id"))
		if err != nil {
			return nil, err
		}
		items = append(items, data)
	}
	return map[string]any{"list": items, "total": len(rows)}, nil
}
