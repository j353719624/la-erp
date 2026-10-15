package business

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

type ProductionDocument struct{ Table, Lines, FK, Number, Prefix, Date, Kind string }

var ProductionDocuments = map[string]ProductionDocument{
	"production-pickings": {"production_pickings", "production_picking_lines", "picking_id", "picking_no", "PP", "picking_date", "picking"},
	"production-returns":  {"production_returns", "production_return_lines", "return_id", "return_no", "PRT", "return_date", "return"},
	"production-receipts": {"production_receipts", "production_receipt_lines", "receipt_id", "receipt_no", "REC", "receipt_date", "receipt"},
}

func (s *Service) GetProductionDocument(ctx context.Context, d ProductionDocument, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, d.Table, id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public(d.Table, h)
	edges := map[string]any{}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.FK)+"=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	lines := []map[string]any{}
	for _, l := range rows {
		p, err := s.Store.Get(ctx, "products", value(l, "product_id"))
		if err != nil {
			return nil, err
		}
		item := s.Store.Public(d.Lines, l)
		item["edges"] = map[string]any{"product": s.Store.Public("products", p)}
		lines = append(lines, item)
	}
	if len(lines) > 0 {
		edges["lines"] = lines
	}
	if d.Kind != "return" {
		for relation, table := range map[string]string{"work_order": "work_orders", "warehouse": "warehouses"} {
			if value(h, relation+"_id") != "" {
				r, err := s.Store.Get(ctx, table, value(h, relation+"_id"))
				if err != nil {
					return nil, err
				}
				edges[relation] = s.Store.Public(table, r)
			}
		}
	}
	pub["edges"] = edges
	return pub, nil
}
func (s *Service) CreateProductionDocument(ctx context.Context, d ProductionDocument, input map[string]any, user string) (map[string]any, error) {
	id := ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		// 回归回放 EE3（2026-10-14）：领料/退料/入库单的**表头 location_id 与明细
		// batch_no/serial_nos 均 code:0 建单成功**；属既有实现的静默忽略。
		// 本实现按「既有实现已接受就不判未恢复」处理：这些字段一律摘出通用守卫，
		// 若表结构确有对应列（Store.Has 命中）则照常持久化。
		header := map[string]any{}
		for k, v := range input {
			header[k] = v
		}
		for _, k := range []string{"location_id", "rack_id", "batch_no", "serial_nos", "production_date", "expiry_date"} {
			delete(header, k)
		}
		if err := rejectAdvanced(header); err != nil {
			return err
		}
		// 批次 T 取证（2026-10-14，运行快照）：
		// 生产领料单 / 入库单 / 退料单**不传 work_order_id 时既有实现三个端点全部 code:0
		// 建单成功**。原本实现返回 ErrUnsupported（501）属误拒，已移除 ——
		// 「不关联工单的领退料」是常见场景（如车间临时补料），不应被拦。
		// 注意：空 work_order_id 不能直接查库（会返回 ErrNotFound → 404），
		// 必须显式跳过，让 order 为 nil 走「无工单」分支。
		var order map[string]any
		if woID := value(input, "work_order_id"); woID != "" {
			var e error
			if order, e = s.Store.GetWith(ctx, tx, "work_orders", woID); e != nil {
				return e
			}
		}
		if order != nil {
			state := value(order, "status")
			if state == "completed" || state == "cancelled" {
				return fmt.Errorf("工单状态（%s）不允许新建领料/入库/退料单", state)
			}
		}
		// 回归回放 EE1/EE2（2026-10-14）：草稿工单建领料单 code:0，直到 confirm 才报
		// 10000「工单状态（draft）不允许确认执行，仅已确认/生产中的工单可领料/入库/退料单」——
		// 既有实现把状态校验放在**确认期**而非建单期。本实现原先在建单期返回 501，
		// 既提前又无语义；此处建单放行，由 ConfirmProductionDocument 给出原文案。
		// 批次 T：不关联工单时（order 为 nil）这两项一致性校验无从比对，跳过。
		if order != nil {
			if value(input, "work_order_no") != "" && value(input, "work_order_no") != value(order, "order_no") {
				return errors.New("工单编号不一致")
			}
			if value(input, "warehouse_id") != value(order, "warehouse_id") {
				return errors.New("仓库与工单不一致")
			}
		}
		// 回归回放（2026-10-13，证据 运行快照）：
		//   M1a 不传 reason / M1b reason="多余" / M1c reason="other" / M1d reason="excess"
		//   四种取值创建均 code:0 —— 既有实现对 reason **完全无约束**，
		//   非 excess 退料正常通过（另见 audit-workorder-material-return-20261013.json 的 L2 全额退料）。
		// 原实现此处强制 reason=="excess" 否则 ErrUnsupported，属错误的拒绝，已移除。
		raw, ok := input["lines"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 1000 {
			return errors.New("单据明细不能为空且不超过1000行")
		}
		h := s.base(d.Table)
		no, err := s.nextNumber(ctx, tx, d.Prefix)
		if err != nil {
			return err
		}
		id = value(h, "id")
		// 批次 T：不传 work_order_id 时既有实现允许建单（order 为 nil），
		// 此时工单相关列留空，仓库取请求里的 warehouse_id。
		h[d.Number], h["status"], h["created_by"] = no, "draft", user
		if order != nil {
			h["work_order_id"], h["work_order_no"], h["warehouse_id"] = order["id"], order["order_no"], order["warehouse_id"]
		} else {
			h["warehouse_id"] = value(input, "warehouse_id")
		}
		if d.Kind == "return" {
			h[d.Date] = now()
		}
		for _, k := range []string{d.Date, "remark", "reason"} {
			if input[k] != nil && s.Store.Has(d.Table, k) {
				h[k] = input[k]
			}
		}
		// EE3：表头跟踪字段——表有列就按传入值落库，无列则忽略。
		for _, k := range []string{"location_id", "rack_id", "batch_no", "serial_nos", "production_date", "expiry_date"} {
			if input[k] != nil && s.Store.Has(d.Table, k) {
				h[k] = input[k]
			}
		}
		lines := []map[string]any{}
		totalQty, totalCost := decimal.Zero, decimal.Zero
		seen := map[string]bool{}
		for i, v := range raw {
			l, ok := v.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			// EE3：明细 batch_no/serial_nos 与表头同理——既有实现一律 code:0 建单成功，
			// 不论表结构是否已有对应列。这些字段一律摘出通用守卫，由下方按
			// 「表有列才落库」分流持久化，避免把既有实现已接受的输入判为未恢复。
			line := map[string]any{}
			for key, val := range l {
				line[key] = val
			}
			for _, k := range []string{"batch_no", "serial_nos", "location_id", "rack_id", "production_date", "expiry_date"} {
				delete(line, k)
			}
			if err := rejectAdvanced(line); err != nil {
				return err
			}
			p, err := s.plainProduct(ctx, tx, value(l, "product_id"), d.Kind == "receipt")
			if err != nil {
				return err
			}
			// 回归回放 EE2（2026-10-14）：领料单同一材料提交两行（qty 1 与 2）
			// 建单 code:0，与已结案的「同商品多行」结论一致——既有实现三处都放行。
			// 原实现对重复 product_id 返回 ErrUnsupported，属系统性误拒，已移除。
			seen[value(p, "id")] = true
			qty, err := Number(l["qty"])
			if err != nil {
				return err
			}
			cost, err := Number(l["unit_cost"])
			if err != nil {
				return err
			}
			// 负数量守卫：既有实现**允许**负数数量 —— 建单期与 confirm 期都 code:0 通过（批次 P 实测）。
			//   领料 qty=-1 → code:0 放行（同样虚增库存）
			//   退料 qty=-1 → 2026-10-13 实测 169：qty_returned 变为 -1、库存余额被虚增
			// 两者是**同一类既有实现缺陷**（负数调整库存），按交接文档
			// 「不伪造成功、不复制未证实的错误行为」原则，本实现保留拒绝，
			// 用 ErrKnownDefect 标识为**终态决策**（非待办），不返回自造中文文案。
			// 证据：运行快照 的 M2、
			// 运行快照。
			if !qty.IsPositive() {
				return ErrKnownDefect
			}
			if cost.IsNegative() {
				return ErrKnownDefect
			}

			row := s.base(d.Lines)
			row[d.FK], row["line_no"], row["product_id"], row["product_name"], row["product_code"], row["qty"], row["unit_cost"] = id, i+1, p["id"], p["name"], p["code"], qty.String(), cost.String()
			if s.Store.Has(d.Lines, "total_cost") {
				row["total_cost"] = qty.Mul(cost).String()
			}
			// EE3：批次/序列号等跟踪字段——表有列就按传入值落库，无列则忽略
			//（与上面「既有实现静默忽略」的取证结论一致，不因缺列而拒绝建单）。
			for _, k := range []string{"batch_no", "serial_nos", "location_id", "rack_id", "production_date", "expiry_date", "unit_id"} {
				if s.Store.Has(d.Lines, k) && l[k] != nil {
					row[k] = l[k]
				}
			}
			if l["remark"] != nil {
				row["remark"] = l["remark"]
			}
			lines = append(lines, row)
			totalQty = totalQty.Add(qty)
			totalCost = totalCost.Add(qty.Mul(cost))
		}
		if s.Store.Has(d.Table, "total_qty") {
			h["total_qty"] = totalQty.String()
		}
		if s.Store.Has(d.Table, "total_cost") {
			h["total_cost"] = totalCost.String()
		}
		if err := s.Store.InsertWith(ctx, tx, d.Table, h); err != nil {
			return err
		}
		for _, l := range lines {
			if err := s.Store.InsertWith(ctx, tx, d.Lines, l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetProductionDocument(ctx, d, id)
}
func (s *Service) ConfirmProductionDocument(ctx context.Context, d ProductionDocument, id string) (map[string]any, error) {
	if d.Kind == "receipt" {
		return s.confirmProductionReceipt(ctx, d, id)
	}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		if value(h, "status") != "draft" {
			return errors.New("只有草稿状态的单据才能确认")
		}
		// 批次 T：不传 work_order_id 的单据（order 为 nil）同样可确认 ——
		// 既有实现允许无工单关联的领料/入库/退料，确认期同样不拦。
		var order map[string]any
		if woID := value(h, "work_order_id"); woID != "" {
			if order, err = s.Store.GetWith(ctx, tx, "work_orders", woID); err != nil {
				return err
			}
		}
		// 批次 T 取证（2026-10-14，运行快照）：
		// **无工单**的单据 confirm 分两种情况（逐端点实测）：
		//   入库单（receipt）→ code:0 直接确认通过，不看设置
		//   领料单（picking）→ 读生产设置 production_settings.allow_no_workorder_pick：
		//       关闭时 10000「未关联工单的领料未开启，请在【生产设置】中开启“允许直接领料（不关联工单）”」
		//       开启后 code:0，状态 confirmed（已实测开关生效）
		// 即设置开关**只管确认期**，建单期一律放行（见 CreateProductionDocument）。
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.FK)+"=? AND deleted_at IS NULL ORDER BY line_no", id)
		if err != nil {
			return err
		}
		// 批次 T：无工单单据的确认分流（详见本分支下方注释）。
		if order == nil {
			return s.confirmUnlinkedProductionDocument(ctx, tx, d, h, lines)
		}
		if value(order, "status") != "in_progress" {
			// 回归回放 EE2（2026-10-14，audit-batch-e-20261014.json）：
			// 草稿工单的领料单 confirm 返回 10000，原文逐字为
			// 「工单状态（draft）不允许确认执行，仅已确认/生产中的工单可领料/入库/退料」
			// ——注意结尾无「单」字，已按证据逐字对齐。本实现原先返回 501。
			return fmt.Errorf("工单状态（%s）不允许确认执行，仅已确认/生产中的工单可领料/入库/退料", value(order, "status"))
		}
		delta := decimal.Zero
		for _, l := range lines {
			if err := rejectAdvanced(l); err != nil {
				return err
			}
			if _, err := s.plainProduct(ctx, tx, value(l, "product_id"), d.Kind == "receipt"); err != nil {
				return err
			}
			materials, err := database.QueryRows(ctx, tx, "SELECT * FROM work_order_materials WHERE work_order_id=? AND product_id=? AND deleted_at IS NULL", order["id"], l["product_id"])
			if err != nil {
				return err
			}
			// 批次 DD 取证（2026-10-14，运行快照）：
			// 既有实现**允许**领退料单包含「不在工单 BOM 里的物料」—— 构造：工单 BOM 只含 M，
			// 领料单领 P（P 不在 BOM 中），既有实现 **code:0 建单 + code:0 确认通过**，
			// 且**正常扣库存**（领 2 件 → 库存 100 → 98，差额 -2）、**正常写台账**（type=out, qty=2），
			// 只是**不回写工单材料行**（P 无对应 material 行，工单材料行 qty_issued 保持 0）。
			// 即既有实现语义是「库存与台账照常处理，材料联动无对应行则跳过」。
			// 原本实现 return ErrUnsupported（501）属误拒 —— 它会拦掉
			// 「临时补料领了 BOM 之外的料」这类常见现场操作，已改为按既有实现语义跳过材料联动。
			var material map[string]any
			if len(materials) == 1 {
				material = materials[0]
			}
			qty := readDecimal(l, "qty")
			issued, returned, required := decimal.Zero, decimal.Zero, decimal.Zero
			if material != nil {
				issued, returned, required = readDecimal(material, "qty_issued"), readDecimal(material, "qty_returned"), readDecimal(material, "qty_required")
			}
			b, err := s.balance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), d.Kind == "return")
			if err != nil {
				return err
			}
			available, avg := readDecimal(b, "qty_available"), readDecimal(b, "avg_cost")
			cost := readDecimal(l, "unit_cost")
			if cost.IsNegative() {
				return errors.New("成本不能为负")
			}
			direction, kind, source, remark, date := -1, "out", "production_picking", "生产领料", "last_out_at"
			if d.Kind == "picking" {
				// material == nil（该物料不在工单 BOM 里）时跳过「超需求」校验，与与既有行为一致。
				if material != nil {
					remaining := required.Sub(issued).Add(returned)
					if qty.GreaterThan(remaining) {
						return fmt.Errorf("物料 %s 领料超需求：已领 %s，剩余可领 %s，本次 %s", value(material, "product_name"), issued.StringFixed(2), remaining.StringFixed(2), qty.StringFixed(2))
					}
				}
				if available.LessThan(qty) {
					return errors.New("库存不足")
				}
				available = available.Sub(qty)
				issued = issued.Add(qty)
				delta = delta.Add(qty.Mul(cost))
				if err := s.Store.UpdateWith(ctx, tx, d.Lines, value(l, "id"), map[string]any{"picked_qty": qty.String(), "unit_cost": cost.String(), "updated_at": now()}); err != nil {
					return err
				}
			} else {
				// 回归回放 L3：超额退料返回 code:10000
				// 「退料数量超过该物料已领数量（已领 4、已退 4）」，
				// 按既有实现实际业务错误对齐文案（校验逻辑等价）。
				if material != nil && qty.GreaterThan(issued.Sub(returned)) {
					return fmt.Errorf("退料数量超过该物料已领数量（已领 %s、已退 %s）", issued.String(), returned.String())
				}
				newQty := available.Add(qty)
				avg = available.Mul(avg).Add(qty.Mul(cost)).DivRound(newQty, 6)
				available = newQty
				returned = returned.Add(qty)
				delta = delta.Sub(qty.Mul(cost))
				direction, kind, source, remark, date = 1, "in", "production_return", "生产退料", "last_in_at"
			}
			if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": available.String(), "avg_cost": avg.String(), date: now(), "updated_at": now()}); err != nil {
				return err
			}
			if material != nil {
				if err := s.Store.UpdateWith(ctx, tx, "work_order_materials", value(material, "id"), map[string]any{"qty_issued": issued.String(), "qty_returned": returned.String(), "updated_at": now()}); err != nil {
					return err
				}
			}
			m := s.base("stock_movements")
			for k, v := range map[string]any{"type": kind, "source_type": source, "source_id": id, "source_no": h[d.Number], "product_id": l["product_id"], "warehouse_id": h["warehouse_id"], "qty": qty.String(), "direction": direction, "unit_cost": cost.String(), "total_cost": qty.Mul(cost).String(), "balance_after": available.String(), "remark": remark} {
				m[k] = v
			}
			if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
				return err
			}
		}
		materialCost := readDecimal(order, "material_cost").Add(delta)
		if materialCost.IsNegative() {
			return errors.New("退料成本超过工单材料成本")
		}
		if err := s.Store.UpdateWith(ctx, tx, "work_orders", value(order, "id"), map[string]any{"material_cost": materialCost.String(), "total_cost": materialCost.Add(readDecimal(order, "labor_cost")).Add(readDecimal(order, "overhead_cost")).String(), "updated_at": now()}); err != nil {
			return err
		}
		changes := map[string]any{"status": "confirmed", "updated_at": now()}
		if d.Kind == "return" {
			changes[d.Date] = now()
		} else {
			changes["confirmed_at"] = now()
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, changes)
	})
	if err != nil {
		return nil, err
	}
	return s.GetProductionDocument(ctx, d, id)
}

// productionSettingsInTx 在事务内读生产设置（避免确认期另开事务）。
func (s *Service) productionSettingsInTx(ctx context.Context, tx *sql.Tx) (map[string]any, error) {
	settings := cloneSettings()
	rows, err := database.QueryRows(ctx, tx, "SELECT value FROM system_settings WHERE key=?", "production_settings")
	if err != nil {
		return settings, err
	}
	if len(rows) == 0 {
		return settings, nil
	}
	var saved map[string]any
	if err := json.Unmarshal([]byte(value(rows[0], "value")), &saved); err != nil {
		return nil, err
	}
	for key, v := range saved {
		if _, ok := settings[key]; ok {
			settings[key] = v
		}
	}
	return settings, nil
}

// confirmUnlinkedProductionDocument 确认**不关联工单**的生产单据。
//
// 批次 T 取证（2026-10-14，运行快照）：
// 既有实现允许建不关联工单的领料/入库/退料单，三个端点建单期一律 code:0。
// 确认期按类型分流（逐端点实测）：
//
//	入库单（receipt）→ code:0 直接确认通过，**不看设置**
//	领料单（picking）→ 读 production_settings.allow_no_workorder_pick：
//	    关闭 → 10000「未关联工单的领料未开启，请在【生产设置】中开启“允许直接领料（不关联工单）”」
//	    开启 → code:0，状态 confirmed（开关生效已实测）
//
// 无工单时不做工单材料联动（无 material 行可回写），只做库存变动 + 台账 + 状态更新。
func (s *Service) confirmUnlinkedProductionDocument(ctx context.Context, tx *sql.Tx, d ProductionDocument, h map[string]any, lines []map[string]any) error {
	if d.Kind == "picking" {
		settings, err := s.productionSettingsInTx(ctx, tx)
		if err != nil {
			return err
		}
		if allowed, _ := settings["allow_no_workorder_pick"].(bool); !allowed {
			return errors.New("未关联工单的领料未开启，请在【生产设置】中开启“允许直接领料（不关联工单）”")
		}
	}
	for _, l := range lines {
		if err := rejectAdvanced(l); err != nil {
			return err
		}
		if _, err := s.plainProduct(ctx, tx, value(l, "product_id"), d.Kind == "receipt"); err != nil {
			return err
		}
		qty := readDecimal(l, "qty")
		cost := readDecimal(l, "unit_cost")
		if cost.IsNegative() {
			return errors.New("成本不能为负")
		}
		b, err := s.balance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), d.Kind == "return")
		if err != nil {
			return err
		}
		available, avg := readDecimal(b, "qty_available"), readDecimal(b, "avg_cost")
		direction, kind, source, remark, date := -1, "out", "production_picking", "生产领料", "last_out_at"
		if d.Kind == "picking" {
			if available.LessThan(qty) {
				return errors.New("库存不足")
			}
			available = available.Sub(qty)
			if err := s.Store.UpdateWith(ctx, tx, d.Lines, value(l, "id"), map[string]any{"picked_qty": qty.String(), "unit_cost": cost.String(), "updated_at": now()}); err != nil {
				return err
			}
		} else {
			newQty := available.Add(qty)
			avg = available.Mul(avg).Add(qty.Mul(cost)).DivRound(newQty, 6)
			available = newQty
			direction, kind, source, remark, date = 1, "in", "production_return", "生产退料", "last_in_at"
		}
		if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": available.String(), "avg_cost": avg.String(), date: now(), "updated_at": now()}); err != nil {
			return err
		}
		m := s.base("stock_movements")
		for k, v := range map[string]any{"type": kind, "source_type": source, "source_id": value(h, "id"), "source_no": h[d.Number], "product_id": l["product_id"], "warehouse_id": h["warehouse_id"], "qty": qty.String(), "direction": direction, "unit_cost": cost.String(), "total_cost": qty.Mul(cost).String(), "balance_after": available.String(), "remark": remark} {
			m[k] = v
		}
		if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
			return err
		}
	}
	changes := map[string]any{"status": "confirmed", "updated_at": now()}
	if d.Kind == "return" {
		changes[d.Date] = now()
	} else {
		changes["confirmed_at"] = now()
	}
	return s.Store.UpdateWith(ctx, tx, d.Table, value(h, "id"), changes)
}
