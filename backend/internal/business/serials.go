package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"la-erp/backend/internal/database"
)

func (s *Service) RegisterSerials(ctx context.Context, input map[string]any) (map[string]any, error) {
	raw, ok := input["serial_nos"].([]any)
	// 回归回放 FF3（2026-10-14，运行快照）：
	// serial_nos 缺失或为空数组 → 10000「序列号不能为空」（逐字一致，见下方）；
	// 元素为数字/对象 → HTTP 400 无业务文案；含空串元素 → code:0 并跳过。
	if !ok || len(raw) == 0 {
		return nil, errors.New("序列号不能为空")
	}
	names := []string{}
	seen := map[string]bool{}
	for _, v := range raw {
		if v == nil {
			// 既有实现对 null 元素 **code:0 放行**（等价于空串，被下面的 no=="" 跳过）。
			continue
		}
		no, ok := v.(string)
		if !ok {
			// 批次 U 复测（2026-10-14，运行快照）：
			// 既有实现对 serial_nos 内的**非字符串元素**返回 HTTP **400**「系统内部错误，请稍后重试或联系管理员」
			// （结构体绑定失败，无业务文案）：
			//   数字 123 → 400    对象 {a:1} → 400    布尔 true → 400
			//   **null → code:0 放行**（被当作空串跳过）
			// 原本实现返回 ErrUnsupported（映射 501），HTTP 语义与既有实现 400 不一致；
			// 改用 ErrKnownNoMessage 携带既有实现状态码与原文案，不自造 message。
			return nil, ErrKnownNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}
		}
		if no == "" {
			continue
		}
		if seen[no] {
			return nil, fmt.Errorf("序列号 %s 在本次提交中重复", no)
		}
		seen[no] = true
		names = append(names, no)
	}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		for _, no := range names {
			var n int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM serial_numbers WHERE serial_no=? AND deleted_at IS NULL", no).Scan(&n); err != nil {
				return err
			}
			if n > 0 {
				return fmt.Errorf("序列号 %s 已存在", no)
			}
		}
		registered := now()
		for _, no := range names {
			row := s.base("serial_numbers")
			row["serial_no"], row["status"], row["registered_at"] = no, "in_stock", registered
			for _, key := range []string{"product_id", "product_code", "product_name", "warehouse_id", "warehouse_name", "source_type", "source_no", "remark"} {
				if input[key] != nil {
					row[key] = input[key]
				}
			}
			if err := s.Store.InsertWith(ctx, tx, "serial_numbers", row); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"registered": len(names)}, nil
}
func (s *Service) SerialAction(ctx context.Context, id, action string) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "serial_numbers", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("序列号不存在")
		}
		if err != nil {
			return err
		}
		verb, status := "出库", "out"
		if action == "scrap" {
			verb, status = "报废", "scrapped"
		}
		if value(row, "status") != "in_stock" {
			return errors.New("只有待出库状态（在库）的序列号才能" + verb)
		}
		changes := map[string]any{"status": status, "updated_at": now()}
		if action == "out" {
			changes["out_at"] = now()
		}
		if err := s.Store.UpdateWith(ctx, tx, "serial_numbers", id, changes); err != nil {
			return err
		}
		row, err = s.Store.GetWith(ctx, tx, "serial_numbers", id)
		if err != nil {
			return err
		}
		result = s.Store.Public("serial_numbers", row)
		delete(result, "edges")
		return nil
	})
	return result, err
}
