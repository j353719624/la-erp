package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"la-erp/backend/internal/database"
	"time"

	"github.com/shopspring/decimal"
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

// transferDecimal 解析调拨明细里的数值字段（qty / cost_price）。
//
// 回归回放 NN（2026-10-15，运行快照）：
// 非数字串 → 400「请求参数错误: error decoding string 'abc': can't convert abc to decimal」，
// 与 combos.go 的 comboQty 同源。不能用 business.Number —— 后者返回的是单据文案
// 「数值格式错误，最多20位整数和12位小数」，与本端点实测形态不符。
//
// 既有实现**允许** cost_price 为负（回放：cost_price=-1 → code:0 建单成功），也允许
// 缺失（按 0 处理），故此处只做解码、不做符号判断。
func transferDecimal(raw any) (decimal.Decimal, error) {
	if raw == nil {
		return decimal.Zero, nil
	}
	d, err := decimal.NewFromString(fmt.Sprint(raw))
	if err != nil {
		return decimal.Zero, ErrKnownNoMessage{Status: 400, Note: fmt.Sprintf("请求参数错误: error decoding string '%v': %v", raw, err)}
	}
	return d, nil
}

// transferLinesShapeFailure 是明细形状非法时既定的降级形态。
//
// 回放：lines 传非数组（对象）或数组元素非对象 → **HTTP 400**，但文案是通用
// 「系统内部错误，请稍后重试或联系管理员」（既有实现 JSON 绑定失败后套了通用文案）。
// 注意与「完全不传 lines」区分：后者走业务校验（POST「调拨明细不能为空」、
// PUT 清空明细），不是本形态。
var transferLinesShapeFailure = ErrKnownNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}

// transferRefFailure 是仓库引用不存在时既定的降级形态。
//
// 回放：from_warehouse_id / to_warehouse_id 为不存在的 uuid → 500 通用文案。
// 既有实现由外键约束兜底（写库时 FK 失败落成 500）；本实现 SQLite 未开启外键约束，
// 若不显式检查会**建出指向不存在仓库的单据**，比既有实现更糟，故显式降级对齐。
//
// 这是**降级行为**对齐，不是语义对齐 —— 500 不作为语义证据，此处对齐的是
// 「引用缺失 → 通用 500」这一既有实现既有表现。
var transferRefFailure = ErrKnownNoMessage{Status: 500, Note: "系统内部错误，请稍后重试或联系管理员"}

func (s *Service) WriteTransfer(ctx context.Context, id string, input map[string]any, user string) (map[string]any, error) {
	creating := id == ""
	// ── 阶段一：纯入参校验（不读库、不开事务）──
	// 校验顺序（回放 NN，2026-10-15，运行快照
	// audit-batch-nn-transfers-20261015.json 与 -transfers2-）：
	//   1. 必填 from/to           → 400（在 handler 层，见 transferRequired）
	//   2. 调出仓 == 调入仓        → 10000「调出仓与调入仓不能相同」
	//   3. 明细为空（仅 POST）     → 10000「调拨明细不能为空」
	//   4. 任一 qty <= 0          → 10000「调拨数量必须大于0」（**全量先于商品检查**）
	//   5. 仓库引用不存在          → 500 通用（既有实现外键兜底）
	//   6. 商品不存在              → 10000「所选商品不存在或已被删除」
	// 第 2 步**早于**单据存在性检查（回放：PUT 不存在的 id 且两仓相同 →
	// 「调出仓与调入仓不能相同」，而非「调拨单不存在或状态不允许修改」）。
	//
	// 回归回放 UT2（2026-10-13）：提交 from_location_id/to_location_id 时既有实现返回
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
		// 批次 W 取证（2026-10-14，运行快照）：
		//   有效库位（跨仓调拨）→ code:0，from_location_id **确实落库**并回读一致
		//   不存在的库位（全零 UUID）→ **code:0 照常建单**，既有实现不校验库位引用完整性
		// 即既有实现对库位 id 只做落库、不做存在性校验。原本实现无引用检查（一致），
		// 但此处原有一处 Store.Has 断言 —— schema 中两列本就存在，该断言永不可达，
		// 保留亦无害，故仅补注取证结论。
		if !s.Store.Has("stock_transfers", k) {
			// schema.sql 中 stock_transfers 确有 from/to_location_id 两列（uuid NULL），
			// 此处永不可达；保留作防御性断言，不自造文案。
			return nil, ErrUnsupported
		}
		locations[k] = input[k]
		delete(header, k)
	}
	if err := rejectAdvanced(header); err != nil {
		return nil, err
	}
	from, to := value(input, "from_warehouse_id"), value(input, "to_warehouse_id")
	if from == to {
		return nil, errors.New("调出仓与调入仓不能相同")
	}
	// 明细形状：传了 lines 但形状非法 → 400 通用；**完全不传** lines 时走业务分支
	//（POST「调拨明细不能为空」、PUT 清空明细），故此处只在 input["lines"] != nil 时判。
	rawLines, linesIsSlice := input["lines"].([]any)
	if input["lines"] != nil && !linesIsSlice {
		return nil, transferLinesShapeFailure
	}
	lines := make([]map[string]any, 0, len(rawLines))
	for _, v := range rawLines {
		in, ok := v.(map[string]any)
		if !ok {
			return nil, transferLinesShapeFailure
		}
		lines = append(lines, in)
	}
	// POST 要求明细非空；PUT 允许空 —— 回放：PUT lines:[] → code:0 且明细被清空，
	// PUT 不带 lines 同样 code:0（回读 edges.lines 为 0 行）。
	// 另：既有实现**没有**行数上限（回放：1001 行 → code:0 建单成功），
	// 原本实现的「且不超过1000行」是自造文案，已移除。
	if creating && len(lines) == 0 {
		return nil, errors.New("调拨明细不能为空")
	}
	// 数量与成本全量先算：回放「第一行商品不存在 + 第二行 qty=0」→ 报数量错，
	// 说明既有实现是**先扫完全部行的数量**再校验商品，不是逐行串行校验。
	qtys := make([]decimal.Decimal, len(lines))
	costs := make([]decimal.Decimal, len(lines))
	for i, in := range lines {
		if err := rejectAdvanced(in); err != nil {
			return nil, err
		}
		qty, err := transferDecimal(in["qty"])
		if err != nil {
			return nil, err
		}
		if !qty.IsPositive() {
			return nil, errors.New("调拨数量必须大于0")
		}
		cost, err := transferDecimal(in["cost_price"])
		if err != nil {
			return nil, err
		}
		qtys[i], costs[i] = qty, cost
	}

	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h := s.base("stock_transfers")
		if !creating {
			var err error
			h, err = s.Store.GetWith(ctx, tx, "stock_transfers", id)
			if err != nil {
				return errors.New("调拨单不存在或状态不允许修改")
			}
			// 既有实现「不存在」与「非草稿」共用同一文案（回放 NN，2026-10-15）：
			//   PUT 不存在的 id   → 10000「调拨单不存在或状态不允许修改」
			//   PUT cancelled 单  → 同上
			//   PUT in_transit 单 → 同上
			// 原本实现的「只有草稿状态的调拨单才能编辑」是自造文案，已替换。
			if value(h, "status") != "draft" {
				return errors.New("调拨单不存在或状态不允许修改")
			}
		}
		for _, wid := range []string{from, to} {
			if _, err := s.Store.GetWith(ctx, tx, "warehouses", wid); err != nil {
				return transferRefFailure
			}
		}
		h["from_warehouse_id"], h["to_warehouse_id"] = from, to
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
		// 既有实现允许同一商品出现多行（回放：两行同 product_id → code:0），
		// 不做去重合并；原实现里只写不读的 seen 集合一并移除。
		for i, in := range lines {
			pid := value(in, "product_id")
			// 商品引用用**单据专属文案**：回放「行缺 product_id」→
			// 10000「所选商品不存在或已被删除」，与通用 plainProduct 的
			// 「商品不存在」不同，故覆盖而不透传。
			if _, err := s.plainProduct(ctx, tx, pid); err != nil {
				return errors.New("所选商品不存在或已被删除")
			}
			l := s.base("stock_transfer_lines")
			l["transfer_id"], l["line_no"], l["product_id"], l["qty"], l["cost_price"] = id, i+1, pid, qtys[i].String(), costs[i].String()
			for _, k := range []string{"product_name", "product_code", "spec", "unit_name", "remark"} {
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
			// 回归回放 NN（2026-10-15）：DELETE 与 dispatch / complete / cancel 在 id
			// 不存在时返回 **200 + code 10000「调拨单不存在」**，不是通用 404。
			// 与 GET 详情的 404「调拨单不存在」是两套形态（后者见 reads.go）。
			return errors.New("调拨单不存在")
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
		// 既有实现 NN3 实测动作集只有 dispatch / complete / cancel；delete 为 HTTP DELETE 形态。
		// 与本实现白名单一致，本 default **不可达**，保留作兜底。
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
