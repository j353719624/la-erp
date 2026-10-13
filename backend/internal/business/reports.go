package business

import (
	"context"
	"github.com/shopspring/decimal"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Reports aggregate persisted documents using decimal arithmetic. No canned
// capture values are returned. Unverified report branches remain unsupported.
func (s *Service) TradeReport(ctx context.Context, q url.Values, family, mode string) (any, error) {
	d := Documents[family+"-orders"]
	where := []string{"o.deleted_at IS NULL", "o.status IN ('confirmed','approved','closed')"}
	args := []any{}
	for _, key := range []string{d.Party + "_id", "warehouse_id"} {
		if v := q.Get(key); v != "" {
			where = append(where, "o."+key+"=?")
			args = append(args, v)
		}
	}
	for _, bound := range []struct{ key, op string }{{"start_date", ">="}, {"end_date", "<="}} {
		if v := q.Get(bound.key); v != "" {
			where = append(where, "date(o.order_date)"+bound.op+"date(?)")
			args = append(args, v)
		}
	}
	if v := q.Get("product_id"); v != "" {
		where = append(where, "l.product_id=?")
		args = append(args, v)
	}
	rows, err := s.Store.Rows(ctx, "SELECT l.*,o.id AS report_order_id,o.order_date,o."+d.Party+"_id AS party_id,o."+d.Party+"_name AS party_name FROM "+d.Table+" o JOIN "+d.Lines+" l ON l.order_id=o.id WHERE l.deleted_at IS NULL AND "+strings.Join(where, " AND ")+" ORDER BY o.order_date,o.created_at,l.line_no", args...)
	if err != nil {
		return nil, err
	}
	type group struct {
		meta                  map[string]any
		qty, amount, min, max decimal.Decimal
		orders                map[string]bool
	}
	groups := map[string]*group{}
	for _, r := range rows {
		if date, ok := r["order_date"].(time.Time); ok {
			r["order_date"] = date.Format(time.RFC3339)
		}
		key := value(r, "product_id")
		date := value(r, "order_date")
		if len(date) > 7 {
			date = date[:7]
		}
		switch mode {
		case "by-customer", "by-supplier":
			key = value(r, "party_id")
		case "trend":
			key = date
		case "price-trend":
			key += "|" + date
		}
		g := groups[key]
		if g == nil {
			g = &group{meta: r, orders: map[string]bool{}, min: readDecimal(r, "price"), max: readDecimal(r, "price")}
			groups[key] = g
		}
		g.qty = g.qty.Add(readDecimal(r, "qty"))
		g.amount = g.amount.Add(readDecimal(r, "amount"))
		g.orders[value(r, "report_order_id")] = true
		price := readDecimal(r, "price")
		if price.LessThan(g.min) {
			g.min = price
		}
		if price.GreaterThan(g.max) {
			g.max = price
		}
	}
	keys := []string{}
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := []map[string]any{}
	if mode == "dormant" {
		days := 90
		if v := q.Get("days"); v != "" {
			if parsed, e := strconv.Atoi(v); e == nil && parsed >= 0 {
				days = parsed
			}
		}
		cutoff := time.Now().AddDate(0, 0, -days)
		for _, r := range rows {
			moves, e := s.Store.Rows(ctx, "SELECT created_at FROM stock_movements WHERE product_id=? AND warehouse_id=? ORDER BY created_at DESC LIMIT 1", r["product_id"], r["warehouse_id"])
			if e != nil {
				return nil, e
			}
			var last any
			if len(moves) > 0 {
				last = moves[0]["created_at"]
			}
			lastTime := time.Time{}
			if t, ok := last.(time.Time); ok {
				lastTime = t
			}
			if !lastTime.IsZero() && lastTime.After(cutoff) {
				continue
			}
			age := days
			if !lastTime.IsZero() {
				age = int(time.Since(lastTime).Hours() / 24)
			}
			qty := readDecimal(r, "qty_available")
			out = append(out, map[string]any{"product_id": r["product_id"], "product_code": r["product_code"], "product_name": r["product_name"], "warehouse_name": r["warehouse_name"], "qty_available": qty.String(), "avg_cost": readDecimal(r, "avg_cost").String(), "total_value": qty.Mul(readDecimal(r, "avg_cost")).String(), "last_movement_at": last, "dormant_days": age})
		}
		return out, nil
	}
	if mode == "expiry-alert" {
		days := 30
		if v := q.Get("days"); v != "" {
			if parsed, e := strconv.Atoi(v); e == nil && parsed >= 0 {
				days = parsed
			}
		}
		nowDate := time.Now()
		limit := nowDate.AddDate(0, 0, days)
		for _, r := range rows {
			expiry := value(r, "expiry_date")
			if expiry == "" {
				continue
			}
			expiryDate, e := time.Parse(time.RFC3339Nano, expiry)
			if e != nil {
				expiryDate, e = time.Parse("2006-01-02", expiry)
			}
			if e != nil || expiryDate.After(limit) {
				continue
			}
			left := int(expiryDate.Sub(nowDate).Hours() / 24)
			status := "warning"
			if left < 0 {
				status = "expired"
			}
			out = append(out, map[string]any{"product_id": r["product_id"], "product_code": r["product_code"], "product_name": r["product_name"], "warehouse_name": r["warehouse_name"], "batch_no": value(r, "batch_no"), "qty_available": readDecimal(r, "qty_available").String(), "expiry_date": expiry, "days_left": left, "status": status})
		}
		return out, nil
	}
	if mode == "age" {
		type ageGroup struct {
			row         map[string]any
			qty, amount decimal.Decimal
			max         int
			buckets     map[string]map[string]decimal.Decimal
		}
		groups := map[string]*ageGroup{}
		nowDate := time.Now()
		for _, r := range rows {
			moves, e := s.Store.Rows(ctx, "SELECT created_at FROM stock_movements WHERE product_id=? AND warehouse_id=? ORDER BY created_at DESC LIMIT 1", r["product_id"], r["warehouse_id"])
			if e != nil {
				return nil, e
			}
			age := 0
			if len(moves) > 0 {
				if t, ok := moves[0]["created_at"].(time.Time); ok {
					age = int(nowDate.Sub(t).Hours() / 24)
					if age < 0 {
						age = 0
					}
				}
			}
			name := "0-30天"
			if age > 90 {
				name = "90天以上"
			} else if age > 60 {
				name = "61-90天"
			} else if age > 30 {
				name = "31-60天"
			}
			id := value(r, "product_id")
			g := groups[id]
			if g == nil {
				g = &ageGroup{row: r, buckets: map[string]map[string]decimal.Decimal{}}
				groups[id] = g
			}
			qty := readDecimal(r, "qty_available")
			amount := qty.Mul(readDecimal(r, "avg_cost"))
			g.qty = g.qty.Add(qty)
			g.amount = g.amount.Add(amount)
			if age > g.max {
				g.max = age
			}
			b := g.buckets[name]
			if b == nil {
				b = map[string]decimal.Decimal{"qty": decimal.Zero, "amount": decimal.Zero}
				g.buckets[name] = b
			}
			b["qty"] = b["qty"].Add(qty)
			b["amount"] = b["amount"].Add(amount)
		}
		for _, g := range groups {
			buckets := []map[string]any{}
			for _, name := range []string{"0-30天", "31-60天", "61-90天", "90天以上"} {
				b := g.buckets[name]
				if b == nil {
					b = map[string]decimal.Decimal{"qty": decimal.Zero, "amount": decimal.Zero}
				}
				buckets = append(buckets, map[string]any{"name": name, "qty": b["qty"].String(), "amount": b["amount"].String()})
			}
			out = append(out, map[string]any{"product_id": g.row["product_id"], "product_code": g.row["product_code"], "product_name": g.row["product_name"], "total_qty": g.qty.String(), "total_amount": g.amount.String(), "max_age_days": g.max, "buckets": buckets})
		}
		return out, nil
	}
	prices := map[string]map[string]any{}
	revenue, cost := decimal.Zero, decimal.Zero
	for _, key := range keys {
		g := groups[key]
		r := g.meta
		row := map[string]any{"product_id": r["product_id"], "product_code": r["product_code"], "product_name": r["product_name"], "total_qty": g.qty.String(), "total_amount": g.amount.String(), "order_count": len(g.orders)}
		switch mode {
		case "by-customer", "by-supplier":
			row = map[string]any{d.Party + "_id": r["party_id"], d.Party + "_name": r["party_name"], "total_amount": g.amount.String(), "order_count": len(g.orders), "avg_amount": g.amount.DivRound(decimal.NewFromInt(int64(len(g.orders))), 2).String()}
		case "trend":
			if family == "sales" {
				row = map[string]any{"period": key, "total_amount": g.amount.String(), "order_count": len(g.orders)}
			} else {
				row = map[string]any{"date": key, "amount": g.amount.String(), "order_count": len(g.orders)}
			}
		case "price-trend":
			id := value(r, "product_id")
			p := prices[id]
			if p == nil {
				p = map[string]any{"product_id": id, "product_code": r["product_code"], "product_name": r["product_name"], "points": []map[string]any{}}
				prices[id] = p
				out = append(out, p)
			}
			avg := decimal.Zero
			if !g.qty.IsZero() {
				avg = g.amount.DivRound(g.qty, 2)
			}
			point := map[string]any{"period": strings.Split(key, "|")[1], "avg_price": avg.String(), "min_price": g.min.String(), "max_price": g.max.String(), "total_qty": g.qty.String(), "order_count": len(g.orders)}
			p["points"] = append(p["points"].([]map[string]any), point)
			continue
		case "profit", "profit-summary":
			balanceSQL := "SELECT * FROM inventory_balances WHERE product_id=?"
			balanceArgs := []any{r["product_id"]}
			if warehouse := q.Get("warehouse_id"); warehouse != "" {
				balanceSQL += " AND warehouse_id=?"
				balanceArgs = append(balanceArgs, warehouse)
			}
			balances, e := s.Store.Rows(ctx, balanceSQL, balanceArgs...)
			if e != nil {
				return nil, e
			}
			avg := decimal.Zero
			stockQty := decimal.Zero
			stockValue := decimal.Zero
			for _, balance := range balances {
				qty := readDecimal(balance, "qty_available")
				stockQty = stockQty.Add(qty)
				stockValue = stockValue.Add(qty.Mul(readDecimal(balance, "avg_cost")))
			}
			if !stockQty.IsZero() {
				avg = stockValue.DivRound(stockQty, 6)
			}
			c := g.qty.Mul(avg)
			p := g.amount.Sub(c)
			margin := decimal.Zero
			if !g.amount.IsZero() {
				margin = p.Mul(decimal.NewFromInt(100)).DivRound(g.amount, 2)
			}
			row = map[string]any{"product_id": r["product_id"], "product_code": r["product_code"], "product_name": r["product_name"], "qty": g.qty.String(), "revenue": g.amount.String(), "cost": c.String(), "profit": p.String(), "margin_rate": margin.String()}
			revenue = revenue.Add(g.amount)
			cost = cost.Add(c)
		}
		out = append(out, row)
	}
	if mode == "profit-summary" {
		profit := revenue.Sub(cost)
		margin := decimal.Zero
		if !revenue.IsZero() {
			margin = profit.Mul(decimal.NewFromInt(100)).DivRound(revenue, 2)
		}
		return map[string]any{"total_revenue": revenue.String(), "total_cost": cost.String(), "total_profit": profit.String(), "margin_rate": margin.String(), "product_count": len(out)}, nil
	}
	return out, nil
}

func (s *Service) FulfillmentReport(ctx context.Context, q url.Values) ([]map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT o.id AS order_id,o.order_no,o.order_date,o.expected_date,o.status,o.customer_name,l.product_id,l.product_code,l.product_name,l.spec,l.qty,l.delivered_qty,l.price FROM sales_orders o JOIN sales_order_lines l ON l.order_id=o.id WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL AND o.status IN ('confirmed','approved','closed') ORDER BY o.order_date,o.order_no,l.line_no")
	if err != nil {
		return nil, err
	}
	nowDate := time.Now()
	out := []map[string]any{}
	for _, r := range rows {
		qty, delivered := readDecimal(r, "qty"), readDecimal(r, "delivered_qty")
		remaining := qty.Sub(delivered)
		if !remaining.IsPositive() {
			continue
		}
		expected := value(r, "expected_date")
		overdue := 0
		if expected != "" {
			if t, e := time.Parse(time.RFC3339Nano, expected); e == nil && nowDate.After(t) {
				overdue = int(nowDate.Sub(t).Hours() / 24)
			}
		}
		out = append(out, map[string]any{"order_id": r["order_id"], "order_no": r["order_no"], "order_type": "sales", "party_name": r["customer_name"], "product_id": r["product_id"], "product_code": r["product_code"], "product_name": r["product_name"], "spec": r["spec"], "qty": qty.String(), "delivered_qty": delivered.String(), "remaining_qty": remaining.String(), "price": readDecimal(r, "price").String(), "order_date": r["order_date"], "expected_date": r["expected_date"], "overdue_days": overdue, "status": r["status"]})
	}
	return out, nil
}

func (s *Service) FulfillmentSummary(ctx context.Context) ([]map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT o.id,o.customer_id,o.customer_name,o.expected_date,o.status,l.qty,l.delivered_qty,l.price FROM sales_orders o JOIN sales_order_lines l ON l.order_id=o.id WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL AND o.status IN ('confirmed','approved','closed')")
	if err != nil {
		return nil, err
	}
	type group struct {
		id, name                string
		orders                  map[string]bool
		qty, delivered, overdue decimal.Decimal
		overdueOrders           map[string]bool
	}
	groups := map[string]*group{}
	nowDate := time.Now()
	for _, r := range rows {
		id := value(r, "customer_id")
		g := groups[id]
		if g == nil {
			g = &group{id: id, name: value(r, "customer_name"), orders: map[string]bool{}, overdueOrders: map[string]bool{}}
			groups[id] = g
		}
		g.orders[value(r, "id")] = true
		qty, delivered := readDecimal(r, "qty"), readDecimal(r, "delivered_qty")
		g.qty = g.qty.Add(qty)
		g.delivered = g.delivered.Add(delivered)
		if expected := value(r, "expected_date"); expected != "" {
			if t, e := time.Parse(time.RFC3339Nano, expected); e == nil && nowDate.After(t) && delivered.LessThan(qty) {
				g.overdueOrders[value(r, "id")] = true
				g.overdue = g.overdue.Add(qty.Sub(delivered).Mul(readDecimal(r, "price")))
			}
		}
	}
	out := []map[string]any{}
	for _, g := range groups {
		rate := decimal.Zero
		if !g.qty.IsZero() {
			rate = g.delivered.Mul(decimal.NewFromInt(100)).DivRound(g.qty, 2)
		}
		out = append(out, map[string]any{"customer_id": g.id, "customer_name": g.name, "order_count": len(g.orders), "total_qty": g.qty.String(), "delivered_qty": g.delivered.String(), "fulfillment_rate": rate.String(), "overdue_order_count": len(g.overdueOrders), "overdue_amount": g.overdue.String()})
	}
	return out, nil
}

func (s *Service) SalesForecast(ctx context.Context, q url.Values) ([]map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT l.product_id,l.product_code,l.product_name,l.qty,o.order_date FROM sales_orders o JOIN sales_order_lines l ON l.order_id=o.id WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL AND o.status IN ('confirmed','approved','closed') ORDER BY o.order_date")
	if err != nil {
		return nil, err
	}
	type group struct {
		row    map[string]any
		months map[string]decimal.Decimal
	}
	groups := map[string]*group{}
	for _, r := range rows {
		month := value(r, "order_date")
		if len(month) >= 7 {
			month = month[:7]
		}
		g := groups[value(r, "product_id")]
		if g == nil {
			g = &group{row: r, months: map[string]decimal.Decimal{}}
			groups[value(r, "product_id")] = g
		}
		g.months[month] = g.months[month].Add(readDecimal(r, "qty"))
	}
	periods := 3
	if v := q.Get("periods"); v != "" {
		if n, e := strconv.Atoi(v); e == nil && n > 0 && n <= 24 {
			periods = n
		}
	}
	out := []map[string]any{}
	for _, g := range groups {
		total, count := decimal.Zero, 0
		months := make([]string, 0, len(g.months))
		for month := range g.months {
			months = append(months, month)
		}
		sort.Strings(months)
		for _, month := range months {
			v := g.months[month]
			total = total.Add(v)
			count++
		}
		avg := decimal.Zero
		if count > 0 {
			avg = total.DivRound(decimal.NewFromInt(int64(count)), 2)
		}
		points := []map[string]any{}
		for _, month := range months {
			points = append(points, map[string]any{"month": month, "actual": g.months[month].String(), "forecast": "0", "is_forecast": false})
		}
		start := time.Now().AddDate(0, 1, 0)
		for i := 0; i < periods; i++ {
			month := start.AddDate(0, i, 0).Format("2006-01")
			points = append(points, map[string]any{"month": month, "actual": "0", "forecast": avg.String(), "is_forecast": true})
		}
		out = append(out, map[string]any{"product_id": g.row["product_id"], "product_code": g.row["product_code"], "product_name": g.row["product_name"], "method": "moving_average", "method_name": "移动平均", "periods": periods, "lookback": count, "total_forecast": avg.Mul(decimal.NewFromInt(int64(periods))).String(), "avg_monthly": avg.String(), "points": points})
	}
	return out, nil
}

func (s *Service) Dashboard(ctx context.Context) (map[string]any, error) {
	var sales, purchases, stock, ar, ap decimal.Decimal
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT COALESCE(SUM(total_amount),0) FROM sales_orders WHERE deleted_at IS NULL AND status IN ('confirmed','approved','closed')").Scan(&sales); err != nil {
		return nil, err
	}
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT COALESCE(SUM(total_amount),0) FROM purchase_orders WHERE deleted_at IS NULL AND status IN ('confirmed','approved','closed')").Scan(&purchases); err != nil {
		return nil, err
	}
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT COALESCE(SUM(qty_available*avg_cost),0) FROM inventory_balances").Scan(&stock); err != nil {
		return nil, err
	}
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT COALESCE(SUM(balance),0) FROM ar_invoices WHERE deleted_at IS NULL").Scan(&ar); err != nil {
		return nil, err
	}
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT COALESCE(SUM(balance),0) FROM ap_invoices WHERE deleted_at IS NULL").Scan(&ap); err != nil {
		return nil, err
	}
	var low int
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT count(*) FROM inventory_balances b JOIN products p ON p.id=b.product_id WHERE b.qty_available < p.safety_stock").Scan(&low); err != nil {
		return nil, err
	}
	var openSales, openPurchases, draftsSales, draftsPurchases int
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT count(*) FROM sales_orders WHERE deleted_at IS NULL AND status IN ('draft','confirmed','approved')").Scan(&openSales); err != nil {
		return nil, err
	}
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT count(*) FROM purchase_orders WHERE deleted_at IS NULL AND status IN ('draft','confirmed','approved')").Scan(&openPurchases); err != nil {
		return nil, err
	}
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT count(*) FROM sales_orders WHERE deleted_at IS NULL AND status='draft'").Scan(&draftsSales); err != nil {
		return nil, err
	}
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT count(*) FROM purchase_orders WHERE deleted_at IS NULL AND status='draft'").Scan(&draftsPurchases); err != nil {
		return nil, err
	}
	var todaySales, todayPurchases decimal.Decimal
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT COALESCE(SUM(total_amount),0) FROM sales_orders WHERE deleted_at IS NULL AND date(order_date)=date('now','localtime')").Scan(&todaySales); err != nil {
		return nil, err
	}
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT COALESCE(SUM(total_amount),0) FROM purchase_orders WHERE deleted_at IS NULL AND date(order_date)=date('now','localtime')").Scan(&todayPurchases); err != nil {
		return nil, err
	}
	var revenue, cost, expense decimal.Decimal
	for _, item := range []struct {
		prefix string
		target *decimal.Decimal
	}{{"600", &revenue}, {"640", &cost}, {"660", &expense}} {
		var amount decimal.Decimal
		if err := s.Store.DB.QueryRowContext(ctx, "SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) FROM journal_entries WHERE account_code LIKE ? AND strftime('%Y-%m',entry_date)=strftime('%Y-%m','now','localtime')", item.prefix+"%").Scan(&amount); err != nil {
			return nil, err
		}
		*item.target = amount
	}
	profit := revenue.Sub(cost).Sub(expense)
	lowRows, err := s.Store.Rows(ctx, "SELECT p.code AS product_code,p.name AS product_name,w.name AS warehouse_name,b.qty_available,p.safety_stock,(p.safety_stock-b.qty_available) AS shortage_qty FROM inventory_balances b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id WHERE b.qty_available < p.safety_stock ORDER BY shortage_qty DESC LIMIT 20")
	if err != nil {
		return nil, err
	}
	lowItems := []any{}
	for _, row := range lowRows {
		lowItems = append(lowItems, map[string]any{"product_code": row["product_code"], "product_name": row["product_name"], "warehouse_name": row["warehouse_name"], "qty_available": readDecimal(row, "qty_available").String(), "safety_stock": readDecimal(row, "safety_stock").String(), "shortage_qty": readDecimal(row, "shortage_qty").String()})
	}
	topRows, err := s.Store.Rows(ctx, "SELECT l.product_code,l.product_name,SUM(l.qty) AS total_qty,SUM(l.amount) AS total_amount FROM sales_orders o JOIN sales_order_lines l ON l.order_id=o.id WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL AND o.status IN ('confirmed','approved','closed') GROUP BY l.product_id,l.product_code,l.product_name ORDER BY total_amount DESC LIMIT 10")
	if err != nil {
		return nil, err
	}
	topItems := []any{}
	for _, row := range topRows {
		topItems = append(topItems, map[string]any{"product_code": row["product_code"], "product_name": row["product_name"], "total_qty": readDecimal(row, "total_qty").String(), "total_amount": readDecimal(row, "total_amount").String()})
	}
	approvalRows, err := s.Store.Rows(ctx, "SELECT id,biz_type,biz_no,initiator_name,current_step,created_at FROM approval_records WHERE current_status='pending' ORDER BY created_at DESC LIMIT 20")
	if err != nil {
		return nil, err
	}
	pending := []any{}
	for _, row := range approvalRows {
		pending = append(pending, row)
	}
	aging, err := s.Aging(ctx, url.Values{"as_of": {time.Now().Format("2006-01-02")}}, "ar")
	if err != nil {
		return nil, err
	}
	agingMap := aging["buckets"]
	overdue := decimal.Zero
	if buckets, ok := agingMap.([]map[string]any); ok {
		for i, b := range buckets {
			if i > 0 {
				overdue = overdue.Add(readDecimal(b, "amount"))
			}
		}
	}
	apAging, err := s.Aging(ctx, url.Values{"as_of": {time.Now().Format("2006-01-02")}}, "ap")
	if err != nil {
		return nil, err
	}
	apOverdue := decimal.Zero
	if buckets, ok := apAging["buckets"].([]map[string]any); ok {
		for i, b := range buckets {
			if i > 0 {
				apOverdue = apOverdue.Add(readDecimal(b, "amount"))
			}
		}
	}
	salesTrend, err := s.TradeReport(ctx, url.Values{}, "sales", "trend")
	if err != nil {
		return nil, err
	}
	purchaseTrend, err := s.TradeReport(ctx, url.Values{}, "purchase", "trend")
	if err != nil {
		return nil, err
	}
	return map[string]any{"total_sales_amount": sales.String(), "total_purchase_amount": purchases.String(), "total_stock_value": stock.String(), "open_sales_orders": openSales, "open_purchase_orders": openPurchases, "low_stock_count": low, "today_sales_amount": todaySales.String(), "today_purchase_amount": todayPurchases.String(), "ar_balance": ar.String(), "ap_balance": ap.String(), "monthly_revenue": revenue.String(), "monthly_cost": cost.String(), "monthly_expense": expense.String(), "monthly_profit": profit.String(), "low_stock_items": lowItems, "pending_approvals": pending, "top_products": topItems, "receivable_aging": agingMap, "draft_sales_orders": draftsSales, "draft_purchase_orders": draftsPurchases, "overdue_receivable": overdue.String(), "overdue_payable": apOverdue.String(), "sales_trend": salesTrend, "purchase_trend": purchaseTrend}, nil
}

func (s *Service) InventoryReport(ctx context.Context, q url.Values, mode string) (any, error) {
	where := []string{"p.deleted_at IS NULL", "w.deleted_at IS NULL"}
	args := []any{}
	for _, key := range []string{"product_id", "warehouse_id"} {
		if v := q.Get(key); v != "" {
			where = append(where, "b."+key+"=?")
			args = append(args, v)
		}
	}
	rows, err := s.Store.Rows(ctx, "SELECT b.*,p.code AS product_code,p.name AS product_name,p.safety_stock,w.name AS warehouse_name FROM inventory_balances b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id WHERE "+strings.Join(where, " AND ")+" ORDER BY p.name,w.name", args...)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	if mode == "turnover" {
		for _, r := range rows {
			movementRows, err := s.Store.Rows(ctx, "SELECT qty,created_at,direction FROM stock_movements WHERE product_id=? AND warehouse_id=? ORDER BY created_at", r["product_id"], r["warehouse_id"])
			if err != nil {
				return nil, err
			}
			qty := readDecimal(r, "qty_available")
			issued := decimal.Zero
			var lastOut any
			for _, m := range movementRows {
				if readDecimal(m, "direction").IsNegative() {
					issued = issued.Add(readDecimal(m, "qty"))
					lastOut = m["created_at"]
				}
			}
			turnover := decimal.Zero
			if !qty.IsZero() {
				turnover = issued.DivRound(qty, 4)
			}
			row := map[string]any{"product_id": r["product_id"], "product_code": r["product_code"], "product_name": r["product_name"], "warehouse_name": r["warehouse_name"], "out_qty": issued.String(), "avg_stock": qty.String(), "turnover": turnover.String(), "turnover_days": "0", "last_out_at": lastOut}
			out = append(out, row)
		}
		return out, nil
	}
	groups := map[string]map[string]any{}
	for _, r := range rows {
		qty := readDecimal(r, "qty_available")
		amount := qty.Mul(readDecimal(r, "avg_cost"))
		if mode == "balance" {
			m := map[string]any{}
			for _, k := range []string{"product_id", "product_code", "product_name", "warehouse_id", "warehouse_name", "location_id", "rack_id"} {
				m[k] = r[k]
			}
			m["batch_no"] = value(r, "batch_no")
			for _, k := range []string{"qty_available", "qty_locked", "qty_in_transit", "avg_cost", "safety_stock"} {
				m[k] = readDecimal(r, k).String()
			}
			m["total_value"] = amount.Round(3).String()
			m["is_low_stock"] = qty.LessThan(readDecimal(r, "safety_stock"))
			out = append(out, m)
			continue
		}
		id := value(r, "product_id")
		g := groups[id]
		if g == nil {
			g = map[string]any{"product_id": id, "product_code": r["product_code"], "product_name": r["product_name"], "qty": "0", "amount": "0"}
			groups[id] = g
			out = append(out, g)
		}
		g["qty"] = readDecimal(g, "qty").Add(qty).String()
		g["amount"] = readDecimal(g, "amount").Add(amount).String()
	}
	if mode == "abc" {
		sort.Slice(out, func(i, j int) bool { return readDecimal(out[i], "amount").GreaterThan(readDecimal(out[j], "amount")) })
		total, cum := decimal.Zero, decimal.Zero
		for _, r := range out {
			total = total.Add(readDecimal(r, "amount"))
		}
		for _, r := range out {
			cum = cum.Add(readDecimal(r, "amount"))
			percent := decimal.Zero
			if !total.IsZero() {
				percent = cum.Mul(decimal.NewFromInt(100)).DivRound(total, 2)
			}
			class := "C"
			if percent.LessThanOrEqual(decimal.NewFromInt(80)) {
				class = "A"
			} else if percent.LessThanOrEqual(decimal.NewFromInt(95)) {
				class = "B"
			}
			r["cum_percent"], r["class"] = percent.String(), class
		}
	}
	return out, nil
}
