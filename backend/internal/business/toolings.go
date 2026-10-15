package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

func (s *Service) ToolingAction(ctx context.Context, id, action string, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "toolings", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("工装不存在")
		}
		if err != nil {
			return err
		}
		status := value(row, "status")
		if status == "scrapped" {
			return errors.New("已报废工装不能操作")
		}
		changes := map[string]any{"updated_at": now()}
		switch action {
		case "use":
			times := int64(1)
			if input["times"] != nil {
				n, e := Number(input["times"])
				if e != nil || !n.IsInteger() || n.IntPart() <= 0 {
					return errors.New("使用次数必须是正整数")
				}
				times = n.IntPart()
			}
			used := readDecimal(row, "used_times").Add(decimal.NewFromInt(times))
			if life := readDecimal(row, "life_times"); life.IsPositive() && used.GreaterThan(life) {
				return errors.New("使用次数不能超过寿命次数")
			}
			changes["used_times"], changes["status"] = used.String(), "in_use"
		case "maintain":
			stamp := now()
			changes["status"], changes["last_maintain_date"] = "idle", stamp
			if value(input, "date") != "" {
				changes["last_maintain_date"] = input["date"]
			}
			if value(input, "next_date") != "" {
				changes["next_maintain_date"] = input["next_date"]
			} else if interval := readDecimal(row, "maintain_interval_days"); interval.IsPositive() {
				var next string
				if err := tx.QueryRowContext(ctx, "SELECT datetime(?, '+' || ? || ' days')", stamp, interval.IntPart()).Scan(&next); err != nil {
					return err
				}
				changes["next_maintain_date"] = next
			}
		case "scrap":
			changes["status"] = "scrapped"
		// 既有实现 NN2 实测动作集为 use / maintain / scrap，与本实现白名单逐项一致，
		// 本 default **不可达**，保留作兜底。
		default:
			return ErrUnsupported
		}
		if value(input, "remark") != "" {
			changes["remark"] = input["remark"]
		}
		if err := s.Store.UpdateWith(ctx, tx, "toolings", id, changes); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "toolings", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("toolings", result), nil
}
