package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"la-erp/backend/internal/database"
)

func (s *Service) confirmProductionReceipt(ctx context.Context, d ProductionDocument, id string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的单据才能确认")
		}
		// 批次 T 取证（2026-10-14，evidence/backend-runtime/audit-batch-t-20261014.json）：
		// 原版允许**不关联工单**的完工入库单，且 confirm **直接通过**（不看任何设置）。
		// 无工单时无「工单状态 / 完工数量 / 超量」可比对，整段工单联动跳过。
		// 空 work_order_id 不能直接查库（返回 ErrNotFound → 404），必须显式跳过。
		var order map[string]any
		if woID := value(h, "work_order_id"); woID != "" {
			if order, err = s.Store.GetWith(ctx, tx, "work_orders", woID); err != nil {
				return err
			}
		}
		if order != nil && value(order, "status") != "in_progress" && value(order, "status") != "confirmed" {
			// 原版仅在**关联了工单**时才校验工单状态；无工单直接放行。
			return ErrUnsupported
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM production_receipt_lines WHERE receipt_id=? AND deleted_at IS NULL ORDER BY line_no", id)
		if err != nil {
			return err
		}
		if len(lines) == 0 {
			return errors.New("入库明细不能为空")
		}
		// 批次 T：无工单时无「完工数量」可比对，超量校验整段跳过。
		if order != nil {
			total := readDecimal(h, "total_qty")
			ordered := readDecimal(order, "qty")
			rows, err := database.QueryRows(ctx, tx, "SELECT total_qty FROM production_receipts WHERE work_order_id=? AND status='confirmed' AND deleted_at IS NULL", order["id"])
			if err != nil {
				return err
			}
			received := readDecimal(map[string]any{"n": "0"}, "n")
			for _, r := range rows {
				received = received.Add(readDecimal(r, "total_qty"))
			}
			if received.Add(total).GreaterThan(ordered) {
				return fmt.Errorf("生产入库超量：工单 %s 完工数量 %s，已入库 %s，本次 %s，合计不能超过完工数量", value(order, "order_no"), ordered.StringFixed(2), received.StringFixed(2), total.StringFixed(2))
			}
		}
		for _, line := range lines {
			if err := rejectAdvanced(line); err != nil {
				return err
			}
			if _, err := s.plainProduct(ctx, tx, value(line, "product_id"), true); err != nil {
				return err
			}
			qty := readDecimal(line, "qty")
			cost := readDecimal(line, "unit_cost")
			if cost.IsZero() && order != nil {
				// 批次 T：无工单时无工单成本可分摊，保留传入的 0 成本。
				cost = readDecimal(order, "total_cost").DivRound(readDecimal(order, "qty"), 6)
			}
			b, err := s.balance(ctx, tx, value(line, "product_id"), value(h, "warehouse_id"), true)
			if err != nil {
				return err
			}
			available, avg := readDecimal(b, "qty_available"), readDecimal(b, "avg_cost")
			newQty := available.Add(qty)
			avg = available.Mul(avg).Add(qty.Mul(cost)).DivRound(newQty, 6)
			if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": newQty.String(), "avg_cost": avg.String(), "last_in_at": now(), "updated_at": now()}); err != nil {
				return err
			}
			m := s.base("stock_movements")
			for k, v := range map[string]any{"type": "in", "source_type": "production_receipt", "source_id": id, "source_no": h[d.Number], "product_id": line["product_id"], "warehouse_id": h["warehouse_id"], "qty": qty.String(), "direction": 1, "unit_cost": cost.String(), "total_cost": qty.Mul(cost).String(), "balance_after": newQty.String(), "remark": "生产入库"} {
				m[k] = v
			}
			if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
				return err
			}
		}
		// Original keeps the draft line/header cost and completed_qty unchanged;
		// the computed cost is written to inventory and stock ledger only.
		return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"status": "confirmed", "confirmed_at": now(), "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.GetProductionDocument(ctx, d, id)
}
