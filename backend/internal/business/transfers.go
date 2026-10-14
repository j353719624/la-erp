package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"la-erp-recovered/backend/internal/database"
	"time"
)

func (s *Service) GetTransfer(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "stock_transfers", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("stock_transfers", h)
	edges := map[string]any{}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM stock_transfer_lines WHERE transfer_id=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	lines := []map[string]any{}
	for _, l := range rows {
		p, err := s.Store.Get(ctx, "products", value(l, "product_id"))
		if err != nil {
			return nil, err
		}
		r := s.Store.Public("stock_transfer_lines", l)
		r["edges"] = map[string]any{"product": s.product(ctx, p, true)}
		lines = append(lines, r)
	}
	if len(lines) > 0 {
		edges["lines"] = lines
	}
	for relation, field := range map[string]string{"fromWarehouse": "from_warehouse_id", "toWarehouse": "to_warehouse_id"} {
		wh, err := s.Store.Get(ctx, "warehouses", value(h, field))
		if err != nil {
			return nil, err
		}
		p := s.Store.Public("warehouses", wh)
		p["edges"] = map[string]any{}
		edges[relation] = p
	}
	pub["edges"] = edges
	return pub, nil
}

func (s *Service) WriteTransfer(ctx context.Context, id string, input map[string]any, user string) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		// 原版回放 UT2（2026-10-13）：提交 from_location_id/to_location_id 时原版返回
		// code:0，且**两个字段都真实落库**（回读值与传入一致）。stock_transfers 表确有
		// 这两列，故先摘出这两项再走通用守卫，有列的持久化、无列的显式拒绝。
		// 早前记录的「静默忽略」结论来自另一模块的证据文件，属误判，已更正。
		locations := map[string]any{}
		header := map[string]any{}
		for k, v := range input {
			header[k] = v
		}
		for _, k := range []string{"from_location_id", "to_location_id"} {
			if value(input, k) == "" {
				continue
			}
			if !s.Store.Has("stock_transfers", k) {
				return ErrUnsupported
			}
			locations[k] = input[k]
			delete(header, k)
		}
		if err := rejectAdvanced(header); err != nil {
			return err
		}
		h := s.base("stock_transfers")
		if !creating {
			var err error
			h, err = s.Store.GetWith(ctx, tx, "stock_transfers", id)
			if err != nil {
				return err
			}
			if value(h, "status") != "draft" {
				return errors.New("只有草稿状态的调拨单才能编辑")
			}
		}
		for _, k := range []string{"from_warehouse_id", "to_warehouse_id"} {
			v := value(input, k)
			if !creating && v == "" {
				v = value(h, k)
			}
			if _, err := s.Store.GetWith(ctx, tx, "warehouses", v); err != nil {
				return errors.New("仓库不存在")
			}
			h[k] = v
		}
		if h["from_warehouse_id"] == h["to_warehouse_id"] {
			return errors.New("调出仓与调入仓不能相同")
		}
		raw, ok := input["lines"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 1000 {
			return errors.New("调拨明细不能为空且不超过1000行")
		}
		h["remark"], h["updated_by"], h["updated_at"] = value(input, "remark"), user, now()
		for k, v := range locations {
			h[k] = v
		}
		if creating {
			number, err := s.nextNumber(ctx, tx, "TR")
			if err != nil {
				return err
			}
			h["transfer_no"], h["status"], h["created_by"] = number, "draft", user
		}
		if date := value(input, "transfer_date"); date != "" {
			if _, err := time.Parse(time.RFC3339Nano, date); err != nil {
				return errors.New("日期必须为RFC3339格式")
			}
			h["transfer_date"] = date
		}
		id = value(h, "id")
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "stock_transfers", h); err != nil {
				return err
			}
		} else {
			delete(h, "id")
			if err := s.Store.UpdateWith(ctx, tx, "stock_transfers", id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE stock_transfer_lines SET deleted_at=? WHERE transfer_id=? AND deleted_at IS NULL", now(), id); err != nil {
				return err
			}
		}
		seen := map[string]bool{}
		for i, v := range raw {
			in, ok := v.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			if err := rejectAdvanced(in); err != nil {
				return err
			}
			pid := value(in, "product_id")
			seen[pid] = true
			// 明细仍需校验商品存在且不是无法取证的组合商品。
			if _, err := s.plainProduct(ctx, tx, pid); err != nil {
				return err
			}
			qty, err := Number(in["qty"])
			if err != nil || !qty.IsPositive() {
				return errors.New("调拨数量必须大于0")
			}
			cost, err := Number(in["cost_price"])
			if err != nil || cost.IsNegative() {
				return errors.New("成本格式错误")
			}
			l := s.base("stock_transfer_lines")
			l["transfer_id"], l["line_no"], l["product_id"], l["qty"], l["cost_price"] = id, i+1, pid, qty.String(), cost.String()
			for _, k := range []string{"product_name", "product_code", "spec", "unit_name", "remark"} {
				if value(in, k) != "" {
					l[k] = in[k]
				}
			}
			// 原版回放 UA1/UC1/UT1（2026-10-13）：明细 unit_id 与商品主数据 unit_id
			// 不一致时，调整/盘点/调拨三处均 code:0 创建+动作成功，且明细 unit_id
			// 按传入值原样落库（V6 已对通用单据路径证明同一结论）。原实现的
			// 一致性拒绝属系统性误拒，已移除。
			if value(in, "unit_id") != "" {
				l["unit_id"] = in["unit_id"]
			}
			if err := s.Store.InsertWith(ctx, tx, "stock_transfer_lines", l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetTransfer(ctx, id)
}

func (s *Service) TransferAction(ctx context.Context, id, action, user string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "stock_transfers", id)
		if err != nil {
			return err
		}
		status := value(h, "status")
		switch action {
		case "delete":
			if status != "draft" {
				return errors.New("只有草稿状态的调拨单才能删除")
			}
			return s.Store.UpdateWith(ctx, tx, "stock_transfers", id, map[string]any{"deleted_at": now(), "updated_at": now()})
		case "dispatch":
			if status != "draft" {
				return errors.New("只有草稿状态的调拨单才能发运")
			}
		case "complete":
			if status != "in_transit" {
				return errors.New("只有运输中的调拨单才能完成入库")
			}
		case "cancel":
			if status != "draft" && status != "in_transit" {
				return errors.New("只有草稿或运输中的调拨单才能取消")
			}
		// 原版 NN3 实测动作集只有 dispatch / complete / cancel；delete 为 HTTP DELETE 形态。
		// 与恢复端白名单一致，本 default **不可达**，保留作兜底。
		default:
			return ErrUnsupported
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM stock_transfer_lines WHERE transfer_id=? AND deleted_at IS NULL ORDER BY line_no", id)
		if err != nil {
			return err
		}
		if action != "cancel" || status == "in_transit" {
			for _, l := range lines {
				if err := rejectAdvanced(l); err != nil {
					return err
				}
				pid := value(l, "product_id")
				if _, err := s.plainProduct(ctx, tx, pid); err != nil {
					return err
				}
				from, err := s.balance(ctx, tx, pid, value(h, "from_warehouse_id"), false)
				if err != nil {
					return err
				}
				to, err := s.balance(ctx, tx, pid, value(h, "to_warehouse_id"), true)
				if err != nil {
					return err
				}
				qty, cost := readDecimal(l, "qty"), readDecimal(from, "avg_cost")
				a, b, transit := readDecimal(from, "qty_available"), readDecimal(to, "qty_available"), readDecimal(to, "qty_in_transit")
				movementWarehouse := value(h, "from_warehouse_id")
				direction := int64(-1)
				kind, remark := "out", "调拨出库"
				after := a.Sub(qty)
				fromUpdate, toUpdate := map[string]any{"updated_at": now()}, map[string]any{"updated_at": now()}
				switch action {
				case "dispatch":
					if a.LessThan(qty) {
						return errors.New("库存不足")
					}
					fromUpdate["qty_available"], fromUpdate["last_out_at"] = after.String(), now()
					toUpdate["qty_in_transit"] = transit.Add(qty).String()
					if err := s.Store.UpdateWith(ctx, tx, "stock_transfer_lines", value(l, "id"), map[string]any{"transferred_qty": qty.String(), "updated_at": now()}); err != nil {
						return err
					}
				case "complete", "cancel":
					// The original reads the current source average again at receipt
					// or cancellation, even if incoming stock changed it in transit.
					if transit.LessThan(qty) {
						return errors.New("在途库存不足")
					}
					toUpdate["qty_in_transit"] = transit.Sub(qty).String()
					direction, kind = int64(1), "in"
					if action == "complete" {
						after = b.Add(qty)
						avg := cost
						if !after.IsZero() {
							avg = b.Mul(readDecimal(to, "avg_cost")).Add(qty.Mul(cost)).DivRound(after, 6)
						}
						toUpdate["qty_available"], toUpdate["avg_cost"], toUpdate["last_in_at"] = after.String(), avg.String(), now()
						movementWarehouse, remark = value(h, "to_warehouse_id"), "调拨入库"
					} else {
						after = a.Add(qty)
						fromUpdate["qty_available"], fromUpdate["last_in_at"] = after.String(), now()
						remark = "调拨取消回滚"
					}
				}
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(from, "id"), fromUpdate); err != nil {
					return err
				}
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(to, "id"), toUpdate); err != nil {
					return err
				}
				m := s.base("stock_movements")
				m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"] = kind, "transfer", id, h["transfer_no"], pid, movementWarehouse
				m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = qty.String(), direction, cost.String(), qty.Mul(cost).String(), after.String(), user
				m["remark"] = fmt.Sprintf("%s %s 行%d", remark, value(h, "transfer_no"), l["line_no"])
				if value(l, "unit_id") != "" {
					m["unit_id"] = l["unit_id"]
				}
				if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
					return err
				}
			}
		}
		update := map[string]any{"updated_at": now()}
		switch action {
		case "dispatch":
			update["status"], update["transfer_date"] = "in_transit", now()
		case "complete":
			update["status"], update["completed_at"] = "completed", now()
		case "cancel":
			update["status"] = "cancelled"
		}
		return s.Store.UpdateWith(ctx, tx, "stock_transfers", id, update)
	})
	if err != nil {
		return nil, err
	}
	if action == "delete" {
		return nil, nil
	}
	return s.GetTransfer(ctx, id)
}
