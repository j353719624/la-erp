package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
	"time"
)

func (s *Service) GetCheck(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "inventory_checks", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("inventory_checks", h)
	lines := []map[string]any{}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM inventory_check_lines WHERE check_id=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	for _, l := range rows {
		p, err := s.Store.Get(ctx, "products", value(l, "product_id"))
		if err != nil {
			return nil, err
		}
		r := s.Store.Public("inventory_check_lines", l)
		r["edges"] = map[string]any{"product": s.product(ctx, p, true)}
		lines = append(lines, r)
	}
	pub["edges"] = map[string]any{"lines": lines}
	return pub, nil
}

func (s *Service) WriteCheck(ctx context.Context, id string, input map[string]any, user string) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		// 回归回放 UC2（2026-10-13）：盘点单提交 location_id 既有实现 code:0，
		// 且 inventory_checks 表确有 location_id 列，故先摘出该字段再走通用守卫，
		// 其余无列的高级字段保持显式拒绝（不静默丢弃）。
		location := map[string]any{}
		header := map[string]any{}
		for k, v := range input {
			header[k] = v
		}
		if value(input, "location_id") != "" {
			// 批次 W（2026-10-14）：schema.sql 中 inventory_checks **确有** location_id 列
			// （`location_id` uuid NULL），故本守卫的 Store.Has 必然命中 → **永不可达**，
			// 属防御性断言。保留 ErrUnsupported 作兜底，不自造文案。
			if !s.Store.Has("inventory_checks", "location_id") {
				return ErrUnsupported
			}
			location["location_id"] = input["location_id"]
			delete(header, "location_id")
		}
		if err := rejectAdvanced(header); err != nil {
			return err
		}
		wh := value(input, "warehouse_id")
		if _, err := s.Store.GetWith(ctx, tx, "warehouses", wh); err != nil {
			return errors.New("仓库不存在")
		}
		h := s.base("inventory_checks")
		old := map[string]map[string]any{}
		if !creating {
			var err error
			h, err = s.Store.GetWith(ctx, tx, "inventory_checks", id)
			if err != nil {
				return err
			}
			if value(h, "status") != "draft" && value(h, "status") != "checking" {
				return errors.New("只有草稿或盘点中状态的盘点单才能修改")
			}
			// 回归回放 CC1/CC1b（2026-10-14）：编辑期改仓库既有实现 code:0，
			// 且表头 warehouse_id **真实改成新仓**；随后 start 时按新仓盘点
			// （book_qty 取新仓余额）。原本实现返回 ErrUnsupported，属误拒，已移除。
			rows, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_check_lines WHERE check_id=? AND deleted_at IS NULL", id)
			if err != nil {
				return err
			}
			for _, r := range rows {
				old[value(r, "product_id")] = r
			}
		}
		raw, ok := input["lines"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 1000 {
			return errors.New("盘点明细不能为空且不超过1000行")
		}
		if creating {
			no, err := s.nextNumber(ctx, tx, "IC")
			if err != nil {
				return err
			}
			h["check_no"], h["status"], h["created_by"] = no, "draft", user
		}
		h["warehouse_id"], h["remark"], h["updated_by"], h["updated_at"], h["total_items"] = wh, value(input, "remark"), user, now(), len(raw)
		for k, v := range location {
			h[k] = v
		}
		if date := value(input, "check_date"); date != "" {
			if _, err := time.Parse(time.RFC3339Nano, date); err != nil {
				return errors.New("日期格式错误")
			}
			h["check_date"] = date
		}
		id = value(h, "id")
		lines := []map[string]any{}
		seen := map[string]bool{}
		for i, v := range raw {
			in, ok := v.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			// 回归回放 CC2（2026-10-14）：盘点明细带 location_id/batch_no/serial_nos
			// 既有实现 code:0 建单成功；回读时这些列不暴露（明细表无对应列），
			// 属既有实现的静默忽略。本实现按「有列才持久化、无列不报错」处理：
			// 摘出这几项后再走通用守卫，避免把既有实现已接受的输入判为未恢复。
			line := map[string]any{}
			for key, val := range in {
				line[key] = val
			}
			for _, k := range []string{"batch_no", "serial_nos", "location_id"} {
				delete(line, k)
			}
			if err := rejectAdvanced(line); err != nil {
				return err
			}
			pid := value(in, "product_id")
			// 回归回放 X1（2026-10-13，内联取证）：盘点单提交**同一商品两行**
			// 创建/start/complete 全部 code:0，**两行都保留**（明细行数=2，
			// 两行 book_qty 与 diff_qty 均独立计算）。
			// 原实现对重复 product_id 返回 ErrUnsupported，属未经证据的错误拒绝，已移除。
			seen[pid] = true
			// 明细仍需校验商品存在且不是无法取证的组合商品。
			if _, err := s.plainProduct(ctx, tx, pid); err != nil {
				return err
			}
			actual, err := Number(in["actual_qty"])
			if err != nil || actual.IsNegative() {
				return errors.New("实盘数量格式错误")
			}
			book := decimal.Zero
			if value(h, "status") == "checking" {
				// 回归回放 KK9（2026-10-14，运行快照）：
				// 盘点单 start 后账面被其它单据改动（本例 book_qty=103 → 实时余额 203），
				// 再提交 actual_qty 时既有实现 **code:0 正常保存**，
				// 且**继续按创建时的 book_qty(103) 计算差异**（actual=106 → diff=3 profit），
				// complete 也正常通过（profit_items=1）。
				// 即既有实现**不校验账面与实时余额是否一致**。
				// 原本实现两处 return ErrUnsupported（找不到旧行 / 账面不符实时余额）属误拒：
				// 前者会让「新增明细行」失败，后者会让「盘点期间有出入库」的盘点单整个卡死。
				//
				// 批次 P 补充实测（2026-10-14）：提交**原单上没有的商品**时既有实现同样 code:0 ——
				// 明细被整体替换为新行集，且新行的 book_qty 恒为 **0**：
				//   实测把「实时库存 20 件」的商品替换进盘点单，回读 book_qty 仍是 0
				//   （不是实时余额），actual=23 → diff=23 profit，complete 通过
				// 即既有实现对「原单上没有的行」不查账面，直接按 0 起算（全盘盈）。
				// 本实现原先返回「盘点明细不存在」属误拒，已改为按既有实现取 0。
				previous := old[pid]
				if previous != nil {
					book = readDecimal(previous, "book_qty")
				}
			}
			diff := actual.Sub(book)
			kind := "none"
			if diff.IsPositive() {
				kind = "profit"
			} else if diff.IsNegative() {
				kind = "loss"
			}
			l := s.base("inventory_check_lines")
			l["check_id"], l["line_no"], l["product_id"], l["book_qty"], l["actual_qty"], l["diff_qty"], l["diff_type"] = id, i+1, pid, book.String(), actual.String(), diff.String(), kind
			for _, k := range []string{"product_name", "product_code", "remark"} {
				if value(in, k) != "" {
					l[k] = in[k]
				}
			}
			// 回归回放 UA1/UC1/UT1（2026-10-13）：明细 unit_id 与商品主数据 unit_id
			// 不一致时，调整/盘点/调拨三处均 code:0 创建+动作成功，且明细 unit_id
			// 按传入值原样落库（V6 已对通用单据路径证明同一结论）。原实现的
			// 一致性拒绝属系统性误拒，已移除。
			if value(in, "unit_id") != "" {
				l["unit_id"] = in["unit_id"]
			}
			lines = append(lines, l)
		}
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "inventory_checks", h); err != nil {
				return err
			}
		} else {
			delete(h, "id")
			if err := s.Store.UpdateWith(ctx, tx, "inventory_checks", id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE inventory_check_lines SET deleted_at=? WHERE check_id=? AND deleted_at IS NULL", now(), id); err != nil {
				return err
			}
		}
		for _, l := range lines {
			if err := s.Store.InsertWith(ctx, tx, "inventory_check_lines", l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetCheck(ctx, id)
}

func (s *Service) CheckAction(ctx context.Context, id, action, user string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "inventory_checks", id)
		if err != nil {
			return err
		}
		state := value(h, "status")
		changes := map[string]any{"updated_at": now()}
		switch action {
		case "delete":
			if state != "draft" {
				return errors.New("只有草稿状态的盘点单才能删除")
			}
			changes["deleted_at"] = now()
		case "cancel":
			if state != "draft" && state != "checking" {
				return errors.New("只有草稿或盘点中的盘点单才能取消")
			}
			changes["status"] = "cancelled"
		case "start", "complete":
			if action == "start" && state != "draft" {
				return errors.New("只有草稿状态的盘点单才能开始盘点")
			}
			if action == "complete" && state != "checking" {
				return errors.New("只有盘点中的盘点单才能完成")
			}
			rows, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_check_lines WHERE check_id=? AND deleted_at IS NULL ORDER BY line_no", id)
			if err != nil {
				return err
			}
			profit, loss := decimal.Zero, decimal.Zero
			profits, losses := 0, 0
			for _, l := range rows {
				pid := value(l, "product_id")
				b, err := s.balance(ctx, tx, pid, value(h, "warehouse_id"), true)
				if err != nil {
					return err
				}
				available := readDecimal(b, "qty_available")
				if action == "start" {
					if err := s.Store.UpdateWith(ctx, tx, "inventory_check_lines", value(l, "id"), map[string]any{"book_qty": available.String(), "actual_qty": available.String(), "diff_qty": "0", "diff_type": "none", "diff_amount": "0", "updated_at": now()}); err != nil {
						return err
					}
					continue
				}
				// Apply the counted difference to the current balance; intervening
				// stock movements are retained, matching the original runtime.
				diff := readDecimal(l, "diff_qty")
				if diff.IsZero() {
					continue
				}
				qty := diff.Abs()
				cost := readDecimal(l, "unit_cost")
				kind := "out"
				direction := int64(-1)
				stamp := "last_out_at"
				if diff.IsPositive() {
					kind, direction, stamp = "in", 1, "last_in_at"
					cost = readDecimal(b, "avg_cost")
					profit = profit.Add(qty.Mul(cost))
					profits++
					if err := s.Store.UpdateWith(ctx, tx, "inventory_check_lines", value(l, "id"), map[string]any{"unit_cost": cost.String(), "diff_amount": qty.Mul(cost).String(), "updated_at": now()}); err != nil {
						return err
					}
				} else {
					loss = loss.Add(qty.Mul(cost))
					losses++
				}
				after := available.Add(diff)
				if after.IsNegative() {
					return errors.New("库存不足")
				}
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": after.String(), stamp: now(), "updated_at": now()}); err != nil {
					return err
				}
				m := s.base("stock_movements")
				m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"] = kind, "check", id, h["check_no"], pid, h["warehouse_id"]
				m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = qty.String(), direction, cost.String(), qty.Mul(cost).String(), after.String(), user
				m["remark"] = fmt.Sprintf("盘点调整 %s 行%d", value(h, "check_no"), l["line_no"])
				if value(l, "unit_id") != "" {
					m["unit_id"] = l["unit_id"]
				}
				if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
					return err
				}
			}
			if action == "start" {
				changes["status"] = "checking"
			} else {
				changes["status"], changes["completed_at"], changes["profit_items"], changes["loss_items"], changes["profit_amount"], changes["loss_amount"] = "completed", now(), profits, losses, profit.String(), loss.String()
			}
		// 既有实现 NN5 实测动作集只有 start / complete / cancel；delete 为 HTTP DELETE 形态。
		// 与本实现白名单一致，本 default **不可达**，保留作兜底。
		default:
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, "inventory_checks", id, changes)
	})
	if err != nil {
		return nil, err
	}
	if action == "delete" {
		return nil, nil
	}
	return s.GetCheck(ctx, id)
}
