package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

func (s *Service) AssemblyAction(ctx context.Context, id, action string) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "assembly_orders", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("装配单不存在")
		}
		if err != nil {
			return err
		}
		status := value(row, "status")
		changes := map[string]any{"updated_at": now()}
		switch action {
		case "confirm":
			if status != "draft" {
				return errors.New("只有草稿状态的组装单才能确认")
			}
			// 批次 PP（2026-10-15）：既有实现 confirm 不只是改状态 ——
			// 还会**校验组件库存**并产生两条库存流水（组件出 / 成品入）。
			// 本实现原先只改状态，装配业务等于残的：
			//   ① 组件超量也放行（既有实现回 200+10000「库存不足」）
			//   ② confirm 后库存与流水均无变化
			// 证据：运行快照,3,4}-20261015.txt。
			if err := s.confirmAssemblyStock(ctx, tx, row); err != nil {
				return err
			}
			changes["status"], changes["confirmed_at"] = "confirmed", now()
		case "cancel":
			// 批次 PP（2026-10-15）：既有实现 cancel **只准入 draft**，confirmed /
			// cancelled 一律拒绝，且文案与 confirm 同构（「只有草稿状态的组装单
			// 才能取消」）。本实现原先放行 confirmed —— 而已确认的装配单已经
			// 产生组件出 / 成品入两条库存流水，允许取消会让库存与单据状态脱节。
			// 证据：运行快照
			// 矩阵 ③④⑤⑦ 四条。
			if status != "draft" {
				return errors.New("只有草稿状态的组装单才能取消")
			}
			changes["status"] = "cancelled"
		// 既有实现 NN4 实测动作集只有 confirm / cancel，与本实现白名单完全一致。
		// 本 default 分支在 API 层 []string{...} 限定下**不可达**，保留作兜底。
		default:
			return ErrUnsupported
		}
		if err := s.Store.UpdateWith(ctx, tx, "assembly_orders", id, changes); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "assembly_orders", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("assembly_orders", result), nil
}

// confirmAssemblyStock 执行装配单确认的库存副作用，顺序与字段逐条对齐既有行为：
//
//  ① 逐行扣减组件库存，任一行余额变负 →「库存不足」整体回滚
//     流水：type=out, direction=-1, unit_cost=行 unit_cost,
//           total_cost=qty×unit_cost, remark="组装 {单号} 行{行号}"
//  ② 增加成品库存
//     流水：type=in, direction=1, qty=表头 qty,
//           unit_cost=组件总成本÷表头 qty, total_cost=组件总成本,
//           remark="组装成品 {单号}"
//
// 实测（audit-batch-pp-assembly4-20261015.txt）：组件 qty=1 / unit_cost=7、
// 成品 qty=2 → 出库 unit_cost=7 total_cost=7，入库 unit_cost=3.5 total_cost=7。
func (s *Service) confirmAssemblyStock(ctx context.Context, tx *sql.Tx, order map[string]any) error {
	id, wid, no := value(order, "id"), value(order, "warehouse_id"), value(order, "assembly_no")
	headQty := readDecimal(order, "qty")
	// deleted_at IS NULL 是必须的：PUT 会软删旧明细行再重写（批次 PP），
	// 不排除的话已作废的组件会在 confirm 时被**再扣一次库存**。
	lines, err := database.QueryRows(ctx, tx, "SELECT * FROM assembly_order_lines WHERE assembly_id=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return err
	}
	total := decimal.Zero
	for i, line := range lines {
		qty, cost := readDecimal(line, "qty"), readDecimal(line, "unit_cost")
		total = total.Add(qty.Mul(cost))
		if err := s.assemblyMove(ctx, tx, value(line, "product_id"), wid, qty.Neg(), "out", int64(-1),
			id, no, fmt.Sprintf("组装 %s 行%d", no, i+1), cost, qty.Mul(cost)); err != nil {
			return err
		}
	}
	unitCost := decimal.Zero
	if headQty.IsPositive() {
		unitCost = total.DivRound(headQty, 6)
	}
	return s.assemblyMove(ctx, tx, value(order, "product_id"), wid, headQty, "in", int64(1),
		id, no, fmt.Sprintf("组装成品 %s", no), unitCost, total)
}

// assemblyMove 增减一行库存并写一条流水；余额变负返回「库存不足」。
func (s *Service) assemblyMove(ctx context.Context, tx *sql.Tx, productID, warehouseID string,
	delta decimal.Decimal, kind string, direction int64, sourceID, sourceNo, remark string,
	unitCost, totalCost decimal.Decimal) error {
	// 注：inventory_balances 表**没有 deleted_at 列**（见 schema.sql），不能加该条件。
	rows, err := database.QueryRows(ctx, tx,
		"SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=?", productID, warehouseID)
	if err != nil {
		return err
	}
	var balance map[string]any
	if len(rows) == 0 {
		balance = s.base("inventory_balances")
		balance["product_id"], balance["warehouse_id"] = productID, warehouseID
		if err := s.Store.InsertWith(ctx, tx, "inventory_balances", balance); err != nil {
			return err
		}
	} else {
		balance = rows[0]
	}
	available := readDecimal(balance, "qty_available").Add(delta)
	if available.IsNegative() {
		return errors.New("库存不足")
	}
	stamp := "last_out_at"
	if kind == "in" {
		stamp = "last_in_at"
	}
	update := map[string]any{"qty_available": available.String(), stamp: now(), "updated_at": now()}
	if kind == "in" {
		// 既有实现入库按加权平均刷新 avg_cost（与出库侧一致，见 checks.go 的同款处理）。
		update["avg_cost"] = unitCost.String()
	}
	if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(balance, "id"), update); err != nil {
		return err
	}
	movement := s.base("stock_movements")
	movement["type"], movement["source_type"], movement["source_id"], movement["source_no"] = kind, "assembly", sourceID, sourceNo
	movement["product_id"], movement["warehouse_id"] = productID, warehouseID
	movement["qty"], movement["direction"] = delta.Abs().String(), direction
	movement["unit_cost"], movement["total_cost"], movement["balance_after"] = unitCost.String(), totalCost.String(), available.String()
	movement["remark"] = remark
	return s.Store.InsertWith(ctx, tx, "stock_movements", movement)
}

// ── 组件明细校验（批次 PP，2026-10-15）──────────────────────────────────
//
// 既有实现 POST /assemblies 与 PUT /assemblies/{id} 的组件明细校验共 7 段，
// 且是**分段全量前置**（不是逐行短路）—— 任一行在某段失败即整单失败，
// 且前段优先于后段。这一点靠两组反例坐实，不能凭直觉写成逐行循环：
//   · ⑫ 行1 qty=0 / 行2 product_id 非法 → 报 UUID 错（不是行1 的数量错）
//   · ⑭ 行1 qty=0 / 行2 缺 product_id   → 报商品错（不是行1 的数量错）
// 逐条证据：运行快照,2,3,4,5}-20261015.txt
// 与 audit-batch-pp-put-lines{,2,3}-20261015.txt。
const (
	AssemblyLinesRequired   = "组件明细不能为空"        // A 段：lines 缺失 / nil / 空数组
	AssemblyProductMissing  = "所选商品不存在或已被删除" // E 段：行缺 product_id
	AssemblyQtyMustPositive = "组件数量必须大于0"       // G 段：任一行 qty ≤ 0
)

// AssemblyShapeFailure 是 B 段（明细形状非法）的既有实现降级形态：
// lines 传非数组、或数组元素是标量（数字/字符串）→ **HTTP 400**，但文案是通用
// 「系统内部错误，请稍后重试或联系管理员」（既有实现 JSON 绑定失败后套了通用文案）。
// 与 transfers.go 的 transferLinesShapeFailure 同款。
var AssemblyShapeFailure = ErrKnownNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}

// AssemblyGhostProductFailure 是 F 段：product_id 是**合法 UUID 但查无此商品**。
//
// 注意与 E 段区分：E（缺 product_id）走业务文案 200+10000，F（有合法 UUID 但查不到）
// 走通用 500 —— 实测确实是两套不同形态，不是同一分支的两种写法，故不能合并。
var AssemblyGhostProductFailure = ErrKnownNoMessage{Status: 500, Note: "系统内部错误，请稍后重试或联系管理员"}

// AssemblyLineSet 是校验通过后待落库的规范化明细（数值已解码，避免二次解析）。
type AssemblyLineSet struct {
	Lines []map[string]any
	Qtys  []decimal.Decimal
	Costs []decimal.Decimal
}

// ValidateAssemblyLines 按既有实现顺序全量校验组件明细，返回可安全落库的明细集。
//
// 分段顺序：B 形状 → C UUID → D 数值 → E/F 商品 → G 数量（仅 POST）。
// requireQty 区分 POST 与 PUT：**既有实现 PUT 不校验数量为正**（实测 qty=0 →
// code:0 且原样落库 qty=0），只有 POST 要求 qty > 0。
func (s *Service) ValidateAssemblyLines(ctx context.Context, raw []any, requireQty bool) (*AssemblyLineSet, error) {
	// ── B：形状。null 行按既有实现视作**空对象**继续走 E 段（[null] → 商品不存在）。──
	lines := make([]map[string]any, 0, len(raw))
	for _, v := range raw {
		switch t := v.(type) {
		case nil:
			lines = append(lines, map[string]any{})
		case map[string]any:
			lines = append(lines, t)
		default:
			return nil, AssemblyShapeFailure
		}
	}
	// ── C：product_id **键存在**时必须是合法 UUID；键缺失留给 E 段处理。──
	for _, line := range lines {
		rawID, ok := line["product_id"]
		if !ok || rawID == nil {
			continue
		}
		if _, err := uuid.Parse(fmt.Sprint(rawID)); err != nil {
			return nil, ErrKnownNoMessage{Status: 400, Note: "请求参数错误: " + err.Error()}
		}
	}
	// ── D：qty / unit_cost 必须是数值。C 先于 D（⑨ 单行两者皆非法 → 报 UUID 错）。──
	set := &AssemblyLineSet{
		Lines: lines,
		Qtys:  make([]decimal.Decimal, len(lines)),
		Costs: make([]decimal.Decimal, len(lines)),
	}
	for i, line := range lines {
		var err error
		if set.Qtys[i], err = assemblyDecimal(line["qty"]); err != nil {
			return nil, err
		}
		if set.Costs[i], err = assemblyDecimal(line["unit_cost"]); err != nil {
			return nil, err
		}
	}
	// ── E/F：商品必须存在。D 先于 E（⑯ 行1 缺 product_id / 行2 qty="abc" → 报数值错）。──
	for _, line := range lines {
		pid := value(line, "product_id")
		if pid == "" {
			return nil, errors.New(AssemblyProductMissing)
		}
		rows, err := s.Store.Rows(ctx, "SELECT id FROM products WHERE id=? AND deleted_at IS NULL", pid)
		if err != nil {
			return nil, err
		}
		if len(rows) == 0 {
			return nil, AssemblyGhostProductFailure
		}
	}
	// ── G：数量为正。E 先于 G（⑭ 行1 qty=0 / 行2 缺 product_id → 报商品错）。──
	if requireQty {
		for i := range lines {
			if !set.Qtys[i].IsPositive() {
				return nil, errors.New(AssemblyQtyMustPositive)
			}
		}
	}
	return set, nil
}

// assemblyDecimal 解码明细里的数值字段（qty / unit_cost）。
//
// 既有实现非数字串 → 400「请求参数错误: error decoding string 'abc': can't convert abc
// to decimal」，与 transfers.go 的 transferDecimal 同源。不能用 business.Number ——
// 后者返回的是单据文案「数值格式错误，最多20位整数和12位小数」，形态不符。
// unit_cost 允许为负（回放：unit_cost=-1 → code:0 建单成功），故不做符号判断。
func assemblyDecimal(raw any) (decimal.Decimal, error) {
	if raw == nil {
		return decimal.Zero, nil
	}
	d, err := decimal.NewFromString(fmt.Sprint(raw))
	if err != nil {
		return decimal.Zero, ErrKnownNoMessage{Status: 400, Note: fmt.Sprintf("请求参数错误: error decoding string '%v': %v", raw, err)}
	}
	return d, nil
}

// WriteAssemblyLines 把校验通过的明细落进 assembly_order_lines。
//
// 批次 PP（2026-10-15）：本实现此前**完全不写明细** —— 建单返回成功，
// 但 GET /assemblies/{id} 的 edges.lines 恒为空数组，装配单的组件清单永远丢失。
// 既有实现回读的明细行只含 line_no / product_id / qty / unit_cost / batch_no / remark，
// **不回写** product_name / product_code / spec / unit_id（这几列实测为 NULL），
// 故这里也不写，避免自造既有实现没有的字段。
//
// replace=true 是 PUT 语义：先软删该单旧行再重写（既有实现 PUT 不带 lines → 明细清空；
// 带 lines → 整体重写，见 audit-batch-pp-put-lines-20261015.txt）。
func (s *Service) WriteAssemblyLines(ctx context.Context, assemblyID string, set *AssemblyLineSet, replace bool) error {
	if replace {
		if _, err := s.Store.DB.ExecContext(ctx,
			"UPDATE assembly_order_lines SET deleted_at=?, updated_at=? WHERE assembly_id=? AND deleted_at IS NULL",
			now(), now(), assemblyID); err != nil {
			return err
		}
	}
	// set 为 nil 表示调用方**不带 lines**（PUT 清空语义），只软删不重写。
	if set == nil {
		return nil
	}
	for i, line := range set.Lines {
		row := s.base("assembly_order_lines")
		row["assembly_id"], row["line_no"] = assemblyID, i+1
		row["product_id"] = value(line, "product_id")
		row["qty"], row["unit_cost"] = set.Qtys[i].String(), set.Costs[i].String()
		for _, key := range []string{"batch_no", "remark"} {
			if line[key] != nil {
				row[key] = line[key]
			}
		}
		if err := s.Store.Insert(ctx, "assembly_order_lines", row); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) AssemblyBOMComponents(ctx context.Context, productID string) ([]map[string]any, error) {
	// 回放 OO（2026-10-15）：既有实现 product_id 缺失**或不是合法 UUID**都返回
	// 裸 400 + 「无效的商品ID」；只有合法 UUID（哪怕查无数据）才返回 200 + 空数组。
	// 本实现原来只判空，且用业务错误形态（200/10000「产品不能为空」），两处都不同。
	if _, err := uuid.Parse(productID); err != nil {
		return nil, ErrKnownNoMessage{Status: 400, Note: "无效的商品ID"}
	}
	rows, err := s.Store.Rows(ctx, "SELECT bi.* FROM bom_items bi JOIN bo_ms b ON b.id=bi.bom_id WHERE b.product_id=? AND b.status='active' AND b.deleted_at IS NULL AND bi.deleted_at IS NULL ORDER BY bi.line_no", productID)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, s.Store.Public("bom_items", row))
	}
	return items, nil
}
