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
	// 以下三项来自原版回放 HH（evidence/backend-runtime/audit-batch-hh-20261014.json）：
	// 逐个 GET /api/v1/{route}/{零UUID} 得到的真实 HTTP 状态码、body.code 与 message。
	NotFoundHTTP    int    `json:"not_found_http"`
	NotFoundCode    int    `json:"not_found_code"`
	NotFoundMessage string `json:"not_found_message"`
}

// notFoundStyle 描述原版在「详情记录不存在」时返回的形态。
//
// 原版回放 HH 对 69 条通用读资源逐条取证，实测出三种形态：
//  1. HTTP 404 + code 404 +「<中文单据名>不存在」      —— 多数单据类
//  2. HTTP 200 + code 10000 +「<中文名>不存在」        —— HR / 财务 / 计划类
//  3. HTTP 404 或 500 +「系统内部错误，请稍后重试或联系管理员」—— 原版该分支未做 NotFound 判定
//
// 另有 8 条资源原版**根本没有详情路由**，实测返回 404「路由不存在」，
// 恢复端此前由通用读资源自动补出了详情路由，必须显式关掉。
//
// 恢复端原先一律输出 HTTP 404 +「<表名>不存在」，与上表大面积不符，
// 故改为按表配置、在 s.detail 里统一改写（见 notFoundStyles）。
type notFoundStyle struct {
	HTTP    int
	Code    int
	Message string
}

// notFoundStyles 以**表名**为键。read_resources.json 与 Resources 表（server.go）
// 存在重叠（如 production_equipments / toolings / assemblies 两边都有），
// 用表名做键可让 s.register 与 registerRecoveredReads 共用同一套配置。
var notFoundStyles = map[string]notFoundStyle{}

func loadNotFoundStyles(raw []byte) {
	var list []readResource
	if err := json.Unmarshal(raw, &list); err != nil {
		panic(err)
	}
	for _, item := range list {
		if item.NotFoundMessage == "" {
			continue
		}
		notFoundStyles[item.Table] = notFoundStyle{
			HTTP:    item.NotFoundHTTP,
			Code:    item.NotFoundCode,
			Message: item.NotFoundMessage,
		}
	}
	// 批次 PP（2026-10-15）：这两张表的详情路由原版不存在（GET /{合法UUID} 实测
	// 404「路由不存在」，tools/replay-batch-oo-badid2.js）。
	// 表在 Resources（server.go）注册过、不在 read_resources.json，故在此补配，
	// 防止通用 GET /{id} 自动补出原版没有的详情路由。
	notFoundStyles["production_team_members"] = notFoundStyle{HTTP: 404, Code: 404, Message: "路由不存在"}
	notFoundStyles["approval_records"] = notFoundStyle{HTTP: 404, Code: 404, Message: "路由不存在"}
}

// responseCapture 缓冲 s.get 的输出，用于在命中「记录不存在」时按原版形态改写。
// 只捕获状态码与 body，不实现 Flush/Hijack（详情读接口不需要）。
type responseCapture struct {
	http.ResponseWriter
	status  int
	body    []byte
	started bool
}

func (c *responseCapture) WriteHeader(code int) {
	if c.started {
		return
	}
	c.status = code
	c.started = true
}
func (c *responseCapture) Write(b []byte) (int, error) {
	if !c.started {
		c.status = 200
		c.started = true
	}
	c.body = append(c.body, b...)
	return len(b), nil
}

func isNotFoundMessage(message string) bool {
	return strings.HasSuffix(message, "不存在") || message == "记录不存在"
}

// detail 是通用详情读入口：先按原版形态处理「无此路由」，
// 再把 s.get 输出的 404/500「…不存在」改写为该表配置的原版形态。
// 未配置的表（notFoundStyles 查不到）保持原有行为不变。
func (s *Server) detail(w http.ResponseWriter, r *http.Request, res Resource) {
	style, ok := notFoundStyles[res.Table]
	if !ok {
		s.get(w, r, res)
		return
	}
	// 原版没有该详情路由：恢复端不得自动补出，逐字返回 404「路由不存在」。
	if style.Message == "路由不存在" {
		fail(w, 404, "路由不存在")
		return
	}
	buf := &responseCapture{ResponseWriter: w}
	s.get(buf, r, res)
	if buf.status != 404 && buf.status != 500 {
		w.WriteHeader(buf.status)
		_, _ = w.Write(buf.body)
		return
	}
	var payload struct {
		Message string `json:"message"`
	}
	// 只改写「记录不存在」这一类；「无权访问该数据」等非 NotFound 的 404 原样透传。
	if json.Unmarshal(buf.body, &payload) != nil || !isNotFoundMessage(payload.Message) {
		w.WriteHeader(buf.status)
		_, _ = w.Write(buf.body)
		return
	}
	if style.HTTP == 200 && style.Code != 0 {
		write(w, 200, map[string]any{"code": style.Code, "message": style.Message, "data": nil})
		return
	}
	fail(w, style.HTTP, style.Message)
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
	loadNotFoundStyles(recoveredReadResources)
	for _, item := range resources {
		if _, registered := Resources[item.Route]; registered {
			continue
		}
		res := Resource{Table: item.Table, Permission: item.Permission, Label: item.Table}
		if name, ok := recoveredTableLabels[item.Table]; ok {
			res.Label = name
		}
		// notifications 的列表由 lead_notifications.go 的专用处理器提供，此处只补详情。
		if item.Route != "bank/statements" && item.Route != "serial-numbers" && item.Route != "notifications" {
			s.mux.Handle("GET /api/v1/"+item.Route, s.protected(res.Permission, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.list(w, r, res) })))
		}
		// metadata/entities/{id} 由 metadata.go 自行注册：原版对不存在的 id 返回
		// HTTP 500 + 通用文案（回放 GG15），与通用读资源的 404「记录不存在」不同。
		if s.Store.Has(res.Table, "id") && item.Route != "mrp/requirements" && item.Route != "purchase-suggestions" && item.Route != "serial-numbers" && item.Route != "mps-plans" && item.Route != "metadata/entities" {
			s.mux.Handle("GET /api/v1/"+item.Route+"/{id}", s.protected(res.Permission, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.detail(w, r, res) })))
		}
	}
}
