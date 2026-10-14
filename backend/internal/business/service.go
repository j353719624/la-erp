// Package business reconstructs transactions observed in the original runtime.
// Only plain weighted-average stock and plain sales/purchase orders are covered.
package business

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
	"regexp"
	"strings"
	"time"
)

// ErrUnsupported 表示「该业务分支尚未恢复」——对外是 HTTP 501，
// 含义是「原版行为未知或未取证，恢复端选择不实现」。
var ErrUnsupported = errors.New("该业务分支尚未恢复")

// ErrOriginalDefect 表示「原版此处存在缺陷，恢复端有意不对齐」。
//
// 与 ErrUnsupported 的区别很重要：
//   - ErrUnsupported  = 「不知道原版怎么做 / 还没做」，属于**待办**；
//   - ErrOriginalDefect = 「知道原版怎么做，且原版做法有害，恢复端有意拒绝」，属于**终态决策**。
//
// 两者对外都返回 501，但语义不同：前者在台账里是可推进的存量，
// 后者已结案（见 docs/UNSUPPORTED-AUDIT-LOG.md 各批「不对齐」结论）。
// 之所以仍用 501 而非 4xx：这类输入在原版能成功建单，给 4xx 会与原版
// 行为产生表面冲突；但**绝不能复用「尚未恢复」的说法**，否则把终态决策
// 混进待办存量，反复审计也推不动。
var ErrOriginalDefect = errors.New("原版该行为存在数据风险，恢复端有意拒绝而非复刻")

// ErrOriginalNoMessage 表示「原版此处会失败但**不返回业务文案**」。
//
// 原版有若干路径返回裸 HTTP 400 / 500（既非 code:0 也非 10000，也没有 message），
// 典型如：外协 material_lines 传非数组 → 400；product_id 指向不存在的商品 → 500
// （原版未捕获的记录未找到，见 evidence/backend-runtime/audit-batch-e-20261014.json 的 EE8）。
//
// 这类场景**不能**用 ErrUnsupported：那个错误对外映射 HTTP 501，
// 与原版的 400/500 不一致，会让前端错误处理分流错误。
// 但也不能自造中文文案去「补齐」——原版确实没有文案。
//
// 故用本错误携带原版的**状态码**（0 表示沿用调用点的默认语义），
// 由 API 层原样输出 status 而不给 message。
type ErrOriginalNoMessage struct {
	// Status 是原版的 HTTP 状态码（400 / 500）。
	Status int
	// Note 是内部说明，**不返回给客户端**，仅供日志与代码注释追溯。
	Note string
}

func (e ErrOriginalNoMessage) Error() string {
	if e.Note != "" {
		return e.Note
	}
	return "原版该路径不返回业务文案"
}

// Status 返回原版状态码；0 表示调用方应沿用自身默认。
func (e ErrOriginalNoMessage) StatusCode() int { return e.Status }

var decimalSyntax = regexp.MustCompile(`^-?[0-9]{1,20}(\.[0-9]{1,12})?$`)

type Service struct{ Store *database.Store }
type Document struct {
	Table, Lines, ForeignKey, Number, Prefix, Date, Party string
	Stock, Incoming                                       bool
}

var Documents = map[string]Document{
	"stock-ins":        {"stock_ins", "stock_in_lines", "stock_in_id", "stock_in_no", "STIN", "stock_in_date", "", true, true},
	"stock-outs":       {"stock_outs", "stock_out_lines", "stock_out_id", "stock_out_no", "STOUT", "stock_out_date", "", true, false},
	"sales-orders":     {"sales_orders", "sales_order_lines", "order_id", "order_no", "SO", "order_date", "customer", false, false},
	"sales-returns":    {"sales_returns", "sales_return_lines", "order_id", "order_no", "SR", "order_date", "customer", false, true},
	"purchase-returns": {"purchase_returns", "purchase_return_lines", "order_id", "order_no", "PRN", "order_date", "supplier", false, false},
	"purchase-orders":  {"purchase_orders", "purchase_order_lines", "order_id", "order_no", "PO", "order_date", "supplier", false, false},
}

func Number(value any) (decimal.Decimal, error) {
	if value == nil {
		return decimal.Zero, nil
	}
	text := fmt.Sprint(value)
	if !decimalSyntax.MatchString(text) {
		return decimal.Zero, errors.New("数值格式错误，最多20位整数和12位小数")
	}
	return decimal.NewFromString(text)
}
func value(m map[string]any, k string) string {
	if m[k] == nil {
		return ""
	}
	return fmt.Sprint(m[k])
}
func readDecimal(m map[string]any, k string) decimal.Decimal {
	d, _ := decimal.NewFromString(value(m, k))
	return d
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func (s *Service) base(table string) map[string]any {
	r := map[string]any{"id": uuid.NewString()}
	for _, k := range []string{"created_at", "updated_at"} {
		if s.Store.Has(table, k) {
			r[k] = now()
		}
	}
	for _, c := range s.Store.Tables[table].Columns {
		if strings.EqualFold(c.Type, "numeric") && c.NotNull == 1 {
			r[c.Name] = "0"
		}
	}
	if s.Store.Has(table, "tenant_id") {
		r["tenant_id"] = database.ZeroUUID
	}
	return r
}
func (s *Service) transaction(ctx context.Context, action func(*sql.Tx) error) error {
	tx, err := s.Store.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = action(tx); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Service) nextNumber(ctx context.Context, tx *sql.Tx, prefix string) (string, error) {
	// The captured default uses the server's Asia/Shanghai calendar and four digits.
	p := prefix + time.Now().In(time.FixedZone("CST", 8*3600)).Format("20060102")
	rows, err := database.QueryRows(ctx, tx, "SELECT * FROM number_counters WHERE prefix=?", p)
	if err != nil {
		return "", err
	}
	seq := int64(1)
	if len(rows) == 0 {
		r := s.base("number_counters")
		r["prefix"] = p
		r["seq"] = seq
		err = s.Store.InsertWith(ctx, tx, "number_counters", r)
	} else {
		seq = rows[0]["seq"].(int64) + 1
		err = s.Store.UpdateWith(ctx, tx, "number_counters", value(rows[0], "id"), map[string]any{"seq": seq, "updated_at": now()})
	}
	return fmt.Sprintf("%s%04d", p, seq), err
}
func (s *Service) plainProduct(ctx context.Context, tx *sql.Tx, id string, stock ...bool) (map[string]any, error) {
	p, err := s.Store.GetWith(ctx, tx, "products", id)
	if err != nil {
		return nil, errors.New("商品不存在")
	}
	// 原版对 cost_method 不作任何限制，且实测 fifo 商品仍按加权平均计价
	// （2026-10-13 回放：10 件@100 + 10 件@200 入库后 avg_cost=150，出库 unit_cost=150，
	// 出库后 avg_cost 仍为 150）——cost_method 与订单 discount_amount 同属
	// 「落库但不接线」字段，故恢复端不按成本方法拒绝单据。
	// is_batch / is_serial 商品在原版出入库与订单中全部可用
	// （P1/P2/P3 与 Q1-Q6 回放：批次商品可无批次出库，序列号商品受台账约束），
	// 原先的整类拒绝属未经证据的错误拒绝，已移除。
	//
	// 批次 R 取证（2026-10-14，evidence/backend-runtime/audit-batch-r-20261014.json）：
	// 原版**不存在 is_combo=true 的商品行** —— 传入 is_combo=true 或 1 均被静默忽略
	// （回读 undefined，combo-products 列表总数恒为 0）；
	// 而 product_type=combo 会**正常落库**，且该商品出入库完全正常（code:0 + confirm 通过）。
	// 原实现按 is_combo 拒绝，但该字段在原版永远为假 → 守卫**永不可达**，属死代码，已移除。
	//
	// 注：原版的组合件功能挂在独立的 `/api/v1/combo-products` 端点族上
	// （列表/详情/改行/删除/组装/拆卸/可用量），恢复端尚未恢复该端点族，
	// 属**功能缺失**而非本守卫问题 —— 组合件功能恢复时应另立任务。
	return p, nil
}

// advancedHeaderFields 对「高级字段」按表结构分流（2026-10-13 回放取证，
// 2026-10-14 批次 O 补充）：
//
// 表有列且原版接受落库的：
//   - stock_ins/stock_outs 的 location_id / rack_id（R7/S3）
//   - sales_orders 的 sales_contract_id（S4；批次 O 用真实合同 id 验证确实落库并回读一致）
//
// 表无对应列的——订单的 location_id / rack_id / batch_no / serial_nos / production_date、
// 库存单与退货单的 sales_contract_id / contract_id——原版**一律静默忽略**：
//
//	批次 O 实测销售订单带 location_id / rack_id / batch_no / serial_nos / production_date
//	全部 code:0 建单成功；入库单带 sales_contract_id / contract_id 也 code:0。
//
// 原实现对这些字段 return ErrUnsupported（501），把原版的「静默忽略」变成了「拒绝」，
// 属系统性误拒。已移除守卫：表有列则落库，表无列则按原版忽略。
func (s *Service) advancedHeaderFields(table string, input map[string]any) (map[string]any, error) {
	out := map[string]any{}
	for _, k := range []string{"location_id", "rack_id", "batch_no", "serial_nos", "production_date", "expiry_date", "sales_contract_id", "contract_id"} {
		if list, ok := input[k].([]any); ok && len(list) == 0 {
			continue
		}
		if input[k] == nil || fmt.Sprint(input[k]) == "" {
			continue
		}
		if s.Store.Has(table, k) {
			out[k] = input[k]
		}
		// 表无此列 → 原版静默忽略，不返回错误（批次 O 实测 code:0）。
	}
	return out, nil
}
func rejectAdvancedDocumentLine(input map[string]any, dates ...bool) error {
	for _, k := range []string{"location_id", "rack_id", "production_date", "expiry_date", "sales_contract_id", "contract_id"} {
		if (k == "production_date" || k == "expiry_date") && len(dates) > 0 && dates[0] {
			if _, ok := input[k].(time.Time); ok {
				continue
			}
			if v := value(input, k); v != "" {
				if _, err := time.Parse(time.RFC3339Nano, v); err != nil {
					return errors.New("批次日期格式无效")
				}
			}
			continue
		}
		if input[k] != nil && fmt.Sprint(input[k]) != "" {
			return ErrUnsupported
		}
	}
	return nil
}
func rejectAdvanced(input map[string]any) error {
	for _, k := range []string{"location_id", "rack_id", "batch_no", "serial_nos", "production_date", "expiry_date", "sales_contract_id", "contract_id"} {
		if list, ok := input[k].([]any); ok && len(list) == 0 {
			continue
		}
		if input[k] != nil && fmt.Sprint(input[k]) != "" {
			return ErrUnsupported
		}
	}
	return nil
}
func (s *Service) Create(ctx context.Context, d Document, input map[string]any, user string) (map[string]any, error) {
	return s.writeDocument(ctx, d, input, user, "")
}
func (s *Service) writeDocument(ctx context.Context, d Document, input map[string]any, user, existingID string) (map[string]any, error) {
	raw, ok := input["lines"].([]any)
	if existingID == "" && (!ok || len(raw) == 0) {
		if d.Stock && d.Incoming {
			return nil, errors.New("入库明细不能为空")
		}
		return nil, errors.New("单据明细不能为空")
	}
	// 原版回放 FF6（2026-10-14）：1001 行订单原版 code:0 且 1001 行全部落库，
	// 即原版没有明细行数上限。恢复端保留 1000 行上限作为资源保护
	// （不复制「无上限」这一潜在资源耗尽风险），但记录该差异以免误判为等价。
	if len(raw) > 1000 {
		return nil, errors.New("明细过多")
	}
	advanced, err := s.advancedHeaderFields(d.Table, input)
	if err != nil {
		return nil, err
	}
	// 原版回放 JJ1/JJ5（2026-10-14，evidence/backend-runtime/audit-batch-j-20261014.json）：
	//   订单传 source_id + source_no → code:0，回读两字段 undefined（表无这两列）
	//   订单传 source = manual/sales/purchase/garbage/空 → 全部 code:0，
	//     且回读**一律是 manual**（连 manual 之外的值也被归一为 manual）
	// 即原版对订单的这两个字段**一律静默忽略**。
	// 原恢复端 return ErrUnsupported 把「静默忽略」变成「拒绝」，与原版不符，已移除。
	// 库存单同样接受 source_id/source_no（原版 code:0），该路径本就未被本守卫覆盖。
	// 批次 R 取证（2026-10-14，evidence/backend-runtime/audit-batch-r-20261014.json）：
	// 表头的 discount / discount_rate 原版**一律静默忽略** ——
	//   销售订单 discount=10         → code:0
	//   销售订单 discount_rate=0.1   → code:0
	//   采购订单 discount=10         → code:0
	//   入库单   discount=10         → code:0
	// 两字段在 sales_orders / purchase_orders 表中**都没有对应列**
	// （表头只有 discount_amount，行级有 discount），属批次 N/O/P 同源的「静默忽略」误拒，
	// 原恢复端 return ErrUnsupported 与原版不符，已移除。
	//
	// 表头 discount_amount 原版接受并落库（回读 50）但**不参与 total_amount 计算**
	// （total_amount 仍为 2×10=20，2026-10-13 B2 回放），恢复端这一行为已一致。
	id := ""
	err = s.transaction(ctx, func(tx *sql.Tx) error {
		wh := value(input, "warehouse_id")
		if existingID != "" && wh == "" {
			old, err := s.Store.GetWith(ctx, tx, d.Table, existingID)
			if err != nil {
				return err
			}
			wh = value(old, "warehouse_id")
		}
		if d.Stock && wh == "" {
			return errors.New("仓库不能为空")
		}
		if wh != "" {
			if _, err := s.Store.GetWith(ctx, tx, "warehouses", wh); err != nil {
				return errors.New("仓库不存在")
			}
		}
		h := s.base(d.Table)
		if existingID != "" {
			old, err := s.Store.GetWith(ctx, tx, d.Table, existingID)
			if err != nil {
				return err
			}
			if value(old, "status") != "draft" {
				return stateError(d, "修改")
			}
			h = old
			// 原版允许编辑外币订单（2026-10-13 R2：USD 订单创建/确认/审批全通过），
			// 不再按币种拒绝。
			//
			// 批次 BB 复测（2026-10-14，evidence/backend-runtime/audit-batch-bb-20261014.json）：
			// 原版**没有任何订单收款路由** —— 7 个候选动作端点
			// （pay / receive / payment / settle / receipt / collect / confirm-receipt）
			// 对 sales-orders/{id} 逐一探测，全部 404「路由不存在」；
			// 且原版库中 101 张销售订单里 `paid_amount > 0` 的为 **0 条**。
			// 即已收金额恒为 0，本守卫在原版**永不可达**，属防御性断言。
			// 保留 ErrUnsupported 作兜底（防外部直写数据库造出脏数据），不自造文案。
			if !readDecimal(h, "paid_amount").IsZero() {
				return ErrUnsupported
			}
			h["updated_at"] = now()
			if _, err := s.advancedHeaderFields(d.Table, h); err != nil {
				return err
			}
		} else {
			h["created_by"] = user
			if s.Store.Has(d.Table, "department_id") {
				creator, err := s.Store.GetWith(ctx, tx, "sys_users", user)
				if err != nil {
					return err
				}
				if dep := value(creator, "department_id"); dep != "" {
					h["department_id"] = dep
				}
			}
		}
		id = value(h, "id")
		h["status"] = "draft"
		if wh != "" {
			h["warehouse_id"] = wh
		}
		for _, k := range []string{d.Date, "remark"} {
			if v := value(input, k); v != "" {
				if k == d.Date {
					if _, err := time.Parse(time.RFC3339Nano, v); err != nil {
						return errors.New("日期格式错误")
					}
				}
				h[k] = v
			}
		}
		if existingID == "" {
			number, err := s.nextNumber(ctx, tx, d.Prefix)
			if err != nil {
				return err
			}
			h[d.Number] = number
		}
		if d.Stock {
			for _, k := range []string{"source_id", "source_no"} {
				if v := value(input, k); v != "" {
					h[k] = v
				}
			}
			// 原版回放 JJ6（2026-10-14）：source_id 为非法 UUID 时原版在**建单期**
			// 即返回 400「invalid UUID length: 10」——即 UUID 格式在建单期校验，
			// 而「来源订单是否存在」不在建单期校验（格式合法但订单不存在时建单通过）。
			if raw := value(input, "source_id"); raw != "" {
				if _, err := uuid.Parse(raw); err != nil {
					return err
				}
			}
			if _, err := s.source(ctx, tx, d, h, false); err != nil {
				return err
			}
			h["type"] = ""
			// 原版不校验单据类型（2026-10-13 R3 回放：stock-ins/stock-outs 的
			// type=sales/purchase/garbage 全部落库；S5：type=other 与 source 可共存），
			// 传入值原样持久化。
			if t := value(input, "type"); t != "" {
				h["type"] = t
			}
		}
		if !d.Stock {
			party := value(input, d.Party+"_id")
			if party == "" && existingID != "" {
				party = value(h, d.Party+"_id")
			}
			if party == "" {
				return errors.New("客户或供应商不能为空")
			}
			p, err := s.Store.GetWith(ctx, tx, d.Party+"s", party)
			if err != nil {
				return errors.New("客户或供应商不存在")
			}
			h[d.Party+"_id"] = party
			h[d.Party+"_name"] = p["name"]
			if existingID != "" {
				h[d.Party+"_name"] = nil
				if name := value(input, d.Party+"_name"); name != "" {
					h[d.Party+"_name"] = name
				}
			}
			// 原版接受并落库任意币种，金额不作折算（2026-10-13 B1/R2/S6 回放：
			// USD 销售/采购订单创建、确认、审批全部通过，currency=USD 持久化）。
			h["currency"] = "CNY"
			if v := value(input, "currency"); v != "" {
				h["currency"] = v
			}
			h["payment_status"] = "unpaid"
			// 原版接受头部 discount_amount 并落库，但不计入 total_amount（B2 回放）。
			if input["discount_amount"] != nil {
				v, err := Number(input["discount_amount"])
				if err != nil {
					return err
				}
				h["discount_amount"] = v.String()
			}
			if isReturn(d) {
				for _, k := range []string{"sales_order_id", "sales_order_no", "purchase_order_id", "purchase_order_no"} {
					if s.Store.Has(d.Table, k) && input[k] != nil {
						h[k] = input[k]
					}
				}
			}
		}
		for k, v := range advanced {
			h[k] = v
		}
		lines := []map[string]any{}
		totalQty, totalAmount, totalTax := decimal.Zero, decimal.Zero, decimal.Zero
		for i, item := range raw {
			line, ok := item.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			if d.Stock {
				if err := rejectAdvancedDocumentLine(line, true); err != nil {
					return err
				}
			} else if err := rejectOrderLine(line, isReturn(d)); err != nil {
				return err
			}
			// 批次 U：serial_nos 元素类型校验对**库存单与订单都生效**
			// （原版两类单据在建单期都返回 400，见 rejectSerialNosType 注释）。
			if err := rejectSerialNosType(line); err != nil {
				return err
			}
			// 原版支持赠品行，但要求单价为 0（2026-10-13 B3/R1 回放：
			// price=100 + is_gift → 10000「赠品行单价必须为 0」；
			// price=0 + is_gift → code:0，行 amount=0、is_gift 落库、total 不含赠品金额）。
			// 仅对有 is_gift 列的明细表生效（订单/退货行有，库存行无）。
			gift := false
			if s.Store.Has(d.Lines, "is_gift") {
				switch v := line["is_gift"].(type) {
				case bool:
					gift = v
				case string:
					gift = v == "true" || v == "1"
				case float64:
					gift = v == 1
				}
			}
			// 原版回放 FF7（2026-10-14，evidence/backend-runtime/audit-batch-f-20261014.json）：
			// 明细传 unit_rate=2 与 unit_rate=0 原版均 code:0，且金额计算完全不受影响
			// （qty=3 × price=10 → amount=30），回读也不暴露该字段——原版彻底忽略 unit_rate。
			// 原恢复端对 ≠1 返回 ErrUnsupported，属误拒，已移除。
			// 非数字值原版无实测证据（未能构造出与「忽略」相区分的观测），故一并放行，
			// 不自造文案。若后续取证到原版确实拒绝，再补原文案。
			product, err := s.plainProduct(ctx, tx, value(line, "product_id"), d.Stock || d.Table == "sales_orders" || isReturn(d))
			if err != nil {
				return err
			}
			qty, err := Number(line["qty"])
			if err != nil {
				return err
			}
			if !qty.IsPositive() {
				return errors.New("库存数量必须大于0")
			}
			costField := "price"
			if d.Stock {
				costField = "unit_cost"
			}
			cost, err := Number(line[costField])
			if err != nil {
				return err
			}
			if cost.IsNegative() {
				return errors.New("价格不能为负数")
			}
			if gift && !cost.IsZero() {
				return errors.New("赠品行单价必须为 0")
			}
			l := s.base(d.Lines)
			l[d.ForeignKey] = id
			l["line_no"] = i + 1
			l["product_id"] = product["id"]
			l["product_name"] = product["name"]
			l["product_code"] = product["code"]
			if unit := value(line, "unit_id"); unit != "" {
				if _, err := s.Store.GetWith(ctx, tx, "units", unit); err != nil {
					return errors.New("单位不存在")
				}
				l["unit_id"] = unit
			}
			l["qty"] = qty.String()
			l[costField] = cost.String()
			if gift {
				l["is_gift"] = true
			}
			amount := qty.Mul(cost)
			l["amount"] = amount.String()
			for _, key := range []string{"batch_no", "serial_nos", "production_date", "expiry_date"} {
				if s.Store.Has(d.Lines, key) && line[key] != nil {
					l[key] = line[key]
				}
			}
			if !d.Stock {
				discount, err := Number(line["discount"])
				if err != nil {
					return err
				}
				if discount.IsNegative() || discount.GreaterThan(amount) {
					return errors.New("折扣金额超出明细金额")
				}
				amount = amount.Sub(discount)
				l["discount"] = discount.String()
				l["amount"] = amount.String()
				tax, err := Number(line["tax_rate"])
				if err != nil {
					return err
				}
				if tax.IsNegative() || tax.GreaterThan(decimal.NewFromInt(100)) {
					return errors.New("税率超出范围")
				}
				taxAmount := amount.Mul(tax).Div(decimal.NewFromInt(100))
				l["tax_rate"] = tax.String()
				l["tax_amount"] = taxAmount.String()
				totalTax = totalTax.Add(taxAmount)
			}
			if v := value(line, "remark"); v != "" {
				l["remark"] = v
			}
			lines = append(lines, l)
			totalQty = totalQty.Add(qty)
			totalAmount = totalAmount.Add(amount)
		}
		h["total_qty"] = totalQty.String()
		h["total_amount"] = totalAmount.String()
		if !d.Stock {
			h["tax_amount"] = totalTax.String()
		}
		if existingID == "" {
			if err := s.Store.InsertWith(ctx, tx, d.Table, h); err != nil {
				return err
			}
		} else {
			if err := s.Store.UpdateWith(ctx, tx, d.Table, id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=?", id); err != nil {
				return err
			}
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
	return s.Get(ctx, d, id)
}
func (s *Service) Get(ctx context.Context, d Document, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, d.Table, id)
	if err != nil {
		return nil, err
	}
	result := s.Store.Public(d.Table, h)
	edges := map[string]any{}
	lines, err := s.Store.Rows(ctx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=? AND deleted_at IS NULL ORDER BY line_no", id)
	if err != nil {
		return nil, err
	}
	publicLines := []map[string]any{}
	for _, l := range lines {
		p := s.Store.Public(d.Lines, l)
		e := map[string]any{}
		if product, err := s.Store.Get(ctx, "products", value(l, "product_id")); err == nil {
			e["product"] = s.product(ctx, product, true)
		}
		if !d.Stock {
			if unit, err := s.Store.Get(ctx, "units", value(l, "unit_id")); err == nil {
				e["unit"] = s.Store.Public("units", unit)
			}
		}
		p["edges"] = e
		publicLines = append(publicLines, p)
	}
	if len(publicLines) > 0 {
		edges["lines"] = publicLines
	}
	relation, table, field := "warehouse", "warehouses", "warehouse_id"
	if !d.Stock {
		relation = d.Party
		table = d.Party + "s"
		field = d.Party + "_id"
	}
	if p, err := s.Store.Get(ctx, table, value(h, field)); err == nil {
		edges[relation] = s.Store.Public(table, p)
	}
	result["edges"] = edges
	if d.Table == "stock_ins" {
		photos, err := s.StockPhotos(ctx, id)
		if err != nil {
			return nil, err
		}
		if len(photos) > 0 {
			edges["photos"] = photos
		}
	}
	return result, nil
}
func (s *Service) product(ctx context.Context, p map[string]any, nested bool) map[string]any {
	pub := s.Store.Public("products", p)
	if nested {
		edges := map[string]any{}
		if u, err := s.Store.Get(ctx, "units", value(p, "unit_id")); err == nil {
			edges["unit"] = s.Store.Public("units", u)
		}
		pub["edges"] = edges
	}
	return pub
}
func (s *Service) trackingBalance(ctx context.Context, tx *sql.Tx, product, warehouse, batch string, create bool) (map[string]any, error) {
	if batch == "" {
		return s.balance(ctx, tx, product, warehouse, create)
	}
	rows, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=? AND batch_no=?", product, warehouse, batch)
	if err != nil {
		return nil, err
	}
	// 批次 Q 结论（2026-10-14，evidence/backend-runtime/audit-batch-q-20261014.json）：
	// 同键余额行由**数据库 UNIQUE 索引**保证唯一 —— schema.sql 定义
	//   idx_inventory_balance_key ON (product_id, warehouse_id,
	//     COALESCE(location_id,'000…0'), COALESCE(rack_id,'000…0'), COALESCE(batch_no,''))
	// 用 COALESCE 把 NULL 归一化，正是为保证「无库位/无货架/无批次」这一组不重复。
	// 原版库实测 52 条余额行、同键多行组数 0；
	// 恢复端 TestRecoveredBalanceRowIsUniquePerKey / …BatchedBalance… 亦验证索引生效。
	//
	// 故 `len(rows) > 1` **永不可达**（2026-10-14 DUP-A/DUP-B 注释里「无取舍证据」的顾虑，
	// 已由数据库约束消解）。属**防御性断言**，保留兜底但不再当作待办推进项：
	// 该分支一旦命中说明数据库被绕过唯一索引写入了脏数据，
	// 此时返回 ErrUnsupported（500 级）比自造中文更保守 —— 无原版文案可对齐，不自造。
	if len(rows) > 1 {
		return nil, ErrUnsupported
	}
	if len(rows) == 1 {
		return rows[0], nil
	}
	if !create {
		return nil, errors.New("库存不足")
	}
	b := s.base("inventory_balances")
	b["product_id"], b["warehouse_id"], b["batch_no"] = product, warehouse, batch
	if err := s.Store.InsertWith(ctx, tx, "inventory_balances", b); err != nil {
		return nil, err
	}
	return b, nil
}
func (s *Service) balance(ctx context.Context, tx *sql.Tx, product, warehouse string, create bool) (map[string]any, error) {
	rows, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=? AND (batch_no IS NULL OR batch_no='')", product, warehouse)
	if err != nil {
		return nil, err
	}
	if len(rows) > 1 {
		// 同 trackingBalance：数据库 UNIQUE 索引（批次 Q）保证同键唯一，该分支**不可达**。
		// 无原版文案可对齐，保留 ErrUnsupported 作兜底，不自造中文。
		return nil, ErrUnsupported
	}
	if len(rows) == 1 {
		if err := rejectAdvanced(rows[0]); err != nil {
			return nil, err
		}
		return rows[0], nil
	}
	if !create {
		return nil, errors.New("库存不足")
	}
	b := s.base("inventory_balances")
	b["product_id"] = product
	b["warehouse_id"] = warehouse
	err = s.Store.InsertWith(ctx, tx, "inventory_balances", b)
	return b, err
}
func (s *Service) shift(ctx context.Context, tx *sql.Tx, b map[string]any, qty decimal.Decimal, unlock bool) error {
	available, locked := readDecimal(b, "qty_available"), readDecimal(b, "qty_locked")
	if !qty.IsPositive() {
		return errors.New("库存数量必须大于0")
	}
	if unlock {
		if locked.LessThan(qty) {
			return errors.New("锁定库存不足")
		}
		available = available.Add(qty)
		locked = locked.Sub(qty)
	} else {
		personal, err := s.personalMode(ctx, tx)
		if err != nil {
			return err
		}
		if available.LessThan(qty) && !personal {
			return errors.New("库存不足")
		}
		available = available.Sub(qty)
		locked = locked.Add(qty)
	}
	return s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), map[string]any{"qty_available": available.String(), "qty_locked": locked.String(), "updated_at": now()})
}
func (s *Service) Lock(ctx context.Context, id string, input map[string]any, unlock bool) error {
	qty, err := Number(input["qty"])
	if err != nil {
		return err
	}
	return s.transaction(ctx, func(tx *sql.Tx) error {
		b, err := s.Store.GetWith(ctx, tx, "inventory_balances", id)
		if err != nil {
			return err
		}
		return s.shift(ctx, tx, b, qty, unlock)
	})
}
func (s *Service) Transition(ctx context.Context, d Document, id, user string, cancel bool) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		// 原版确认/取消不受活动审批流影响（2026-10-13 A2 回放：启用 sales_order
		// 活动流后订单 confirm+approve 均 code:0），与退货/工单路径的既有结论一致，
		// 此处不再统计审批流后拒绝。
		h, err := s.Store.GetWith(ctx, tx, d.Table, id)
		if err != nil {
			return err
		}
		status := value(h, "status")
		if !cancel && status != "draft" {
			if d.Stock {
				label := "出库单"
				if d.Incoming {
					label = "入库单"
				}
				return errors.New(label + "不存在或状态不允许确认")
			}
			label := "销售"
			if d.Party == "supplier" {
				label = "采购"
			}
			return fmt.Errorf("只有草稿状态的%s订单才能确认", label)
		}
		if cancel && d.Stock {
			// 原版仅允许取消草稿状态的库存单据；已确认的取消返回
			// 「出库单/入库单不存在或状态不允许取消」（2026-10-13 X1/X2/X3 回放）。
			if status != "draft" {
				label := "出库单"
				if d.Incoming {
					label = "入库单"
				}
				return errors.New(label + "不存在或状态不允许取消")
			}
		}
		if cancel && status != "draft" && status != "confirmed" {
			label := "销售"
			if d.Party == "supplier" {
				label = "采购"
			}
			return fmt.Errorf("只有草稿或已确认的%s订单才能取消", label)
		}
		if _, err := s.advancedHeaderFields(d.Table, h); err != nil {
			return err
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=? AND deleted_at IS NULL ORDER BY line_no", id)
		if err != nil {
			return err
		}
		if len(lines) == 0 && d.Stock {
			return errors.New("单据明细不能为空")
		}
		// 原版允许取消已发货/已收货的订单（2026-10-13 W6/X4 回放：部分发货的销售订单、
		// 部分收货的采购订单取消均 code:0，delivered_qty 不回滚），此处不再拒绝。
		changes := map[string]any{"updated_at": now(), "status": "confirmed"}
		if cancel {
			changes["status"] = "cancelled"
		} else {
			changes["confirmed_at"] = now()
		}
		if d.Stock && cancel {
			// 草稿库存单取消只改状态，不触碰库存、台账与来源订单
			// （2026-10-13 CA3-CA5 回放：取消后 status=cancelled；再次取消与 confirm
			// 分别返回「入库单/出库单不存在或状态不允许取消/确认」；确认过的出库单取消
			// 同样被拒）。此处提前返回，避免落入确认分支误记流水与回写 delivered_qty。
			return s.Store.UpdateWith(ctx, tx, d.Table, id, changes)
		}
		if d.Stock {
			order, err := s.source(ctx, tx, d, h, true)
			if err != nil {
				return err
			}
			changes["confirmed_by"] = user
			total := decimal.Zero
			for _, l := range lines {
				if err := rejectAdvancedDocumentLine(l, true); err != nil {
					return err
				}
				product, err := s.plainProduct(ctx, tx, value(l, "product_id"), true)
				if err != nil {
					return err
				}
				if !d.Incoming && order == nil && value(l, "batch_no") == "" && (product["is_batch"] == int64(1) || product["is_batch"] == true) {
					// 批次商品无批次号的出库走自动批次分配。原实现此处还有一层
					// `if order != nil { return ErrUnsupported }`，但外层条件已要求
					// order == nil，分支恒不可达，属死代码（对账脚本亦无此路径证据），已删除。
					strategy := "fifo"
					settings, e := database.QueryRows(ctx, tx, "SELECT value FROM system_settings WHERE key='inventory'")
					if e != nil {
						return e
					}
					if len(settings) > 0 {
						var config map[string]any
						if e = json.Unmarshal([]byte(value(settings[0], "value")), &config); e != nil {
							return e
						}
						if v := value(config, "batch_strategy"); v != "" {
							strategy = v
						}
					}
					if e := s.allocateTrackedBatch(ctx, tx, h, l, d, user, strategy); e != nil {
						return e
					}
					total = total.Add(readDecimal(l, "qty").Mul(readDecimal(l, "unit_cost")))
					continue
				}
				personal, err := s.personalMode(ctx, tx)
				if err != nil {
					return err
				}
				b, err := s.trackingBalance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), value(l, "batch_no"), d.Incoming || personal)
				if err != nil {
					return err
				}
				// 序列号商品出入库必须填写序列号（2026-10-13 T5/Q8 回放：
				// 入库缺号 → 「商品 [name] 为序列号管理，必须填写序列号」；
				// 出库缺号 → 「商品 [name] 为序列号管理，出库必须填写序列号」）。
				// 库存校验先于序列号校验（U3：异仓无库存时先报「库存不足」）。
				if product["is_serial"] == int64(1) || product["is_serial"] == true {
					if len(serialNosOf(l)) == 0 {
						verb := "必须填写序列号"
						if !d.Incoming {
							verb = "出库必须填写序列号"
						}
						return fmt.Errorf("商品 [%s] 为序列号管理，%s", value(l, "product_name"), verb)
					}
				}
				if err := validateSerialLine(l, d.Incoming); err != nil {
					return err
				}
				if err := s.applySerialTransition(ctx, tx, l, h, d.Incoming); err != nil {
					return err
				}
				if err := s.deliverLine(ctx, tx, d, order, l); err != nil {
					return err
				}
				qty, cost := readDecimal(l, "qty"), readDecimal(l, "unit_cost")
				available, locked, avg := readDecimal(b, "qty_available"), readDecimal(b, "qty_locked"), readDecimal(b, "avg_cost")
				update := map[string]any{"updated_at": now()}
				direction, kind := 1, "in"
				if d.Incoming {
					for _, key := range []string{"production_date", "expiry_date"} {
						if value(l, key) != "" {
							update[key] = l[key]
						}
					}
					// Captured original cost logic uses available stock, excluding locked stock.
					onHand := available
					newQty := onHand.Add(qty)
					avg = onHand.Mul(avg).Add(qty.Mul(cost)).DivRound(newQty, 6)
					available = available.Add(qty)
					update["last_in_at"] = now()
				} else {
					if order != nil && value(order, "status") == "approved" && (order["stock_locked"] == int64(1) || order["stock_locked"] == true) {
						var err error
						available, locked, err = consumeLocked(available, locked, qty)
						if err != nil {
							return err
						}
					} else {
						if available.LessThan(qty) && !personal {
							return errors.New("库存不足")
						}
						available = available.Sub(qty)
					}
					cost = avg
					direction, kind = -1, "out"
					update["last_out_at"] = now()
					if err := s.Store.UpdateWith(ctx, tx, d.Lines, value(l, "id"), map[string]any{"unit_cost": cost.String(), "amount": qty.Mul(cost).String(), "updated_at": now()}); err != nil {
						return err
					}
				}
				update["qty_available"] = available.String()
				update["qty_locked"] = locked.String()
				update["avg_cost"] = avg.String()
				if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(b, "id"), update); err != nil {
					return err
				}
				movement := s.base("stock_movements")
				movement["type"] = kind
				movement["source_type"] = h["type"]
				if value(h, "type") == "other" || value(h, "type") == "" {
					movement["source_type"] = "manual"
				}
				movement["source_id"] = id
				movement["source_no"] = h[d.Number]
				movement["product_id"] = l["product_id"]
				movement["warehouse_id"] = h["warehouse_id"]
				movement["qty"] = qty.String()
				movement["direction"] = direction
				movement["unit_cost"] = cost.String()
				movement["total_cost"] = qty.Mul(cost).String()
				movement["balance_after"] = available.String()
				movement["operator_id"] = user
				for _, key := range []string{"batch_no", "production_date", "expiry_date"} {
					if value(l, key) != "" {
						movement[key] = l[key]
					}
				}
				if err := s.Store.InsertWith(ctx, tx, "stock_movements", movement); err != nil {
					return err
				}
				total = total.Add(qty.Mul(cost))
			}
			if err := s.closeDelivered(ctx, tx, d, order); err != nil {
				return err
			}
			changes["total_amount"] = total.String()
			source, remark := "sales_outbound", "销售出库确认"
			entries := []Posting{{"6401", "debit", total}, {"1405", "credit", total}}
			if d.Incoming {
				source, remark = "purchase_inbound", "采购入库确认"
				entries = []Posting{{"1403", "debit", total}, {"2202", "credit", total}}
			}
			if value(h, "type") != "other" && value(h, "type") != "" {
				if err := s.post(ctx, tx, source, id, value(h, d.Number), now(), remark, entries); err != nil {
					return err
				}
			}
		} else if d.Table == "sales_orders" && value(h, "warehouse_id") != "" {
			personal, err := s.personalMode(ctx, tx)
			if err != nil {
				return err
			}
			locked := h["stock_locked"] == int64(1) || h["stock_locked"] == true
			if !cancel || locked {
				for _, l := range lines {
					b, err := s.balance(ctx, tx, value(l, "product_id"), value(h, "warehouse_id"), personal)
					if err != nil {
						return err
					}
					if err := s.shift(ctx, tx, b, readDecimal(l, "qty"), cancel); err != nil {
						return err
					}
				}
				changes["stock_locked"] = !cancel
				if cancel {
					changes["lock_remark"] = "取消已归还锁定库存"
				} else {
					changes["lock_remark"] = "确认时锁定库存"
				}
			}
		}
		if !cancel && d.Table == "sales_orders" {
			changes["customer_progress"] = "confirmed"
		}
		return s.Store.UpdateWith(ctx, tx, d.Table, id, changes)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, d, id)
}

// serialNosOf 取出明细行的序列号列表（兼容数组与 JSON 字符串两种编码）。
func serialNosOf(line map[string]any) []any {
	switch v := line["serial_nos"].(type) {
	case []any:
		return v
	case string:
		if v != "" {
			var raw []any
			if json.Unmarshal([]byte(v), &raw) == nil {
				return raw
			}
		}
	}
	return nil
}
func (s *Service) applySerialTransition(ctx context.Context, tx *sql.Tx, line, header map[string]any, incoming bool) error {
	raw := serialNosOf(line)
	if len(raw) == 0 {
		return nil
	}
	for _, item := range raw {
		serial, ok := item.(string)
		if !ok || serial == "" {
			return errors.New("序列号格式错误")
		}
		if incoming {
			existing, err := database.QueryRows(ctx, tx, "SELECT id FROM serial_numbers WHERE serial_no=? AND deleted_at IS NULL", serial)
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				return fmt.Errorf("序列号 %s 已在台账中存在", serial)
			}
			row := s.base("serial_numbers")
			row["product_id"], row["product_code"], row["product_name"] = line["product_id"], line["product_code"], line["product_name"]
			row["warehouse_id"], row["serial_no"] = header["warehouse_id"], serial
			row["status"], row["registered_at"] = "in_stock", now()
			// 原版台账行记录来源单据（2026-10-13 U2 回放：source_type=stock_in、
			// source_no=入库单号），出库时覆写为 stock_out/出库单号（T2-A 回放）。
			row["source_type"], row["source_no"] = "stock_in", value(header, "stock_in_no")
			if err := s.Store.InsertWith(ctx, tx, "serial_numbers", row); err != nil {
				return err
			}
			continue
		}
		rows, err := database.QueryRows(ctx, tx, "SELECT * FROM serial_numbers WHERE serial_no=? AND deleted_at IS NULL", serial)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return fmt.Errorf("序列号 %s 不存在于台账", serial)
		}
		if value(rows[0], "product_id") != value(line, "product_id") {
			return fmt.Errorf("序列号 %s 不属于该商品", serial)
		}
		if value(rows[0], "status") != "in_stock" {
			return fmt.Errorf("序列号 %s 当前状态为 %s，不能出库", serial, value(rows[0], "status"))
		}
		if err := s.Store.UpdateWith(ctx, tx, "serial_numbers", value(rows[0], "id"), map[string]any{
			"status": "out", "out_at": now(), "updated_at": now(),
			"source_type": "stock_out", "source_no": value(header, "stock_out_no"),
		}); err != nil {
			return err
		}
	}
	return nil
}

func validateSerialLine(line map[string]any, incoming bool) error {
	raw := serialNosOf(line)
	if len(raw) == 0 {
		return nil
	}
	seen := map[string]bool{}
	blank := 0
	for _, v := range raw {
		if v == nil {
			// 原版：null 元素等价于空串（建单放行，confirm 时因「有效序列号数为 0」
			// 而报 10000「序列号不能为空」）。见 evidence/backend-runtime/audit-batch-u-*.json。
			blank++
			continue
		}
		no, ok := v.(string)
		if !ok {
			// 原版：数字 / 布尔 / 对象元素在**建单期**即 400「系统内部错误，请稍后重试或联系管理员」。
			// 此处是确认期，正常输入到不了；保留类型错误以防内部调用绕过校验。
			return errors.New("序列号格式错误")
		}
		if no == "" {
			blank++
			continue
		}
		if seen[no] {
			return fmt.Errorf("序列号 %s 在本单内重复", no)
		}
		seen[no] = true
	}
	// 原版：整组只有空串/null 时报 10000「序列号不能为空」（与「序列号不能为空」逐字一致）。
	if len(seen) == 0 && blank > 0 {
		return errors.New("序列号不能为空")
	}
	verb := "出库"
	if incoming {
		verb = "入库"
	}
	if !readDecimal(line, "qty").Equal(decimal.NewFromInt(int64(len(raw)))) {
		return fmt.Errorf("序列号数量(%d)与%s数量(%s)不一致", len(raw), verb, readDecimal(line, "qty").String())
	}
	return nil
}

// rejectSerialNosType 校验 serial_nos 的**元素类型**（建单期）。
//
// 批次 U 取证（2026-10-14，evidence/backend-runtime/audit-batch-u-20261014.json）：
// 原版对 serial_nos 内的非字符串元素在**建单期**即返回 HTTP **400**
// 「系统内部错误，请稍后重试或联系管理员」（Go 结构体绑定失败）：
//
//	数字 123 / 布尔 true / 对象 {"a":1} → 建单 400
//	null / 空串 ""                     → 建单 code:0（视为空串，见 validateSerialLine）
//
// 恢复端原先把 serial_nos 摘出通用守卫后完全放行，数字元素能建单成功，与原版不符。
func rejectSerialNosType(line map[string]any) error {
	for _, v := range serialNosOf(line) {
		if v == nil {
			continue
		}
		if _, ok := v.(string); !ok {
			return ErrOriginalNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}
		}
	}
	return nil
}

func rejectOrderLine(line map[string]any, returnDocument bool) error {
	if !returnDocument {
		return rejectAdvanced(line)
	}
	// Original return lines do not persist batch_no and return to the generic balance.
	validated := map[string]any{}
	for k, v := range line {
		if k != "batch_no" {
			validated[k] = v
		}
	}
	return rejectAdvanced(validated)
}
