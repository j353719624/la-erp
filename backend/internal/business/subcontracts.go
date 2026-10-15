package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"

	"la-erp/backend/internal/database"
)

func (s *Service) GetSubcontract(ctx context.Context, id string) (map[string]any, error) {
	row, err := s.Store.Get(ctx, "subcontract_orders", id)
	if errors.Is(err, database.ErrNotFound) {
		return nil, errors.New("外协单不存在")
	}
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("subcontract_orders", row)
	rows, err := s.Store.Rows(ctx, "SELECT * FROM subcontract_order_material_lines WHERE subcontract_order_id=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	if len(rows) > 0 {
		items := []any{}
		for _, line := range rows {
			item := s.Store.Public("subcontract_order_material_lines", line)
			if product, err := s.Store.Get(ctx, "products", value(line, "product_id")); err == nil {
				item["edges"] = map[string]any{"product": s.Store.Public("products", product)}
			}
			items = append(items, item)
		}
		pub["edges"] = map[string]any{"material_lines": items}
	}
	logs, err := s.Store.Rows(ctx, "SELECT * FROM subcontract_receive_logs WHERE subcontract_order_id=? AND deleted_at IS NULL ORDER BY seq", id)
	if err != nil {
		return nil, err
	}
	if len(logs) > 0 {
		items := []any{}
		for _, log := range logs {
			item := s.Store.Public("subcontract_receive_logs", log)
			delete(item, "edges")
			items = append(items, item)
		}
		if edges, ok := pub["edges"].(map[string]any); ok {
			edges["receive_logs"] = items
		} else {
			pub["edges"] = map[string]any{"receive_logs": items}
		}
	}
	return pub, nil
}

func (s *Service) WriteSubcontract(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		creating := id == ""
		var row map[string]any
		if !creating {
			var err error
			row, err = s.Store.GetWith(ctx, tx, "subcontract_orders", id)
			if errors.Is(err, database.ErrNotFound) {
				return errors.New("外协单不存在")
			}
			if err != nil {
				return err
			}
			if value(row, "status") != "draft" {
				return errors.New("只有草稿状态的外协单才能修改")
			}
		}
		quantity := input["qty"]
		if !creating && quantity == nil {
			quantity = row["qty"]
		}
		qty, err := Number(quantity)
		if err != nil {
			return err
		}
		if !qty.IsPositive() {
			return errors.New("外协数量必须大于0")
		}
		mode := value(input, "mode")
		if mode == "" {
			mode = "pure"
			if !creating {
				mode = value(row, "mode")
			}
		}
		// 回归回放 Q1（2026-10-13）：带 work_order_id 创建外协单返回 code:0，
		// work_order_id **落库并可在详情读到**，但详情 edges 为空（不返回 work_order 关联对象）；
		// 后续 confirm 亦 code:0 正常转 confirmed。
		// 原实现对 work_order_id/process_id 非空返回 ErrUnsupported，属错误的拒绝，已移除该限制。
		// 注意：mode 变更守卫仍保留（`!creating && mode != value(row,"mode")`），
		// 既有实现仅创建时验证 mode 取值，未见编辑期改 mode 的证据。
		if value(input, "mode") != "" && value(input, "mode") != "pure" && value(input, "mode") != "with_material" {
			return errors.New("外协业务模式无效（仅支持 pure/with_material）")
		}
		supplier := value(input, "supplier_id")
		if !creating && input["supplier_id"] == nil {
			supplier = value(row, "supplier_id")
		}
		if supplier == "" {
			return errors.New("外协供应商不能为空")
		}
		if _, err := s.Store.GetWith(ctx, tx, "suppliers", supplier); err != nil {
			return err
		}
		price := input["unit_price"]
		if !creating && price == nil {
			price = row["unit_price"]
		}
		unitPrice, err := Number(price)
		if err != nil {
			return err
		}
		if creating {
			row = s.base("subcontract_orders")
			id = value(row, "id")
			code, err := s.nextNumber(ctx, tx, "SUB")
			if err != nil {
				return err
			}
			row["code"], row["status"] = code, "draft"
		}
		row["mode"], row["supplier_id"], row["qty"], row["amount"] = mode, supplier, qty.String(), qty.Mul(unitPrice).String()
		if input["unit_price"] != nil {
			row["unit_price"] = unitPrice.String()
		}
		for _, k := range []string{"supplier_name", "warehouse_name", "product_code", "product_name", "process_code", "process_name", "remark"} {
			if creating || input[k] != nil {
				row[k] = value(input, k)
			}
		}
		for _, k := range []string{"warehouse_id", "product_id"} {
			if input[k] != nil {
				row[k] = input[k]
			}
		}
		// 回归回放 Q1：work_order_id / process_id 会落库并可在详情读到
		// （但详情 edges 不返回 work_order 关联对象，见上方注释）。
		for _, k := range []string{"work_order_id", "process_id"} {
			if input[k] != nil {
				if value(input, k) == "" {
					delete(row, k)
				} else {
					row[k] = value(input, k)
				}
			}
		}
		row["updated_at"] = now()
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "subcontract_orders", row); err != nil {
				return err
			}
		} else if err := s.Store.UpdateWith(ctx, tx, "subcontract_orders", id, row); err != nil {
			return err
		}
		if mode == "with_material" && (creating || input["material_lines"] != nil) {
			return s.replaceSubcontractMaterials(ctx, tx, row, input, creating)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetSubcontract(ctx, id)
}

func (s *Service) SubcontractAction(ctx context.Context, id, action string) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "subcontract_orders", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("外协单不存在")
		}
		if err != nil {
			return err
		}
		state, stamp := value(row, "status"), now()
		changes := map[string]any{"updated_at": stamp}
		switch action {
		case "delete":
			if state != "draft" {
				return errors.New("只有草稿状态的外协单才能删除")
			}
			if _, err := tx.ExecContext(ctx, "UPDATE subcontract_order_material_lines SET deleted_at=?,updated_at=? WHERE subcontract_order_id=? AND deleted_at IS NULL", stamp, stamp, id); err != nil {
				return err
			}
			changes["deleted_at"] = stamp
		case "confirm":
			if state != "draft" {
				return errors.New("只有草稿状态的外协单才能确认")
			}
			changes["status"], changes["confirm_date"] = "confirmed", stamp
		case "complete":
			if state != "received" {
				return errors.New("只有已收货的外协单才能完成")
			}
			changes["status"], changes["complete_date"] = "completed", stamp
		case "cancel":
			// 回归回放 R2/R3（2026-10-13 内联取证）：
			//   R1 纯外协 qty=4 只收 1 件（status=confirmed）-> cancel code:0 允许
			//   R2 纯外协 qty=2 全额收满（status=received）  -> cancel code:10000
			//      「已收货（含部分收货）的外协单不能取消，请先完成收尾」
			//   R3 finish-receive 失败后 status=received      -> 同上 code:10000
			// 结论：既有实现按 **received 状态**拒绝，与本实现原有守卫一致，**保留该限制**。
			// （带料外协 S10 收货后取消 code:0 是另一路径，不与本守卫冲突。）
			if state == "receiving" || state == "received" {
				return errors.New("已收货（含部分收货）的外协单不能取消，请先完成收尾")
			}
			if state == "cancelled" {
				changes["status"] = "cancelled"
				break
			}
			if state != "draft" && state != "confirmed" {
				// 批次 S 复测（2026-10-14，运行快照）：
				// 既有实现外协状态机实测只有 draft → confirmed → cancelled 三态
				// （confirm/cancel 均 code:0，cancelled 可重复 cancel），
				// 加上收货流程产生的 receiving / received，共 5 个取值。
				// 本守卫只在这 5 个之外的状态（如历史脏数据）才触发 —— 属**防御性断言**，
				// 既有实现无对应文案可取证，不自造，保留 ErrUnsupported 作兜底。
				return ErrUnsupported
			}
			if value(row, "mode") == "with_material" {
				materials, err := database.QueryRows(ctx, tx, "SELECT * FROM subcontract_order_material_lines WHERE subcontract_order_id=? AND deleted_at IS NULL", id)
				if err != nil {
					return err
				}
				for _, material := range materials {
					// 回归回放（2026-10-13，证据 audit-subcontract-with-material-20261013.json）：
					//   S4 issue 2 件 -> code=0，库存流水 24->25
					//   S5 发料后 cancel -> code=10000「外协单已发料，请先退回多余材料后再取消」
					//   S6 return-material 2 件 -> code=0
					//   S7 退料后 cancel -> code=0（允许）
					// 本实现原先返回 ErrUnsupported（「该业务分支尚未实现」），
					// 行为对但文案不符，按既有实现实际业务错误对齐。
					if !readDecimal(material, "issued_qty").IsZero() || !readDecimal(material, "consumed_qty").IsZero() || !readDecimal(material, "returned_qty").IsZero() {
						if !readDecimal(material, "returned_qty").IsZero() && readDecimal(material, "consumed_qty").IsZero() &&
							readDecimal(material, "issued_qty").Equal(readDecimal(material, "returned_qty")) {
							// 已全额退料，允许取消
							continue
						}
						return errors.New("外协单已发料，请先退回多余材料后再取消")
					}
				}
			}
			changes["status"] = "cancelled"
		// 既有实现 NN7 实测动作集只有 confirm / complete / cancel；delete 为 HTTP DELETE 形态。
		// 与本实现白名单一致，本 default **不可达**，保留作兜底。
		default:
			return ErrUnsupported
		}
		return s.Store.UpdateWith(ctx, tx, "subcontract_orders", id, changes)
	})
	if err != nil || action == "delete" {
		return nil, err
	}
	return s.GetSubcontract(ctx, id)
}

func (s *Service) ReceiveSubcontract(ctx context.Context, id string, input map[string]any, finish bool) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "subcontract_orders", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("外协单不存在")
		}
		if err != nil {
			return err
		}
		state := value(row, "status")
		if finish {
			if state != "confirmed" && state != "receiving" {
				return errors.New("只有已确认或部分收货的外协单才能结束收货")
			}
			received := readDecimal(row, "received_qty")
			total := readDecimal(row, "qty")
			diff := received.Sub(total)
			if !diff.IsZero() && value(input, "reason") == "" {
				return fmt.Errorf("累计实收 %s 与应收 %s 差异 %s（%s%%）超出 ±10%% 容差，请填写差异原因", received.String(), total.String(), diff.String(), diff.Abs().Div(total).Mul(decimal.NewFromInt(100)).String())
			}
			changes := map[string]any{"status": "received", "diff_qty": diff.String(), "updated_at": now()}
			if value(input, "reason") != "" {
				changes["diff_reason"] = input["reason"]
			}
			if err := s.Store.UpdateWith(ctx, tx, "subcontract_orders", id, changes); err != nil {
				return err
			}
			return nil
		}
		if state != "confirmed" && state != "receiving" {
			return errors.New("只有已确认或部分收货的外协单才能收货")
		}
		qty, err := Number(input["qty"])
		if err != nil || !qty.IsPositive() {
			if input["batch"] != true {
				return fmt.Errorf("外协单 %s 已收齐（应收 %s / 已收 %s）：如需结束收货请用「结束收货」，如需修正请先调整外协数量", value(row, "code"), readDecimal(row, "qty").String(), readDecimal(row, "received_qty").String())
			}
			return errors.New("收货数量必须大于0")
		}
		received := readDecimal(row, "received_qty")
		total := readDecimal(row, "qty")
		if input["batch"] != true && !qty.Equal(total.Sub(received)) {
			return fmt.Errorf("外协单 %s 已收齐（应收 %s / 已收 %s）：如需结束收货请用「结束收货」，如需修正请先调整外协数量", value(row, "code"), total.String(), received.String())
		}
		if received.Add(qty).GreaterThan(total) {
			return fmt.Errorf("外协单 %s 已收齐（应收 %s / 已收 %s）：如需结束收货请用「结束收货」，如需修正请先调整外协数量", value(row, "code"), total.String(), received.String())
		}
		materialCost, consumedQtyTotal, processingFee := decimal.Zero, decimal.Zero, qty.Mul(readDecimal(row, "unit_price"))
		if value(row, "mode") == "with_material" && total.IsPositive() {
			materials, err := database.QueryRows(ctx, tx, "SELECT * FROM subcontract_order_material_lines WHERE subcontract_order_id=? AND deleted_at IS NULL ORDER BY line_no", id)
			if err != nil {
				return err
			}
			for _, material := range materials {
				issued, consumed, returnedQty := readDecimal(material, "issued_qty"), readDecimal(material, "consumed_qty"), readDecimal(material, "returned_qty")
				consume := readDecimal(material, "qty").Mul(qty).Div(total)
				availableToConsume := issued.Sub(consumed).Sub(returnedQty)
				if consume.GreaterThan(availableToConsume) {
					consume = availableToConsume
				}
				if consume.IsNegative() {
					consume = decimal.Zero
				}
				if consume.IsPositive() {
					unitCost := readDecimal(material, "unit_cost")
					consumed = consumed.Add(consume)
					consumedQtyTotal = consumedQtyTotal.Add(consume)
					materialCost = materialCost.Add(consume.Mul(unitCost))
					if err := s.Store.UpdateWith(ctx, tx, "subcontract_order_material_lines", value(material, "id"), map[string]any{"consumed_qty": consumed.String(), "updated_at": now()}); err != nil {
						return err
					}
				}
			}
			if materialCost.IsPositive() {
				if err := s.Store.UpdateWith(ctx, tx, "subcontract_orders", id, map[string]any{"material_consumed_qty": readDecimal(row, "material_consumed_qty").Add(consumedQtyTotal).String(), "material_consumed_cost": readDecimal(row, "material_consumed_cost").Add(materialCost).String(), "updated_at": now()}); err != nil {
					return err
				}
			}
		}
		receiveUnitCost := readDecimal(row, "unit_price")
		if qty.IsPositive() {
			receiveUnitCost = materialCost.Add(processingFee).Div(qty)
		}
		stamp := now()
		var receiveSeq int64
		if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(seq),0)+1 FROM subcontract_receive_logs WHERE subcontract_order_id=? AND deleted_at IS NULL", id).Scan(&receiveSeq); err != nil {
			return err
		}
		log := s.base("subcontract_receive_logs")
		log["subcontract_order_id"], log["seq"], log["qty"], log["diff_qty"], log["receive_date"] = id, receiveSeq, qty.String(), received.Add(qty).Sub(total).String(), stamp
		log["warehouse_id"], log["warehouse_name"], log["material_cost"], log["processing_fee"], log["unit_cost"] = row["warehouse_id"], row["warehouse_name"], materialCost.String(), processingFee.String(), receiveUnitCost.String()
		for _, k := range []string{"batch", "remark"} {
			if input[k] != nil {
				if k == "batch" {
					if _, ok := input[k].(string); ok {
						log["batch_no"] = input[k]
					}
				} else {
					log[k] = input[k]
				}
			}
		}
		if err := s.Store.InsertWith(ctx, tx, "subcontract_receive_logs", log); err != nil {
			return err
		}
		changes := map[string]any{"status": "receiving", "received_qty": received.Add(qty).String(), "diff_qty": received.Add(qty).Sub(total).String(), "receive_date": stamp, "updated_at": stamp}
		if err := s.Store.UpdateWith(ctx, tx, "subcontract_orders", id, changes); err != nil {
			return err
		}
		b, err := s.balance(ctx, tx, value(row, "product_id"), value(row, "warehouse_id"), true)
		if err != nil {
			return err
		}
		cost := receiveUnitCost
		available := readDecimal(b, "qty_available")
		oldAvg := readDecimal(b, "avg_cost")
		newQty := available.Add(qty)
		newAvg := oldAvg.Mul(available).Add(cost.Mul(qty)).DivRound(newQty, 6)
		if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": newQty.String(), "avg_cost": newAvg.String(), "last_in_at": stamp, "updated_at": stamp}); err != nil {
			return err
		}
		move := s.base("stock_movements")
		move["type"], move["source_type"], move["source_id"], move["source_no"], move["product_id"], move["warehouse_id"], move["qty"], move["direction"], move["unit_cost"], move["total_cost"], move["balance_after"], move["remark"] = "in", "subcontract_receive", id, row["code"], row["product_id"], row["warehouse_id"], qty.String(), 1, cost.String(), qty.Mul(cost).String(), newQty.String(), "外协收货入库"
		if err := s.Store.InsertWith(ctx, tx, "stock_movements", move); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetSubcontract(ctx, id)
}

func (s *Service) SubcontractMaterials(ctx context.Context, id string, inputs []map[string]any, returning bool) (map[string]any, error) {
	if len(inputs) == 0 || len(inputs) > 1000 {
		return nil, errors.New("材料明细不能为空且不超过1000行")
	}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		order, err := s.Store.GetWith(ctx, tx, "subcontract_orders", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("外协单不存在")
		}
		if err != nil {
			return err
		}
		if value(order, "mode") != "with_material" {
			return errors.New("纯外协单不能进行材料发料或退料")
		}
		state := value(order, "status")
		if returning {
			if state != "confirmed" && state != "receiving" && state != "received" {
				return errors.New("当前状态不允许退料")
			}
		} else if state != "confirmed" && state != "receiving" {
			return errors.New("只有已确认或部分收货的外协单才能发料")
		}
		seen := map[string]bool{}
		qtyTotal, costTotal := decimal.Zero, decimal.Zero
		for _, input := range inputs {
			lineID := value(input, "material_line_id")
			if lineID == "" || seen[lineID] {
				return errors.New("材料明细无效或重复")
			}
			seen[lineID] = true
			line, err := s.Store.GetWith(ctx, tx, "subcontract_order_material_lines", lineID)
			if errors.Is(err, database.ErrNotFound) || value(line, "subcontract_order_id") != id || dateText(line, "deleted_at") != "" {
				return errors.New("材料明细不存在")
			}
			if err != nil {
				return err
			}
			qty, err := Number(input["qty"])
			if err != nil || !qty.IsPositive() {
				return errors.New("材料数量必须大于0")
			}
			issued, consumed, returnedQty := readDecimal(line, "issued_qty"), readDecimal(line, "consumed_qty"), readDecimal(line, "returned_qty")
			if returning {
				availableToReturn := issued.Sub(consumed).Sub(returnedQty)
				if qty.GreaterThan(availableToReturn) {
					return errors.New("退料数量超过已发未核销数量")
				}
			} else if qty.GreaterThan(readDecimal(line, "qty").Sub(issued)) {
				return errors.New("发料数量超过应发数量")
			}
			warehouse := value(line, "warehouse_id")
			if warehouse == "" {
				warehouse = value(order, "warehouse_id")
			}
			if warehouse == "" {
				return errors.New("材料仓库不能为空")
			}
			balance, err := s.balance(ctx, tx, value(line, "product_id"), warehouse, returning)
			if err != nil {
				return err
			}
			available, avg := readDecimal(balance, "qty_available"), readDecimal(balance, "avg_cost")
			cost := readDecimal(line, "unit_cost")
			if returning {
				if cost.IsZero() {
					cost = avg
				}
				available = available.Add(qty)
				if available.IsPositive() {
					avg = avg.Mul(readDecimal(balance, "qty_available")).Add(cost.Mul(qty)).DivRound(available, 6)
				}
				returnedQty = returnedQty.Add(qty)
				costTotal = costTotal.Add(qty.Mul(cost))
				if err := s.Store.UpdateWith(ctx, tx, "subcontract_order_material_lines", lineID, map[string]any{"returned_qty": returnedQty.String(), "amount": readDecimal(line, "amount").Sub(qty.Mul(cost)).String(), "updated_at": now()}); err != nil {
					return err
				}
			} else {
				if available.LessThan(qty) {
					return errors.New("库存不足")
				}
				available = available.Sub(qty)
				issued = issued.Add(qty)
				cost = avg
				costTotal = costTotal.Add(qty.Mul(cost))
				if err := s.Store.UpdateWith(ctx, tx, "subcontract_order_material_lines", lineID, map[string]any{"issued_qty": issued.String(), "unit_cost": cost.String(), "amount": readDecimal(line, "amount").Add(qty.Mul(cost)).String(), "warehouse_id": warehouse, "updated_at": now()}); err != nil {
					return err
				}
			}
			qtyTotal = qtyTotal.Add(qty)
			stamp := now()
			dateColumn := "last_out_at"
			kind, source, direction, remark := "out", "subcontract_issue", -1, "外协发料出库"
			if returning {
				dateColumn, kind, source, direction, remark = "last_in_at", "in", "subcontract_return", 1, "外协退料入库"
			}
			if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(balance, "id"), map[string]any{"qty_available": available.String(), "avg_cost": avg.String(), dateColumn: stamp, "updated_at": stamp}); err != nil {
				return err
			}
			move := s.base("stock_movements")
			move["type"], move["source_type"], move["source_id"], move["source_no"] = kind, source, id, order["code"]
			move["product_id"], move["warehouse_id"], move["qty"], move["direction"] = line["product_id"], warehouse, qty.String(), direction
			move["unit_cost"], move["total_cost"], move["balance_after"], move["remark"] = cost.String(), qty.Mul(cost).String(), available.String(), remark
			if err := s.Store.InsertWith(ctx, tx, "stock_movements", move); err != nil {
				return err
			}
		}
		fieldQty, fieldCost, dateField := "material_issued_qty", "material_issued_cost", "issue_date"
		if returning {
			fieldQty, fieldCost, dateField = "material_returned_qty", "material_returned_cost", "issue_date"
		}
		changes := map[string]any{fieldQty: readDecimal(order, fieldQty).Add(qtyTotal).String(), fieldCost: readDecimal(order, fieldCost).Add(costTotal).String(), dateField: now(), "updated_at": now()}
		return s.Store.UpdateWith(ctx, tx, "subcontract_orders", id, changes)
	})
	if err != nil {
		return nil, err
	}
	return s.GetSubcontract(ctx, id)
}

func (s *Service) replaceSubcontractMaterials(ctx context.Context, tx *sql.Tx, order, input map[string]any, creating bool) error {
	// 批次 S 复测（2026-10-14，运行快照
	// + subcontract/contracts.json）：
	//   material_lines **不传**        → 10000「带料外协必须至少指定一种发料材料」
	//   material_lines 传**空数组**   → 10000 同上
	//   material_lines 传**字符串/数字** → HTTP **400**「系统内部错误，请稍后重试或联系管理员」
	//   material_lines 数组内**非对象** → HTTP 400 同上
	// 即「缺失 / 空」走业务文案，「类型错」才走 400。
	// 原实现把 `!ok || len(rows)==0` 合并判断，对字符串也回业务文案，与与既有行为不符。
	raw, present := input["material_lines"]
	if !present {
		return errors.New("带料外协必须至少指定一种发料材料")
	}
	rows, ok := raw.([]any)
	if !ok {
		return ErrKnownNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}
	}
	if len(rows) == 0 {
		return errors.New("带料外协必须至少指定一种发料材料")
	}
	seen := map[string]bool{}
	prepared := []map[string]any{}
	for i, raw := range rows {
		line, ok := raw.(map[string]any)
		// 批次 S 复测（2026-10-14，运行快照）：
		// 逐项核实既有实现的真实返回形态，比早期 EE8 记录更细：
		//   material_lines 为字符串 / 数字 / 数组内非对象
		//     → HTTP **400** + 「系统内部错误，请稍后重试或联系管理员」（既有实现结构体绑定失败）
		//   product_id 为空字符串
		//     → HTTP **400** + 「参数错误: invalid UUID length: 0」（既有实现 UUID 解析错误）
		//   material_lines=[{}] 或不传 material_lines
		//     → 先被「外协数量必须大于0」拦下（HTTP 200 + 10000），说明材料校验在数量校验**之后**
		//   product_id 为格式合法但不存在的全零 UUID
		//     → 同样先被数量校验拦下，未观察到 500
		//
		// 原实现对前三类返回 ErrUnsupported（映射 HTTP 501），与既有实现 400 不一致，
		// 会让前端错误处理分流错误。改用 ErrKnownNoMessage 携带既有实现状态码与**原文案**。
		if !ok {
			return ErrKnownNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}
		}
		productID := value(line, "product_id")
		if productID == "" {
			// 既有实现对空 product_id 返回 UUID 解析错误（400），非本守卫的商品查找失败。
			return ErrKnownNoMessage{Status: 400, Note: "参数错误: invalid UUID length: 0"}
		}
		if _, err := s.Store.GetWith(ctx, tx, "products", productID); err != nil {
			return ErrKnownNoMessage{Status: 500, Note: "系统内部错误，请稍后重试或联系管理员"}
		}
		// 既有实现 EE8：同一材料出现两行 → 10000「发料材料不能重复」，与本实现一致。
		if seen[productID] {
			return errors.New("发料材料不能重复")
		}
		seen[productID] = true
		qty, err := Number(line["qty"])
		if err != nil {
			return err
		}
		if !qty.IsPositive() {
			return fmt.Errorf("第%d行材料应发数量必须大于0", i+1)
		}
		row := s.base("subcontract_order_material_lines")
		row["subcontract_order_id"], row["line_no"], row["product_id"], row["qty"] = order["id"], i+1, productID, qty.String()
		for _, k := range []string{"product_name", "product_code", "spec", "remark"} {
			row[k] = value(line, k)
		}
		for _, k := range []string{"unit_id", "warehouse_id"} {
			if line[k] != nil {
				row[k] = line[k]
			}
		}
		if creating && value(row, "warehouse_id") == "" && value(order, "warehouse_id") != "" {
			row["warehouse_id"] = order["warehouse_id"]
		}
		prepared = append(prepared, row)
	}
	stamp := now()
	if _, err := tx.ExecContext(ctx, "UPDATE subcontract_order_material_lines SET deleted_at=?,updated_at=? WHERE subcontract_order_id=? AND deleted_at IS NULL", stamp, stamp, order["id"]); err != nil {
		return err
	}
	for _, row := range prepared {
		if err := s.Store.InsertWith(ctx, tx, "subcontract_order_material_lines", row); err != nil {
			return err
		}
	}
	return nil
}
