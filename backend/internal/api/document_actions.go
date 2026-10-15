package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/business"
	"la-erp/backend/internal/database"
)

// docActionSpec 描述一个「改状态」类单据动作：
// 只有 from 列表中的原状态允许执行，执行后落到 to。
type docActionSpec struct {
	route  string
	table  string
	label  string
	perm   string
	action string
	from   []string
	to     string
}

func (s *Server) registerDocumentActions() {
	// ── 采购申请：草稿 → 待审批 → 已审批 / 已驳回，审批通过后可转采购订单 ──────────
	for _, spec := range []docActionSpec{
		{"purchase-requisitions", "purchase_requisitions", "采购申请", "purchase_requisition_edit", "submit", []string{"draft"}, "submitted"},
		{"purchase-requisitions", "purchase_requisitions", "采购申请", "purchase_requisition_edit", "approve", []string{"submitted"}, "approved"},
		{"purchase-requisitions", "purchase_requisitions", "采购申请", "purchase_requisition_edit", "reject", []string{"submitted"}, "rejected"},
		{"purchase-requisitions", "purchase_requisitions", "采购申请", "purchase_requisition_edit", "cancel", []string{"draft", "submitted"}, "cancelled"},
	} {
		s.registerStatusAction(spec)
	}
	s.mux.Handle("POST /api/v1/purchase-requisitions/{id}/convert", s.protected("purchase_order_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "purchase_requisitions", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "采购申请")
			return
		}
		if text(row, "status") != "approved" {
			fail(w, 400, "只有已审批的采购申请可以转采购订单")
			return
		}
		lines, err := s.Store.Rows(r.Context(), "SELECT * FROM purchase_requisition_lines WHERE requisition_id=? AND deleted_at IS NULL ORDER BY line_no", text(row, "id"))
		if err != nil {
			s.failure(w, err, "采购申请")
			return
		}
		if len(lines) == 0 {
			fail(w, 400, "采购申请没有明细，无法生成采购订单")
			return
		}
		supplier := ""
		items := make([]any, 0, len(lines))
		for _, line := range lines {
			if supplier == "" {
				supplier = text(line, "suggested_supplier_id")
			}
			items = append(items, map[string]any{
				"product_id": text(line, "product_id"),
				"qty":        line["qty"],
				"price":      line["suggested_price"],
			})
		}
		if supplier == "" {
			fail(w, 400, "申请明细缺少建议供应商，无法生成采购订单")
			return
		}
		input := map[string]any{
			"supplier_id": supplier,
			"lines":       items,
			"remark":      "由采购申请 " + text(row, "requisition_no") + " 生成",
		}
		data, err := s.business().Create(r.Context(), business.Documents["purchase-orders"], input, current(r).UserID)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "purchase_requisitions", text(row, "id"), map[string]any{"status": "converted", "updated_at": now}); err != nil {
			s.failure(w, err, "采购申请")
			return
		}
		respond(w, 200, data)
	})))

	// ── 采购询价：草稿 → 已确认 → 已转订单 / 已取消，含报价录入与选标 ──────────────
	for _, spec := range []docActionSpec{
		{"purchase-rfqs", "purchase_rf_qs", "询价单", "purchase_rfq_edit", "confirm", []string{"draft"}, "confirmed"},
		{"purchase-rfqs", "purchase_rf_qs", "询价单", "purchase_rfq_edit", "cancel", []string{"draft", "confirmed"}, "cancelled"},
	} {
		s.registerStatusAction(spec)
	}
	s.mux.Handle("POST /api/v1/purchase-rfqs/{id}/convert", s.protected("purchase_order_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "purchase_rf_qs", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "询价单")
			return
		}
		if text(row, "status") != "confirmed" {
			verbatimFailure(w, verbatim{text: "只有已确认的询价单才能转采购订单"})
			return
		}
		body, _ := decode(w, r)
		if body == nil {
			body = map[string]any{}
		}
		quoteID := text(body, "quote_id")
		supplier := text(row, "supplier_id")
		items := []any{}
		if quoteID != "" {
			quote, err := s.Store.Get(r.Context(), "purchase_rfq_quotes", quoteID)
			if err != nil || text(quote, "rfq_id") != text(row, "id") {
				verbatimFailure(w, verbatim{text: "报价不存在"})
				return
			}
			if supplier == "" {
				supplier = text(quote, "supplier_id")
			}
			lines, err := s.Store.Rows(r.Context(), "SELECT * FROM purchase_rfq_quote_lines WHERE quote_id=? AND deleted_at IS NULL ORDER BY line_no", quoteID)
			if err != nil {
				s.failure(w, err, "询价单")
				return
			}
			for _, line := range lines {
				items = append(items, map[string]any{
					"product_id": text(line, "product_id"),
					"qty":        line["qty"],
					"price":      line["price"],
				})
			}
		} else {
			lines, err := s.Store.Rows(r.Context(), "SELECT * FROM purchase_rfq_lines WHERE rfq_id=? AND deleted_at IS NULL ORDER BY line_no", text(row, "id"))
			if err != nil {
				s.failure(w, err, "询价单")
				return
			}
			for _, line := range lines {
				items = append(items, map[string]any{
					"product_id": text(line, "product_id"),
					"qty":        line["qty"],
					"price":      line["quoted_price"],
				})
			}
		}
		if supplier == "" {
			fail(w, 400, "询价单缺少供应商，无法生成采购订单")
			return
		}
		if len(items) == 0 {
			fail(w, 400, "询价单没有明细，无法生成采购订单")
			return
		}
		input := map[string]any{
			"supplier_id": supplier,
			"lines":       items,
			"remark":      "由询价单 " + text(row, "rfq_no") + " 生成",
		}
		data, err := s.business().Create(r.Context(), business.Documents["purchase-orders"], input, current(r).UserID)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "purchase_rf_qs", text(row, "id"), map[string]any{
			"status":          "converted",
			"converted_at":    now,
			"converted_po_id": text(data, "id"),
			"converted_po_no": text(data, "order_no"),
			"updated_at":      now,
		}); err != nil {
			s.failure(w, err, "询价单")
			return
		}
		respond(w, 200, data)
	})))
	// 报价：列表 / 录入 / 选标 / 删除
	s.mux.Handle("GET /api/v1/purchase-rfqs/{id}/quotes", s.protected("purchase_rfq", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM purchase_rfq_quotes WHERE rfq_id=? AND deleted_at IS NULL ORDER BY created_at", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "询价报价")
			return
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			items = append(items, s.rfqQuoteView(r, row))
		}
		respond(w, 200, items)
	})))
	s.mux.Handle("POST /api/v1/purchase-rfqs/{id}/quotes", s.protected("purchase_rfq_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rfq, err := s.Store.Get(r.Context(), "purchase_rf_qs", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "询价单")
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		// 原版回放（2026-10-14，audit-batch-gg/gg2/gg14）：草稿询价单录入报价一律拒绝。
		if text(rfq, "status") != "confirmed" {
			verbatimFailure(w, verbatim{text: "只有已确认的询价单才能录入供应商报价"})
			return
		}
		if text(body, "supplier_id") == "" {
			fail(w, 400, "请求参数错误: Key: 'createQuoteRequest.SupplierID' Error:Field validation for 'SupplierID' failed on the 'required' tag")
			return
		}
		raw, _ := body["lines"].([]any)
		if len(raw) == 0 {
			verbatimFailure(w, verbatim{text: "报价明细不能为空"})
			return
		}
		now := database.Now()
		quoteID := uuid.NewString()
		total := decimal.Zero
		lines := make([]map[string]any, 0, len(raw))
		for i, item := range raw {
			line, ok := item.(map[string]any)
			if !ok {
				fail(w, 400, "报价明细格式错误")
				return
			}
			qty, err := business.Number(line["qty"])
			if err != nil || !qty.IsPositive() {
				verbatimFailure(w, verbatim{text: "报价明细数量必须大于 0"})
				return
			}
			// 原版放行负单价（回放 gg14：price=-1 仍 code:0），恢复端此前拒绝属误拒
			price, _ := business.Number(line["price"])
			product, err := s.Store.Get(r.Context(), "products", text(line, "product_id"))
			if err != nil {
				verbatimFailure(w, verbatim{text: "报价明细缺少商品"})
				return
			}
			amount := qty.Mul(price)
			total = total.Add(amount)
			lines = append(lines, map[string]any{
				"id":           uuid.NewString(),
				"created_at":   now,
				"updated_at":   now,
				"deleted_at":   nil,
				"line_no":      i + 1,
				"product_id":   text(product, "id"),
				"product_name": text(product, "name"),
				"product_code": text(product, "code"),
				"spec":         text(product, "spec"),
				"qty":          qty.String(),
				"price":        price.String(),
				"amount":       amount.String(),
				"remark":       text(line, "remark"),
				"tenant_id":    database.ZeroUUID,
				"created_by":   current(r).UserID,
				"quote_id":     quoteID,
			})
		}
		quote := map[string]any{
			"id":            quoteID,
			"created_at":    now,
			"updated_at":    now,
			"deleted_at":    nil,
			"supplier_id":   text(body, "supplier_id"),
			"supplier_name": text(body, "supplier_name"),
			"quote_date":    body["quote_date"],
			"status":        "pending",
			"total_amount":  total.String(),
			"remark":        text(body, "remark"),
			"tenant_id":     database.ZeroUUID,
			"created_by":    current(r).UserID,
			"rfq_id":        text(rfq, "id"),
		}
		err = s.withTx(r, func(tx *sql.Tx) error {
			if err := s.Store.InsertWith(r.Context(), tx, "purchase_rfq_quotes", quote); err != nil {
				return err
			}
			for _, line := range lines {
				if err := s.Store.InsertWith(r.Context(), tx, "purchase_rfq_quote_lines", line); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			s.failure(w, err, "询价报价")
			return
		}
		saved, err := s.Store.Get(r.Context(), "purchase_rfq_quotes", quoteID)
		if err != nil {
			s.failure(w, err, "询价报价")
			return
		}
		respond(w, 200, s.rfqQuoteView(r, saved))
	})))
	s.mux.Handle("POST /api/v1/purchase-rfqs/{id}/quotes/{quoteId}/select", s.protected("purchase_rfq_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		quote, err := s.Store.Get(r.Context(), "purchase_rfq_quotes", r.PathValue("quoteId"))
		if err != nil || text(quote, "rfq_id") != r.PathValue("id") {
			verbatimFailure(w, verbatim{text: "系统内部错误，请稍后重试或联系管理员", status: 500})
			return
		}
		now := database.Now()
		err = s.withTx(r, func(tx *sql.Tx) error {
			rows, err := database.QueryRows(r.Context(), tx, "SELECT id FROM purchase_rfq_quotes WHERE rfq_id=? AND deleted_at IS NULL", text(quote, "rfq_id"))
			if err != nil {
				return err
			}
			for _, row := range rows {
				status := "pending"
				if text(row, "id") == text(quote, "id") {
					status = "selected"
				}
				if err := s.Store.UpdateWith(r.Context(), tx, "purchase_rfq_quotes", text(row, "id"), map[string]any{"status": status, "updated_at": now}); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			s.failure(w, err, "询价报价")
			return
		}
		saved, err := s.Store.Get(r.Context(), "purchase_rfq_quotes", text(quote, "id"))
		if err != nil {
			s.failure(w, err, "询价报价")
			return
		}
		respond(w, 200, s.rfqQuoteView(r, saved))
	})))
	s.mux.Handle("DELETE /api/v1/purchase-rfqs/{id}/quotes/{quoteId}", s.protected("purchase_rfq_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		quote, err := s.Store.Get(r.Context(), "purchase_rfq_quotes", r.PathValue("quoteId"))
		if err != nil || text(quote, "rfq_id") != r.PathValue("id") {
			verbatimFailure(w, verbatim{text: "系统内部错误，请稍后重试或联系管理员", status: 500})
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "purchase_rfq_quotes", text(quote, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
			s.failure(w, err, "询价报价")
			return
		}
		respond(w, 200, nil)
	})))

	// ── 采购/销售合同：草稿 → 生效中 → 已完成 / 已取消 ─────────────────────────────
	for _, spec := range []docActionSpec{
		{"purchase-contracts", "purchase_contracts", "采购合同", "purchase_contract_edit", "activate", []string{"draft"}, "active"},
		{"purchase-contracts", "purchase_contracts", "采购合同", "purchase_contract_edit", "complete", []string{"active"}, "completed"},
		{"purchase-contracts", "purchase_contracts", "采购合同", "purchase_contract_edit", "cancel", []string{"draft", "active"}, "cancelled"},
		{"sales-contracts", "sales_contracts", "销售合同", "sales_contract_edit", "activate", []string{"draft"}, "active"},
		{"sales-contracts", "sales_contracts", "销售合同", "sales_contract_edit", "complete", []string{"active"}, "completed"},
		{"sales-contracts", "sales_contracts", "销售合同", "sales_contract_edit", "cancel", []string{"draft", "active"}, "cancelled"},
	} {
		s.registerStatusAction(spec)
	}

	// ── 销售报价：草稿 → 已发送 → 客户已接受 → 已转订单 / 已拒绝 / 已过期 ──────────
	for _, spec := range []docActionSpec{
		{"sales-quotations", "sales_quotations", "销售报价单", "sales_quotation_edit", "send", []string{"draft"}, "sent"},
		{"sales-quotations", "sales_quotations", "销售报价单", "sales_quotation_edit", "accept", []string{"sent"}, "accepted"},
		{"sales-quotations", "sales_quotations", "销售报价单", "sales_quotation_edit", "reject", []string{"sent"}, "rejected"},
		{"sales-quotations", "sales_quotations", "销售报价单", "sales_quotation_edit", "expire", []string{"sent"}, "expired"},
	} {
		s.registerStatusAction(spec)
	}
	s.mux.Handle("POST /api/v1/sales-quotations/{id}/convert", s.protected("sales_order_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "sales_quotations", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "销售报价单")
			return
		}
		if text(row, "status") != "accepted" {
			fail(w, 400, "只有客户已接受的报价单可以转销售订单")
			return
		}
		if text(row, "customer_id") == "" {
			fail(w, 400, "报价单缺少客户，无法生成销售订单")
			return
		}
		lines, err := s.Store.Rows(r.Context(), "SELECT * FROM sales_quotation_lines WHERE quotation_id=? AND deleted_at IS NULL ORDER BY line_no", text(row, "id"))
		if err != nil {
			s.failure(w, err, "销售报价单")
			return
		}
		items := make([]any, 0, len(lines))
		for _, line := range lines {
			items = append(items, map[string]any{
				"product_id": text(line, "product_id"),
				"qty":        line["qty"],
				"price":      line["price"],
				"discount":   line["discount"],
				"tax_rate":   line["tax_rate"],
			})
		}
		if len(items) == 0 {
			fail(w, 400, "报价单没有明细，无法生成销售订单")
			return
		}
		input := map[string]any{
			"customer_id": text(row, "customer_id"),
			"lines":       items,
			"remark":      "由销售报价单 " + text(row, "quotation_no") + " 生成",
		}
		data, err := s.business().Create(r.Context(), business.Documents["sales-orders"], input, current(r).UserID)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "sales_quotations", text(row, "id"), map[string]any{"status": "converted", "updated_at": now}); err != nil {
			s.failure(w, err, "销售报价单")
			return
		}
		respond(w, 200, data)
	})))

	// ── 销售/采购订单：变更（留审计链）、变更历史、关闭、备货、物流单号 ─────────────
	for _, pair := range []struct {
		route string
		d     business.Document
		perm  string
	}{
		{"sales-orders", business.Documents["sales-orders"], "sales_order_edit"},
		{"purchase-orders", business.Documents["purchase-orders"], "purchase_order_edit"},
	} {
		route, d, perm := pair.route, pair.d, pair.perm
		s.mux.Handle("POST /api/v1/"+route+"/{id}/change", s.protected(perm, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s.orderChange(w, r, d)
		})))
		s.mux.Handle("GET /api/v1/"+route+"/{id}/changes", s.protected(perm, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rows, err := s.Store.Rows(r.Context(),
				"SELECT * FROM order_change_logs WHERE order_type=? AND order_id=? ORDER BY created_at DESC",
				d.Table, r.PathValue("id"))
			if err != nil {
				s.failure(w, err, "变更记录")
				return
			}
			items := make([]map[string]any, 0, len(rows))
			for _, row := range rows {
				items = append(items, s.Store.Public("order_change_logs", row))
			}
			respond(w, 200, items)
		})))
		s.mux.Handle("POST /api/v1/"+route+"/{id}/close", s.protected(perm, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			row, err := s.Store.Get(r.Context(), d.Table, r.PathValue("id"))
			if err != nil {
				s.failure(w, err, orderLabel(d))
				return
			}
			if text(row, "status") != "approved" {
				fail(w, 400, "只有已审核的订单可以关闭")
				return
			}
			now := database.Now()
			if err = s.Store.Update(r.Context(), d.Table, text(row, "id"), map[string]any{"status": "closed", "updated_at": now}); err != nil {
				s.failure(w, err, orderLabel(d))
				return
			}
			saved, err := s.Store.Get(r.Context(), d.Table, text(row, "id"))
			if err != nil {
				s.failure(w, err, orderLabel(d))
				return
			}
			respond(w, 200, s.documentView(r, d, saved))
		})))
	}
	s.mux.Handle("POST /api/v1/sales-orders/{id}/preparing", s.protected("sales_order_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "sales_orders", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "销售订单")
			return
		}
		status := text(row, "status")
		if status != "confirmed" && status != "approved" {
			fail(w, 400, "只有已确认或已审核的订单可以开始备货")
			return
		}
		if progress := text(row, "customer_progress"); progress == "shipped" || progress == "completed" {
			fail(w, 400, "订单已发货或已完成，不能再备货")
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "sales_orders", text(row, "id"), map[string]any{"customer_progress": "preparing", "updated_at": now}); err != nil {
			s.failure(w, err, "销售订单")
			return
		}
		saved, err := s.Store.Get(r.Context(), "sales_orders", text(row, "id"))
		if err != nil {
			s.failure(w, err, "销售订单")
			return
		}
		respond(w, 200, s.documentView(r, business.Documents["sales-orders"], saved))
	})))
	s.mux.Handle("POST /api/v1/sales-orders/{id}/tracking", s.protected("sales_order_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "sales_orders", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "销售订单")
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		trackingNo := text(body, "tracking_no")
		if trackingNo == "" {
			fail(w, 400, "请输入物流单号")
			return
		}
		now := database.Now()
		changes := map[string]any{"tracking_no": trackingNo, "updated_at": now}
		if progress := text(row, "customer_progress"); progress == "preparing" {
			changes["customer_progress"] = "shipped"
			changes["shipped_at"] = now
		}
		if err = s.Store.Update(r.Context(), "sales_orders", text(row, "id"), changes); err != nil {
			s.failure(w, err, "销售订单")
			return
		}
		saved, err := s.Store.Get(r.Context(), "sales_orders", text(row, "id"))
		if err != nil {
			s.failure(w, err, "销售订单")
			return
		}
		respond(w, 200, s.documentView(r, business.Documents["sales-orders"], saved))
	})))
}

// registerStatusAction 注册一个「校验原状态 → 改写状态 → 回传单据视图」的动作端点。
func (s *Server) registerStatusAction(spec docActionSpec) {
	s.mux.Handle("POST /api/v1/"+spec.route+"/{id}/"+spec.action, s.protected(spec.perm, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), spec.table, r.PathValue("id"))
		if err != nil {
			s.failure(w, err, spec.label)
			return
		}
		current := text(row, "status")
		allowed := false
		for _, from := range spec.from {
			if from == current {
				allowed = true
				break
			}
		}
		if !allowed {
			fail(w, 400, spec.label+"当前状态不允许该操作")
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), spec.table, text(row, "id"), map[string]any{"status": spec.to, "updated_at": now}); err != nil {
			s.failure(w, err, spec.label)
			return
		}
		saved, err := s.Store.Get(r.Context(), spec.table, text(row, "id"))
		if err != nil {
			s.failure(w, err, spec.label)
			return
		}
		respond(w, 200, s.plainView(r, spec.table, saved))
	})))
}

// orderChange 已确认/已审批订单的变更入口：整体替换明细并写一条变更日志。
//
// 与 PUT /{id} 的区别：PUT 走 writeDocument，要求订单仍为草稿；
// 已确认/已审批的单据只能走本接口，且必须带变更原因（前端已强制，后端兜底）。
func (s *Server) orderChange(w http.ResponseWriter, r *http.Request, d business.Document) {
	row, err := s.Store.Get(r.Context(), d.Table, r.PathValue("id"))
	if err != nil {
		s.failure(w, err, orderLabel(d))
		return
	}
	status := text(row, "status")
	if status != "confirmed" && status != "approved" {
		fail(w, 400, "只有已确认或已审批的订单可以变更")
		return
	}
	body, err := decode(w, r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	reason := text(body, "reason")
	if reason == "" {
		fail(w, 400, "已确认/审批单据变更必须填写变更原因")
		return
	}
	raw, _ := body["lines"].([]any)
	if len(raw) == 0 {
		fail(w, 400, "单据明细不能为空")
		return
	}
	if len(raw) > 1000 {
		fail(w, 400, "明细过多")
		return
	}
	now := database.Now()
	tenant := database.ZeroUUID
	if v := text(row, "tenant_id"); v != "" {
		tenant = v
	}
	err = s.withTx(r, func(tx *sql.Tx) error {
		before, err := database.QueryRows(r.Context(), tx,
			"SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=? AND deleted_at IS NULL ORDER BY line_no",
			text(row, "id"))
		if err != nil {
			return err
		}
		beforeLines := make([]map[string]any, 0, len(before))
		for _, line := range before {
			beforeLines = append(beforeLines, s.Store.Public(d.Lines, line))
			if err := s.Store.UpdateWith(r.Context(), tx, d.Lines, text(line, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
				return err
			}
		}
		lines := make([]map[string]any, 0, len(raw))
		totalQty, totalAmount, totalTax := decimal.Zero, decimal.Zero, decimal.Zero
		for i, item := range raw {
			line, ok := item.(map[string]any)
			if !ok {
				return errors.New("明细格式错误")
			}
			product, err := s.Store.GetWith(r.Context(), tx, "products", text(line, "product_id"))
			if err != nil {
				return errors.New("商品不存在")
			}
			qty, err := business.Number(line["qty"])
			if err != nil || !qty.IsPositive() {
				return errors.New("数量必须大于0")
			}
			price, err := business.Number(line["price"])
			if err != nil || price.IsNegative() {
				return errors.New("价格不能为负数")
			}
			discount, _ := business.Number(line["discount"])
			taxRate, _ := business.Number(line["tax_rate"])
			amount := qty.Mul(price).Sub(discount)
			taxAmount := amount.Mul(taxRate).Div(decimal.NewFromInt(100))
			totalQty = totalQty.Add(qty)
			totalAmount = totalAmount.Add(amount)
			totalTax = totalTax.Add(taxAmount)
			l := map[string]any{
				"id":           uuid.NewString(),
				"created_at":   now,
				"updated_at":   now,
				"deleted_at":   nil,
				"line_no":      i + 1,
				"product_id":   text(product, "id"),
				"product_name": text(product, "name"),
				"product_code": text(product, "code"),
				"spec":         text(product, "spec"),
				"qty":          qty.String(),
				"price":        price.String(),
				"discount":     discount.String(),
				"tax_rate":     taxRate.String(),
				"amount":       amount.String(),
				"tax_amount":   taxAmount.String(),
				"remark":       text(line, "remark"),
				"tenant_id":    tenant,
				"created_by":   current(r).UserID,
				d.ForeignKey:   text(row, "id"),
			}
			if unit := text(line, "unit_id"); unit != "" && s.Store.Has(d.Lines, "unit_id") {
				l["unit_id"] = unit
			}
			if s.Store.Has(d.Lines, "is_gift") {
				l["is_gift"] = line["is_gift"] == true || line["is_gift"] == "true"
			}
			// delivered_qty / returned_qty 等 numeric NOT NULL 且无默认值的列补 0
			s.fillNumericDefaults(d.Lines, l)
			if err := s.Store.InsertWith(r.Context(), tx, d.Lines, l); err != nil {
				return err
			}
			lines = append(lines, s.Store.Public(d.Lines, l))
		}
		header := map[string]any{
			"total_qty":    totalQty.String(),
			"total_amount": totalAmount.String(),
			"tax_amount":   totalTax.String(),
			"updated_at":   now,
		}
		for _, key := range []string{"remark", "expected_date", "order_date", "discount_amount", "currency", "warehouse_id"} {
			if value, ok := body[key]; ok && value != nil && s.Store.Has(d.Table, key) {
				header[key] = value
			}
		}
		if err := s.Store.UpdateWith(r.Context(), tx, d.Table, text(row, "id"), header); err != nil {
			return err
		}
		beforeJSON, _ := json.Marshal(beforeLines)
		afterJSON, _ := json.Marshal(lines)
		return s.Store.InsertWith(r.Context(), tx, "order_change_logs", map[string]any{
			"id":           uuid.NewString(),
			"created_at":   now,
			"updated_at":   now,
			"order_type":   d.Table,
			"order_id":     text(row, "id"),
			"order_no":     text(row, d.Number),
			"change_type":  "lines_changed",
			"reason":       reason,
			"before_lines": string(beforeJSON),
			"after_lines":  string(afterJSON),
			"operator_id":  current(r).UserID,
			"tenant_id":    tenant,
		})
	})
	if err != nil {
		s.failure(w, err, orderLabel(d))
		return
	}
	saved, err := s.Store.Get(r.Context(), d.Table, text(row, "id"))
	if err != nil {
		s.failure(w, err, orderLabel(d))
		return
	}
	respond(w, 200, s.documentView(r, d, saved))
}

// documentView 单据公开视图（表字段 + edges.lines + 往来单位）。
func (s *Server) documentView(r *http.Request, d business.Document, row map[string]any) map[string]any {
	pub := s.Store.Public(d.Table, row)
	edges := map[string]any{}
	rows, err := s.Store.Rows(r.Context(),
		"SELECT * FROM "+database.Quote(d.Lines)+" WHERE "+database.Quote(d.ForeignKey)+"=? AND deleted_at IS NULL ORDER BY line_no",
		text(row, "id"))
	if err == nil {
		lines := make([]map[string]any, 0, len(rows))
		for _, line := range rows {
			lines = append(lines, s.Store.Public(d.Lines, line))
		}
		if len(lines) > 0 {
			edges["lines"] = lines
		}
	}
	if !d.Stock && d.Party != "" {
		table := d.Party + "s"
		if party, err := s.Store.Get(r.Context(), table, text(row, d.Party+"_id")); err == nil {
			edges[d.Party] = s.Store.Public(table, party)
		}
	}
	pub["edges"] = edges
	return pub
}

// plainView 无明细表的单据（申请/询价/合同/报价）公开视图。
func (s *Server) plainView(r *http.Request, table string, row map[string]any) map[string]any {
	pub := s.Store.Public(table, row)
	edges := map[string]any{}
	lineTable, fk := "", ""
	switch table {
	case "purchase_requisitions":
		lineTable, fk = "purchase_requisition_lines", "requisition_id"
	case "purchase_rf_qs":
		lineTable, fk = "purchase_rfq_lines", "rfq_id"
	case "sales_quotations":
		lineTable, fk = "sales_quotation_lines", "quotation_id"
	}
	if lineTable != "" {
		if rows, err := s.Store.Rows(r.Context(),
			"SELECT * FROM "+database.Quote(lineTable)+" WHERE "+database.Quote(fk)+"=? AND deleted_at IS NULL ORDER BY line_no",
			text(row, "id")); err == nil {
			lines := make([]map[string]any, 0, len(rows))
			for _, line := range rows {
				lines = append(lines, s.Store.Public(lineTable, line))
			}
			if len(lines) > 0 {
				edges["lines"] = lines
			}
		}
	}
	if table == "purchase_rf_qs" {
		if rows, err := s.Store.Rows(r.Context(), "SELECT * FROM purchase_rfq_quotes WHERE rfq_id=? AND deleted_at IS NULL ORDER BY created_at", text(row, "id")); err == nil {
			quotes := make([]map[string]any, 0, len(rows))
			for _, quote := range rows {
				quotes = append(quotes, s.rfqQuoteView(r, quote))
			}
			if len(quotes) > 0 {
				edges["quotes"] = quotes
			}
		}
	}
	pub["edges"] = edges
	return pub
}

// rfqQuoteView 询价报价视图（带报价明细）。
func (s *Server) rfqQuoteView(r *http.Request, row map[string]any) map[string]any {
	pub := s.Store.Public("purchase_rfq_quotes", row)
	edges := map[string]any{}
	if rows, err := s.Store.Rows(r.Context(), "SELECT * FROM purchase_rfq_quote_lines WHERE quote_id=? AND deleted_at IS NULL ORDER BY line_no", text(row, "id")); err == nil {
		lines := make([]map[string]any, 0, len(rows))
		for _, line := range rows {
			lines = append(lines, s.Store.Public("purchase_rfq_quote_lines", line))
		}
		if len(lines) > 0 {
			edges["lines"] = lines
		}
	}
	pub["edges"] = edges
	return pub
}

// orderLabel 订单类单据的中文名（用于「X不存在」）。
func orderLabel(d business.Document) string {
	if d.Table == "sales_orders" {
		return "销售订单"
	}
	return "采购订单"
}

// withTx 在事务中执行 action（提交/回滚归一处理）。
func (s *Server) withTx(r *http.Request, action func(*sql.Tx) error) error {
	tx, err := s.Store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	if err = action(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
