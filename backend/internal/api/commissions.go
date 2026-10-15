package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

// 佣金计算基数：revenue=按销售额，profit=按毛利额。
const (
	commissionBaseRevenue = "revenue"
	commissionBaseProfit  = "profit"
)

// commissionSettlementPrefix / 编号位数与 numbering-rules 中 commission_settlement
// 的默认规则一致（前缀 CM + 年月 200601 + 4 位流水，按月重置）。
const (
	commissionSettlementPrefix    = "CM"
	commissionSettlementDigits    = 4
	commissionSettlementDateFmt   = "200601"
	commissionSettlementTableName = "commission_settlements"
)

func (s *Server) registerCommissions() {
	base := "/api/v1/sales-commissions"
	// 配置：列表 / 新增或更新（同一业务员只保留一条）/ 删除
	s.mux.Handle("GET "+base+"/configs", s.protected("sales_commission", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM sales_commission_configs WHERE deleted_at IS NULL ORDER BY created_at")
		if err != nil {
			s.failure(w, err, "佣金配置")
			return
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			items = append(items, s.Store.Public("sales_commission_configs", row))
		}
		respond(w, 200, items)
	})))
	s.mux.Handle("POST "+base+"/configs", s.protected("sales_commission_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		rate, err := decimal.NewFromString(fmt.Sprint(body["rate"]))
		if err != nil {
			fail(w, 400, "佣金率必须是数字")
			return
		}
		if rate.IsNegative() || rate.GreaterThan(decimal.NewFromInt(100)) {
			fail(w, 400, "佣金率须在 0~100 之间")
			return
		}
		salespersonID := text(body, "salesperson_id")
		now := database.Now()
		row := map[string]any{
			"rate":             rate.String(),
			"status":           "active",
			"remark":           text(body, "remark"),
			"salesperson_id":   nil,
			"salesperson_name": nil,
			"updated_at":       now,
		}
		if salespersonID != "" {
			row["salesperson_id"] = salespersonID
			row["salesperson_name"] = text(body, "salesperson_name")
		}
		clause := "salesperson_id IS NULL"
		args := []any{}
		if salespersonID != "" {
			clause = "salesperson_id=?"
			args = append(args, salespersonID)
		}
		existing, err := s.Store.Rows(r.Context(), "SELECT id FROM sales_commission_configs WHERE "+clause+" AND deleted_at IS NULL", args...)
		if err != nil {
			s.failure(w, err, "佣金配置")
			return
		}
		if len(existing) > 0 {
			if err = s.Store.Update(r.Context(), "sales_commission_configs", text(existing[0], "id"), row); err != nil {
				s.failure(w, err, "佣金配置")
				return
			}
			saved, err := s.Store.Get(r.Context(), "sales_commission_configs", text(existing[0], "id"))
			if err != nil {
				s.failure(w, err, "佣金配置")
				return
			}
			respond(w, 200, s.Store.Public("sales_commission_configs", saved))
			return
		}
		row["id"] = uuid.NewString()
		row["created_at"] = now
		row["tenant_id"] = database.ZeroUUID
		row["created_by"] = current(r).UserID
		if err = s.Store.Insert(r.Context(), "sales_commission_configs", row); err != nil {
			s.failure(w, err, "佣金配置")
			return
		}
		saved, err := s.Store.Get(r.Context(), "sales_commission_configs", text(row, "id"))
		if err != nil {
			s.failure(w, err, "佣金配置")
			return
		}
		respond(w, 200, s.Store.Public("sales_commission_configs", saved))
	})))
	s.mux.Handle("DELETE "+base+"/configs/{id}", s.protected("sales_commission_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), "sales_commission_configs", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "佣金配置")
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), "sales_commission_configs", text(row, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
			s.failure(w, err, "佣金配置")
			return
		}
		respond(w, 200, nil)
	})))
	// 试算：按业务员汇总销售额/毛利额，套用配置佣金率
	s.mux.Handle("GET "+base+"/calculate", s.protected("sales_commission", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		results, err := s.commissionResults(r)
		if err != nil {
			s.failure(w, err, "佣金配置")
			return
		}
		respond(w, 200, results)
	})))
	// 结算单
	//
	// GET /settlements 与 GET /settlements/{id} 已由 read_resources.json 的通用读
	// 资源注册（registerSrcReads），此处不再重复注册（Go 1.22 ServeMux 对
	// 重复 pattern 直接 panic）。期间过滤所需 period 条件已并入 Store.List 的
	// 过滤字段表，通用列表即支持 ?period=&status=。
	s.mux.Handle("POST "+base+"/settlements/generate", s.protected("sales_commission_create", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		period := text(body, "period")
		if period == "" {
			fail(w, 400, "缺少结算期间")
			return
		}
		baseKind := text(body, "base")
		if baseKind == "" {
			baseKind = commissionBaseRevenue
		}
		results, err := s.commissionResults(r)
		if err != nil {
			s.failure(w, err, "佣金结算单")
			return
		}
		dateSegment := commissionPeriodSegment(period)
		now := database.Now()
		created := 0
		for _, item := range results {
			if text(item, "base") != baseKind {
				continue
			}
			salespersonID := text(item, "salesperson_id")
			if salespersonID == "" {
				continue
			}
			existing, err := s.Store.Rows(r.Context(), "SELECT id FROM "+database.Quote(commissionSettlementTableName)+" WHERE period=? AND salesperson_id=? AND base=? AND deleted_at IS NULL", period, salespersonID, baseKind)
			if err == nil && len(existing) > 0 {
				continue // 同一期间同一基数不重复生成
			}
			seq, err := s.commissionNextSeq(r, period)
			if err != nil {
				s.failure(w, err, "佣金结算单")
				return
			}
			row := map[string]any{
				"id":               uuid.NewString(),
				"created_at":       now,
				"updated_at":       now,
				"deleted_at":       nil,
				"settlement_no":    fmt.Sprintf("%s%s%0*d", commissionSettlementPrefix, dateSegment, commissionSettlementDigits, seq),
				"period":           period,
				"salesperson_id":   salespersonID,
				"salesperson_name": text(item, "salesperson_name"),
				"amount":           text(item, "commission"),
				"base":             baseKind,
				"status":           "unpaid",
				"paid_at":          nil,
				"remark":           "",
				"tenant_id":        database.ZeroUUID,
				"created_by":       current(r).UserID,
			}
			if err = s.Store.Insert(r.Context(), commissionSettlementTableName, row); err != nil {
				s.failure(w, err, "佣金结算单")
				return
			}
			created++
		}
		respond(w, 200, map[string]any{"created": created})
	})))
	s.mux.Handle("POST "+base+"/settlements/{id}/paid", s.protected("sales_commission_edit", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), commissionSettlementTableName, r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "佣金结算单")
			return
		}
		if text(row, "status") == "paid" {
			fail(w, 400, "该结算单已付款")
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), commissionSettlementTableName, text(row, "id"), map[string]any{"status": "paid", "paid_at": now, "updated_at": now}); err != nil {
			s.failure(w, err, "佣金结算单")
			return
		}
		saved, err := s.Store.Get(r.Context(), commissionSettlementTableName, text(row, "id"))
		if err != nil {
			s.failure(w, err, "佣金结算单")
			return
		}
		respond(w, 200, s.Store.Public(commissionSettlementTableName, saved))
	})))
	s.mux.Handle("DELETE "+base+"/settlements/{id}", s.protected("sales_commission_delete", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Store.Get(r.Context(), commissionSettlementTableName, r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "佣金结算单")
			return
		}
		if text(row, "status") == "paid" {
			fail(w, 400, "已付款的结算单不允许删除")
			return
		}
		now := database.Now()
		if err = s.Store.Update(r.Context(), commissionSettlementTableName, text(row, "id"), map[string]any{"deleted_at": now, "updated_at": now}); err != nil {
			s.failure(w, err, "佣金结算单")
			return
		}
		respond(w, 200, nil)
	})))
}

// commissionResults 按业务员汇总销售业绩并套用佣金率。
//
// 口径（原版该接口在空库回放下返回 []，无法逐字取证，按下述业务定义实现）：
//   - 统计范围：未删除、状态非 draft/cancelled 的销售订单；start_date/end_date 按 order_date 过滤
//   - sales_amount：SUM(total_amount)
//   - profit_amount：SUM(total_amount) - Σ(明细行 qty × 商品采购价)
//   - rate：优先取业务员专属配置，回落全局默认配置（salesperson_id IS NULL），都没有则 0
func (s *Server) commissionResults(r *http.Request) ([]map[string]any, error) {
	base := r.URL.Query().Get("base")
	if base == "" {
		base = commissionBaseRevenue
	}
	where := []string{"deleted_at IS NULL", "status NOT IN ('draft','cancelled')"}
	args := []any{}
	if start := r.URL.Query().Get("start_date"); start != "" {
		where = append(where, database.Quote("order_date")+">=?")
		args = append(args, start)
	}
	if end := r.URL.Query().Get("end_date"); end != "" {
		where = append(where, database.Quote("order_date")+"<=?")
		args = append(args, end+"T23:59:59.999999999+08:00")
	}
	orders, err := s.Store.Rows(r.Context(), "SELECT id, salesperson_id, total_amount FROM sales_orders WHERE "+strings.Join(where, " AND "), args...)
	if err != nil {
		return nil, err
	}
	type bucket struct {
		count  int
		sales  decimal.Decimal
		profit decimal.Decimal
	}
	buckets := map[string]*bucket{}
	for _, order := range orders {
		id := text(order, "salesperson_id")
		if id == "" {
			continue
		}
		amount, _ := decimal.NewFromString(fmt.Sprint(order["total_amount"]))
		b := buckets[id]
		if b == nil {
			b = &bucket{}
			buckets[id] = b
		}
		b.count++
		b.sales = b.sales.Add(amount)
		cost := decimal.Zero
		lines, err := s.Store.Rows(r.Context(),
			"SELECT l.qty, p.purchase_price FROM sales_order_lines l LEFT JOIN products p ON p.id=l.product_id WHERE l.order_id=? AND l.deleted_at IS NULL",
			text(order, "id"))
		if err != nil {
			return nil, err
		}
		for _, line := range lines {
			qty, _ := decimal.NewFromString(fmt.Sprint(line["qty"]))
			price, _ := decimal.NewFromString(fmt.Sprint(line["purchase_price"]))
			cost = cost.Add(qty.Mul(price))
		}
		b.profit = b.profit.Add(amount.Sub(cost))
	}
	rates := map[string]decimal.Decimal{}
	var fallback decimal.Decimal
	hasFallback := false
	if configs, err := s.Store.Rows(r.Context(), "SELECT salesperson_id, rate FROM sales_commission_configs WHERE deleted_at IS NULL AND status='active'"); err == nil {
		for _, cfg := range configs {
			rate, err := decimal.NewFromString(fmt.Sprint(cfg["rate"]))
			if err != nil {
				continue
			}
			if text(cfg, "salesperson_id") == "" {
				fallback = rate
				hasFallback = true
				continue
			}
			rates[text(cfg, "salesperson_id")] = rate
		}
	}
	names := map[string]string{}
	if users, err := s.Store.Rows(r.Context(), "SELECT id, username FROM sys_users WHERE deleted_at IS NULL"); err == nil {
		for _, user := range users {
			name := text(user, "username")
			if v := text(user, "name"); v != "" {
				name = v
			}
			names[text(user, "id")] = name
		}
	}
	results := make([]map[string]any, 0, len(buckets))
	for id, b := range buckets {
		rate, ok := rates[id]
		if !ok {
			rate = fallback
			_ = hasFallback
		}
		baseAmount := b.sales
		if base == commissionBaseProfit {
			baseAmount = b.profit
		}
		results = append(results, map[string]any{
			"salesperson_id":   id,
			"salesperson_name": names[id],
			"order_count":      b.count,
			"sales_amount":     b.sales.String(),
			"profit_amount":    b.profit.String(),
			"rate":             rate.String(),
			"commission":       baseAmount.Mul(rate).Div(decimal.NewFromInt(100)).String(),
			"base":             base,
		})
	}
	return results, nil
}

// commissionPeriodSegment 把「2026-10」/「202610」等期间写法归一为 YYYYMM。
func commissionPeriodSegment(period string) string {
	compact := strings.ReplaceAll(period, "-", "")
	compact = strings.ReplaceAll(compact, "/", "")
	if t, err := time.Parse("200601", compact); err == nil {
		return t.Format(commissionSettlementDateFmt)
	}
	return time.Now().Format(commissionSettlementDateFmt)
}

// commissionNextSeq 取该期间内已有结算单最大流水 + 1（含已删除，避免撞号）。
func (s *Server) commissionNextSeq(r *http.Request, period string) (int, error) {
	dateSegment := commissionPeriodSegment(period)
	rows, err := s.Store.Rows(r.Context(),
		"SELECT settlement_no FROM "+database.Quote(commissionSettlementTableName)+" WHERE settlement_no LIKE ?",
		commissionSettlementPrefix+strings.ReplaceAll(dateSegment, "%", "")+"%")
	if err != nil {
		return 0, err
	}
	max := 0
	prefixLen := len(commissionSettlementPrefix + dateSegment)
	for _, row := range rows {
		no := text(row, "settlement_no")
		if len(no) != prefixLen+commissionSettlementDigits {
			continue
		}
		if seq, err := strconv.Atoi(no[prefixLen:]); err == nil && seq > max {
			max = seq
		}
	}
	return max + 1, nil
}
