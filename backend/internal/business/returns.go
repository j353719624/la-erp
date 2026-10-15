package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

func isReturn(d Document) bool { return d.Table == "sales_returns" || d.Table == "purchase_returns" }

// The original approves returns independently of source-order delivered quantities.
// Keep this observed behavior explicit rather than silently inventing backwrites.
func (s *Service) approveReturn(ctx context.Context, d Document, id, user string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		// 原版回放（2026-10-13，证据 audit-approval-flow-20261013.json 与
		// audit-approval-biztype-20261013.json）：
		//   J1 仅存在 biz_type=sales_order 的活动流 -> 退货 approve code:0 通过
		//   J2 新建 biz_type=sales_return 的活动流   -> 仍 code:0 通过
		//   J3 停用该流后                            -> 仍 code:0 通过
		// 结论：原版退货审批**不因存在活动审批流而阻断**，也不按 biz_type 匹配。
		// 原实现此处统计全部 is_active=1 的流程后返回 ErrUnsupported，
		// 属未经证据的错误拒绝，已移除。
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		label, source, remark := "采购退货单", "purchase_return", "采购退货自动回冲"
		if d.Incoming {
			label, source, remark = "销售退货单", "sales_return", "销售退货自动回冲"
		}
		if value(h, "status") != "confirmed" {
			return errors.New("只有已确认的" + label + "才能审批")
		}
		// 原版回放（2026-10-13）：
		//   N1 创建时传 paid_amount=5 + payment_status=paid -> code:0，字段落库
		//      -> confirm code:0 -> approve code:0，单据 SR202610130023 正常 approved，
		//         paid_amount=5、payment_status=paid 均保留
		//   7.2 C 场景：currency_code=USD + exchange_rate=7.2 的退货创建与 confirm 亦 code:0
		// 原实现此处对非 CNY 或 paid_amount>0 返回 ErrUnsupported，属错误的拒绝，已移除。
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE order_id=? AND deleted_at IS NULL ORDER BY line_no", id)
		if err != nil {
			return err
		}
		if len(lines) == 0 {
			return errors.New("单据明细不能为空")
		}
		totalCost := decimal.Zero
		for _, l := range lines {
			if err := rejectAdvanced(l); err != nil {
				return err
			}
			if _, err := s.plainProduct(ctx, tx, value(l, "product_id"), true); err != nil {
				return err
			}
			b, err := s.balance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), d.Incoming)
			if err != nil {
				return err
			}
			qty, available, cost := readDecimal(l, "qty"), readDecimal(b, "qty_available"), readDecimal(b, "avg_cost")
			if d.Incoming {
				// 取价规则保持原实现（ORDER BY qty_available DESC LIMIT 1）。
				//
				// 原版回放显示该模型并不完全等价，证据见
				// docs/UNSUPPORTED-AUDIT-LOG.md 第 7.4 节：
				//   - 回冲落点恒为「无批次」行，即使明细指定了 batch_no；
				//   - 取价命中 qty_available DESC 的首行，但在数量并列时取到的是并列行之一
				//     （实例：REC-TIE-67 与 REC-LARGE-59 同为 20，原版取 59 而非 67）。
				// 该差异属交接文档第 36 行所述「等量没有人工次序，不能宣称跨数据库首行一致」，
				// 需构造无并列样本后才能判定，故此处暂不改排序语义，避免用未验证结论破坏既有回归。
				costs, err := database.QueryRows(ctx, tx, "SELECT avg_cost FROM inventory_balances WHERE product_id=? AND warehouse_id=? ORDER BY qty_available DESC LIMIT 1", l["product_id"], h["warehouse_id"])
				if err != nil {
					return err
				}
				if len(costs) > 0 {
					cost = readDecimal(costs[0], "avg_cost")
				}
			}
			if !d.Incoming {
				cost = readDecimal(l, "price")
			}
			direction, kind, date := 1, "in", "last_in_at"
			if d.Incoming {
				available = available.Add(qty)
			} else {
				if available.LessThan(qty) {
					return errors.New("库存不足")
				}
				available = available.Sub(qty)
				direction, kind, date = -1, "out", "last_out_at"
			}
			changes := map[string]any{"qty_available": available.String(), date: now(), "updated_at": now()}
			if d.Incoming {
				// 原版对「退清整个余额行」照常通过（SR202610130010：4 件退清后 balance_after=8）。
				// 原先此处对 available.IsZero() 直接返回 ErrUnsupported，与原版不符，已移除。
				// 仍需防止平均成本除零：available 为 0 且无既有成本时，按本次退货成本入账。
				if available.IsZero() {
					changes["avg_cost"] = cost.String()
				} else {
					changes["avg_cost"] = readDecimal(b, "qty_available").Mul(readDecimal(b, "avg_cost")).Add(qty.Mul(cost)).DivRound(available, 6).String()
				}
			}
			if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), changes); err != nil {
				return err
			}
			totalCost = totalCost.Add(qty.Mul(cost))
			m := s.base("stock_movements")
			for k, v := range map[string]any{"type": kind, "source_type": source, "source_id": id, "source_no": h[d.Number], "product_id": l["product_id"], "warehouse_id": h["warehouse_id"], "qty": qty.String(), "direction": direction, "unit_cost": cost.String(), "total_cost": qty.Mul(cost).String(), "balance_after": available.String(), "remark": remark} {
				m[k] = v
			}
			if value(l, "unit_id") != "" {
				m["unit_id"] = l["unit_id"]
			}
			if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
				return err
			}
		}
		amount := readDecimal(h, "total_amount")
		entries := []Posting{{"2202", "debit", amount}, {"1403", "credit", amount}}
		postingRemark := "采购退货红字冲销"
		if d.Incoming {
			postingRemark = "销售退货红字冲销"
			entries = []Posting{{"6001", "debit", amount}, {"1122", "credit", amount}, {"1405", "debit", totalCost}, {"6401", "credit", totalCost}}
		}
		if err := s.post(ctx, tx, source, id, value(h, d.Number), now(), postingRemark, entries); err != nil {
			return err
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"status": "approved", "approved_by": user, "approved_at": now(), "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, d, id)
}
