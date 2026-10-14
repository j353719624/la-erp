package api

import (
	"net/http"
	"testing"
)

// 本文件固化批次 MM 已实测确认的 P0 口径（2026-10-15 原版 192.168.110.97:18886 回放，
// 见 docs/UNSUPPORTED-AUDIT-LOG.md 37.2）：会计期间 period 的格式必须是 **YYYY-MM**。
//
// 起因：恢复端 Resources 里 accounting-periods 的必填字段错配成了
// start_date / end_date，于是 `{"period":"2026-10"}`（原版 200 成功的请求）
// 被恢复端以「start_date 为必填字段」拒掉 —— 会计期间根本建不出来。
//
// 断言原则与项目铁律一致：**原版有文案就逐字照抄**，不「优化」措辞；
// 错误形态（400 vs 200+10000）也照抄，不按常理「修正」。

// TestMMAccountingPeriodCreate 固化上表 4 条实测断言。
func TestMMAccountingPeriodCreate(t *testing.T) {
	c, _ := setup(t)

	// ① {} → 400「期间不能为空」
	//    注意：不是通用的「请求参数错误：period 为必填字段」。
	status, body := c.request("POST", "/api/v1/accounting-periods", map[string]any{})
	if status != http.StatusBadRequest || body["message"] != "期间不能为空" {
		t.Fatalf("POST /accounting-periods {} = %d %v,\n want 400/期间不能为空", status, body)
	}

	// ② {"period":"2026-10"} → 200 success，且 period 原样落库为 YYYY-MM
	created := c.ok("POST", "/api/v1/accounting-periods", map[string]any{"period": "2026-10"}).(map[string]any)
	if created["period"] != "2026-10" {
		t.Fatalf("新建会计期间 period = %v, want 2026-10（不得做日期转换）", created["period"])
	}
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("创建未返回 id: %v", created)
	}

	// ③ {"period":"2026-10-01T00:00:00+08:00"} → 200 + code 10000「期间格式错误，应为 YYYY-MM」
	//    关键点：这是**业务错误形态**（HTTP 200 + code 10000），不是 400。
	status, body = c.request("POST", "/api/v1/accounting-periods", map[string]any{
		"period": "2026-10-01T00:00:00+08:00",
	})
	const formatMsg = "期间格式错误，应为 YYYY-MM"
	if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != formatMsg {
		t.Fatalf("POST /accounting-periods period=完整时间戳 = %d %v,\n want 200/10000/%s", status, body, formatMsg)
	}

	// ③ 补充：其它非 YYYY-MM 形态同样落格式错分支
	for _, period := range []string{"2026-1", "2026-100", "2026/10", "2026年10月", "abc", " 2026-10"} {
		status, body = c.request("POST", "/api/v1/accounting-periods", map[string]any{"period": period})
		if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != formatMsg {
			t.Fatalf("POST /accounting-periods period=%q = %d %v, want 200/10000/%s", period, status, body, formatMsg)
		}
	}

	// ④ {"start_date":"2026-10-01","end_date":"2026-10-31"} → 400 + Go time.Parse 报错
	//    注意：这里既没有 period 也没有报「期间不能为空」—— 原版的日期绑定
	//    **早于** period 校验，故报的是 Go 标准库的 parse 错误。
	status, body = c.request("POST", "/api/v1/accounting-periods", map[string]any{
		"start_date": "2026-10-01", "end_date": "2026-10-31",
	})
	if status != http.StatusBadRequest {
		t.Fatalf("POST /accounting-periods 仅带日期 = %d %v, want 400", status, body)
	}
	// 逐字对齐原版的 Go 报错文案（含 layout 与非法值的原文）
	wantParse := "请求参数错误: parsing time \"2026-10-01\" as " +
		"\"2006-01-02T15:04:05Z07:00\": cannot parse \"\" as \"T\""
	if body["message"] != wantParse {
		t.Fatalf("POST /accounting-periods 仅带日期 的 message = %v,\n want %s", body["message"], wantParse)
	}

	// 期初余额与结账/反结账仍按 YYYY-MM 的 period 工作（回归：period 形态变了，
	// 但会计期间相关的既有端点不能因此坏掉）。
	if status, body = c.request("POST", "/api/v1/accounting-periods/"+id+"/close", nil); status != http.StatusOK {
		t.Fatalf("close 新建的会计期间 = %d %v, want 200", status, body)
	}
}
