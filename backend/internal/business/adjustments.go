package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
	"strings"
	"time"
)

func (s *Service) GetAdjustment(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "stock_adjusts", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("stock_adjusts", h)
	lines := []map[string]any{}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM stock_adjust_lines WHERE adjust_id=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	for _, l := range rows {
		p, err := s.Store.Get(ctx, "products", value(l, "product_id"))
		if err != nil {
			return nil, err
		}
		r := s.Store.Public("stock_adjust_lines", l)
		product := s.Store.Public("products", p)
		product["edges"] = map[string]any{}
		r["edges"] = map[string]any{"product": product}
		lines = append(lines, r)
	}
	pub["edges"] = map[string]any{"lines": lines}
	return pub, nil
}

func (s *Service) WriteAdjustment(ctx context.Context, id string, input map[string]any, user string) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if err := rejectAdvanced(input); err != nil {
			return err
		}
		kind := value(input, "adjust_type")
		// 原版回放 BB5/BB5b（2026-10-14）：adjust_type 不校验白名单——"garbage"
		// 原样落库并可 confirm；不传时该列落库为空串。原恢复端返回 ErrUnsupported，
		// 属误拒，已移除。成本型（cost）单独在下方按 qty 归零处理。
		kind = strings.ToLower(kind)
		wh := value(input, "warehouse_id")
		if _, err := s.Store.GetWith(ctx, tx, "warehouses", wh); err != nil {
			return errors.New("仓库不存在")
		}
		raw, ok := input["lines"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 1000 {
			return errors.New("明细不能为空且不超过1000行")
		}
		h := s.base("stock_adjusts")
		if !creating {
			var err error
			h, err = s.Store.GetWith(ctx, tx, "stock_adjusts", id)
			if err != nil {
				return err
			}
			if value(h, "status") != "draft" {
				return errors.New("只有草稿状态的库存调整单才能编辑")
			}
		}
		id = value(h, "id")
		number := value(h, "adjust_no")
		if creating {
			var err error
			number, err = s.nextNumber(ctx, tx, "ADJ")
			if err != nil {
				return err
			}
		}
		h["adjust_no"], h["warehouse_id"], h["adjust_type"], h["status"], h["created_by"], h["remark"] = number, wh, kind, "draft", user, value(input, "remark")
		if date := value(input, "adjust_date"); date != "" {
			if _, err := time.Parse(time.RFC3339Nano, date); err != nil {
				return errors.New("日期格式错误")
			}
			h["adjust_date"] = date
		}
		total := decimal.Zero
		lines := []map[string]any{}
		for i, v := range raw {
			in, ok := v.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			if err := rejectAdvanced(in); err != nil {
				return err
			}
			pid := value(in, "product_id")
			// 原版回放 V1（2026-10-13，内联取证）：库存调整单提交**同一商品两行**
			// （qty 1 与 qty 2）创建 code:0、confirm code:0，**两行都保留**（明细行数=2）。
			// 原实现对重复 product_id 返回 ErrUnsupported，属未经证据的错误拒绝，已移除。

			// 明细仍需校验商品存在且不是无法取证的组合商品。
			if _, err := s.plainProduct(ctx, tx, pid); err != nil {
				return err
			}
			qty, err := Number(in["qty"])
			if err != nil || (kind != "cost" && !qty.IsPositive()) {
				return errors.New("调整数量必须大于0")
			}
			// 原版回放 BB5/BB5b/KK10（2026-10-14）：cost 型传入 qty=3/5 时原版 code:0，
			// 且**只有表头 total_qty 落库为 0**——成本调整不携带数量，
			// 故汇总时忽略传入的数量；但**明细行的 qty 原样保留**（回读为 5）。
			// 原恢复端两处不合：一是直接拒绝非零 qty（误拒，已移除）；
			// 二是把明细也归零（与原版不符，此处修正为只归零汇总值）。
			// 成本调整的数量校验：非 cost 型要求 qty>0；cost 型不限（沿用原版放行）。
			summed := qty
			if kind == "cost" {
				summed = decimal.Zero
			}
			cost, err := Number(in["unit_cost"])
			if err != nil || cost.IsNegative() {
				return errors.New("成本格式错误")
			}
			l := s.base("stock_adjust_lines")
			l["adjust_id"], l["line_no"], l["product_id"], l["qty"], l["unit_cost"] = id, i+1, pid, qty.String(), cost.String()
			for _, k := range []string{"product_name", "product_code", "spec", "remark"} {
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
			total = total.Add(summed)
			lines = append(lines, l)
		}
		h["total_qty"] = total.String()
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "stock_adjusts", h); err != nil {
				return err
			}
		} else {
			delete(h, "id")
			h["updated_at"], h["updated_by"] = now(), user
			if err := s.Store.UpdateWith(ctx, tx, "stock_adjusts", id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE stock_adjust_lines SET deleted_at=? WHERE adjust_id=? AND deleted_at IS NULL", now(), id); err != nil {
				return err
			}
		}
		for _, l := range lines {
			if err := s.Store.InsertWith(ctx, tx, "stock_adjust_lines", l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetAdjustment(ctx, id)
}

func (s *Service) AdjustmentAction(ctx context.Context, id, action, user string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, "stock_adjusts", id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的库存调整单才能" + map[string]string{"confirm": "确认", "cancel": "取消", "delete": "删除"}[action])
		}
		update := map[string]any{"updated_at": now()}
		switch action {
		case "delete":
			update["deleted_at"] = now()
		case "cancel":
			update["status"] = "cancelled"
		case "confirm":
			kind := strings.ToLower(value(h, "adjust_type"))
			// 原版回放 BB5/BB5b（2026-10-14）：adjust_type 不校验白名单，
			// "garbage" 类型也能 confirm 成功。原恢复端在确认期再拒一次，属误拒，已移除。
			lines, err := database.QueryRows(ctx, tx, "SELECT * FROM stock_adjust_lines WHERE adjust_id=? AND deleted_at IS NULL ORDER BY line_no", id)
			if err != nil {
				return err
			}
			for _, l := range lines {
				pid := value(l, "product_id")
				b, err := s.balance(ctx, tx, pid, value(h, "warehouse_id"), kind != "loss")
				if err != nil {
					return err
				}
				qty, cost := readDecimal(l, "qty"), readDecimal(l, "unit_cost")
				if kind == "cost" {
					// 原版回放 KK10（2026-10-14，evidence/backend-runtime/audit-batch-m-20261014.json）：
					// cost 型调整传 qty=5 时原版 **code:0 建单成功且 confirm 成功**，
					// 明细行 qty 原样保留为 5，只有表头 total_qty 被强制归 0。
					// 即原版**不拒绝非零数量，只在汇总时忽略它**。
					// 原恢复端 return ErrUnsupported 属误拒：正常的「按金额调成本、顺手填了数量」
					// 会被整个拒掉。已移除该守卫，成本调整本身不受数量影响（下方 movement 的 qty 恒为 0）。
					_ = qty
					if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"avg_cost": cost.String(), "updated_at": now()}); err != nil {
						return err
					}
					m := s.base("stock_movements")
					m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"] = "adjust", "adjust_cost", id, h["adjust_no"], pid, h["warehouse_id"]
					m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = "0", int64(0), cost.String(), "0", readDecimal(b, "qty_available").String(), user
					m["remark"] = fmt.Sprintf("成本调整 %s 行%d：均价→%s", value(h, "adjust_no"), l["line_no"], cost.String())
					if value(l, "unit_id") != "" {
						m["unit_id"] = l["unit_id"]
					}
					if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
						return err
					}
					continue
				}
				before, avg := readDecimal(b, "qty_available"), readDecimal(b, "avg_cost")
				after := before.Add(qty)
				direction := int64(1)
				changes := map[string]any{"updated_at": now(), "last_in_at": now()}
				if kind == "loss" {
					if before.LessThan(qty) {
						return errors.New("库存不足")
					}
					after = before.Sub(qty)
					direction = -1
					delete(changes, "last_in_at")
					changes["last_out_at"] = now()
				} else if !after.IsZero() {
					avg = before.Mul(avg).Add(qty.Mul(cost)).DivRound(after, 6)
				}
				changes["qty_available"], changes["avg_cost"] = after.String(), avg.String()
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), changes); err != nil {
					return err
				}
				m := s.base("stock_movements")
				m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"] = "adjust", "adjust", id, h["adjust_no"], pid, h["warehouse_id"]
				m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = qty.String(), direction, cost.String(), qty.Mul(cost).String(), after.String(), user
				m["remark"] = fmt.Sprintf("库存调整 %s 行%d", value(h, "adjust_no"), l["line_no"])
				if value(l, "unit_id") != "" {
					m["unit_id"] = l["unit_id"]
				}
				if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
					return err
				}
			}
			update["status"], update["confirmed_at"], update["confirmed_by"] = "confirmed", now(), user
		// 原版 NN11 实测动作集只有 confirm / cancel；delete 为 HTTP DELETE 形态。
		// API 层 registerAdjustments 用 []string{"confirm","cancel","delete"} 限定，
		// 故本 default 分支**不可达**，无原文案可对齐，保留 ErrUnsupported 作兜底。
		default:
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, "stock_adjusts", id, update)
	})
	if err != nil {
		return nil, err
	}
	if action == "delete" {
		return nil, nil
	}
	return s.GetAdjustment(ctx, id)
}
