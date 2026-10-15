package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

func sourceDocument(d Document) Document {
	if d.Incoming {
		return Documents["purchase-orders"]
	}
	return Documents["sales-orders"]
}

// source 解析库存单据的来源订单。
//
// 回归回放 JJ6（2026-10-14，运行快照）：
//
//	source_id 为**非法 UUID**（"not-a-uuid"）→ 建单期即 400「invalid UUID length: 10」
//	  —— 即 UUID **格式**在建单期校验。
//	source_id 为格式合法但不存在的 UUID（全零）→ 建单 code:0，**confirm 也 code:0 成功**，
//	  即来源订单是否存在**既有实现完全不校验**（本实现确认期仍报「来源订单不存在」，
//	  与既有实现不同，但该文案是本实现基线文案且无既有实现反证，保留并在此记录差异）。
//
// 既有实现只按 source_id 关联来源订单（2026-10-13 回放取证）：
//
//	V3 —— source_no 传错仍正常回写 delivered_qty，编号仅作信息落库不校验一致性；
//	V5 —— 出库仓库与来源订单仓库不一致同样放行。故本实现不复刻这两项校验。
func (s *Service) source(ctx context.Context, tx *sql.Tx, d Document, h map[string]any, validate bool) (map[string]any, error) {
	id := value(h, "source_id")
	if id == "" {
		return nil, nil
	}
	// 批次 Z（2026-10-14）：两处调用点（service.go:363 建单期、service.go:795 确认期）
	// **都已在 `if d.Stock` 块内**（service.go:349 / 795），故本守卫**永不可达**。
	// 属防御性断言，保留 ErrUnsupported 作兜底，不自造文案。
	if !d.Stock {
		return nil, ErrUnsupported
	}
	order, err := s.Store.GetWith(ctx, tx, sourceDocument(d).Table, id)
	if err != nil {
		if !validate {
			return nil, nil
		}
		return nil, errors.New("来源订单不存在")
	}
	return order, nil
}
func (s *Service) deliverLine(ctx context.Context, tx *sql.Tx, d Document, order, line map[string]any) error {
	if order == nil {
		return nil
	}
	// 既有实现状态文案用完整动词（发货/收货），超发文案用短形式（剩余可发/剩余可收），
	// 故此处分别保留 verb 与 short（2026-10-13 V4/Z1/Z2/Z3/Z4/Y1-Y3 回放逐字核对）。
	kind, label, verb, short, act := "发", "销售", "发货", "发", "出库"
	if d.Incoming {
		kind, label, verb, short, act = "收", "采购", "收货", "收", "入库"
	}
	no := value(order, "order_no")
	switch value(order, "status") {
	case "draft":
		return fmt.Errorf("%s订单 %s 未确认，不能%s（请先确认订单）", label, no, verb)
	case "cancelled":
		return fmt.Errorf("%s订单 %s 已取消，不能%s", label, no, verb)
	case "closed":
		return fmt.Errorf("%s订单 %s 已关闭，不能继续%s", label, no, verb)
	}
	src := sourceDocument(d)
	// 既有实现允许来源订单同商品多行，并按 line_no 顺序跨行分配（2026-10-13 回放取证）：
	// V1 —— 两行（2/3）发 1 件记入第 1 行；Y1 —— 行满后自动落到下一行；
	// Y2/Y3 —— 一次发 5/4 件拆成 L1=2、L2=3/2；超额按聚合剩余量拒绝（Z1：剩余可发 5.00）。
	matches, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(src.Lines)+" WHERE order_id=? AND product_id=? AND deleted_at IS NULL ORDER BY line_no", order["id"], line["product_id"])
	if err != nil {
		return err
	}
	if len(matches) == 0 {
		return fmt.Errorf("商品 %s 不在%s订单 %s 明细中，无法%s", value(line, "product_name"), label, no, act)
	}
	qty := readDecimal(line, "qty")
	remaining := decimal.Zero
	for _, l := range matches {
		remaining = remaining.Add(readDecimal(l, "qty").Sub(readDecimal(l, "delivered_qty")))
	}
	if qty.GreaterThan(remaining) {
		return fmt.Errorf("商品 %s 超%s：%s订单 %s 剩余可%s %s，本次 %s", value(line, "product_name"), kind, label, no, short, remaining.StringFixed(2), qty.StringFixed(2))
	}
	// 既有实现不校验明细单位与来源订单行单位的一致性（V6：异单位发货成功且正常回写）。
	left := qty
	for _, l := range matches {
		if !left.IsPositive() {
			break
		}
		open := readDecimal(l, "qty").Sub(readDecimal(l, "delivered_qty"))
		if open.IsNegative() {
			open = decimal.Zero
		}
		take := decimal.Min(open, left)
		if take.IsPositive() {
			if err := s.Store.UpdateWith(ctx, tx, src.Lines, value(l, "id"), map[string]any{"delivered_qty": readDecimal(l, "delivered_qty").Add(take).String(), "updated_at": now()}); err != nil {
				return err
			}
			left = left.Sub(take)
		}
	}
	return nil
}
func (s *Service) closeDelivered(ctx context.Context, tx *sql.Tx, d Document, order map[string]any) error {
	if order == nil {
		return nil
	}
	src := sourceDocument(d)
	lines, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(src.Lines)+" WHERE order_id=? AND deleted_at IS NULL", order["id"])
	if err != nil {
		return err
	}
	complete := len(lines) > 0
	for _, l := range lines {
		if readDecimal(l, "delivered_qty").LessThan(readDecimal(l, "qty")) {
			complete = false
		}
	}
	changes := map[string]any{"updated_at": now()}
	if complete {
		changes["status"] = "closed"
	}
	if !d.Incoming {
		changes["customer_progress"] = "shipped"
		if complete {
			changes["customer_progress"] = "completed"
		}
		changes["shipped_at"] = now()
	}
	return s.Store.UpdateWith(ctx, tx, src.Table, value(order, "id"), changes)
}
func (s *Service) Approve(ctx context.Context, d Document, id, user string) (map[string]any, error) {
	if isReturn(d) {
		return s.approveReturn(ctx, d, id, user)
	}
	// 既有实现没有 stock 单据的审批路由（2026-10-13 A4 回放：POST /stock-ins/{id}/approve → 404
	// 「路由不存在」），本实现同样不支持该动作，返回 ErrUnsupported。
	// 批次 Z（2026-10-14）：approve 路由在 API 层用 `if !d.Stock` 包住注册
	// （internal/api/business.go:53-54），即**只有非库存单据才有 approve 端点**。
	// 本函数只在 approve 路由里被调用（business.go:58），故 `d.Stock` 恒为 false
	// → 本守卫**永不可达**。保留 ErrUnsupported 作兜底，不自造文案。
	if d.Stock {
		return nil, ErrUnsupported
	}
	// 既有实现审批不受活动审批流影响（2026-10-13 A2 回放：启用 sales_order 活动流后
	// confirm 与 approve 均 code:0，状态正常转为 approved），也不校验币种与已收金额
	// （R2：USD 订单 confirm+approve 均通过；A3：既有实现无订单收款路由，paid_amount 恒为 0）。
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		if value(h, "status") != "confirmed" {
			label := "销售"
			if d.Party == "supplier" {
				label = "采购"
			}
			return fmt.Errorf("只有已确认的%s订单才能审批", label)
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, map[string]any{"status": "approved", "approved_by": user, "approved_at": now(), "updated_at": now()})
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, d, id)
}
func consumeLocked(available, locked, qty decimal.Decimal) (decimal.Decimal, decimal.Decimal, error) {
	fromLocked := decimal.Min(locked, qty)
	unlocked := qty.Sub(fromLocked)
	if available.LessThan(unlocked) {
		return available, locked, errors.New("库存不足")
	}
	return available.Sub(unlocked), locked.Sub(fromLocked), nil
}
