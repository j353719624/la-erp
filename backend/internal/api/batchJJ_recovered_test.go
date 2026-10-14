package api

import (
	"testing"
)

// 本文件固化批次 JJ 的取证结论（2026-10-14 原版回放 192.168.110.97:18886）。
//
// 起因：backend/internal/database/database.go 的 Store.List 里那套查询参数
// （page 默认 1、page_size 默认 10 上限 1000、ORDER BY created_at DESC、
//   17 个精确过滤字段、5 个 LIKE 字段、keyword 按表分派）
// 全是照惯例推断的，此前**没有原版实据**。批次 JJ 用三轮回放逐条取回真实值。
//
// 结论：
//   - 分页默认值 10、page_size=0/负数回落 10、page 越界返回空、page 非数字回落 1 —— 一致
//   - 排序 created_at DESC —— 一致
//   - 过滤参数是**按表而异**的，恢复端少了几项前端真在用的：
//       order_no（包含匹配、区分大小写）／start_date ／end_date ／customer_id ／
//       supplier_id ／work_order_id ／source_type ／account_id
//     销售订单列表页（SalesOrderList.tsx）把关键字框映射到 order_no 并发 start_date/
//     end_date，这几项缺失等于「筛选点了没反应」。
//   - keyword 在科目列表页是**前端本地过滤**（不发查询参数），故恢复端多过滤不算问题
//
// 证据：evidence/backend-runtime/audit-batch-jj{,2,3}-20261014.json

// TestBatchJJPaginationDefaults 分页默认值与边界（回放 JJ-1~JJ-8、JJ-21/22）。
func TestBatchJJPaginationDefaults(t *testing.T) {
	c, product, warehouse, party := recoveredFixture(t, "JJ-PAGE")
	customer := party["customer"].(map[string]any)
	for i := 0; i < 12; i++ {
		c.ok("POST", "/api/v1/sales-orders", map[string]any{
			"customer_id": customer["id"], "warehouse_id": warehouse["id"],
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 10}},
		})
	}
	total := func(query string) float64 {
		t.Helper()
		return c.ok("GET", "/api/v1/sales-orders?"+query, nil).(map[string]any)["total"].(float64)
	}
	count := func(query string) int {
		t.Helper()
		return len(c.ok("GET", "/api/v1/sales-orders?"+query, nil).(map[string]any)["list"].([]any))
	}
	if got := total("page=1"); got != 12 {
		t.Fatalf("total = %v, want 12", got)
	}
	// 不带 page_size → 默认 10
	if got := count("page=1"); got != 10 {
		t.Fatalf("默认 page_size 返回 %d 条, want 10", got)
	}
	// page_size=0 / 负数 → 同样回落 10
	if got := count("page=1&page_size=0"); got != 10 {
		t.Fatalf("page_size=0 返回 %d 条, want 10", got)
	}
	if got := count("page=1&page_size=-5"); got != 10 {
		t.Fatalf("page_size=-5 返回 %d 条, want 10", got)
	}
	// page 越界 → 空列表，total 不变
	if got := count("page=9999&page_size=10"); got != 0 {
		t.Fatalf("page 越界返回 %d 条, want 0", got)
	}
	// page 非数字 → 回落第 1 页
	if got := count("page=abc&page_size=10"); got != 10 {
		t.Fatalf("page 非数字返回 %d 条, want 10", got)
	}
}

// TestBatchJJOrderNoContains 单号按「包含」匹配且区分大小写（回放 JJ3-A3/A4/A5）。
func TestBatchJJOrderNoContains(t *testing.T) {
	c, product, warehouse, party := recoveredFixture(t, "JJ-NO")
	customer := party["customer"].(map[string]any)
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": customer["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 10}},
	}).(map[string]any)
	no := order["order_no"].(string)
	if len(no) < 4 {
		t.Fatalf("单号异常: %q", no)
	}
	total := func(query string) float64 {
		t.Helper()
		return c.ok("GET", "/api/v1/sales-orders?"+query, nil).(map[string]any)["total"].(float64)
	}
	if got := total("order_no=" + no); got != 1 {
		t.Fatalf("完整单号 total = %v, want 1", got)
	}
	// 去掉末位（前缀）仍命中 → 是「包含」而非「相等」
	if got := total("order_no=" + no[:len(no)-1]); got != 1 {
		t.Fatalf("前缀单号 total = %v, want 1", got)
	}
	// 中缀也命中
	if got := total("order_no=" + no[2:]); got != 1 {
		t.Fatalf("中缀单号 total = %v, want 1", got)
	}
	// 大小写敏感：原版小写查不到（回放 JJ3-A5）
	lower := ""
	for _, r := range no {
		if r >= 'A' && r <= 'Z' {
			lower += string(r + 32)
		} else {
			lower += string(r)
		}
	}
	if lower != no {
		if got := total("order_no=" + lower); got != 0 {
			t.Fatalf("小写单号 total = %v, want 0（原版区分大小写）", got)
		}
	}
}

// TestBatchJJDateRange 日期区间的上下界写法不对称（回放 JJ3-B / JJ5）。
//
// 下界 `order_date >= start_date`（直接比对），上界 `date(order_date) <= date(end_date)`
// （经 SQLite date() 归一到 UTC）。因此 order_date=2026-10-13T00:00:00+08:00 的记录
// 在 end_date=2026-10-12 时**仍会被查到**（归一后是 2026-10-12），而 end_date=2026-10-11 查不到。
func TestBatchJJDateRange(t *testing.T) {
	c, product, warehouse, party := recoveredFixture(t, "JJ-DATE")
	customer := party["customer"].(map[string]any)
	// 复刻原版样本的 order_date 分布：10-13 一条、10-14 两条
	for _, date := range []string{"2026-10-13T00:00:00+08:00", "2026-10-14T00:00:00+08:00", "2026-10-14T00:00:00+08:00"} {
		c.ok("POST", "/api/v1/sales-orders", map[string]any{
			"customer_id": customer["id"], "warehouse_id": warehouse["id"], "order_date": date,
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 10}},
		})
	}
	total := func(query string) float64 {
		t.Helper()
		return c.ok("GET", "/api/v1/sales-orders?"+query, nil).(map[string]any)["total"].(float64)
	}
	// 下界（回放 JJ5：start 10-12→3、10-13→3、10-14→2、10-15→0）
	for date, want := range map[string]float64{
		"2026-10-12": 3, "2026-10-13": 3, "2026-10-14": 2, "2026-10-15": 0,
	} {
		if got := total("start_date=" + date); got != want {
			t.Fatalf("start_date=%s total = %v, want %v", date, got, want)
		}
	}
	// 上界（回放 JJ5：end 10-10→0、10-11→0、10-12→1、10-13→3、10-14→3、10-15→3）
	for date, want := range map[string]float64{
		"2026-10-10": 0, "2026-10-11": 0, "2026-10-12": 1,
		"2026-10-13": 3, "2026-10-14": 3, "2026-10-15": 3,
	} {
		if got := total("end_date=" + date); got != want {
			t.Fatalf("end_date=%s total = %v, want %v", date, got, want)
		}
	}
}

// TestBatchJJForeignKeyFilters 外键过滤（回放 JJ2）：恢复端此前不认 customer_id 等，
// 销售订单列表页按客户筛选等于失效。
func TestBatchJJForeignKeyFilters(t *testing.T) {
	c, product, warehouse, party := recoveredFixture(t, "JJ-FK")
	customer := party["customer"].(map[string]any)
	supplier := party["supplier"].(map[string]any)

	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": customer["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 10}},
	}).(map[string]any)

	total := func(route, query string) float64 {
		t.Helper()
		return c.ok("GET", "/api/v1/"+route+"?"+query, nil).(map[string]any)["total"].(float64)
	}

	// customer_id 精确过滤：命中本人 1 条、零 UUID 0 条
	if got := total("sales-orders", "customer_id="+customer["id"].(string)); got != 1 {
		t.Fatalf("customer_id 命中 total = %v, want 1", got)
	}
	if got := total("sales-orders", "customer_id=00000000-0000-0000-0000-000000000000"); got != 0 {
		t.Fatalf("customer_id=零UUID total = %v, want 0", got)
	}
	_ = order

	// supplier_id 精确过滤（采购订单）
	c.ok("POST", "/api/v1/purchase-orders", map[string]any{
		"supplier_id": supplier["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 10}},
	})
	if got := total("purchase-orders", "supplier_id="+supplier["id"].(string)); got != 1 {
		t.Fatalf("supplier_id 命中 total = %v, want 1", got)
	}
	if got := total("purchase-orders", "supplier_id=00000000-0000-0000-0000-000000000000"); got != 0 {
		t.Fatalf("supplier_id=零UUID total = %v, want 0", got)
	}
}

// TestBatchJJSourceTypeFilter source_type 精确过滤（回放 JJ2：vouchers / stock-movements 生效）。
func TestBatchJJSourceTypeFilter(t *testing.T) {
	c, _, _, _ := recoveredFixture(t, "JJ-SRC")
	total := func(query string) float64 {
		t.Helper()
		return c.ok("GET", "/api/v1/stock-movements?"+query, nil).(map[string]any)["total"].(float64)
	}
	// 库存流水支持 source_type；不存在的源类型应过滤为 0（而不是被忽略返回全部）
	if got := total("source_type=ZZZ_NOT_EXIST"); got != 0 {
		t.Fatalf("source_type 不生效: total = %v, want 0", got)
	}
	_ = c
}
