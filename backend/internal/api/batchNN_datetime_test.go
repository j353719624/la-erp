package api

import (
	"strings"
	"testing"
	"time"
)

// 本文件固化批次 NN 的 **datetime 读取缺陷**（`dateText` 的由来）。
//
// ## 缺陷本质
// SQLite 驱动按**列声明类型**自动转换：声明为 datetime 的列，即使写入的是
// RFC3339Nano 字符串，读回来也是 Go 的 `time.Time`（`2026-10-08 08:05:06.79 +0800 CST`）。
// 于是：
//   · `api.text()` 做 `.(string)` 断言 → **静默返回空串**（不报错）
//   · `business.value()` 用 `fmt.Sprint` → 输出 `2006-01-02 15:04:05 -0700 MST`，
//     **不是 RFC3339**，后续按 RFC3339 解析恒失败
//
// 批次 MM 的会计期间重叠判定栽在第一种（恒不重叠），本轮的履约报表逾期统计
// 栽在第二种（逾期天数恒为 0）—— 同一个坑的两种表现。
//
// ## 为什么这类缺陷难发现
// 两端 API 响应的时间字段**格式一致**（`Store.Public` 已做转换），
// 所以只比对响应看不出来；缺陷藏在**内部逻辑**里，表现为「某项统计恒为 0」。

// TestNNDateTimeIsTimeType 钉死「datetime 列读回来是 time.Time」这一事实。
//
// 这条不是断言原版行为，而是**锁定恢复端的运行前提**：一旦换驱动或改列类型
// 导致这里变成 string，本测试会红，提示重新评估 dateText 的必要性。
func TestNNDateTimeIsTimeType(t *testing.T) {
	_, s := setup(t)
	rows, err := s.Store.Rows(t.Context(), "SELECT created_at FROM products LIMIT 1")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Fatal("种子数据缺 products")
	}
	if _, ok := rows[0]["created_at"].(time.Time); !ok {
		t.Fatalf("created_at = %T %v, want time.Time（驱动不再自动转换时须重新评估 dateText）",
			rows[0]["created_at"], rows[0]["created_at"])
	}
}

// TestNNFulfillmentOverdue 履约报表的逾期天数**不再恒为 0**。
//
// 修复前：`expected_date` 经 value() 变成 `2026-10-08 08:05:06 +0800 CST`，
// `time.Parse(RFC3339Nano)` 失败 → overdue 恒 0，逾期金额也恒 0。
// 同文件 TradeReport 里已有一处针对 order_date 的兼容，另两个报表漏了。
func TestNNFulfillmentOverdue(t *testing.T) {
	c, _ := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "NN-C", "name": "NN 客户"}).(map[string]any)

	// 建一张**已确认**的销售订单，预期交期设在过去
	past := time.Now().AddDate(0, 0, -30).Format("2006-01-02T15:04:05+08:00")
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id":   customer["id"],
		"order_date":    time.Now().Format("2006-01-02T15:04:05+08:00"),
		"expected_date": past,
		"lines": []any{map[string]any{
			"product_id": product["id"], "qty": 10, "price": 5,
		}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)

	rows := c.ok("GET", "/api/v1/reports/trade/fulfillment", nil)
	list, ok := rows.([]any)
	if !ok {
		t.Fatalf("履约报表 = %T %v, want 数组", rows, rows)
	}
	found := false
	for _, item := range list {
		row := item.(map[string]any)
		if row["order_id"] != order["id"] {
			continue
		}
		found = true
		days, _ := row["overdue_days"].(float64)
		if days <= 0 {
			t.Fatalf("overdue_days = %v, want > 0（expected_date 在 30 天前）", row["overdue_days"])
		}
	}
	if !found {
		t.Fatalf("履约报表里没有本单: %v", list)
	}
}

// TestNNFulfillmentSummaryOverdue 汇总口径的逾期金额同样不再恒为 0。
func TestNNFulfillmentSummaryOverdue(t *testing.T) {
	c, _ := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "NN-C", "name": "NN 客户"}).(map[string]any)

	past := time.Now().AddDate(0, 0, -10).Format("2006-01-02T15:04:05+08:00")
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id":   customer["id"],
		"order_date":    time.Now().Format("2006-01-02T15:04:05+08:00"),
		"expected_date": past,
		"lines": []any{map[string]any{
			"product_id": product["id"], "qty": 4, "price": 100,
		}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/sales-orders/"+order["id"].(string)+"/confirm", nil)

	rows := c.ok("GET", "/api/v1/reports/trade/fulfillment-summary", nil)
	list, ok := rows.([]any)
	if !ok {
		t.Fatalf("履约汇总 = %T %v, want 数组", rows, rows)
	}
	for _, item := range list {
		row := item.(map[string]any)
		if row["customer_id"] != customer["id"] {
			continue
		}
		if n, _ := row["overdue_order_count"].(float64); n < 1 {
			t.Fatalf("overdue_order_count = %v, want >= 1", row["overdue_order_count"])
		}
		return
	}
	t.Fatalf("履约汇总里没有该客户: %v", list)
}

// TestNNOrderExpectedDate 销售订单 expected_date 的落库与格式校验。
//
// 修复前：`writeDocument` 的表头白名单只有 `[d.Date, "remark"]` 加
// advancedHeaderFields 的九个字段，expected_date 不在其中 → **静默丢弃**。
// 直接后果是履约报表的逾期天数与逾期金额恒为 0。
func TestNNOrderExpectedDate(t *testing.T) {
	c, _ := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "NN-C", "name": "NN 客户"}).(map[string]any)
	lines := []any{map[string]any{"product_id": product["id"], "qty": 10, "price": 5}}
	const ok = "2026-10-15T09:24:05+08:00"

	// 合法 → 落库并回读
	past := "2026-09-15T09:24:05+08:00"
	order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": customer["id"], "order_date": ok, "expected_date": past, "lines": lines,
	}).(map[string]any)
	if order["expected_date"] != past {
		t.Fatalf("建单返回 expected_date = %v, want %s", order["expected_date"], past)
	}
	detail := c.ok("GET", "/api/v1/sales-orders/"+order["id"].(string), nil).(map[string]any)
	if detail["expected_date"] != past {
		t.Fatalf("回读 expected_date = %v, want %s", detail["expected_date"], past)
	}

	// 非法（含空串）→ 400 parsing time 原文；null / 不传 → code:0
	for _, tc := range []struct {
		tag  string
		body map[string]any
		code float64
	}{
		{"仅日期", map[string]any{"expected_date": "2026-09-15"}, 400},
		{"空串", map[string]any{"expected_date": ""}, 400},
		{"乱串", map[string]any{"expected_date": "abc"}, 400},
		{"null", map[string]any{"expected_date": nil}, 0},
	} {
		t.Run(tc.tag, func(t *testing.T) {
			body := map[string]any{"customer_id": customer["id"], "order_date": ok, "lines": lines}
			for k, v := range tc.body {
				body[k] = v
			}
			status, got := c.request("POST", "/api/v1/sales-orders", body)
			if tc.code == 400 {
				if status != 400 || got["code"] != float64(400) {
					t.Fatalf("%s = %d %v, want 400", tc.tag, status, got)
				}
				if msg, _ := got["message"].(string); !strings.HasPrefix(msg, `请求参数错误: parsing time "`) {
					t.Fatalf("%s 文案 = %q, want 请求参数错误: parsing time 前缀", tc.tag, msg)
				}
				return
			}
			if status != 200 || got["code"] != tc.code {
				t.Fatalf("%s = %d %v, want 200/%v", tc.tag, status, got, tc.code)
			}
		})
	}
}

// TestNNOrderDateInvalid 订单日期非法的形态是 **400**，不是业务 10000。
//
// 原恢复端的「日期格式错误」（200 + code 10000）是自造文案；原版是
// 400 + 「请求参数错误: parsing time … as "2006-01-02T15:04:05Z07:00"」。
// layout 必须是 RFC3339（错误信息里没有 .999999999），不能用 RFC3339Nano。
func TestNNOrderDateInvalid(t *testing.T) {
	c, _ := setup(t)
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "NN-C", "name": "NN 客户"}).(map[string]any)
	status, body := c.request("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": customer["id"],
		"order_date":  "2026-09-15",
		"lines":       []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 1}},
	})
	if status != 400 || body["code"] != float64(400) {
		t.Fatalf("order_date 非法 = %d %v, want 400/400", status, body)
	}
	msg, _ := body["message"].(string)
	if !strings.HasPrefix(msg, `请求参数错误: parsing time "2026-09-15" as "2006-01-02T15:04:05Z07:00"`) {
		t.Fatalf("文案 = %q, want RFC3339 layout 的 parsing time 原文", msg)
	}
}
