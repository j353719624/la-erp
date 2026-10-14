package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) GetWorkOrder(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "work_orders", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("work_orders", h)
	edges := map[string]any{}
	for relation, table := range map[string]string{"product": "products", "bom": "bo_ms", "warehouse": "warehouses", "routing": "routings"} {
		if value(h, relation+"_id") != "" {
			if relation == "routing" {
				rows, err := s.Store.Rows(ctx, "SELECT * FROM routings WHERE id=?", h["routing_id"])
				if err != nil {
					return nil, err
				}
				if len(rows) > 0 {
					edges[relation] = s.Store.Public(table, rows[0])
				}
				continue
			}
			r, err := s.Store.Get(ctx, table, value(h, relation+"_id"))
			if err != nil {
				return nil, err
			}
			edges[relation] = s.Store.Public(table, r)
		}
	}
	processes, err := s.Store.Rows(ctx, "SELECT * FROM work_order_processes WHERE work_order_id=? AND deleted_at IS NULL ORDER BY sequence", id)
	if err != nil {
		return nil, err
	}
	if len(processes) > 0 {
		rows := []map[string]any{}
		for _, p := range processes {
			rows = append(rows, s.Store.Public("work_order_processes", p))
		}
		edges["processes"] = rows
	}
	pub["edges"] = edges
	return pub, nil
}
func (s *Service) WriteWorkOrder(ctx context.Context, id, user string, input map[string]any) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var err error
		id, err = s.writeWorkOrderWith(ctx, tx, id, user, input)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.GetWorkOrder(ctx, id)
}

// Shared transaction helper also permits a generated batch to commit atomically.
func (s *Service) writeWorkOrderWith(ctx context.Context, tx *sql.Tx, id, user string, input map[string]any) (string, error) {
	creating := id == ""
	err := func() error {
		// 原版回放 T1/T2/T3（2026-10-13）：
		//   T1 工艺绑定的 product_id 与工单商品**不一致**时，创建仍 code:0 允许（不做匹配校验）
		//   T2 已关联工序(1条)的草稿工单改 product_id -> code:0，**工序被清空为 0**，routing_id 保留
		//   T3 清空后再提交 routing_id -> code:0，**工序重新生成为 1 条**
		// 原实现在此对「已关联工序 或 提交 routing_id」返回 ErrUnsupported，属错误的拒绝，已移除。
		product, err := s.plainProduct(ctx, tx, value(input, "product_id"))
		if err != nil {
			return err
		}
		qty, err := Number(input["qty"])
		if err != nil {
			return err
		}
		if !qty.IsPositive() {
			return errors.New("生产数量必须大于零")
		}
		if _, err := s.Store.GetWith(ctx, tx, "warehouses", value(input, "warehouse_id")); err != nil {
			return errors.New("仓库不存在")
		}
		var h map[string]any
		if creating {
			h = s.base("work_orders")
			no, err := s.nextNumber(ctx, tx, "WO")
			if err != nil {
				return err
			}
			h["order_no"], h["status"], h["priority"], h["created_by"] = no, "draft", "normal", user
			id = value(h, "id")
		} else {
			h, err = s.Store.GetWith(ctx, tx, "work_orders", id)
			if err != nil {
				return err
			}
			// 原版回放 T2（2026-10-13）：草稿态修改 product_id 返回 code:0 并生效，
			// 同时已关联工序被清空（1→0）、routing_id 保留。
			// 原实现对 bom_id/product_id 变更返回 ErrUnsupported，属错误的拒绝，已移除；
			// 下方的「只有草稿状态的工单才能编辑」状态守卫经原版确认一致，予以保留。
			if value(h, "status") != "draft" {
				return errors.New("只有草稿状态的工单才能编辑")
			}
			h["updated_at"] = now()
		}
		h["product_id"], h["product_name"], h["product_code"], h["qty"], h["warehouse_id"] = product["id"], value(input, "product_name"), value(input, "product_code"), qty.String(), input["warehouse_id"]
		for _, k := range []string{"remark", "planned_start_date", "planned_end_date", "priority"} {
			if input[k] != nil {
				h[k] = input[k]
			}
		}
		bomID := value(input, "bom_id")
		var items []map[string]any
		qtyPer := decimal.NewFromInt(1)
		if bomID != "" {
			b, err := s.Store.GetWith(ctx, tx, "bo_ms", bomID)
			if err != nil {
				return err
			}
			if value(b, "product_id") != value(product, "id") {
				return errors.New("BOM产品与工单产品不一致")
			}
			if value(b, "status") != "active" {
				return errors.New("BOM未启用")
			}
			qtyPer = readDecimal(b, "qty_per")
			if !qtyPer.IsPositive() {
				// 批次 Q 取证（2026-10-14，evidence/backend-runtime/audit-batch-q-20261014.json）：
				// 原版建 BOM 传 qty_per=0 或 -1 均 code:0，且**落库值被归一为 1**
				// （回读均为 1），据此 BOM 建工单 qty=5、材料 2 件 → 需求 10（=5/1×2）。
				// 原版库实测 qty_per<=0 的 BOM **0 条** —— 建单路径根本不产生该状态。
				// 故本守卫**永不可达**，属防御性断言（防外部直写数据库的脏数据）。
				// 无原版文案可对齐，不自造，保留 ErrUnsupported 作兜底。
				return ErrUnsupported
			}
			items, err = database.QueryRows(ctx, tx, "SELECT * FROM bom_items WHERE bom_id=? AND deleted_at IS NULL ORDER BY line_no", bomID)
			if err != nil {
				return err
			}
			h["bom_id"] = bomID
		} else {
			h["bom_id"] = nil
		}
		if value(input, "routing_id") != "" {
			// 仍校验工艺存在（查不到应报错），但**不再校验 product_id 匹配**。
			// 原版回放 T1：工艺绑定的 product_id 与工单商品不一致时仍允许关联（code:0）。
			if _, err := s.Store.GetWith(ctx, tx, "routings", value(input, "routing_id")); err != nil {
				return err
			}
			h["routing_id"] = input["routing_id"]
		}
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "work_orders", h); err != nil {
				return err
			}
		} else {
			if err := s.Store.UpdateWith(ctx, tx, "work_orders", id, h); err != nil {
				return err
			}
		}
		// 原版回放 T2/T3：
		//   T2 改 product_id 后已关联工序被清空（1→0），routing_id 保留
		//   T3 再次提交 routing_id 后工序重新生成（0→1）
		// 因此工序生成不限于创建，且编辑期需先清理旧工序再按新工艺重建。
		if value(h, "routing_id") != "" {
			if !creating {
				if _, err := tx.ExecContext(ctx, "DELETE FROM work_order_processes WHERE work_order_id=?", id); err != nil {
					return err
				}
			}
			if err := s.createWorkOrderProcesses(ctx, tx, h); err != nil {
				return err
			}
		}
		existingMaterials, err := database.QueryRows(ctx, tx, "SELECT id, product_id, product_name, qty_issued FROM work_order_materials WHERE work_order_id=? AND deleted_at IS NULL", id)
		if err != nil {
			return err
		}
		allowed := map[string]bool{}
		for _, l := range items {
			allowed[value(l, "product_id")] = true
		}
		// 原版回放 EE6（2026-10-14）：草稿工单把 bom_id 从「两材料」换成「单材料」后，
		// 原版 code:0，且 `GET /work-orders/{id}/materials` **只返回新 BOM 的材料**
		// （P1 行消失，仅剩 P2/70）——即原版会按新 BOM 重建材料行。
		// 原恢复端对「新 BOM 不含的旧材料」返回 ErrUnsupported，属误拒，已移除：
		// 下方按 allowed 集合清理不再需要的材料行。
		// 批次 BB 取证（2026-10-14，evidence/backend-runtime/audit-batch-bb-20261014.json）：
		// 原版**放行**负 scrap_rate 的 BOM 行：scrap_rate=-0.5 的 BOM 建工单 qty=10
		// → code:0，材料需求 19.9（= 10 × 2 × (1-0.005)）。
		// 批次 T 已测定 scrap_rate 是**百分数**：只有 ≤ -100 才产生零/负需求，
		// 小幅负值仅造成 0.5% 级偏差，危害极小，不足以拒绝。
		// 原恢复端 return ErrUnsupported（501）属误拒，已移除。
		for _, l := range items {
			var rows []map[string]any
			if !creating {
				rows, err = database.QueryRows(ctx, tx, "SELECT * FROM work_order_materials WHERE work_order_id=? AND product_id=? AND deleted_at IS NULL ORDER BY created_at", id, l["product_id"])
				if err != nil {
					return err
				}
			}
			m := s.base("work_order_materials")
			required := qty.Div(qtyPer).Mul(readDecimal(l, "qty")).Mul(decimal.NewFromInt(1).Add(readDecimal(l, "scrap_rate").Div(decimal.NewFromInt(100))))
			for k, v := range map[string]any{"work_order_id": id, "product_id": l["product_id"], "product_code": l["product_code"], "product_name": l["product_name"], "unit_id": l["unit_id"], "qty_required": required.String()} {
				m[k] = v
			}
			if len(rows) == 0 {
				if err := s.Store.InsertWith(ctx, tx, "work_order_materials", m); err != nil {
					return err
				}
			} else {
				// Original sync indexes materials by product, so the last duplicate
				// receives each matching BOM update; earlier duplicate rows remain.
				if err := s.Store.UpdateWith(ctx, tx, "work_order_materials", value(rows[len(rows)-1], "id"), map[string]any{"qty_required": required.String(), "updated_at": now()}); err != nil {
					return err
				}
			}
		}
		// 原版 EE6：换 BOM 后新 BOM 不再包含的旧材料行会从 materials 视图消失。
		// 已发出（qty_issued>0）的材料不能静默删除——那会让已领数量失去归属，
		// 故只清理从未领用过的行；已领用的保留由下方完成守卫兜底。
		for _, m := range existingMaterials {
			pid := value(m, "product_id")
			if allowed[pid] {
				continue
			}
			if readDecimal(m, "qty_issued").IsPositive() {
				// 批次 BB 取证（2026-10-14，evidence/backend-runtime/audit-batch-bb-20261014.json）：
				// 本守卫**永不可达** —— 两个前提互斥：
				//   · 只有**草稿**工单能改 BOM（已 confirmed 的返回 10000「只有草稿状态的工单才能修改」）
				//   · 只有**非草稿**工单能确认领料（草稿工单 confirm 返回 10000
				//     「工单状态（draft）不允许确认执行，仅已确认/生产中的工单可领料/入库/退料」）
				// 即「草稿态」与「已领用（qty_issued>0）」不可能同时成立。
				// 属防御性断言，保留 ErrUnsupported 作兜底，不自造文案。
				return ErrUnsupported
			}
			// 必须用 UpdateWith 传入 tx：Store.Update 走 s.DB 会逃出当前事务。
			if err := s.Store.UpdateWith(ctx, tx, "work_order_materials", value(m, "id"), map[string]any{"deleted_at": now()}); err != nil {
				return err
			}
		}
		return nil
	}()
	return id, err
}
func (s *Service) WorkOrderAction(ctx context.Context, id, user, action string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		// 原版回放（2026-10-13）：存在活动审批流 REC-PERSONAL-FLOW-1013(biz_type=sales_order) 时，
		// 新建工单 confirm 返回 code:0 且状态正常转为 confirmed；
		// 退货审批侧同样不因活动流阻断（见 returns.go approveReturn 注释与
		// evidence/backend-runtime/audit-approval-biztype-20261013.json）。
		// 原实现此处统计全部 is_active=1 的流程后返回 ErrUnsupported，
		// 属未经证据的错误拒绝，已移除。
		h, err := s.Store.GetWith(ctx, tx, "work_orders", id)
		if err != nil {
			return err
		}
		state := value(h, "status")
		changes := map[string]any{"updated_at": now()}
		switch action {
		case "confirm":
			if state != "draft" {
				return errors.New("只有草稿状态的工单才能确认")
			}
			changes["status"], changes["confirmed_at"] = "confirmed", now()
		case "approve":
			if state != "confirmed" {
				return errors.New("只有已确认的工单才能审批")
			}
			changes["status"], changes["approved_by"], changes["approved_at"], changes["actual_start_date"] = "in_progress", user, now(), now()
		case "cancel":
			var posted int
			for _, table := range []string{"production_pickings", "production_returns", "production_receipts"} {
				var n int
				if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM "+database.Quote(table)+" WHERE work_order_id=? AND status='confirmed' AND deleted_at IS NULL", id).Scan(&n); err != nil {
					return err
				}
				posted += n
			}
			if posted > 0 {
				return errors.New("工单已发生领料/退料/完工入库，不能取消（请先完成或做反向处理后工单）")
			}
			if state != "draft" && state != "confirmed" {
				return errors.New("只有草稿或已确认的工单才能取消")
			}
			changes["status"] = "cancelled"
		case "complete":
			if state != "in_progress" {
				return errors.New("只有生产中的工单才能完成")
			}
			var pendingProcesses int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM work_order_processes WHERE work_order_id=? AND deleted_at IS NULL AND status!='completed'", id).Scan(&pendingProcesses); err != nil {
				return err
			}
			if pendingProcesses > 0 {
				return errors.New("存在未完成的工序，无法完成工单")
			}
			rows, err := database.QueryRows(ctx, tx, "SELECT * FROM work_order_materials WHERE work_order_id=? AND deleted_at IS NULL", id)
			if err != nil {
				return err
			}
			for _, m := range rows {
				pending := readDecimal(m, "qty_required").Sub(readDecimal(m, "qty_issued")).Add(readDecimal(m, "qty_returned"))
				if pending.IsPositive() {
					return fmt.Errorf("物料 %s 尚有 %s 未领足，无法完成工单", value(m, "product_name"), pending.StringFixed(2))
				}
			}
			changes["status"], changes["completed_qty"], changes["actual_end_date"] = "completed", h["qty"], now()
		// 原版 NN8 实测动作集为 confirm / approve / complete / cancel，与恢复端白名单逐项一致，
		// 本 default **不可达**，保留作兜底。
		default:
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, "work_orders", id, changes)
	})
	if err != nil {
		return nil, err
	}
	return s.GetWorkOrder(ctx, id)
}
func (s *Service) WorkOrderMaterials(ctx context.Context, id, mode string) ([]map[string]any, error) {
	h, err := s.Store.Get(ctx, "work_orders", id)
	if err != nil {
		return nil, err
	}
	result := []map[string]any{}
	if mode == "bom-items" {
		if value(h, "bom_id") == "" {
			return result, nil
		}
		// Original endpoint includes old soft-deleted BOM items; other demand views
		// use the active snapshot. Preserve the captured discrepancy explicitly.
		rows, err := s.Store.Rows(ctx, "SELECT * FROM bom_items WHERE bom_id=? ORDER BY created_at", h["bom_id"])
		if err != nil {
			return nil, err
		}
		for _, l := range rows {
			p, err := s.Store.Get(ctx, "products", value(l, "product_id"))
			if err != nil {
				return nil, err
			}
			cost := readDecimal(p, "purchase_price")
			b, err := s.Store.Rows(ctx, "SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=?", l["product_id"], h["warehouse_id"])
			if err != nil {
				return nil, err
			}
			if len(b) > 0 {
				cost = readDecimal(b[0], "avg_cost")
			}
			unitName := ""
			if value(l, "unit_id") != "" {
				u, err := s.Store.Get(ctx, "units", value(l, "unit_id"))
				if err != nil {
					return nil, err
				}
				unitName = value(u, "name")
			}
			result = append(result, map[string]any{"product_id": p["id"], "product_code": p["code"], "product_name": p["name"], "unit_id": l["unit_id"], "unit_name": unitName, "qty": readDecimal(h, "qty").Mul(readDecimal(l, "qty")).String(), "unit_cost": cost.String()})
		}
		return result, nil
	}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM work_order_materials WHERE work_order_id=? AND deleted_at IS NULL ORDER BY created_at", id)
	if err != nil {
		return nil, err
	}
	for _, m := range rows {
		issued, returned, required := readDecimal(m, "qty_issued"), readDecimal(m, "qty_returned"), readDecimal(m, "qty_required")
		pending := decimal.Max(decimal.Zero, required.Sub(issued).Add(returned))
		if mode == "material-availability" {
			balance, err := s.Store.Rows(ctx, "SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=?", m["product_id"], h["warehouse_id"])
			if err != nil {
				return nil, err
			}
			available := decimal.Zero
			for _, b := range balance {
				available = available.Add(readDecimal(b, "qty_available"))
			}
			shortage := decimal.Max(decimal.Zero, pending.Sub(available))
			status := "ok"
			if shortage.IsPositive() {
				status = "shortage"
			}
			result = append(result, map[string]any{"product_id": m["product_id"], "product_code": m["product_code"], "product_name": m["product_name"], "required": required.String(), "picked": issued.Sub(returned).String(), "available": available.String(), "shortage": shortage.String(), "status": status})
		} else {
			unitName := ""
			if value(m, "unit_id") != "" {
				u, err := s.Store.Get(ctx, "units", value(m, "unit_id"))
				if err != nil {
					return nil, err
				}
				unitName = value(u, "name")
			}
			result = append(result, map[string]any{"id": m["id"], "work_order_id": id, "product_id": m["product_id"], "product_code": m["product_code"], "product_name": m["product_name"], "unit_id": m["unit_id"], "unit_name": unitName, "qty_required": required.String(), "qty_issued": issued.String(), "qty_returned": returned.String(), "qty_pending": pending.String(), "remark": value(m, "remark")})
		}
	}
	return result, nil
}
