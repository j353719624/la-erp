package business

// combos.go —— 组合件（/api/v1/combo-products 端点族）
//
// 批次 EE 回放取证（2026-10-14，evidence/backend-runtime/audit-batch-ee-20261014.json）。
//
// 端点族共 7 个入口：
//   GET    /api/v1/combo-products                       列表（商品行 + item_count/unit_cost/can_assemble/stock）
//   GET    /api/v1/combo-products/{id}                  详情（product/is_combo/lines/unit_cost/total_cost）
//   PUT    /api/v1/combo-products/{id}                  标记组合件并**全量替换**配方行
//   DELETE /api/v1/combo-products/{id}                  取消组合标记（软删配方行，商品保留）
//   POST   /api/v1/combo-products/{id}/assemble         组装：配件出库 + 成品入库
//   POST   /api/v1/combo-products/{id}/disassemble      拆解：成品出库 + 配件入库
//   GET    /api/v1/combo-products/{id}/available        可组装数量与成品库存
//
// 成本口径（回放实测，逐条对账过库存余额与 stock_movements）：
//   ref_cost     = 配件在**默认仓库**的库存均价；均价为 0 或无库存行时回落到 purchase_price
//   assemble     unit_cost = Σ(行 qty × ref_cost)，成品按此单价入库
//   disassemble  unit_cost = 成品在该仓的**库存均价**，配件按各自 ref_cost 入库
//
// 文案全部逐字取自原版回放（见证据文件“边界与文案”），本文件不自造中文业务文案。

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

const (
	comboAssembleNumberPrefix    = "COMBOZ"
	comboDisassembleNumberPrefix = "COMBOC"
	comboAssembleSourceType      = "combo_assemble"
	comboDisassembleSourceType   = "combo_disassemble"
)

// comboFlag 把 SQLite 的布尔列（int64(1) / true）归一为 bool。
func comboFlag(v any) bool { return v == int64(1) || v == true }

type comboLineView struct {
	row map[string]any
	qty decimal.Decimal
	ref decimal.Decimal
}

// comboLines 取某成品的配方行，并顺带算出每行的 ref_cost。
func (s *Service) comboLines(ctx context.Context, db database.Executor, productID string) ([]comboLineView, error) {
	rows, err := database.QueryRows(ctx, db, "SELECT * FROM product_combo_items WHERE product_id=? AND deleted_at IS NULL ORDER BY line_no, created_at", productID)
	if err != nil {
		return nil, err
	}
	views := make([]comboLineView, 0, len(rows))
	for _, row := range rows {
		view := comboLineView{row: row, qty: readDecimal(row, "qty")}
		// 配件被删除时原版仍保留快照行（无证据支持报错），此处只让 ref_cost 归 0。
		if component, err := s.Store.GetWith(ctx, db, "products", value(row, "component_id")); err == nil {
			view.ref = s.comboRefCost(ctx, db, component)
		}
		views = append(views, view)
	}
	return views, nil
}

// comboUnitCost = Σ(行 qty × ref_cost)，即组装单价。
func comboUnitCost(views []comboLineView) decimal.Decimal {
	unit := decimal.Zero
	for _, v := range views {
		unit = unit.Add(v.qty.Mul(v.ref))
	}
	return unit
}

func comboLinePublic(v comboLineView) map[string]any {
	line := map[string]any{
		"id":             value(v.row, "id"),
		"product_id":     value(v.row, "product_id"),
		"component_id":   value(v.row, "component_id"),
		"component_code": value(v.row, "component_code"),
		"component_name": value(v.row, "component_name"),
		"spec":           value(v.row, "spec"),
		"unit_name":      value(v.row, "unit_name"),
		"qty":            v.qty.String(),
		"ref_cost":       v.ref.String(),
		"remark":         value(v.row, "remark"),
	}
	// 原版无单位时该键为 JSON null，而非空串。
	if unitID := value(v.row, "unit_id"); unitID == "" {
		line["unit_id"] = nil
	} else {
		line["unit_id"] = unitID
	}
	return line
}

// comboDefaultWarehouse 默认仓库 id（原版 ref_cost / 列表库存口径均锚定默认仓）。
func (s *Service) comboDefaultWarehouse(ctx context.Context, db database.Executor) string {
	rows, err := database.QueryRows(ctx, db, "SELECT id FROM warehouses WHERE deleted_at IS NULL AND is_default=1")
	if err != nil || len(rows) == 0 {
		return ""
	}
	return value(rows[0], "id")
}

// comboRefCost 配件参考成本：默认仓库存均价（>0 才用），否则回落采购价。
//
// 回放证据：C1 无库存时 purchase_price=20 → ref_cost=20；库存均价 1.818182 → ref_cost=1.818182；
// C3 默认仓均价 100 / 分仓 7 → 取 100（默认仓优先），默认仓均价 50.5 / 分仓 153.5 → 取 50.5。
func (s *Service) comboRefCost(ctx context.Context, db database.Executor, component map[string]any) decimal.Decimal {
	if wh := s.comboDefaultWarehouse(ctx, db); wh != "" {
		rows, err := database.QueryRows(ctx, db, "SELECT avg_cost FROM inventory_balances WHERE product_id=? AND warehouse_id=? AND (batch_no IS NULL OR batch_no='')", value(component, "id"), wh)
		if err == nil && len(rows) > 0 {
			if avg := readDecimal(rows[0], "avg_cost"); avg.IsPositive() {
				return avg
			}
		}
	}
	return readDecimal(component, "purchase_price")
}

// comboAvailable 某仓下成品库存与可组装套数（可组装 = min⌊配件可用量 / 行 qty⌋）。
func (s *Service) comboAvailable(ctx context.Context, db database.Executor, productID, warehouse string) (decimal.Decimal, decimal.Decimal, error) {
	stock := decimal.Zero
	if rows, err := database.QueryRows(ctx, db, "SELECT qty_available FROM inventory_balances WHERE product_id=? AND warehouse_id=? AND (batch_no IS NULL OR batch_no='')", productID, warehouse); err == nil && len(rows) > 0 {
		stock = readDecimal(rows[0], "qty_available")
	}
	views, err := s.comboLines(ctx, db, productID)
	if err != nil {
		return decimal.Zero, decimal.Zero, err
	}
	can := decimal.Zero
	for i, v := range views {
		if !v.qty.IsPositive() {
			continue
		}
		available := decimal.Zero
		if rows, err := database.QueryRows(ctx, db, "SELECT qty_available FROM inventory_balances WHERE product_id=? AND warehouse_id=? AND (batch_no IS NULL OR batch_no='')", value(v.row, "component_id"), warehouse); err == nil && len(rows) > 0 {
			available = readDecimal(rows[0], "qty_available")
		}
		sets := available.Div(v.qty).Floor()
		if sets.IsNegative() {
			sets = decimal.Zero
		}
		if i == 0 || sets.LessThan(can) {
			can = sets
		}
	}
	return stock, can, nil
}

// ListCombos 组合件列表。
//
// 回放证据：不带 warehouse_id 时 stock / can_assemble 恒为 "0"；带 warehouse_id 才计算。
func (s *Service) ListCombos(ctx context.Context, q url.Values) (map[string]any, error) {
	clauses := []string{"deleted_at IS NULL", "is_combo=1"}
	args := []any{}
	if name := q.Get("name"); name != "" {
		clauses = append(clauses, "name LIKE ?")
		args = append(args, "%"+name+"%")
	}
	where := " WHERE " + strings.Join(clauses, " AND ")
	var total int
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT count(*) FROM products"+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(q.Get("page_size"))
	if size < 1 {
		size = 10
	}
	if size > 1000 {
		size = 1000
	}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM products"+where+" ORDER BY created_at DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, err
	}
	warehouse := q.Get("warehouse_id")
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		item := s.Store.Public("products", row)
		item["edges"] = map[string]any{}
		views, err := s.comboLines(ctx, s.Store.DB, value(row, "id"))
		if err != nil {
			return nil, err
		}
		item["item_count"] = len(views)
		item["unit_cost"] = comboUnitCost(views).String()
		stock, can := decimal.Zero, decimal.Zero
		if warehouse != "" {
			if stock, can, err = s.comboAvailable(ctx, s.Store.DB, value(row, "id"), warehouse); err != nil {
				return nil, err
			}
		}
		item["can_assemble"], item["stock"] = can.String(), stock.String()
		items = append(items, item)
	}
	return map[string]any{"list": items, "total": total}, nil
}

// GetCombo 组合件详情。
//
// 回放证据：非组合商品返回 is_combo=false / lines=null / unit_cost=0（**数字** 0，非字符串）；
// 有配方行时 unit_cost 与 total_cost 均为 decimal 字符串，且 total_cost 与 unit_cost 等值。
// 详情响应恒**不含** stock（即使带 warehouse_id）。
func (s *Service) GetCombo(ctx context.Context, id string) (map[string]any, error) {
	product, err := s.Store.Get(ctx, "products", id)
	if err != nil {
		return nil, errors.New("商品不存在")
	}
	views, err := s.comboLines(ctx, s.Store.DB, id)
	if err != nil {
		return nil, err
	}
	data := map[string]any{"product": s.Store.Public("products", product), "is_combo": comboFlag(product["is_combo"])}
	if len(views) == 0 {
		data["lines"] = nil
		data["unit_cost"] = 0
		data["total_cost"] = 0
		return data, nil
	}
	lines := make([]map[string]any, 0, len(views))
	for _, v := range views {
		lines = append(lines, comboLinePublic(v))
	}
	unit := comboUnitCost(views)
	data["lines"] = lines
	data["unit_cost"] = unit.String()
	data["total_cost"] = unit.String()
	return data, nil
}

// comboQty 解析数量：nil / 缺失按 0 处理（原版一律落到「必须大于 0」类文案），
// 非数字串按原版返回 400 解码错误。
func comboQty(raw any) (decimal.Decimal, error) {
	if raw == nil {
		return decimal.Zero, nil
	}
	// 原版此处走 decimal 解码，错误信息与 bank.go / currencies.go 的
	// 「请求参数错误: error decoding string '…': …」同源（回放：qty="abc" → 400）。
	// 不用 business.Number，后者返回的是单据文案「数值格式错误…」。
	qty, err := decimal.NewFromString(fmt.Sprint(raw))
	if err != nil {
		return decimal.Zero, ErrKnownNoMessage{Status: 400, Note: fmt.Sprintf("请求参数错误: error decoding string '%v': %v", raw, err)}
	}
	return qty, nil
}

// SaveCombo 标记组合件并全量替换配方行。
//
// 校验顺序（回放）：成品存在 → lines 是数组且非空 → component_id 为合法 UUID →
// 配件存在 → 配件不能是自身 → qty > 0 → 同配件不重复。
func (s *Service) SaveCombo(ctx context.Context, id string, input map[string]any) error {
	raw, ok := input["lines"].([]any)
	if !ok {
		// 回放：lines 传对象/非数组 → 400「系统内部错误，请稍后重试或联系管理员」；
		// 但**完全不传** lines 时原版走业务文案「组合配方至少需要一行配件」（与空数组同）。
		if input["lines"] != nil {
			return ErrKnownNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}
		}
	}
	if len(raw) == 0 {
		return errors.New("组合配方至少需要一行配件")
	}
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, "products", id); err != nil {
			return errors.New("成品商品不存在")
		}
		lines := make([]map[string]any, 0, len(raw))
		seen := map[string]bool{}
		for i, item := range raw {
			line, ok := item.(map[string]any)
			if !ok {
				return ErrKnownNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}
			}
			componentID := strings.TrimSpace(value(line, "component_id"))
			if _, err := uuid.Parse(componentID); err != nil {
				// 回放：component_id="" → 400「请求参数错误: invalid UUID length: 0」
				return ErrKnownNoMessage{Status: 400, Note: "请求参数错误: " + err.Error()}
			}
			component, err := s.Store.GetWith(ctx, tx, "products", componentID)
			if err != nil {
				return errors.New("配件商品不存在")
			}
			if componentID == id {
				return errors.New("配件不能是成品自身")
			}
			qty, err := comboQty(line["qty"])
			if err != nil {
				return err
			}
			if !qty.IsPositive() {
				return errors.New("配件数量必须大于 0")
			}
			if seen[componentID] {
				return errors.New("同一配件不能重复添加")
			}
			seen[componentID] = true
			row := s.base("product_combo_items")
			row["product_id"] = id
			row["component_id"] = componentID
			row["component_code"] = value(component, "code")
			row["component_name"] = value(component, "name")
			row["spec"] = value(component, "spec")
			row["unit_id"] = value(component, "unit_id")
			row["qty"] = qty.String()
			row["line_no"] = int64(i + 1)
			row["remark"] = value(line, "remark")
			if unitID := value(component, "unit_id"); unitID != "" {
				if units, err := database.QueryRows(ctx, tx, "SELECT name FROM units WHERE id=?", unitID); err == nil && len(units) > 0 {
					row["unit_name"] = value(units[0], "name")
				}
			}
			lines = append(lines, row)
		}
		if _, err := tx.ExecContext(ctx, "UPDATE product_combo_items SET deleted_at=? WHERE product_id=? AND deleted_at IS NULL", now(), id); err != nil {
			return err
		}
		for _, row := range lines {
			if err := s.Store.InsertWith(ctx, tx, "product_combo_items", row); err != nil {
				return err
			}
		}
		// is_combo 只由本端点族写入；通用 products 通道按原版语义静默忽略该字段
		// （见 internal/api/server.go originalIgnoredFields）。
		return s.Store.UpdateWith(ctx, tx, "products", id, map[string]any{"is_combo": true, "updated_at": now()})
	})
}

// DeleteCombo 取消组合标记（幂等：从未是组合件的商品同样返回成功）。
func (s *Service) DeleteCombo(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, "products", id); err != nil {
			return errors.New("商品不存在")
		}
		if _, err := tx.ExecContext(ctx, "UPDATE product_combo_items SET deleted_at=? WHERE product_id=? AND deleted_at IS NULL", now(), id); err != nil {
			return err
		}
		return s.Store.UpdateWith(ctx, tx, "products", id, map[string]any{"is_combo": false, "updated_at": now()})
	})
}

// ComboAvailable 可组装数量与成品库存。
//
// 回放：商品不存在 / 仓库不存在均**静默**返回 0（不报错），故此处不抛错。
func (s *Service) ComboAvailable(ctx context.Context, id, warehouse string) (map[string]any, error) {
	stock, can := decimal.Zero, decimal.Zero
	if product, err := s.Store.Get(ctx, "products", id); err == nil && comboFlag(product["is_combo"]) {
		var err error
		if stock, can, err = s.comboAvailable(ctx, s.Store.DB, id, warehouse); err != nil {
			return nil, err
		}
	}
	return map[string]any{"can_assemble": can.String(), "stock": stock.String()}, nil
}

// comboMovement 写一条组合件库存流水（字段口径取自回放的 stock_movements 记录）。
func (s *Service) comboMovement(ctx context.Context, tx *sql.Tx, kind, sourceType, sourceID, sourceNo, productID, warehouse string, qty, unitCost decimal.Decimal, direction int64, balanceAfter decimal.Decimal, remark, user string) error {
	m := s.base("stock_movements")
	m["type"], m["source_type"], m["source_id"], m["source_no"], m["product_id"], m["warehouse_id"] = kind, sourceType, sourceID, sourceNo, productID, warehouse
	m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = qty.String(), direction, unitCost.String(), qty.Mul(unitCost).String(), balanceAfter.String(), user
	m["remark"] = remark
	return s.Store.InsertWith(ctx, tx, "stock_movements", m)
}

// ComboAction 组装 / 拆解。
//
// 组装：配件按「行 qty × 组装数」出库（流水 unit_cost 记 ref_cost，余额均价不变），
//
//	成品按 unit_cost=Σ(行 qty × ref_cost) 入库；
//
// 拆解：成品按库存均价出库，配件按各自 ref_cost 入库。
func (s *Service) ComboAction(ctx context.Context, id, action string, input map[string]any, user string) (map[string]any, error) {
	assembling := action == "assemble"
	prefix := comboDisassembleNumberPrefix
	if assembling {
		prefix = comboAssembleNumberPrefix
	}
	data := map[string]any{}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		product, err := s.Store.GetWith(ctx, tx, "products", id)
		if err != nil {
			return errors.New("商品不存在")
		}
		warehouse := value(input, "warehouse_id")
		if _, err := s.Store.GetWith(ctx, tx, "warehouses", warehouse); err != nil {
			return errors.New("仓库不存在")
		}
		qty, err := comboQty(input["qty"])
		if err != nil {
			return err
		}
		if !qty.IsPositive() {
			if assembling {
				return errors.New("组装数量必须大于 0")
			}
			return errors.New("拆解数量必须大于 0")
		}
		views, err := s.comboLines(ctx, tx, id)
		if err != nil {
			return err
		}
		if !comboFlag(product["is_combo"]) || len(views) == 0 {
			if assembling {
				return errors.New("该商品未配置组合配方，无法组装")
			}
			return errors.New("该商品未配置组合配方，无法拆解")
		}
		name := value(product, "name")
		number, err := s.nextNumber(ctx, tx, prefix)
		if err != nil {
			return err
		}
		unit := comboUnitCost(views)
		if assembling {
			// 配件出库（流水记 ref_cost，余额均价保持不动）
			for _, v := range views {
				need := v.qty.Mul(qty)
				b, err := s.balance(ctx, tx, value(v.row, "component_id"), warehouse, false)
				if err != nil {
					return errors.New("库存不足")
				}
				before := readDecimal(b, "qty_available")
				if before.LessThan(need) {
					return errors.New("库存不足")
				}
				after := before.Sub(need)
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": after.String(), "last_out_at": now(), "updated_at": now()}); err != nil {
					return err
				}
				if err := s.comboMovement(ctx, tx, "out", comboAssembleSourceType, id, number, value(v.row, "component_id"), warehouse, need, v.ref, -1, after, fmt.Sprintf("组装 %s 配件出库", name), user); err != nil {
					return err
				}
			}
			// 成品入库
			b, err := s.balance(ctx, tx, id, warehouse, true)
			if err != nil {
				return err
			}
			before, avg := readDecimal(b, "qty_available"), readDecimal(b, "avg_cost")
			after := before.Add(qty)
			if after.IsPositive() {
				avg = before.Mul(avg).Add(qty.Mul(unit)).DivRound(after, 6)
			}
			if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": after.String(), "avg_cost": avg.String(), "last_in_at": now(), "updated_at": now()}); err != nil {
				return err
			}
			if err := s.comboMovement(ctx, tx, "in", comboAssembleSourceType, id, number, id, warehouse, qty, unit, 1, after, fmt.Sprintf("组装成品 %s", name), user); err != nil {
				return err
			}
		} else {
			// 成品出库：单价取该仓库存均价
			b, err := s.balance(ctx, tx, id, warehouse, false)
			if err != nil {
				return errors.New("库存不足")
			}
			before := readDecimal(b, "qty_available")
			if before.LessThan(qty) {
				return errors.New("库存不足")
			}
			unit = readDecimal(b, "avg_cost")
			after := before.Sub(qty)
			if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": after.String(), "last_out_at": now(), "updated_at": now()}); err != nil {
				return err
			}
			if err := s.comboMovement(ctx, tx, "out", comboDisassembleSourceType, id, number, id, warehouse, qty, unit, -1, after, fmt.Sprintf("拆解成品 %s", name), user); err != nil {
				return err
			}
			// 配件入库：单价取 ref_cost
			for _, v := range views {
				need := v.qty.Mul(qty)
				cb, err := s.balance(ctx, tx, value(v.row, "component_id"), warehouse, true)
				if err != nil {
					return err
				}
				cbefore, cavg := readDecimal(cb, "qty_available"), readDecimal(cb, "avg_cost")
				cafter := cbefore.Add(need)
				if cafter.IsPositive() {
					cavg = cbefore.Mul(cavg).Add(need.Mul(v.ref)).DivRound(cafter, 6)
				}
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(cb, "id"), map[string]any{"qty_available": cafter.String(), "avg_cost": cavg.String(), "last_in_at": now(), "updated_at": now()}); err != nil {
					return err
				}
				if err := s.comboMovement(ctx, tx, "in", comboDisassembleSourceType, id, number, value(v.row, "component_id"), warehouse, need, v.ref, 1, cafter, fmt.Sprintf("拆解 %s 配件入库", name), user); err != nil {
					return err
				}
			}
		}
		data["source_no"] = number
		data["qty"] = qty.String()
		data["unit_cost"] = unit.String()
		data["total_cost"] = qty.Mul(unit).String()
		return nil
	})
	if err != nil {
		return nil, err
	}
	return data, nil
}
