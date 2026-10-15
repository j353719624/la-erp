package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"la-erp/backend/internal/database"
)

// 单号规则（设置便利性改进 B-05，2026-09-13）：
//
//	编号 = 前缀 + 日期段 + 流水
//	流水取「同前缀已用最大号 + 1」（含已删除记录，绝不撞号）
//	重置策略与日期段配对：daily=20060102 / monthly=200601 / yearly=2006 / never=""
//
// 默认规则表 65 条按 biz_type 字典序，逐字取自 2026-10-08 回归回放
// （运行快照 → GET /api/v1/numbering-rules）。
// 既有实现库内无编号规则表（system_settings 仅 date_midnight_migrated /
// permission_split_version / demo_seed_injected 三个键），即 65 条为代码级默认值，
// 自定义覆盖存 system_settings.numbering_rules（与 account_mapping /
// portal_settings / tax_rate_defaults 同一套设置持久化模式）。
//
// preview 的 400 文案「请提供 biz_types（逗号分隔的业务对象）」同为逐字回放
// （同文件 GET /api/v1/numbering-rules/preview 未带 biz_types 的捕获）。

type numberingRule struct {
	BizType           string `json:"biz_type"`
	Label             string `json:"label"`
	Prefix            string `json:"prefix"`
	DateFormat        string `json:"date_format"`
	SeqDigits         int    `json:"seq_digits"`
	Reset             string `json:"reset"`
	Sample            string `json:"sample"`
	IsDefault         bool   `json:"is_default"`
	DefaultPrefix     string `json:"default_prefix"`
	DefaultDateFormat string `json:"default_date_format"`
	DefaultSeqDigits  int    `json:"default_seq_digits"`
	DefaultReset      string `json:"default_reset"`
}

var numberingDefaults = []numberingRule{
	{BizType: "ap_invoice", Label: "应付发票号", Prefix: "AP", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "ar_invoice", Label: "应收发票号", Prefix: "AR", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "attendance_request", Label: "考勤申请单号", Prefix: "KQ", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "category", Label: "商品分类编码", Prefix: "CAT", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
	{BizType: "combo_assembly", Label: "组装追溯号", Prefix: "COMBOZ", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "combo_disassembly", Label: "拆解追溯号", Prefix: "COMBOC", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "commission_settlement", Label: "佣金结算单号", Prefix: "CM", DateFormat: "200601", SeqDigits: 4, Reset: "monthly"},
	{BizType: "crm_opportunity", Label: "商机编号", Prefix: "SJ", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "customer", Label: "客户编码", Prefix: "C", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
	{BizType: "employee", Label: "员工工号", Prefix: "EMP", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
	{BizType: "expense_claim", Label: "费用报销单号", Prefix: "EX", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "fixed_asset", Label: "固定资产编号", Prefix: "FA", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "inventory_adjust", Label: "库存调整单", Prefix: "ADJ", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "inventory_check", Label: "库存盘点单", Prefix: "IC", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "inventory_consignment", Label: "寄售单", Prefix: "CST", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "inventory_loan", Label: "借出借入单", Prefix: "LO", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "inventory_transfer", Label: "库存调拨单", Prefix: "TR", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "labor_contract", Label: "劳动合同编号", Prefix: "HT", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "lead", Label: "销售线索编号", Prefix: "LD", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "location", Label: "库位编码", Prefix: "L", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
	{BizType: "payment_payment", Label: "付款单号", Prefix: "PY", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "payment_plan", Label: "付款计划号", Prefix: "PL", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "payment_receipt", Label: "收款单号", Prefix: "RC", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "payroll_batch", Label: "工资批次号", Prefix: "SAL", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "perf_assessment", Label: "绩效考核单号", Prefix: "JX", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "piecework_record", Label: "计件登记单号", Prefix: "JJ", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "product", Label: "商品编码", Prefix: "P", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
	{BizType: "product_spu", Label: "SPU 编码", Prefix: "SPU", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
	{BizType: "production_assembly", Label: "组装单", Prefix: "ASM", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_bom", Label: "BOM 编码", Prefix: "BOM", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_document", Label: "技术资料编号", Prefix: "DOC", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_equipment", Label: "设备编号", Prefix: "EQ", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_mps", Label: "主生产计划编号", Prefix: "MPS", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_mrp", Label: "物料需求单号", Prefix: "MRP", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_picking", Label: "生产领料单号", Prefix: "PP", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_purchase_suggestion", Label: "采购建议单号", Prefix: "PS", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_receipt", Label: "生产入库单号", Prefix: "REC", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_return", Label: "生产退料单号", Prefix: "PRT", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_rework_order", Label: "返工单号", Prefix: "REW", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_routing", Label: "工艺路线编号", Prefix: "RT", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_subcontract_order", Label: "委外加工单号", Prefix: "SUB", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_team", Label: "班组编号", Prefix: "TM", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_tooling", Label: "模具工装编号", Prefix: "TL", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "production_work_order", Label: "生产工单号", Prefix: "WO", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "purchase_contract", Label: "采购合同", Prefix: "CT", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "purchase_order", Label: "采购订单", Prefix: "PO", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "purchase_reconciliation", Label: "采购对账单号", Prefix: "CGDZ", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "purchase_requisition", Label: "采购申请单", Prefix: "PR", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "purchase_return", Label: "采购退货单", Prefix: "PRN", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "purchase_rfq", Label: "采购询价单", Prefix: "RFQ", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "rack", Label: "货架编码", Prefix: "R", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
	{BizType: "recruitment_candidate", Label: "候选人编号", Prefix: "YP", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "recruitment_position", Label: "招聘职位编号", Prefix: "ZP", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "sales_contract", Label: "销售合同", Prefix: "XSHT", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "sales_order", Label: "销售订单", Prefix: "SO", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "sales_quotation", Label: "销售报价单", Prefix: "SQ", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "sales_return", Label: "销售退货单", Prefix: "SR", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "stock_in", Label: "入库单", Prefix: "STIN", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "stock_out", Label: "出库单", Prefix: "STOUT", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "supplier", Label: "供应商编码", Prefix: "S", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
	{BizType: "tax_accrual", Label: "税金计提单号", Prefix: "TJ", DateFormat: "200601", SeqDigits: 4, Reset: "monthly"},
	{BizType: "training_record", Label: "培训单号", Prefix: "PX", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "unit", Label: "计量单位编码", Prefix: "U", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
	{BizType: "voucher", Label: "记账凭证号", Prefix: "VOU", DateFormat: "20060102", SeqDigits: 4, Reset: "daily"},
	{BizType: "warehouse", Label: "仓库编码", Prefix: "W", DateFormat: "20060102", SeqDigits: 5, Reset: "daily"},
}

// numberingSources: biz_type → 承载该编号的（表, 列）。
// 「同前缀已用最大号」扫描用；单据列名取自 schema.sql（order_no / *_no / code）。
var numberingSources = map[string][2]string{
	"ap_invoice":                     {"ap_invoices", "invoice_no"},
	"ar_invoice":                     {"ar_invoices", "invoice_no"},
	"attendance_request":             {"attendance_requests", "code"},
	"category":                       {"categories", "code"},
	"combo_assembly":                 {"assembly_orders", "assembly_no"},
	"combo_disassembly":              {"assembly_orders", "assembly_no"},
	"commission_settlement":          {"commission_settlements", "settlement_no"},
	"crm_opportunity":                {"crm_opportunities", "code"},
	"customer":                       {"customers", "code"},
	"employee":                       {"employees", "code"},
	"expense_claim":                  {"expense_claims", "claim_no"},
	"fixed_asset":                    {"fixed_assets", "asset_no"},
	"inventory_adjust":               {"stock_adjusts", "adjust_no"},
	"inventory_check":                {"inventory_checks", "check_no"},
	"inventory_consignment":          {"consignment_orders", "consignment_no"},
	"inventory_loan":                 {"loan_orders", "loan_no"},
	"inventory_transfer":             {"stock_transfers", "transfer_no"},
	"labor_contract":                 {"labor_contracts", "code"},
	"lead":                           {"leads", "lead_no"},
	"location":                       {"locations", "code"},
	"payment_payment":                {"payment_payments", "payment_no"},
	"payment_plan":                   {"payment_plans", "plan_no"},
	"payment_receipt":                {"payment_receipts", "receipt_no"},
	"payroll_batch":                  {"payroll_batches", "batch_no"},
	"perf_assessment":                {"perf_assessments", "code"},
	"piecework_record":               {"piecework_records", "code"},
	"product":                        {"products", "code"},
	"product_spu":                    {"product_spus", "code"},
	"production_assembly":            {"assembly_orders", "assembly_no"},
	"production_bom":                 {"bo_ms", "code"},
	"production_document":            {"product_documents", "doc_no"},
	"production_equipment":           {"production_equipments", "equipment_no"},
	"production_mps":                 {"mps_plans", "code"},
	"production_mrp":                 {"material_requirements", "mrp_no"},
	"production_picking":             {"production_pickings", "picking_no"},
	"production_purchase_suggestion": {"purchase_suggestions", "suggestion_no"},
	"production_receipt":             {"production_receipts", "receipt_no"},
	"production_return":              {"production_returns", "return_no"},
	"production_rework_order":        {"rework_orders", "code"},
	"production_routing":             {"routings", "code"},
	"production_subcontract_order":   {"subcontract_orders", "code"},
	"production_team":                {"production_teams", "code"},
	"production_tooling":             {"toolings", "tooling_no"},
	"production_work_order":          {"work_orders", "order_no"},
	"purchase_contract":              {"purchase_contracts", "contract_no"},
	"purchase_order":                 {"purchase_orders", "order_no"},
	"purchase_reconciliation":        {"purchase_reconciliations", "code"},
	"purchase_requisition":           {"purchase_requisitions", "requisition_no"},
	"purchase_return":                {"purchase_returns", "order_no"},
	"purchase_rfq":                   {"purchase_rf_qs", "rfq_no"},
	"rack":                           {"racks", "code"},
	"recruitment_candidate":          {"recruitment_candidates", "code"},
	"recruitment_position":           {"recruitment_positions", "code"},
	"sales_contract":                 {"sales_contracts", "contract_no"},
	"sales_order":                    {"sales_orders", "order_no"},
	"sales_quotation":                {"sales_quotations", "quotation_no"},
	"sales_return":                   {"sales_returns", "order_no"},
	"stock_in":                       {"stock_ins", "stock_in_no"},
	"stock_out":                      {"stock_outs", "stock_out_no"},
	"supplier":                       {"suppliers", "code"},
	"tax_accrual":                    {"tax_accruals", "code"},
	"training_record":                {"training_records", "code"},
	"unit":                           {"units", "code"},
	"voucher":                        {"vouchers", "voucher_no"},
	"warehouse":                      {"warehouses", "code"},
}

const (
	numberingSettingsKey    = "numbering_rules"
	numberingMaxPreviewSize = 20
)

// numberingZone: 与 business.nextNumber 一致的 Asia/Shanghai 固定时区。
var numberingZone = time.FixedZone("CST", 8*3600)

// numberingDateFormats: 重置策略 → 日期段（前端同一套配对，改重置即改日期段）。
var numberingDateFormats = map[string]string{
	"daily":   "20060102",
	"monthly": "200601",
	"yearly":  "2006",
	"never":   "",
}

func (s *Server) registerNumbering() {
	s.mux.Handle("GET /api/v1/numbering-rules", s.authenticated(http.HandlerFunc(s.numberingList)))
	s.mux.Handle("GET /api/v1/numbering-rules/preview", s.authenticated(http.HandlerFunc(s.numberingPreview)))
	s.mux.Handle("PUT /api/v1/numbering-rules", s.protected("numbering_edit", http.HandlerFunc(s.numberingSave)))
}

// numberingList: GET /api/v1/numbering-rules —— 默认规则 + 自定义覆盖合并视图。
func (s *Server) numberingList(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, s.numberingRules(r))
}

// numberingRules 组装列表：默认值打底，system_settings.numbering_rules 覆盖，
// 重算 is_default / default_* / sample（sample = 前缀 + 当日日期段 + 000…1）。
func (s *Server) numberingRules(r *http.Request) []numberingRule {
	stored := s.storedNumberingRules(r)
	now := time.Now().In(numberingZone)
	out := make([]numberingRule, 0, len(numberingDefaults)+len(stored))
	for _, d := range numberingDefaults {
		v := d
		if o, ok := stored[d.BizType]; ok {
			if o.Label != "" {
				v.Label = o.Label
			}
			if o.Prefix != "" {
				v.Prefix = o.Prefix
			}
			if o.DateFormat != "" || o.Reset != "" {
				v.DateFormat, v.Reset = o.DateFormat, o.Reset
			}
			if o.SeqDigits != 0 {
				v.SeqDigits = o.SeqDigits
			}
		}
		v.DefaultPrefix, v.DefaultDateFormat = d.Prefix, d.DateFormat
		v.DefaultSeqDigits, v.DefaultReset = d.SeqDigits, d.Reset
		v.IsDefault = v.Prefix == d.Prefix && v.DateFormat == d.DateFormat && v.SeqDigits == d.SeqDigits && v.Reset == d.Reset
		v.Sample = numberingSample(v, now)
		out = append(out, v)
	}
	// 自定义里多出的未知 biz_type 原样带回（前端只回传服务端列表，理论不可达；
	// 保留是为了外部客户端写入的自定义规则不丢）。
	for _, item := range stored {
		if _, known := numberingDefaultOf(item.BizType); known {
			continue
		}
		item.Sample = numberingSample(item, now)
		out = append(out, item)
	}
	return out
}

func numberingDefaultOf(bizType string) (numberingRule, bool) {
	for _, d := range numberingDefaults {
		if d.BizType == bizType {
			return d, true
		}
	}
	return numberingRule{}, false
}

// storedNumberingRules 读取自定义覆盖（key=biz_type）。
func (s *Server) storedNumberingRules(r *http.Request) map[string]numberingRule {
	out := map[string]numberingRule{}
	rows, err := s.Store.Rows(r.Context(), "SELECT value FROM system_settings WHERE key=?", numberingSettingsKey)
	if err != nil || len(rows) == 0 {
		return out
	}
	var stored []numberingRule
	if json.Unmarshal([]byte(fmt.Sprint(rows[0]["value"])), &stored) != nil {
		return out
	}
	for _, item := range stored {
		if item.BizType == "" {
			continue
		}
		out[item.BizType] = item
	}
	return out
}

func numberingSample(v numberingRule, now time.Time) string {
	return v.Prefix + now.Format(v.DateFormat) + fmt.Sprintf("%0*d", v.SeqDigits, 1)
}

// numberingPreview: GET /api/v1/numbering-rules/preview?biz_types=a,b
// 下一号 = max(number_counters[前缀+日期段], 同前缀已用最大号[含软删除]) + 1。
func (s *Server) numberingPreview(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("biz_types"))
	if raw == "" {
		fail(w, 400, "请提供 biz_types（逗号分隔的业务对象）")
		return
	}
	seen := map[string]bool{}
	types := make([]string, 0, numberingMaxPreviewSize)
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		types = append(types, item)
	}
	if len(types) > numberingMaxPreviewSize {
		fail(w, 400, fmt.Sprintf("单次预览最多 %d 个业务对象", numberingMaxPreviewSize))
		return
	}
	byType := map[string]numberingRule{}
	for _, v := range s.numberingRules(r) {
		byType[v.BizType] = v
	}
	now := time.Now().In(numberingZone)
	out := map[string]string{}
	for _, bizType := range types {
		v, ok := byType[bizType]
		if !ok {
			continue
		}
		next, err := s.numberingNext(r, v, now)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		out[bizType] = next
	}
	respond(w, 200, out)
}

// numberingNext 计算某业务对象的下一个编号。
func (s *Server) numberingNext(r *http.Request, v numberingRule, now time.Time) (string, error) {
	key := v.Prefix + now.Format(v.DateFormat)
	max := int64(0)
	// 单据通道：number_counters（business.nextNumber 同键，逐位+1）。
	if rows, err := s.Store.Rows(r.Context(), "SELECT seq FROM number_counters WHERE prefix=?", key); err == nil && len(rows) > 0 {
		if n, e := strconv.ParseInt(fmt.Sprint(rows[0]["seq"]), 10, 64); e == nil && n > max {
			max = n
		}
	}
	// 主数据/落库单据通道：同前缀已用最大号（不过滤 deleted_at，绝不撞号）。
	if src, ok := numberingSources[v.BizType]; ok && s.Store.Has(src[0], src[1]) {
		column, table := database.Quote(src[1]), database.Quote(src[0])
		rows, err := s.Store.Rows(r.Context(),
			"SELECT "+column+" AS used FROM "+table+" WHERE "+column+" LIKE ? ESCAPE '\\'",
			numberingLikePattern(key))
		if err != nil {
			return "", err
		}
		for _, row := range rows {
			if n, ok := numberingTrailingSeq(fmt.Sprint(row["used"]), key); ok && n > max {
				max = n
			}
		}
	}
	// 位数不足时自动进位变长（前端提示：改 3 位、当天已到 999 不报错）。
	return key + fmt.Sprintf("%0*d", v.SeqDigits, max+1), nil
}

// numberingTrailingSeq 取 code 去掉 key 前缀后的数字流水（非数字后缀忽略）。
func numberingTrailingSeq(code, key string) (int64, bool) {
	if !strings.HasPrefix(code, key) {
		return 0, false
	}
	n, err := strconv.ParseInt(strings.TrimPrefix(code, key), 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// numberingLikePattern 转义 LIKE 通配符，保证前缀按字面匹配。
func numberingLikePattern(key string) string {
	escaped := strings.ReplaceAll(key, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, "%", `\%`)
	escaped = strings.ReplaceAll(escaped, "_", `\_`)
	return escaped + "%"
}

// numberingSave: PUT /api/v1/numbering-rules —— 整体保存自定义规则。
func (s *Server) numberingSave(w http.ResponseWriter, r *http.Request) {
	input, err := decode(w, r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	raw, ok := input["rules"]
	if !ok {
		fail(w, 400, "缺少 rules 参数")
		return
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		fail(w, 400, "rules 参数格式错误")
		return
	}
	var submitted []numberingRule
	if json.Unmarshal(encoded, &submitted) != nil {
		fail(w, 400, "rules 参数格式错误")
		return
	}
	rules := make([]numberingRule, 0, len(submitted))
	seen := map[string]bool{}
	for _, item := range submitted {
		item.BizType = strings.TrimSpace(item.BizType)
		if item.BizType == "" {
			fail(w, 400, "单号规则缺少业务对象标识")
			return
		}
		if seen[item.BizType] {
			continue
		}
		seen[item.BizType] = true
		if item.Prefix == "" || len([]rune(item.Prefix)) > 10 {
			fail(w, 400, "单号前缀不能为空且不超过 10 个字符")
			return
		}
		if item.SeqDigits < 3 || item.SeqDigits > 8 {
			fail(w, 400, "流水位数需在 3 到 8 之间")
			return
		}
		paired, ok := numberingDateFormats[item.Reset]
		if !ok {
			fail(w, 400, "重置策略无效")
			return
		}
		if item.DateFormat != paired {
			fail(w, 400, "日期段与重置策略不匹配")
			return
		}
		item.Label = strings.TrimSpace(item.Label)
		rules = append(rules, item)
	}
	stored, err := json.Marshal(rules)
	if err != nil {
		businessFailure(w, err, false)
		return
	}
	rows, err := s.Store.Rows(r.Context(), "SELECT id FROM system_settings WHERE key=?", numberingSettingsKey)
	if err != nil {
		businessFailure(w, err, false)
		return
	}
	if len(rows) > 0 {
		err = s.Store.Update(r.Context(), "system_settings", fmt.Sprint(rows[0]["id"]), map[string]any{"value": string(stored), "updated_at": database.Now()})
	} else {
		err = s.Store.Insert(r.Context(), "system_settings", map[string]any{"id": uuid.NewString(), "key": numberingSettingsKey, "value": string(stored), "created_at": database.Now(), "updated_at": database.Now()})
	}
	if err != nil {
		businessFailure(w, err, false)
		return
	}
	respond(w, 200, s.numberingRules(r))
}
