package api

import (
	_ "embed"
	"encoding/json"
	"la-erp-recovered/backend/internal/database"
	"net/http"
	"strings"
)

//go:embed read_resources.json
var recoveredReadResources []byte

type readResource struct {
	Route      string `json:"route"`
	Table      string `json:"table"`
	Permission string `json:"permission"`
}

// recoveredTableLabels 把单据表名映射为原版 404 文案用的中文单据名。
// 原版回放 JJ3（2026-10-14，evidence/backend-runtime/audit-batch-j-20261014.json）
// 逐个 GET 不存在的记录得到：
//
//	stock-ins → 404「入库单不存在」   stock-outs   → 404「出库单不存在」
//	sales-orders → 404「销售订单不存在」purchase-orders → 404「采购订单不存在」
//	inventory-adjusts → 404「库存调整单不存在」
//	inventory-checks  → 404「盘点单不存在」
//	stock-transfers  → 404「调拨单不存在」
//	work-orders      → 404「工单不存在」
//	vouchers         → 404「凭证不存在」
//
// 恢复端原先直接把表名当 label（如「stock_ins不存在」），与原版逐字不符。
// 注意 `assemblies` 原版返回 500 无业务文案、`rework-orders`/`subcontract-orders`
// 返回 200+code:10000，由各自的专用处理器负责，此处不纳入映射。
var recoveredTableLabels = map[string]string{
	"stock_ins":        "入库单",
	"stock_outs":       "出库单",
	"sales_orders":     "销售订单",
	"purchase_orders":  "采购订单",
	"stock_adjusts":    "库存调整单",
	"inventory_checks": "盘点单",
	"stock_transfers":  "调拨单",
	"work_orders":      "工单",
	"vouchers":         "凭证",
}

func (s *Server) registerRecoveredReads() {
	for _, table := range []string{"ar_invoices", "ap_invoices"} {
		route := strings.ReplaceAll(table, "_", "-")
		s.mux.Handle("GET /api/v1/"+route, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			where := []string{"deleted_at IS NULL"}
			args := []any{}
			for _, field := range []string{"customer_id", "supplier_id", "status", "source_id", "source_type"} {
				if value := r.URL.Query().Get(field); value != "" && s.Store.Has(table, field) {
					where = append(where, database.Quote(field)+"=?")
					args = append(args, value)
				}
			}
			rows, err := s.Store.Rows(r.Context(), "SELECT * FROM "+database.Quote(table)+" WHERE "+strings.Join(where, " AND ")+" ORDER BY created_at DESC", args...)
			if err != nil {
				s.failure(w, err, table)
				return
			}
			items := []map[string]any{}
			for _, row := range rows {
				items = append(items, s.Store.Public(table, row))
			}
			respond(w, 200, items)
		})))
	}
	var resources []readResource
	if err := json.Unmarshal(recoveredReadResources, &resources); err != nil {
		panic(err)
	}
	for _, item := range resources {
		if item.Route == "notifications" {
			continue
		}
		if _, registered := Resources[item.Route]; registered {
			continue
		}
		res := Resource{Table: item.Table, Permission: item.Permission, Label: item.Table}
		if name, ok := recoveredTableLabels[item.Table]; ok {
			res.Label = name
		}
		if item.Route != "bank/statements" && item.Route != "serial-numbers" {
			s.mux.Handle("GET /api/v1/"+item.Route, s.protected(res.Permission, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.list(w, r, res) })))
		}
		// metadata/entities/{id} 由 metadata.go 自行注册：原版对不存在的 id 返回
		// HTTP 500 + 通用文案（回放 GG15），与通用读资源的 404「记录不存在」不同。
		if s.Store.Has(res.Table, "id") && item.Route != "mrp/requirements" && item.Route != "purchase-suggestions" && item.Route != "serial-numbers" && item.Route != "mps-plans" && item.Route != "metadata/entities" {
			s.mux.Handle("GET /api/v1/"+item.Route+"/{id}", s.protected(res.Permission, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.get(w, r, res) })))
		}
	}
}
