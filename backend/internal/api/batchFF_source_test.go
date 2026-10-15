package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

// 本文件固化批次 FF 取证（2026-10-14）的结论：
// 路由覆盖对账（tools/audit-route-coverage.mjs）查出「既有实现有、本实现无」的 94 条路径，
// 批次 FF 逐一补齐后重跑对账，缺口为 0（候选 1161｜两端都有 1113｜既有实现有本实现无 0）。
// 证据见 运行快照 与 audit-batch-ff-20261014.json。
//
// 覆盖的新增模块：
//	platform.go          审计日志/公司/字典/机器码/授权激活
//	metadata.go          元数据（实体/字段/布局/行业模板/字段权限/动态数据）
//	numbering.go         单号规则（65 条默认规则 + 预览 + 保存）
//	voucher_templates.go 凭证模板（列表 + 恢复默认分录）
//	print_templates.go   打印模板（列表/按类型/复制/CRUD）
//	commissions.go       销售佣金（配置/试算/结算单生成/标记付款）
//	dashboard_stream.go  看板 SSE
//	document_actions.go  申请/询价/合同/报价/订单的动作族
//	spu_actions.go       商品款批量生成 SKU
//	exportimport.go      导入导出（模板/数据/下载/导入）

// ── 单号规则 ─────────────────────────────────────────────────────────────────

// FF1：GET /numbering-rules 返回 65 条默认规则，且全部标记为 is_default。
func TestSourceNumberingRulesDefaults(t *testing.T) {
	c, _ := setup(t)
	list := c.ok("GET", "/api/v1/numbering-rules", nil).([]any)
	if len(list) != 65 {
		t.Fatalf("default numbering rules = %d, want 65", len(list))
	}
	seen := map[string]bool{}
	for _, raw := range list {
		rule := raw.(map[string]any)
		code := rule["biz_type"].(string)
		if seen[code] {
			t.Fatalf("duplicated biz_type %s", code)
		}
		seen[code] = true
		if rule["is_default"] != true {
			t.Fatalf("%s must be marked is_default", code)
		}
		if rule["prefix"] == "" || rule["sample"] == "" {
			t.Fatalf("%s missing prefix/sample: %v", code, rule)
		}
	}
	// 单据号 4 位流水、主数据 5 位流水（回归回放口径）
	if rule := numberingRuleOf(t, list, "sales_order"); rule["seq_digits"] != float64(4) {
		t.Fatalf("sales_order seq_digits=%v", rule["seq_digits"])
	}
	if rule := numberingRuleOf(t, list, "product"); rule["seq_digits"] != float64(5) {
		t.Fatalf("product seq_digits=%v", rule["seq_digits"])
	}
}

func numberingRuleOf(t *testing.T, list []any, bizType string) map[string]any {
	t.Helper()
	for _, raw := range list {
		if rule := raw.(map[string]any); rule["biz_type"] == bizType {
			return rule
		}
	}
	t.Fatalf("biz_type %s not found", bizType)
	return nil
}

// FF2：缺少 biz_types 时预览返回 400（文案逐字取自回归回放）；带上参数返回下一号。
func TestSourceNumberingPreviewRequiresBizTypes(t *testing.T) {
	c, _ := setup(t)
	status, body := c.request("GET", "/api/v1/numbering-rules/preview", nil)
	if status != 400 {
		t.Fatalf("status=%d body=%v", status, body)
	}
	if body["message"] != "请提供 biz_types（逗号分隔的业务对象）" {
		t.Fatalf("message=%v", body["message"])
	}
	data := c.ok("GET", "/api/v1/numbering-rules/preview?biz_types=sales_order,product", nil).(map[string]any)
	if _, ok := data["sales_order"]; !ok {
		t.Fatalf("preview missing sales_order: %v", data)
	}
	if _, ok := data["product"]; !ok {
		t.Fatalf("preview missing product: %v", data)
	}
}

// FF3：PUT /numbering-rules 保存自定义规则后，列表反映覆盖且 is_default 转假。
func TestSourceNumberingRulesSaveOverride(t *testing.T) {
	c, _ := setup(t)
	updated := c.ok("PUT", "/api/v1/numbering-rules", map[string]any{
		"rules": []any{map[string]any{"biz_type": "sales_order", "prefix": "XS", "date_format": "20060102", "seq_digits": 4, "reset": "daily"}},
	}).([]any)
	rule := numberingRuleOf(t, updated, "sales_order")
	if rule["prefix"] != "XS" {
		t.Fatalf("prefix not persisted: %v", rule)
	}
	if rule["is_default"] != false {
		t.Fatalf("overridden rule must not be is_default: %v", rule)
	}
	// 未覆盖的规则保持默认
	if other := numberingRuleOf(t, updated, "product"); other["is_default"] != true {
		t.Fatalf("untouched rule must stay default: %v", other)
	}
}

// FF4：非法规则（空前缀 / 流水位数越界）应被拒绝。
func TestSourceNumberingRulesRejectsInvalidInput(t *testing.T) {
	c, _ := setup(t)
	for _, rule := range []map[string]any{
		{"biz_type": "sales_order", "prefix": "", "seq_digits": 4, "reset": "daily", "date_format": "20060102"},
		{"biz_type": "sales_order", "prefix": "XS", "seq_digits": 2, "reset": "daily", "date_format": "20060102"},
		{"biz_type": "", "prefix": "XS", "seq_digits": 4, "reset": "daily", "date_format": "20060102"},
	} {
		status, _ := c.request("PUT", "/api/v1/numbering-rules", map[string]any{"rules": []any{rule}})
		if status != 400 {
			t.Fatalf("invalid rule accepted: %v", rule)
		}
	}
}

// ── 凭证模板 ─────────────────────────────────────────────────────────────────

// FF5：凭证模板列表按 code 升序，形状与回归回放一致（无 edges、无外键列）。
func TestSourceVoucherTemplateList(t *testing.T) {
	c, _ := setup(t)
	list := c.ok("GET", "/api/v1/voucher-templates", nil).([]any)
	if len(list) != 5 {
		t.Fatalf("voucher templates = %d, want 5", len(list))
	}
	codes := []string{}
	for _, raw := range list {
		tpl := raw.(map[string]any)
		codes = append(codes, tpl["code"].(string))
		if _, ok := tpl["edges"]; ok {
			t.Fatalf("voucher template must not carry edges: %v", tpl)
		}
		if _, ok := tpl["entries"]; !ok {
			t.Fatalf("voucher template missing entries: %v", tpl)
		}
	}
	want := []string{"VT-AR-INVOICE", "VT-PURCHASE-IN", "VT-PURCHASE-RETURN", "VT-SALES-OUT", "VT-SALES-RETURN"}
	for i := range want {
		if codes[i] != want[i] {
			t.Fatalf("order mismatch at %d: %v", i, codes)
		}
	}
}

// FF6：恢复默认——改坏分录后 reset 应回到官方分录。
func TestSourceVoucherTemplateReset(t *testing.T) {
	c, _ := setup(t)
	list := c.ok("GET", "/api/v1/voucher-templates", nil).([]any)
	target := list[1].(map[string]any)
	id := target["id"].(string)
	broken := c.ok("PUT", "/api/v1/voucher-templates/"+id, map[string]any{
		"entries": []any{map[string]any{"account_code": "9999", "account_name": "乱写的科目", "direction": "debit"}},
	}).(map[string]any)
	if got := broken["entries"].([]any); len(got) != 1 {
		t.Fatalf("custom entries not persisted: %v", got)
	}
	restored := c.ok("POST", "/api/v1/voucher-templates/"+id+"/reset", nil).(map[string]any)
	entries := restored["entries"].([]any)
	if len(entries) != 3 {
		t.Fatalf("reset must restore the official 3 entries, got %d", len(entries))
	}
	first := entries[0].(map[string]any)
	if first["account_code"] != "1403" || first["direction"] != "debit" {
		t.Fatalf("reset did not restore the official entry: %v", first)
	}
}

// ── 打印模板 ─────────────────────────────────────────────────────────────────

// FF7：打印模板 CRUD + 按类型取默认 + 复制。
func TestSourcePrintTemplates(t *testing.T) {
	c, _ := setup(t)
	created := c.ok("POST", "/api/v1/print-templates", map[string]any{
		"doc_type": "sales_order", "name": "FF 测试模板", "paper_size": "A4",
	}).(map[string]any)
	id := created["id"].(string)
	if created["doc_type"] != "sales_order" {
		t.Fatalf("doc_type not persisted: %v", created)
	}
	list := c.ok("GET", "/api/v1/print-templates?doc_type=sales_order", nil).([]any)
	if len(list) == 0 {
		t.Fatal("filtered list is empty")
	}
	byType := c.ok("GET", "/api/v1/print-templates/by-type/sales_order", nil).(map[string]any)
	if byType["id"] == nil {
		t.Fatal("by-type returned no template")
	}
	dup := c.ok("POST", "/api/v1/print-templates/"+id+"/duplicate", nil).(map[string]any)
	if dup["id"] == id {
		t.Fatal("duplicate must create a new record")
	}
	if !strings.Contains(dup["name"].(string), "副本") {
		t.Fatalf("duplicate name not marked: %v", dup["name"])
	}
	if dup["is_default"] != nil {
		t.Fatalf("duplicate must not inherit is_default: %v", dup)
	}
	c.ok("PUT", "/api/v1/print-templates/"+id, map[string]any{"name": "FF 改名"})
	updated := c.ok("GET", "/api/v1/print-templates/"+id, nil).(map[string]any)
	if updated["name"] != "FF 改名" {
		t.Fatalf("rename failed: %v", updated)
	}
	c.ok("DELETE", "/api/v1/print-templates/"+id, nil)
	if status, _ := c.request("GET", "/api/v1/print-templates/"+id, nil); status != 404 {
		t.Fatalf("deleted template still readable: %d", status)
	}
	// 缺 doc_type 的 by-type（无参）按参数缺失处理
	if status, _ := c.request("GET", "/api/v1/print-templates/by-type", nil); status != 400 {
		t.Fatal("by-type without doc_type must report a missing parameter")
	}
}

// ── 销售佣金 ─────────────────────────────────────────────────────────────────

// FF8：佣金配置按业务员去重（同一业务员只保留一条），试算覆盖配置与全局默认。
func TestSourceCommissionConfigAndCalculate(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "FF-COMM")
	srcSeedStock(t, c, product, warehouse, 100, 10)
	cfg := c.ok("POST", "/api/v1/sales-commissions/configs", map[string]any{"rate": 5}).(map[string]any)
	again := c.ok("POST", "/api/v1/sales-commissions/configs", map[string]any{"rate": 8}).(map[string]any)
	if cfg["id"] != again["id"] {
		t.Fatal("global default config must be upserted, not duplicated")
	}
	list := c.ok("GET", "/api/v1/sales-commissions/configs", nil).([]any)
	if len(list) != 1 {
		t.Fatalf("configs = %d, want 1", len(list))
	}

	customer := party["customer"].(map[string]any)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": customer["id"], "warehouse_id": warehouse["id"], "salesperson_id": firstUserID(c),
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 2, "price": 100}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)

	results := c.ok("GET", "/api/v1/sales-commissions/calculate?base=revenue", nil).([]any)
	if len(results) == 0 {
		t.Fatal("commission calculation produced no rows")
	}
	row := results[0].(map[string]any)
	if row["rate"] != "8" {
		t.Fatalf("rate not taken from the config: %v", row)
	}
	// 销售额 2×100=200，佣金率 8% → 16
	if row["sales_amount"] != "200" {
		t.Fatalf("sales_amount=%v", row["sales_amount"])
	}
	if row["commission"] != "16" {
		t.Fatalf("commission=%v", row["commission"])
	}
}

// FF9：结算单生成 → 标记付款；已付款不允许重复标记，也不允许删除。
func TestSourceCommissionSettlementLifecycle(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "FF-SETTLE")
	srcSeedStock(t, c, product, warehouse, 100, 10)
	c.ok("POST", "/api/v1/sales-commissions/configs", map[string]any{"rate": 10})
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "salesperson_id": firstUserID(c),
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 100}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)

	period := "2026-10"
	generated := c.ok("POST", "/api/v1/sales-commissions/settlements/generate", map[string]any{"period": period, "base": "revenue"}).(map[string]any)
	if generated["created"] != float64(1) {
		t.Fatalf("created=%v", generated["created"])
	}
	rows := c.ok("GET", "/api/v1/sales-commissions/settlements?period="+period, nil).(map[string]any)
	list := rows["list"].([]any)
	if len(list) != 1 {
		t.Fatalf("settlements = %d", len(list))
	}
	settlement := list[0].(map[string]any)
	if settlement["status"] != "unpaid" {
		t.Fatalf("status=%v", settlement["status"])
	}
	// 同期间同基数不重复生成
	again := c.ok("POST", "/api/v1/sales-commissions/settlements/generate", map[string]any{"period": period, "base": "revenue"}).(map[string]any)
	if again["created"] != float64(0) {
		t.Fatalf("duplicate generation created=%v", again["created"])
	}
	paid := c.ok("POST", "/api/v1/sales-commissions/settlements/"+settlement["id"].(string)+"/paid", nil).(map[string]any)
	if paid["status"] != "paid" || paid["paid_at"] == nil {
		t.Fatalf("mark paid failed: %v", paid)
	}
	if status, _ := c.request("POST", "/api/v1/sales-commissions/settlements/"+settlement["id"].(string)+"/paid", nil); status != 400 {
		t.Fatal("double payment must be rejected")
	}
	if status, _ := c.request("DELETE", "/api/v1/sales-commissions/settlements/"+settlement["id"].(string), nil); status != 400 {
		t.Fatal("paid settlement must not be deletable")
	}
}

// ── 单据动作族 ───────────────────────────────────────────────────────────────

// FF10：采购申请 草稿 → 提交 → 审批 → 转采购订单（明细带建议供应商）。
func TestSourceRequisitionLifecycle(t *testing.T) {
	c, product, _, party := testFixture(t, "FF-REQ")
	supplier := party["supplier"].(map[string]any)
	req := c.ok("POST", "/api/v1/purchase-requisitions", map[string]any{
		"department": "生产部",
		"lines": []any{map[string]any{
			"product_id": product["id"], "qty": 3, "suggested_price": 12,
			"suggested_supplier_id": supplier["id"], "suggested_supplier_name": supplier["name"],
		}},
	}).(map[string]any)
	path := "/api/v1/purchase-requisitions/" + req["id"].(string)
	// 草稿不能直接审批
	if status, _ := c.request("POST", path+"/approve", nil); status != 400 {
		t.Fatal("approving a draft requisition must be rejected")
	}
	if s := c.ok("POST", path+"/submit", nil).(map[string]any); s["status"] != "submitted" {
		t.Fatalf("submit failed: %v", s)
	}
	if s := c.ok("POST", path+"/approve", nil).(map[string]any); s["status"] != "approved" {
		t.Fatalf("approve failed: %v", s)
	}
	order := c.ok("POST", path+"/convert", nil).(map[string]any)
	if order["order_no"] == nil {
		t.Fatalf("convert did not create a purchase order: %v", order)
	}
	if after := c.ok("GET", path, nil).(map[string]any); after["status"] != "converted" {
		t.Fatalf("requisition status after convert=%v", after["status"])
	}
	// 已转订单不能再转
	if status, _ := c.request("POST", path+"/convert", nil); status != 400 {
		t.Fatal("converted requisition must not convert again")
	}
}

// FF11：销售报价 草稿 → 发送 → 接受 → 转销售订单。
func TestSourceSalesQuotationLifecycle(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "FF-QUOTE")
	srcSeedStock(t, c, product, warehouse, 100, 10)
	customer := party["customer"].(map[string]any)
	quote := c.ok("POST", "/api/v1/sales-quotations", map[string]any{
		"customer_id": customer["id"],
		"lines":       []any{map[string]any{"product_id": product["id"], "qty": 2, "price": 30}},
	}).(map[string]any)
	path := "/api/v1/sales-quotations/" + quote["id"].(string)
	if status, _ := c.request("POST", path+"/accept", nil); status != 400 {
		t.Fatal("accepting a draft quotation must be rejected")
	}
	if s := c.ok("POST", path+"/send", nil).(map[string]any); s["status"] != "sent" {
		t.Fatalf("send failed: %v", s)
	}
	if s := c.ok("POST", path+"/accept", nil).(map[string]any); s["status"] != "accepted" {
		t.Fatalf("accept failed: %v", s)
	}
	order := c.ok("POST", path+"/convert", nil).(map[string]any)
	if order["order_no"] == nil {
		t.Fatalf("convert did not create a sales order: %v", order)
	}
}

// FF12：合同 草稿 → 生效 → 完成；已取消不能再生效。
func TestSourceContractLifecycle(t *testing.T) {
	c, _, _, party := testFixture(t, "FF-CONTRACT")
	supplier := party["supplier"].(map[string]any)
	for _, route := range []string{"/api/v1/purchase-contracts", "/api/v1/sales-contracts"} {
		body := map[string]any{"contract_no": "FF-C-1", "total_amount": 100, "remark": "x"}
		if route == "/api/v1/purchase-contracts" {
			body["supplier_id"] = supplier["id"]
		} else {
			body["customer_id"] = party["customer"].(map[string]any)["id"]
		}
		contract := c.ok("POST", route, body).(map[string]any)
		path := route + "/" + contract["id"].(string)
		if status, _ := c.request("POST", path+"/complete", nil); status != 400 {
			t.Fatalf("%s: completing a draft must be rejected", route)
		}
		if s := c.ok("POST", path+"/activate", nil).(map[string]any); s["status"] != "active" {
			t.Fatalf("%s activate failed: %v", route, s)
		}
		if s := c.ok("POST", path+"/complete", nil).(map[string]any); s["status"] != "completed" {
			t.Fatalf("%s complete failed: %v", route, s)
		}
	}
}

// FF13：销售订单 备货 → 物流单号；变更留审计链且必须带原因。
func TestSourceSalesOrderChangeAndFulfillment(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "FF-SO")
	srcSeedStock(t, c, product, warehouse, 100, 10)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 2, "price": 50}},
	}).(map[string]any)
	path := "/api/v1/sales-orders/" + order["id"].(string)
	// 草稿不能备货/变更
	if status, _ := c.request("POST", path+"/preparing", nil); status != 400 {
		t.Fatal("preparing a draft order must be rejected")
	}
	c.ok("POST", path+"/confirm", nil)
	if s := c.ok("POST", path+"/preparing", nil).(map[string]any); s["customer_progress"] != "preparing" {
		t.Fatalf("preparing failed: %v", s)
	}
	tracked := c.ok("POST", path+"/tracking", map[string]any{"tracking_no": "SF123456"}).(map[string]any)
	if tracked["tracking_no"] != "SF123456" {
		t.Fatalf("tracking_no not saved: %v", tracked)
	}
	if tracked["customer_progress"] != "shipped" {
		t.Fatalf("tracking must advance progress to shipped: %v", tracked)
	}
	// 变更：缺原因被拒
	if status, _ := c.request("POST", path+"/change", map[string]any{
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 5, "price": 50}},
	}); status != 400 {
		t.Fatal("changing without a reason must be rejected")
	}
	changed := c.ok("POST", path+"/change", map[string]any{
		"reason": "客户加单",
		"lines":  []any{map[string]any{"product_id": product["id"], "qty": 5, "price": 50}},
	}).(map[string]any)
	if changed["total_qty"] != "5" {
		t.Fatalf("change did not update totals: %v", changed)
	}
	history := c.ok("GET", path+"/changes", nil).([]any)
	if len(history) != 1 {
		t.Fatalf("change history = %d", len(history))
	}
	entry := history[0].(map[string]any)
	if entry["reason"] != "客户加单" || entry["order_no"] == nil {
		t.Fatalf("change log incomplete: %v", entry)
	}
	// 关闭需先审核
	c.ok("POST", path+"/approve", nil)
	if s := c.ok("POST", path+"/close", nil).(map[string]any); s["status"] != "closed" {
		t.Fatalf("close failed: %v", s)
	}
}

// FF14：询价单 确认 → 录入报价 → 选标 → 转采购订单（带报价）。
func TestSourceRfqQuoteAndConvert(t *testing.T) {
	c, product, _, party := testFixture(t, "FF-RFQ")
	supplier := party["supplier"].(map[string]any)
	rfq := c.ok("POST", "/api/v1/purchase-rfqs", map[string]any{
		"supplier_id": supplier["id"], "supplier_name": supplier["name"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 4, "quoted_price": 9}},
	}).(map[string]any)
	path := "/api/v1/purchase-rfqs/" + rfq["id"].(string)
	// 回归回放 GG10/GG11（2026-10-14）：草稿询价单转单返回 HTTP 200 + code 10000
	// 「只有已确认的询价单才能转采购订单」，不是 400
	if status, body := c.request("POST", path+"/convert", nil); status != 200 ||
		body["code"] != float64(10000) || body["message"] != "只有已确认的询价单才能转采购订单" {
		t.Fatalf("draft rfq convert = %d %v", status, body)
	}
	if s := c.ok("POST", path+"/confirm", nil).(map[string]any); s["status"] != "confirmed" {
		t.Fatalf("confirm failed: %v", s)
	}
	quote := c.ok("POST", path+"/quotes", map[string]any{
		"supplier_id": supplier["id"], "supplier_name": supplier["name"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 4, "price": 8}},
	}).(map[string]any)
	quotes := c.ok("GET", path+"/quotes", nil).([]any)
	if len(quotes) != 1 {
		t.Fatalf("quotes = %d", len(quotes))
	}
	selected := c.ok("POST", path+"/quotes/"+quote["id"].(string)+"/select", nil).(map[string]any)
	if selected["status"] != "selected" {
		t.Fatalf("select failed: %v", selected)
	}
	order := c.ok("POST", path+"/convert", map[string]any{"quote_id": quote["id"]}).(map[string]any)
	if order["order_no"] == nil {
		t.Fatalf("convert did not create a purchase order: %v", order)
	}
	after := c.ok("GET", path, nil).(map[string]any)
	if after["status"] != "converted" || after["converted_po_no"] != order["order_no"] {
		t.Fatalf("rfq not stamped with the converted order: %v", after)
	}
}

// ── SPU 批量生成 SKU ────────────────────────────────────────────────────────

// FF15：款下按 颜色×尺码 生成 SKU；重复生成时 skip_existing 生效。
func TestSourceSpuGenerateSkus(t *testing.T) {
	c, _ := setup(t)
	spu := c.ok("POST", "/api/v1/spus", map[string]any{
		"code": "SPU-FF", "name": "测试款",
		"dims": []any{
			map[string]any{"code": "color", "name": "颜色", "values": []any{"红", "蓝"}},
			map[string]any{"code": "size", "name": "尺码", "values": []any{"S", "L"}},
		},
	}).(map[string]any)
	path := "/api/v1/spus/" + spu["id"].(string) + "/skus"
	first := c.ok("POST", path, map[string]any{"sale_price": 99}).(map[string]any)
	if first["created"] != float64(4) {
		t.Fatalf("created=%v want 4", first["created"])
	}
	// 既有实现口径（回放 GG11/MM，2026-10-14）：code = 款号-两位流水，spec = 值用 "/" 连接
	codes := first["codes"].([]any)
	for i, code := range codes {
		if code != fmt.Sprintf("%s-%02d", spu["code"], i+1) {
			t.Fatalf("codes=%v want 款号-两位流水", codes)
		}
	}
	list := c.ok("GET", "/api/v1/products?keyword=SPU-FF", nil).(map[string]any)
	for _, raw := range list["list"].([]any) {
		row := raw.(map[string]any)
		if row["name"] != "测试款" {
			t.Fatalf("sku name = %v, want 款名本身", row["name"])
		}
		if row["spec"] != "红/S" && row["spec"] != "红/L" && row["spec"] != "蓝/S" && row["spec"] != "蓝/L" {
			t.Fatalf("sku spec = %v, want 维度值用 / 连接", row["spec"])
		}
	}
	// 未勾 skip_existing 时重复生成：既有实现返回 HTTP 200 + code 10000「规格组合已存在: 红/S（…）」
	if status, body := c.request("POST", path, map[string]any{"sale_price": 99}); status != 200 ||
		body["code"] != float64(10000) || body["message"] != "规格组合已存在: 红/S（如需补建请勾选跳过已存在）" {
		t.Fatalf("regenerate without skip_existing = %d %v", status, body)
	}
	second := c.ok("POST", path, map[string]any{"sale_price": 99, "skip_existing": true}).(map[string]any)
	if second["created"] != float64(0) || second["skipped"] != float64(4) {
		t.Fatalf("skip_existing result = %v", second)
	}
	// 无维度的款不能生成
	plain := c.ok("POST", "/api/v1/spus", map[string]any{"code": "SPU-FF2", "name": "无维度款"}).(map[string]any)
	if status, _ := c.request("POST", "/api/v1/spus/"+plain["id"].(string)+"/skus", map[string]any{}); status != 400 {
		t.Fatal("a spu without dims must not generate skus")
	}
}

// ── 导入导出 ─────────────────────────────────────────────────────────────────

// FF16：模板下载（CSV/XLSX）、数据导出两步式、文件取回。
func TestSourceExportTemplateAndDownload(t *testing.T) {
	c, _ := setup(t)
	for _, kind := range []string{"customers", "products", "units", "warehouses", "locations", "racks", "skus", "users", "opening-stock"} {
		for _, format := range []string{"csv", "xlsx"} {
			status, _, payload := c.raw("GET", "/api/v1/export/"+kind+"-template?format="+format, nil)
			if status != 200 {
				t.Fatalf("%s-%s template: %d", kind, format, status)
			}
			if len(payload) == 0 {
				t.Fatalf("%s-%s template is empty", kind, format)
			}
			if format == "xlsx" && !bytes.HasPrefix(payload, []byte("PK")) {
				t.Fatalf("%s xlsx is not a zip container", kind)
			}
			if format == "csv" && !bytes.HasPrefix(payload, []byte("\xEF\xBB\xBF")) {
				t.Fatalf("%s csv missing UTF-8 BOM", kind)
			}
		}
	}
	result := c.ok("GET", "/api/v1/export/customers?format=csv", nil).(map[string]any)
	filename, _ := result["filename"].(string)
	if filename == "" || !strings.HasSuffix(filename, ".csv") {
		t.Fatalf("export did not return a filename: %v", result)
	}
	status, _, payload := c.raw("GET", "/api/v1/export/download/"+filename, nil)
	if status != 200 || len(payload) == 0 {
		t.Fatalf("download %s: %d", filename, status)
	}
	// 不存在的下载文件 → 404
	if status, _ := c.request("GET", "/api/v1/export/download/nope.csv", nil); status != 404 {
		t.Fatalf("unknown export file must be 404, got %d", status)
	}
	// 不支持的格式 → 400
	if status, _ := c.request("GET", "/api/v1/export/customers?format=pdf", nil); status != 400 {
		t.Fatalf("unsupported format must be 400, got %d", status)
	}
}

// FF17：客户导入 —— 新建 / 同名策略 / 预览不落库。
func TestSourceImportCustomers(t *testing.T) {
	c, _ := setup(t)
	csv := "\xEF\xBB\xBF编码,名称,联系人,电话,邮箱,地址,分类名称,信用额度,信用余额,账期(天),税号,银行账号,备注\n" +
		"C-FF1,甲客户,张三,13800000000,,地址一,,,0,0,0,,,\n" +
		"C-FF2,乙客户,李四,13800000001,,地址二,,,0,0,0,,,\n"
	res := c.upload("/api/v1/import/customers", "customers.csv", []byte(csv), nil)
	if res["success"] != float64(2) || res["failed"] != float64(0) {
		t.Fatalf("import result=%v", res)
	}
	list := c.ok("GET", "/api/v1/customers?page_size=50", nil).(map[string]any)["list"].([]any)
	if len(list) != 2 {
		t.Fatalf("customers=%d", len(list))
	}
	// 同名 skip：重复导入同一文件应全部跳过
	skip := c.upload("/api/v1/import/customers", "customers.csv", []byte(csv), map[string]string{"on_duplicate": "skip"})
	if skip["skipped"] != float64(2) || skip["success"] != float64(0) {
		t.Fatalf("skip result=%v", skip)
	}
	// 同名 update：用非空列更新（备注从空改为「已更新」）
	updateCSV := "编码,名称,联系人,电话,邮箱,地址,分类名称,信用额度,信用余额,账期(天),税号,银行账号,备注\n" +
		"C-FF1,甲客户,,,,,,,,,,已更新\n"
	upd := c.upload("/api/v1/import/customers", "u.csv", []byte(updateCSV), map[string]string{"on_duplicate": "update"})
	if upd["updated"] != float64(1) {
		t.Fatalf("update result=%v", upd)
	}
	// 预览：dry_run 不落库
	dry := c.upload("/api/v1/import/customers", "d.csv", []byte("编码,名称\nC-FF9,丙客户\n"), map[string]string{"dry_run": "true"})
	if dry["dry_run"] != true || dry["success"] != float64(1) {
		t.Fatalf("dry_run result=%v", dry)
	}
	found := c.ok("GET", "/api/v1/customers?code=C-FF9", nil).(map[string]any)
	if total, _ := found["total"].(float64); total != 0 {
		t.Fatalf("dry_run must not write: total=%v", total)
	}
}

// ── 平台 ─────────────────────────────────────────────────────────────────────

// FF18：字典类型聚合与条目 CRUD；机器码恒有输出；公开公司与控制台公司清单。
func TestSourcePlatformSurfaces(t *testing.T) {
	c, _ := setup(t)
	created := c.ok("POST", "/api/v1/dict/types", map[string]any{
		"type_code": "ff_type", "type_name": "FF 字典", "first_item_code": "A", "first_item_name": "选项A",
	}).(map[string]any)
	if created["type_code"] != "ff_type" {
		t.Fatalf("dict type create: %v", created)
	}
	types := c.ok("GET", "/api/v1/dict/types", nil).([]any)
	found := false
	for _, raw := range types {
		if item := raw.(map[string]any); item["type_code"] == "ff_type" {
			found = true
			if item["count"] != float64(1) {
				t.Fatalf("count=%v", item["count"])
			}
		}
	}
	if !found {
		t.Fatalf("dict type not listed: %v", types)
	}
	items := c.ok("GET", "/api/v1/dict/items?type_code=ff_type", nil).([]any)
	if len(items) != 1 {
		t.Fatalf("items=%d", len(items))
	}
	if status, _ := c.request("GET", "/api/v1/dict/items", nil); status != 400 {
		t.Fatal("dict items without type_code must be rejected")
	}
	machine := c.ok("GET", "/api/v1/license/machine-code", nil).(map[string]any)
	if machine["machine_code"] == "" {
		t.Fatalf("machine_code empty: %v", machine)
	}
	// 公开公司信息免认证：不带 token 也要能取到（data.company 缺省为空对象）
	status, publicBody := c.request("GET", "/api/v1/public/company", nil)
	if status != 200 {
		t.Fatalf("public company: %d %v", status, publicBody)
	}
	if _, ok := publicBody["data"].(map[string]any)["company"]; !ok {
		t.Fatalf("public company shape: %v", publicBody)
	}
	companies := c.ok("GET", "/api/v1/console/companies", nil).([]any)
	if len(companies) != 1 {
		t.Fatalf("console companies=%d", len(companies))
	}
	logs := c.ok("GET", "/api/v1/audit-logs", nil).(map[string]any)
	if _, ok := logs["list"]; !ok {
		t.Fatalf("audit logs shape: %v", logs)
	}
}

// firstUserID 取第一个用户（种子管理员）的 id，用于把订单挂到业务员名下。
func firstUserID(c *client) string {
	c.t.Helper()
	list := c.ok("GET", "/api/v1/users?page_size=1", nil).(map[string]any)["list"].([]any)
	return list[0].(map[string]any)["id"].(string)
}

// ── 测试端辅助：原始字节请求与 multipart 上传 ─────────────────────────────────

func (c *client) raw(method, route string, body any) (int, http.Header, []byte) {
	c.t.Helper()
	req, err := http.NewRequest(method, c.server.URL+route, nil)
	if err != nil {
		c.t.Fatal(err)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(res.Body); err != nil {
		c.t.Fatal(err)
	}
	return res.StatusCode, res.Header, buf.Bytes()
}

func (c *client) upload(route, filename string, payload []byte, fields map[string]string) map[string]any {
	c.t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		c.t.Fatal(err)
	}
	if _, err = part.Write(payload); err != nil {
		c.t.Fatal(err)
	}
	for key, value := range fields {
		if err = writer.WriteField(key, value); err != nil {
			c.t.Fatal(err)
		}
	}
	if err = writer.Close(); err != nil {
		c.t.Fatal(err)
	}
	req, err := http.NewRequest("POST", c.server.URL+route, &body)
	if err != nil {
		c.t.Fatal(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var decoded map[string]any
	if err := json.NewDecoder(res.Body).Decode(&decoded); err != nil {
		c.t.Fatal(err)
	}
	status := res.StatusCode
	if status != 200 || decoded["code"] != float64(0) {
		c.t.Fatalf("upload %s: %d %v", route, status, decoded)
	}
	data, _ := decoded["data"].(map[string]any)
	return data
}
