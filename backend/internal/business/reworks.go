package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"la-erp/backend/internal/database"
)

func (s *Service) GetRework(ctx context.Context, id string) (map[string]any, error) {
	row, err := s.Store.Get(ctx, "rework_orders", id)
	if errors.Is(err, database.ErrNotFound) {
		return nil, errors.New("返工单不存在")
	}
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("rework_orders", row)
	delete(pub, "edges")
	return pub, nil
}

func (s *Service) WriteRework(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		creating := id == ""
		var row map[string]any
		if !creating {
			var err error
			row, err = s.Store.GetWith(ctx, tx, "rework_orders", id)
			if errors.Is(err, database.ErrNotFound) {
				return errors.New("返工单不存在")
			}
			if err != nil {
				return err
			}
			if value(row, "status") != "draft" {
				return errors.New("只有草稿状态的返工单才能修改")
			}
		}
		quantity := input["qty_rework"]
		if !creating && quantity == nil {
			quantity = row["qty_rework"]
		}
		qty, err := Number(quantity)
		if err != nil {
			return err
		}
		if !qty.IsPositive() {
			return errors.New("返工数量必须大于0")
		}
		workID := value(input, "work_order_id")
		if !creating && input["work_order_id"] == nil {
			workID = value(row, "work_order_id")
		}
		if workID != "" {
			work, err := s.Store.GetWith(ctx, tx, "work_orders", workID)
			if errors.Is(err, database.ErrNotFound) {
				return errors.New("工单不存在")
			}
			if err != nil {
				return err
			}
			state := value(work, "status")
			if state == "completed" || state == "cancelled" {
				return fmt.Errorf("工单状态（%s）不允许新建领料/入库/退料单", state)
			}
			// 批次 BB 取证（2026-10-14，运行快照）：
			// 既有实现返工单的工单状态白名单**完整覆盖全部 5 个状态**（抽样实测）：
			//   draft / confirmed / in_progress               → code:0
			//   completed / cancelled                         → 10000
			//     「工单状态（X）不允许新建领料/入库/退料单」（X 为实际状态，逐字一致）
			//   work_order_id 指向不存在的工单                → 10000「工单不存在」
			// 即上方两处校验（completed/cancelled 拒绝 + 本白名单）与既有实现**逐字一致**。
			// 本守卫只在这 5 个取值之外（如历史脏数据）才触发 → 属**防御性断言**，
			// 无既有文案可对齐，不自造，保留 ErrUnsupported 作兜底。
			if state != "draft" && state != "confirmed" && state != "in_progress" {
				return ErrUnsupported
			}
		}
		if creating {
			row = s.base("rework_orders")
			id = value(row, "id")
			code, err := s.nextNumber(ctx, tx, "REW")
			if err != nil {
				return err
			}
			row["code"], row["status"] = code, "draft"
		}
		for _, key := range []string{"qty_rework", "qty_good", "qty_bad"} {
			amount := input[key]
			if !creating && amount == nil {
				continue
			}
			number, err := Number(amount)
			if err != nil {
				return err
			}
			if number.IsNegative() {
				return errors.New("合格/报废数量不能为负数")
			}
			row[key] = number.String()
		}
		if readDecimal(row, "qty_good").Add(readDecimal(row, "qty_bad")).GreaterThan(readDecimal(row, "qty_rework")) {
			return errors.New("返工合格数量+报废数量不能超过返工数量")
		}
		for _, key := range []string{"reason", "remark", "operator_name", "work_order_no", "process_code", "process_name"} {
			if creating || input[key] != nil {
				row[key] = value(input, key)
			}
		}
		for _, key := range []string{"work_order_id", "process_id", "operator_id"} {
			if input[key] != nil {
				row[key] = input[key]
			}
		}
		row["updated_at"] = now()
		if creating {
			return s.Store.InsertWith(ctx, tx, "rework_orders", row)
		}
		return s.Store.UpdateWith(ctx, tx, "rework_orders", id, row)
	})
	if err != nil {
		return nil, err
	}
	return s.GetRework(ctx, id)
}

func (s *Service) ReworkAction(ctx context.Context, id, action string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "rework_orders", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("返工单不存在")
		}
		if err != nil {
			return err
		}
		status, stamp := value(row, "status"), now()
		changes := map[string]any{"updated_at": stamp}
		switch action {
		case "delete":
			if status != "draft" {
				return errors.New("只有草稿状态的返工单才能删除")
			}
			changes["deleted_at"] = stamp
		case "confirm":
			if status != "draft" {
				return errors.New("只有草稿状态的返工单才能确认")
			}
			changes["status"], changes["confirmed_at"] = "confirmed", stamp
		case "complete":
			if status != "confirmed" {
				return errors.New("只有已确认的返工单才能完成")
			}
			changes["status"], changes["completed_at"] = "completed", stamp
		case "cancel":
			if status == "completed" {
				return errors.New("已完成的返工单不能取消")
			}
			changes["status"] = "cancelled"
		// 既有实现 NN6 实测动作集只有 confirm / complete / cancel；delete 为 HTTP DELETE 形态。
		// 与本实现白名单一致，本 default **不可达**，保留作兜底。
		default:
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, "rework_orders", id, changes)
	})
	if err != nil {
		return nil, err
	}
	if action == "delete" {
		return nil, nil
	}
	return s.GetRework(ctx, id)
}
