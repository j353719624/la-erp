package business

import (
	"context"
	"github.com/shopspring/decimal"
)

func (s *Service) WorkOrderListRecord(ctx context.Context, row map[string]any) (map[string]any, error) {
	pub := s.Store.Public("work_orders", row)
	edges := map[string]any{}
	if id := value(row, "product_id"); id != "" {
		product, err := s.Store.Get(ctx, "products", id)
		if err != nil {
			return nil, err
		}
		edges["product"] = s.Store.Public("products", product)
	}
	pub["edges"] = edges
	id := value(row, "id")
	receipts, err := s.Store.Rows(ctx, "SELECT total_qty FROM production_receipts WHERE work_order_id=? AND status='confirmed' AND deleted_at IS NULL", id)
	if err != nil {
		return nil, err
	}
	received := decimal.Zero
	for _, receipt := range receipts {
		received = received.Add(readDecimal(receipt, "total_qty"))
	}
	pub["received_qty"] = received.String()
	processes, err := s.Store.Rows(ctx, "SELECT * FROM work_order_processes WHERE work_order_id=? AND deleted_at IS NULL ORDER BY sequence", id)
	if err != nil {
		return nil, err
	}
	done := 0
	processRecords := []map[string]any{}
	for _, process := range processes {
		processRecords = append(processRecords, s.Store.Public("work_order_processes", process))
		if value(process, "status") == "completed" {
			done++
		}
	}
	if len(processRecords) > 0 {
		edges["processes"] = processRecords
	}
	pub["processes_total"], pub["processes_done"] = len(processes), done
	materials, err := s.Store.Rows(ctx, "SELECT qty_required,qty_issued,qty_returned FROM work_order_materials WHERE work_order_id=? AND deleted_at IS NULL", id)
	if err != nil {
		return nil, err
	}
	pending := 0
	for _, material := range materials {
		if readDecimal(material, "qty_required").Sub(readDecimal(material, "qty_issued")).Add(readDecimal(material, "qty_returned")).IsPositive() {
			pending++
		}
	}
	pub["material_pending"] = pending
	pub["can_complete"] = value(row, "status") == "in_progress" && done == len(processes) && pending == 0
	return pub, nil
}
