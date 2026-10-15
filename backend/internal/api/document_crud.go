package api

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

// simpleDoc 描述一类「主表 + 明细表」的轻量单据（采购申请 / 询价单 / 报价单 /
// 采购合同 / 销售合同 / 商品款）。这些资源此前只有 GET（read_resources.json 的
// 通用读），新建/编辑/删除未注册，前端保存即 501，故在此补齐写路径。
type simpleDoc struct {
	Route      string
	Table      string
	Lines      string   // 明细表；空串表示无明细
	ForeignKey string   // 明细表指向主表的外键
	Number     string   // 单号列
	Prefix     string   // 单号前缀
	Permission string   // 权限码前缀
	Label      string   // 中文名
	LineFields []string // 明细可写列
	QtyFields  []string // 明细金额列（参与合计）
	TotalQty   bool     // 主表是否有 total_qty
	TotalAmt   bool     // 主表是否有 total_amount

	// 明细校验文案（回归回放 2026-10-14，运行快照）
	// 三种带明细的单据文案各不相同，本实现此前统一自造，属无据文案，已按回放逐字替换。
	EmptyMsg    string // 明细为空
	ProductMsg  string // 明细商品不存在
	ProductHTTP int    // 商品不存在时的 HTTP 状态码；0 表示走业务 10000
	QtyMsg      string // 数量缺失或非正

	// DeletePayload 是删除成功后 data 的返回内容；nil 表示 data:null。
	//
	// 回归回放 II（2026-10-14，运行快照）
	// 逐个建单再删除，实测这 6 类单据**并不统一**：
	//   采购申请 / 销售报价单 / 采购合同 → {"deleted":true}
	//   询价单 / 销售合同 / 商品款       → null
	// 询价单特地连测 3 次均为 null，排除偶发。本实现原先对所有 6 类一律返回 null。
	DeletePayload map[string]any
}

var simpleDocs = []simpleDoc{
	{
		Route: "purchase-requisitions", Table: "purchase_requisitions", Lines: "purchase_requisition_lines",
		ForeignKey: "requisition_id", Number: "requisition_no", Prefix: "PR", Permission: "purchase_requisition",
		Label: "采购申请", LineFields: []string{"product_id", "unit_id", "qty", "suggested_price", "suggested_supplier_id", "suggested_supplier_name", "spec", "remark"},
		QtyFields:  []string{"qty", "suggested_price"},
		TotalQty:   true,
		TotalAmt:   true,
		EmptyMsg:   "采购申请明细不能为空",
		ProductMsg: "系统内部错误，请稍后重试或联系管理员",
		// 既有实现对采购申请的不存在商品直接 500（回放 GG5/MM-a），与询价/报价的 10000 不同
		ProductHTTP:   500,
		QtyMsg:        "采购申请数量必须为正数",
		DeletePayload: map[string]any{"deleted": true},
	},
	{
		Route: "purchase-rfqs", Table: "purchase_rf_qs", Lines: "purchase_rfq_lines",
		ForeignKey: "rfq_id", Number: "rfq_no", Prefix: "RFQ", Permission: "purchase_rfq",
		Label: "询价单", LineFields: []string{"product_id", "unit_id", "qty", "quoted_price", "spec", "remark"},
		QtyFields: []string{"qty", "quoted_price"}, TotalAmt: false, TotalQty: false,
		EmptyMsg: "询价明细不能为空", ProductMsg: "所选商品不存在或已被删除", QtyMsg: "询价明细数量必须大于 0",
		// 既有实现连测 3 次删除均为 data:null（回放 II-C），与采购申请/报价单不同
		DeletePayload: nil,
	},
	{
		Route: "sales-quotations", Table: "sales_quotations", Lines: "sales_quotation_lines",
		ForeignKey: "quotation_id", Number: "quotation_no", Prefix: "SQ", Permission: "sales_quotation",
		Label: "销售报价单", LineFields: []string{"product_id", "unit_id", "qty", "price", "discount", "tax_rate", "spec", "remark"},
		QtyFields: []string{"qty", "price", "discount", "tax_rate", "amount", "tax_amount"}, TotalQty: true, TotalAmt: true,
		EmptyMsg: "报价明细不能为空", ProductMsg: "所选商品不存在或已被删除", QtyMsg: "报价明细数量必须大于 0",
		DeletePayload: map[string]any{"deleted": true},
	},
	{
		// 单号前缀实测为 CT（回放 II 建的合同为 CT202610150002/003/004），
		// 本实现此前按猜测写成 PC，与与既有行为不符。
		Route: "purchase-contracts", Table: "purchase_contracts", Number: "contract_no", Prefix: "CT",
		Permission: "purchase_contract", Label: "采购合同",
		DeletePayload: map[string]any{"deleted": true},
	},
	{
		// 单号前缀实测为 XSHT（回放 II 建的合同为 XSHT202610150007/008/009），
		// 本实现此前写成 SC，与与既有行为不符。
		Route: "sales-contracts", Table: "sales_contracts", Number: "contract_no", Prefix: "XSHT",
		Permission: "sales_contract", Label: "销售合同",
		DeletePayload: nil,
	},
	{
		Route: "spus", Table: "product_spus", Number: "code", Prefix: "SPU",
		Permission: "spu", Label: "商品款",
	},
}

func (s *Server) registerSimpleDocuments() {
	for _, doc := range simpleDocs {
		d := doc
		base := "/api/v1/" + d.Route
		s.mux.Handle("POST "+base, s.protected(d.Permission+"_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			row, err := s.simpleDocRow(r, d, body)
			if err != nil {
				verbatimFailure(w, err)
				return
			}
			row["id"] = uuid.NewString()
			now := database.Now()
			row["created_at"] = now
			row["updated_at"] = now
			row["status"] = "draft"
			row["tenant_id"] = database.ZeroUUID
			if s.Store.Has(d.Table, "created_by") {
				row["created_by"] = current(r).UserID
			}
			// 商品款的 code 既是单号也是用户录入项：回归回放（GG11/MM）里传入的
			// 款号会被原样保留（生成的 SKU 形如「GG-SPU3-01」），不能覆盖成流水号。
			if d.Route == "spus" && text(body, "code") != "" {
				row[d.Number] = text(body, "code")
			} else {
				number, err := s.nextSimpleNumber(r, d)
				if err != nil {
					s.failure(w, err, d.Label)
					return
				}
				row[d.Number] = number
			}
			s.fillNumericDefaults(d.Table, row)
			lines, totalQty, totalAmount, err := s.simpleDocLines(r, d, body, text(row, "id"), true)
			if err != nil {
				verbatimFailure(w, err)
				return
			}
			if d.TotalQty {
				row["total_qty"] = totalQty.String()
			}
			if d.TotalAmt {
				row["total_amount"] = totalAmount.String()
			}
			err = s.withTx(r, func(tx *sql.Tx) error {
				if err := s.Store.InsertWith(r.Context(), tx, d.Table, row); err != nil {
					return err
				}
				for _, line := range lines {
					if err := s.Store.InsertWith(r.Context(), tx, d.Lines, line); err != nil {
						return err
					}
				}
				return nil
			})
			if err != nil {
				s.failure(w, err, d.Label)
				return
			}
			respond(w, 200, s.plainView(r, d.Table, row))
		})))
		s.mux.Handle("PUT "+base+"/{id}", s.protected(d.Permission+"_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			row, err := s.Store.Get(r.Context(), d.Table, r.PathValue("id"))
			if err != nil {
				s.failure(w, err, d.Label)
				return
			}
			if text(row, "status") != "draft" {
				fail(w, 400, d.Label+"已提交，不允许修改")
				return
			}
			body, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			changes, err := s.simpleDocRow(r, d, body)
			if err != nil {
				verbatimFailure(w, err)
				return
			}
			delete(changes, d.Number) // 单号一经生成不再变更
			changes["updated_at"] = database.Now()
			lines, totalQty, totalAmount, err := s.simpleDocLines(r, d, body, text(row, "id"), false)
			if err != nil {
				verbatimFailure(w, err)
				return
			}
			if d.TotalQty {
				changes["total_qty"] = totalQty.String()
			}
			if d.TotalAmt {
				changes["total_amount"] = totalAmount.String()
			}
			now := database.Now()
			err = s.withTx(r, func(tx *sql.Tx) error {
				if err := s.Store.UpdateWith(r.Context(), tx, d.Table, text(row, "id"), changes); err != nil {
					return err
				}
				if d.Lines == "" {
					return nil
				}
				existing, err := database.QueryRows(r.Context(), tx, "SELECT id FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=? AND deleted_at IS NULL", text(row, "id"))
				if err != nil {
					return err
				}
				for _, old := range existing {
					if err := s.Store.UpdateWith(r.Context(), tx, d.Lines, text(old, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
						return err
					}
				}
				for _, line := range lines {
					if err := s.Store.InsertWith(r.Context(), tx, d.Lines, line); err != nil {
						return err
					}
				}
				return nil
			})
			if err != nil {
				s.failure(w, err, d.Label)
				return
			}
			saved, err := s.Store.Get(r.Context(), d.Table, text(row, "id"))
			if err != nil {
				s.failure(w, err, d.Label)
				return
			}
			respond(w, 200, s.plainView(r, d.Table, saved))
		})))
		s.mux.Handle("DELETE "+base+"/{id}", s.protected(d.Permission+"_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			row, err := s.Store.Get(r.Context(), d.Table, r.PathValue("id"))
			if err != nil {
				s.failure(w, err, d.Label)
				return
			}
			if text(row, "status") != "draft" && text(row, "status") != "cancelled" {
				fail(w, 400, d.Label+"当前状态不允许删除")
				return
			}
			now := database.Now()
			err = s.withTx(r, func(tx *sql.Tx) error {
				if err := s.Store.UpdateWith(r.Context(), tx, d.Table, text(row, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
					return err
				}
				if d.Lines == "" {
					return nil
				}
				existing, err := database.QueryRows(r.Context(), tx, "SELECT id FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=? AND deleted_at IS NULL", text(row, "id"))
				if err != nil {
					return err
				}
				for _, old := range existing {
					if err := s.Store.UpdateWith(r.Context(), tx, d.Lines, text(old, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
						return err
					}
				}
				return nil
			})
			if err != nil {
				s.failure(w, err, d.Label)
				return
			}
			respond(w, 200, d.DeletePayload)
		})))
	}
}

// simpleDocRow 从请求体提取主表可写列（跳过内部列与单号）。
func (s *Server) simpleDocRow(r *http.Request, d simpleDoc, body map[string]any) (map[string]any, error) {
	row := map[string]any{}
	for key, value := range body {
		if value == nil {
			continue
		}
		switch key {
		case "id", "created_at", "updated_at", "deleted_at", "tenant_id", "created_by", "updated_by", "status", "edges", "lines", d.Number:
			continue
		}
		if !s.Store.Has(d.Table, key) {
			continue
		}
		row[key] = value
	}
	// 回归回放（2026-10-14，audit-batch-gg-20261014.json）：
	//   POST /spus 缺 name            → 400「请求参数错误: Key: 'CreateSpuRequest.Name' …」
	//   POST /purchase-contracts {}   → code:0 建单成功（不校验供应商）
	//   POST /sales-contracts {}      → code:0 建单成功（不校验客户）
	//   POST /sales-quotations 有明细缺客户 → code:0 建单成功（只校验明细）
	// 故只有 spus 的 name 必填，往来单位一律不校验；此前三处守卫属误拒，已删除。
	if d.Route == "spus" && text(row, "name") == "" {
		return nil, verbatim{
			text:   "请求参数错误: Key: 'CreateSpuRequest.Name' Error:Field validation for 'Name' failed on the 'required' tag",
			status: 400,
		}
	}
	// 往来单位名称冗余列：按 id 带出，避免手工传错
	for _, party := range []string{"supplier", "customer"} {
		if id := text(row, party+"_id"); id != "" && s.Store.Has(d.Table, party+"_name") {
			if partyRow, err := s.Store.Get(r.Context(), party+"s", id); err == nil {
				row[party+"_name"] = text(partyRow, "name")
			}
		}
	}
	return row, nil
}

// simpleDocLines 构造明细行（商品必须存在，数量必须为正），并回传合计用于回写主表。
// requireLines=true 时「无 lines 键」与「空明细数组」同样报错（既有实现 POST 口径）；
// 编辑（PUT）不带 lines 表示只改主表，不得误报明细为空。
func (s *Server) simpleDocLines(r *http.Request, d simpleDoc, body map[string]any, parentID string, requireLines bool) ([]map[string]any, decimal.Decimal, decimal.Decimal, error) {
	if d.Lines == "" {
		return nil, decimal.Zero, decimal.Zero, nil
	}
	raw, _ := body["lines"].([]any)
	_, hasLines := body["lines"]
	// 既有实现对「空明细数组」与「无 lines 键」返回同一句（回放 MM-d / MM-e）
	if len(raw) == 0 && (requireLines || hasLines) {
		return nil, decimal.Zero, decimal.Zero, verbatim{text: d.EmptyMsg}
	}
	now := database.Now()
	lines := make([]map[string]any, 0, len(raw))
	for i, item := range raw {
		input, ok := item.(map[string]any)
		if !ok {
			return nil, decimal.Zero, decimal.Zero, errors.New("明细格式错误")
		}
		product, err := s.Store.Get(r.Context(), "products", text(input, "product_id"))
		if err != nil {
			return nil, decimal.Zero, decimal.Zero, verbatim{text: d.ProductMsg, status: d.ProductHTTP}
		}
		line := map[string]any{
			"id":           uuid.NewString(),
			"created_at":   now,
			"updated_at":   now,
			"deleted_at":   nil,
			"line_no":      i + 1,
			"product_id":   text(product, "id"),
			"product_name": text(product, "name"),
			"product_code": text(product, "code"),
			"spec":         text(product, "spec"),
			"tenant_id":    database.ZeroUUID,
			d.ForeignKey:   parentID,
		}
		for _, key := range d.LineFields {
			value, ok := input[key]
			if !ok || value == nil {
				continue
			}
			if !s.Store.Has(d.Lines, key) {
				continue
			}
			line[key] = value
		}
		// 既有实现对「缺 qty」与「qty=0」返回同一句（回放 MM-b / MM-c）
		qty, _ := decimal.NewFromString(fmt.Sprint(line["qty"]))
		if _, ok := line["qty"]; !ok || !qty.IsPositive() {
			return nil, decimal.Zero, decimal.Zero, verbatim{text: d.QtyMsg}
		}
		s.fillNumericDefaults(d.Lines, line)
		lines = append(lines, line)
	}
	if len(lines) == 0 {
		return nil, decimal.Zero, decimal.Zero, nil
	}
	// 合计回写主表
	totalQty, totalAmount := decimal.Zero, decimal.Zero
	for _, line := range lines {
		qty, _ := decimal.NewFromString(fmt.Sprint(line["qty"]))
		totalQty = totalQty.Add(qty)
		if price, ok := line["price"]; ok {
			amount := qty.Mul(decimalOrZero(price))
			if discount, ok := line["discount"]; ok {
				amount = amount.Sub(decimalOrZero(discount))
			}
			line["amount"] = amount.String()
			totalAmount = totalAmount.Add(amount)
		} else if price, ok := line["suggested_price"]; ok {
			totalAmount = totalAmount.Add(qty.Mul(decimalOrZero(price)))
		}
	}
	return lines, totalQty, totalAmount, nil
}

// fillNumericDefaults 给「numeric NOT NULL 且无默认值」的列补 0。
//
// 这些列在建表时没有 DEFAULT（如 sales_quotations 的 discount_amount / tax_amount、
// sales_order_lines 的 delivered_qty / returned_qty），缺少即触发约束错误；
// 业务上它们的初值本就是 0，故在创建明细时统一补齐。
func (s *Server) fillNumericDefaults(table string, row map[string]any) {
	for _, column := range s.Store.Tables[table].Columns {
		if !strings.EqualFold(column.Type, "numeric") || column.NotNull != 1 {
			continue
		}
		if _, ok := row[column.Name]; !ok {
			row[column.Name] = "0"
		}
	}
}

func decimalOrZero(value any) decimal.Decimal {
	parsed, err := decimal.NewFromString(fmt.Sprint(value))
	if err != nil {
		return decimal.Zero
	}
	return parsed
}

// nextSimpleNumber 前缀 + 年月日 + 4 位流水（同前缀已用最大号 + 1，含软删除）。
func (s *Server) nextSimpleNumber(r *http.Request, d simpleDoc) (string, error) {
	segment := time.Now().Format("20060102")
	rows, err := s.Store.Rows(r.Context(), "SELECT "+database.Quote(d.Number)+" FROM "+database.Quote(d.Table)+" WHERE "+database.Quote(d.Number)+" LIKE ?", d.Prefix+segment+"%")
	if err != nil {
		return "", err
	}
	max := 0
	prefixLen := len(d.Prefix + segment)
	for _, row := range rows {
		no := text(row, d.Number)
		if len(no) != prefixLen+4 {
			continue
		}
		if seq, err := strconv.Atoi(no[prefixLen:]); err == nil && seq > max {
			max = seq
		}
	}
	return fmt.Sprintf("%s%s%04d", d.Prefix, segment, max+1), nil
}
