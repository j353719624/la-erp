package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp/backend/internal/database"
)

func (s *Service) ReceivePaymentPlan(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		plan, err := s.Store.GetWith(ctx, tx, "payment_plans", id)
		if err != nil {
			return err
		}
		if value(plan, "status") == "cancelled" || value(plan, "status") == "completed" {
			return errors.New("当前计划状态不能收款")
		}
		itemID := value(input, "item_id")
		if itemID == "" {
			return errors.New("收款明细不能为空")
		}
		items, err := database.QueryRows(ctx, tx, "SELECT * FROM payment_plan_items WHERE payment_plan_items=? AND id=? AND deleted_at IS NULL", id, itemID)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			return errors.New("收款明细不存在")
		}
		amount, err := Number(input["amount"])
		if err != nil || !amount.IsPositive() {
			if err != nil {
				return err
			}
			return errors.New("收款金额必须大于零")
		}
		item := items[0]
		planned := readDecimal(item, "planned_amount")
		received := readDecimal(item, "received_amount")
		if received.Add(amount).GreaterThan(planned) {
			return errors.New("收款金额超过分期剩余金额")
		}
		nextItem := received.Add(amount)
		itemStatus := "partial"
		if nextItem.Equal(planned) {
			itemStatus = "paid"
		}
		if err := s.Store.UpdateWith(ctx, tx, "payment_plan_items", itemID, map[string]any{"received_amount": nextItem.String(), "status": itemStatus, "updated_at": now()}); err != nil {
			return err
		}
		total := readDecimal(plan, "received_amount").Add(amount)
		plannedTotal := readDecimal(plan, "total_amount")
		status := "partial"
		if total.Equal(plannedTotal) {
			status = "completed"
		}
		if err := s.Store.UpdateWith(ctx, tx, "payment_plans", id, map[string]any{"received_amount": total.String(), "status": status, "updated_at": now()}); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "payment_plans", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("payment_plans", result), nil
}
